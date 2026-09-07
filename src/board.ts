import type { AmbrosioConfig } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import * as agents from "./agents.ts";
import type { Agent } from "./agents.ts";
import * as queue from "./queue.ts";
import { lastActivityAt } from "./transcript.ts";
import { duration, type BoardState } from "./digest.ts";
import { readPause } from "./pause.ts";
import { standing } from "./standing.ts";
import { landable as assessLandable, type Assessment } from "./landable.ts";
import * as timeline from "./timeline.ts";
import { orderReady } from "./chain.ts";
import { readBrief } from "./handover.ts";

export type Deps = {
  listTickets: (repo: { name: string; path: string; prefix: string }, statuses?: string[]) => Ticket[];
  listAgents: () => Agent[];
  listQueue: (home: string) => queue.QueueItem[];
};

const realDeps: Deps = {
  listTickets: (repo, statuses) => tracker.list(repo, statuses),
  listAgents: () => agents.list(),
  listQueue: (home) => queue.listOpen(home),
};

export type Board = BoardState & {
  /** For every ticket in `accept`: could Jaime merge it right now, and if not why. */
  landable: Record<string, Assessment>;
  ready: Ticket[];
  needsInput: Ticket[];
  all: Ticket[];
  agents: Agent[];
};

/** A session the daemon still calls `working` that has in fact gone quiet. */
export type Stale = { agent: Agent; ticket?: Ticket; silentMinutes: number };

/**
 * One read of the whole world: tickets across every repo, live sessions,
 * parked questions, and the anomalies that deserve a human's attention.
 */
export function collectBoard(
  cfg: AmbrosioConfig,
  now = new Date(),
  deps: Deps = realDeps,
  lastActivity: (a: Agent) => Date | null = (a) => (a.sessionId ? lastActivityAt(a.sessionId, a.cwd) : null),
  landable: (cfg: AmbrosioConfig, repo: string, ticket: string) => Assessment = assessLandable,
): Board {
  const all: Ticket[] = [];
  const errors: string[] = [];
  for (const repo of cfg.repos) {
    try {
      all.push(...deps.listTickets(repo));
    } catch (e) {
      errors.push(`could not read tickets in ${repo.name}: ${(e as Error).message}`);
    }
  }

  let live: Agent[] = [];
  try {
    live = deps.listAgents();
  } catch (e) {
    errors.push(`could not list sessions: ${(e as Error).message}`);
  }
  const workers = live.filter((a) => a.kind === "background");

  const questions = deps.listQueue(cfg.homeDir);
  const byStatus = (s: string) => all.filter((t) => t.status === s);

  const plans = byStatus("plan_review");
  const accept = byStatus("in_review");
  const needsInput = byStatus("needs_input");
  const blocked = [...byStatus("blocked"), ...needsInput];
  const activeTickets = all.filter((t) => (tracker.ACTIVE_STATUSES as readonly string[]).includes(t.status));

  // `state` is the daemon's word, and it outlives the session: a finished
  // worker keeps reporting `working` while its pid is recycled into a spare.
  // Trusting it cost a WIP slot for 3h44 on 2026-09-07. The transcript is the
  // only witness that cannot lie about whether anything is still happening.
  const stale: Stale[] = [];
  const working: { agent: Agent; ticket?: Ticket }[] = [];
  for (const a of workers) {
    if (a.state !== "working" && a.state !== "blocked") continue;
    const ticket = activeTickets.find((t) => t.id === a.name);
    const mins = a.state === "working" ? silentMinutes(a, lastActivity, now) : null;
    if (mins !== null && mins >= SILENT_MINUTES) stale.push({ agent: a, ticket, silentMinutes: mins });
    else working.push({ agent: a, ticket });
  }

  // "Work should always be in a mergeable state": the board asserts it per
  // ticket rather than leaving Jaime to open each PR and find out.
  const landableBy: Record<string, Assessment> = {};
  const iterations: Record<string, number> = {};
  const briefs: Record<string, string> = {};
  // Defects that hold a parent back from acceptance: they go to the front of
  // the queue, because finishing what is blocked beats starting what is new.
  const blocking: Record<string, string> = {};
  for (const t of accept) {
    const n = timeline.iterationOf(timeline.read(cfg.homeDir, t.repo ?? "", t.id));
    if (n > 0) iterations[t.id] = n;
    const b = readBrief(cfg.homeDir, t.repo ?? "", t.id);
    if (b?.summary) briefs[t.id] = b.summary;
    try {
      landableBy[t.id] = landable(cfg, t.repo ?? "", t.id);
      const m = /open defects: ([^;]+)/.exec(landableBy[t.id].reasons.join("; "));
      if (m) for (const id of m[1].split(",").map((x) => x.trim())) blocking[id] = t.id;
    } catch (e) {
      errors.push(`could not assess whether ${t.id} is landable: ${(e as Error).message}`);
    }
  }

  const anomalies = [...errors, ...detectAnomalies(cfg, all, workers, questions, lastActivity, now)];

  return {
    now,
    questions,
    plans,
    accept,
    working,
    blocked,
    anomalies,
    stale,
    landable: landableBy,
    iterations,
    briefs,
    paused: readPause(cfg.homeDir),
    instructions: standing(cfg.homeDir).map((e) => e.text),
    ready: orderReady(all.filter((t) => t.status === "open"), blocking),
    needsInput,
    all,
    agents: live,
    tokensToday: workers.reduce((sum, a) => sum + (a.tokens ?? 0), 0) || undefined,
  };
}

