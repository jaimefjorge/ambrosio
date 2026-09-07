import type { AmbrosioConfig } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import * as agents from "./agents.ts";
import type { Agent } from "./agents.ts";
import * as queue from "./queue.ts";
import { lastActivityAt } from "./transcript.ts";
import type { BoardState } from "./digest.ts";

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
  ready: Ticket[];
  needsInput: Ticket[];
  all: Ticket[];
  agents: Agent[];
};

/**
 * One read of the whole world: tickets across every repo, live sessions,
 * parked questions, and the anomalies that deserve a human's attention.
 */
export function collectBoard(cfg: AmbrosioConfig, now = new Date(), deps: Deps = realDeps): Board {
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

  const working = workers
    .filter((a) => a.state === "working" || a.state === "blocked")
    .map((a) => ({ agent: a, ticket: activeTickets.find((t) => t.id === a.name) }));

  const anomalies = [...errors, ...detectAnomalies(cfg, all, workers, questions)];

  return {
    now,
    questions,
    plans,
    accept,
    working,
    blocked,
    anomalies,
    ready: all.filter((t) => t.status === "open"),
    needsInput,
    all,
    agents: live,
    tokensToday: workers.reduce((sum, a) => sum + (a.tokens ?? 0), 0) || undefined,
  };
}

/** Things that are wrong and a human would want named. */
/** A session that has emitted nothing for this long is not really working. */
export const SILENT_MINUTES = 45;

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
      const last = lastActivity(a);
      const mins = last ? Math.round((now.getTime() - last.getTime()) / 60000) : null;
      if (mins !== null && mins >= SILENT_MINUTES) {
        out.push(`${a.name ?? a.id} is marked working but has done nothing for ${mins < 120 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`} — answers for it are being held`);
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