/** Things that are wrong and a human would want named. */
/** A session that has emitted nothing for this long is not really working. */
export const SILENT_MINUTES = 45;

/** Minutes since this session last wrote anything, or null if it never has. */
function silentMinutes(a: Agent, lastActivity: (a: Agent) => Date | null, now: Date): number | null {
  const last = lastActivity(a);
  return last ? Math.round((now.getTime() - last.getTime()) / 60000) : null;
}

export function detectAnomalies(
  cfg: AmbrosioConfig,
  tickets: Ticket[],
  workers: Agent[],
  questions: queue.QueueItem[],
  lastActivity: (a: Agent) => Date | null = (a) => (a.sessionId ? lastActivityAt(a.sessionId, a.cwd) : null),
  now: Date = new Date(),
): string[] {
  const out: string[] = [];

  for (const a of workers) {
    if (a.state === "failed") out.push(`${a.name ?? a.id} failed: ${a.detail ?? "no detail"}`);
    // A stale `working` flag is worse than a crash: it looks healthy, and it
    // holds a WIP slot while quietly blocking every answer bound for it.
    if (a.state === "working") {
      const mins = silentMinutes(a, lastActivity, now);
      if (mins !== null && mins >= SILENT_MINUTES) {
        out.push(`${a.name ?? a.id} is marked working but has done nothing for ${duration(mins)} — its WIP slot is free and answers for it are being held`);
      }
    }
    if (a.state === "stopped" && a.name && tickets.some((t) => t.id === a.name && (tracker.ACTIVE_STATUSES as readonly string[]).includes(t.status))) {
      out.push(`${a.name} stopped while its ticket is still active`);
    }
  }

  // A ticket that thinks work is happening but has no live session behind it.
  const workerNames = new Set(workers.filter((w) => w.state === "working" || w.state === "blocked").map((w) => w.name));
  for (const t of tickets) {
    if ((tracker.ACTIVE_STATUSES as readonly string[]).includes(t.status) && !workerNames.has(t.id)) {
      out.push(`${t.repo} ${t.id} is ${t.status} but no session is running for it`);
    }
  }

  const urgent = questions.filter((q) => q.urgent);
  if (urgent.length > 0) out.push(`${urgent.length} urgent question${urgent.length > 1 ? "s" : ""} waiting`);

  return out;
}

/** How many WIP slots are in use right now. */
export function wipUsed(board: Board): number {
  return board.working.length;
}

export function canDispatch(cfg: AmbrosioConfig, board: Board): boolean {
  return wipUsed(board) < cfg.wipLimit;
}
