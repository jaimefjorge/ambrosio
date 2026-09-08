import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import type { Board } from "./board.ts";
import { collectBoard } from "./board.ts";
import { assignKeys } from "./digest.ts";
import * as queue from "./queue.ts";
import { readTranscript, lastActivityAt, type Event } from "./transcript.ts";
import { applyAnswer } from "./dispatch.ts";
import { applyDecision, type Decision } from "./decide.ts";
import { buildBrief, realMorningDeps } from "./morning.ts";
import { readFocus, setFocus } from "./today.ts";
import { ask } from "./ask.ts";
import { saveReview, readReview, recentLessons } from "./review.ts";
import { isAfterHours } from "./afterhours.ts";
import * as journal from "./journal.ts";
import { dispatchTicket } from "./dispatch.ts";
import { canDispatch, wipUsed } from "./board.ts";
import * as tracker from "./tracker.ts";
import * as timeline from "./timeline.ts";
import type { TimelineEvent } from "./timeline.ts";
import { readBrief, type Brief } from "./handover.ts";
import { missionMap } from "./mission.ts";
import { beginDay } from "./begin.ts";
import { repoByName } from "./config.ts";
import { readDialog, standing, retire, type Entry } from "./standing.ts";
import { say } from "./dialog.ts";
import { realDeps, routeReply } from "./watch.ts";

/**
 * Bumped whenever the API changes. The page carries the same constant and says
 * so when they disagree: `Bun.serve` re-reads the HTML from disk on every
 * request but keeps its routes in memory, so an old server can otherwise serve
 * a new page and fail in ways that look like missing data.
 */
export const UI_VERSION = "15";

/** How much of the thread the page shows; the file keeps all of it. */
const DIALOG_TAIL = 40;

export type UiWorker = {
  id?: string;
  name?: string;
  state: string;
  detail?: string;
  needs?: string;
  tokens?: number;
  startedAt?: number;
  cwd: string;
  /** Minutes since this session last said anything; null when it never has. */
  silentFor: number | null;
  title?: string;
  repo?: string;
  ticketStatus?: string;
};

export type UiQuestion = {
  key: string;
  qid: string;
  ticket: string;
  repo: string;
  urgent: boolean;
  summary: string;
  options: string[];
  askedAt?: string;
};

/** A plan to review, or finished work to accept: the other two things that wait on Jaime. */
export type UiDecision = { key: string; id: string; repo: string; title: string; status: string; iteration?: number; brief?: string; landable?: { ok: boolean; pr: { number: number; url: string } | null; reasons: string[] } };

export type UiPayload = {
  now: string;
  wip: { used: number; limit: number };
  workers: UiWorker[];
  questions: UiQuestion[];
  plans: UiDecision[];
  accept: UiDecision[];
  tickets: { id: string; repo: string; title: string; status: string }[];
  anomalies: string[];
  tokensToday?: number;
  paused?: { since: string; reason: string } | null;
  /** Standing instructions from the dialog, still in force. */
  instructions?: { id: string; text: string; at: string }[];
  /** The last stretch of the dialog, oldest first. */
  dialog?: Entry[];
};

/** Sessions that still hold a WIP slot. */
const BUSY = new Set(["working", "blocked"]);

/**
 * The whole fleet, shaped for one screen.
 *
 * Every background session appears, including the ones that finished or died:
 * a worker that failed silently is exactly what this view exists to catch.
 */
export function buildPayload(cfg: AmbrosioConfig, board: Board): UiPayload {
  const byId = new Map(board.all.map((t) => [t.id.toLowerCase(), t]));
  const keys = assignKeys(board);

  // The board has already reconciled the daemon's `state` against the
  // transcript. Reading `a.state` again here is how the screen came to show a
  // dead worker as working, and to count it against WIP, on 2026-09-07.
  const staleById = new Map((board.stale ?? []).map((s) => [s.agent.id ?? s.agent.name, s]));

  const workers: UiWorker[] = board.agents
    .filter((a) => a.kind === "background")
    .map((a) => {
      const ticket = a.name ? byId.get(a.name.toLowerCase()) : undefined;
      const stale = staleById.get(a.id ?? a.name);
      const last = a.state === "working" && a.sessionId ? lastActivityAt(a.sessionId, a.cwd) : null;
      return {
        id: a.id,
        name: a.name,
        state: stale ? "stale" : (a.state ?? "unknown"),
        detail: a.detail,
        needs: a.needs,
        tokens: a.tokens,
        startedAt: a.startedAt,
        cwd: a.cwd,
        silentFor: stale ? stale.silentMinutes : last ? Math.round((Date.now() - last.getTime()) / 60000) : null,
        title: ticket?.title,
        repo: ticket?.repo,
        ticketStatus: ticket?.status,
      };
    });

  const questions: UiQuestion[] = Object.entries(keys.questions).map(([key, q]) => ({
    key,
    qid: q.qid,
    ticket: q.ticket,
    repo: q.repo,
    urgent: q.urgent,
    summary: queue.summarize(q),
    options: queue.optionLabels(q),
    askedAt: q.createdAt,
  }));

  const decisions = (from: Record<string, any>): UiDecision[] =>
    Object.entries(from).map(([key, t]) => {
      const land = board.landable?.[t.id];
      const round = board.iterations?.[t.id];
      const brief = board.briefs?.[t.id];
      return { key, id: t.id, repo: t.repo ?? "", title: t.title, status: t.status, ...(round ? { iteration: round } : {}), ...(brief ? { brief } : {}), ...(land ? { landable: { ok: land.ok, pr: land.pr ? { number: land.pr.number, url: land.pr.url } : null, reasons: land.reasons } } : {}) };
    });

  return {
    now: board.now.toISOString(),
    wip: { used: (board.working ?? []).length, limit: cfg.wipLimit },
    workers,
    questions,
    plans: decisions(keys.plans),
    accept: decisions(keys.accept),
    tickets: board.all.map((t) => ({ id: t.id, repo: t.repo ?? "", title: t.title, status: t.status })),
    anomalies: board.anomalies,
    tokensToday: board.tokensToday,
    paused: board.paused ?? null,
    instructions: standing(cfg.homeDir).map((e) => ({ id: e.id, text: e.text, at: e.at })),
    dialog: readDialog(cfg.homeDir).slice(-DIALOG_TAIL),
  };
}

export type UiWorkerDetail = {
  worker: UiWorker;
  sessionId?: string;
  transcript: Event[];
  ticket?: { id: string; repo: string; title: string; status: string; description?: string; acceptance?: string };
  questions: UiQuestion[];
};

/**
 * One worker, in full: what it is doing right now, the ticket it is doing it
 * for, and anything it has parked for Jaime.
 */
export type UiTicketDetail = {
  ticket: { id: string; repo: string; title: string; status: string; priority: number; description?: string; acceptance: string[] };
  externalRef?: string;
  /** The worker's own hand-over line: PR, tests, Verity, reviewer. */
  handover: string;
  comments: { author: string; text: string; at: string }[];
  landable?: { ok: boolean; pr: { number: number; url: string } | null; reasons: string[] };
  defects: { id: string; title: string; status: string }[];
  plan: string;
  evidence: string;
  worker?: UiWorker;
  /** Everything that happened to it, oldest first. */
  timeline: TimelineEvent[];
  /** Ambrosio's hand-over brief for this round, or null if not written yet. */
  brief: Brief | null;
  /** Rounds of rework so far. */
  iteration: number;
};

export type TicketDetailDeps = {
  comments: (cfg: AmbrosioConfig, repo: string, id: string) => { id: string; author: string; text: string; created_at: string }[];
  defects: (cfg: AmbrosioConfig, repo: string, id: string) => { id: string; title: string; status: string }[];
  /** A file from the ticket's work dir, or null if it does not exist. */
  file: (cfg: AmbrosioConfig, repo: string, id: string, name: string) => string | null;
};

const realTicketDeps: TicketDetailDeps = {
  comments: (cfg, repo, id) => tracker.comments(repoByName(cfg, repo), id),
  defects: (cfg, repo, id) => tracker.discoveredFrom(repoByName(cfg, repo), id).map((t) => ({ id: t.id, title: t.title, status: t.status })),
  file: (cfg, repo, id, name) => {
    const f = join(journal.workDir(cfg.homeDir, repo, id), name);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  },
};

/** Keep the last stretch of a work file; the whole thing is on disk. */
function tail(text: string | null, lines: number): string {
  if (!text) return "";
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n").trim();
}

/**
 * Everything Jaime needs to accept or reject one piece of work, in one
 * place: what was asked, the criteria one by one, what the worker said at
 * hand-over, whether it can land and why not, what it filed on the way, and
 * the evidence it wrote. "I need to be able to click this and get more
 * context about it."
 */
export function buildTicketDetail(cfg: AmbrosioConfig, board: Board, repo: string, id: string, deps: TicketDetailDeps = realTicketDeps): UiTicketDetail | null {
  const t = board.all.find((x) => x.id.toLowerCase() === id.toLowerCase() && (!x.repo || x.repo === repo));
  if (!t) return null;
  const comments = safely(() => deps.comments(cfg, repo, t.id), []);
  const last = comments.length ? comments[comments.length - 1].text : "";
  const land = board.landable?.[t.id];
  const payload = buildPayload(cfg, board);
  const events = timeline.read(cfg.homeDir, repo, t.id);
  return {
    ticket: {
      id: t.id, repo, title: t.title, status: t.status, priority: t.priority,
      description: t.description,
      acceptance: (t.acceptance_criteria ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    },
    externalRef: t.external_ref,
    handover: last,
    comments: comments.slice(-5).map((c) => ({ author: c.author, text: c.text, at: c.created_at })),
    landable: land ? { ok: land.ok, pr: land.pr ? { number: land.pr.number, url: land.pr.url } : null, reasons: land.reasons } : undefined,
    defects: safely(() => deps.defects(cfg, repo, t.id), []),
    plan: tail(safely(() => deps.file(cfg, repo, t.id, "plan.md"), null), 40),
    evidence: tail(safely(() => deps.file(cfg, repo, t.id, "evidence.md"), null), 60),
    worker: payload.workers.find((w) => w.name?.toLowerCase() === t.id.toLowerCase()),
    timeline: events,
    iteration: timeline.iterationOf(events),
    brief: readBrief(cfg.homeDir, repo, t.id),
  };
}

function safely<T>(f: () => T, fallback: T): T {
  try { return f(); } catch { return fallback; }
}

export function buildWorkerDetail(
  cfg: AmbrosioConfig,
  board: Board,
  id: string,
  read: typeof readTranscript = readTranscript,
): UiWorkerDetail | null {
  const payload = buildPayload(cfg, board);
  const worker = payload.workers.find((w) => w.id === id || w.name === id);
  if (!worker) return null;

  const agent = board.agents.find((a) => a.id === worker.id);
  const ticket = worker.name ? board.all.find((t) => t.id.toLowerCase() === worker.name!.toLowerCase()) : undefined;

  return {
    worker,
    sessionId: agent?.sessionId,
    transcript: agent?.sessionId ? read(agent.sessionId, agent.cwd, 60) : [],
    ticket: ticket
      ? {
          id: ticket.id,
          repo: ticket.repo ?? "",
          title: ticket.title,
          status: ticket.status,
          description: ticket.description,
          acceptance: ticket.acceptance_criteria,
        }
      : undefined,
    questions: payload.questions.filter((q) => worker.name && q.ticket.toLowerCase() === worker.name.toLowerCase()),
  };
}

/**
 * Serve the fleet view on localhost. Nothing leaves the machine: the page is a
 * single local file and the only request it makes is back to this process.
 */
export function serve(cfg: AmbrosioConfig, port: number): { port: number; stop: () => void } {
  const page = join(cfg.rootDir, "ui", "index.html");

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      // Local-only, but a page on the open internet can still POST to
      // 127.0.0.1. Require a header no cross-origin form can set without a
      // preflight, and refuse any Origin that is not this server.
      if (req.method === "POST") {
        const origin = req.headers.get("origin");
        if (req.headers.get("x-ambrosio") !== "1" || (origin && origin !== url.origin)) {
          return Response.json({ error: "refused" }, { status: 403 });
        }
      }

      // The projects Jaime can choose between, with enough on each to choose well.
      if (url.pathname === "/api/projects") {
        try {
          const board = collectBoard(cfg);
          const count = (repo: string, pred: (t: any) => boolean) => board.all.filter((t) => t.repo === repo && pred(t)).length;
          return Response.json({
            projects: cfg.repos.map((r) => ({
              name: r.name,
              open: count(r.name, (t) => t.status === "open"),
              running: count(r.name, (t) => t.status === "in_progress" || t.status === "planning"),
              waiting: count(r.name, (t) => t.status === "in_review" || t.status === "plan_review" || t.status === "needs_input"),
            })),
            focus: readFocus(cfg),
          });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      if (url.pathname === "/api/today" && req.method === "POST") {
        try {
          const { repos, mission } = (await req.json()) as { repos?: string[]; mission?: string };
          const focus = setFocus(cfg, { repos: repos ?? [], mission: mission ?? "" });
          journal.append(cfg.homeDir,
            `Jaime set the day: ${focus.repos.length ? focus.repos.join(", ") : "no project chosen"}` +
            `${focus.mission ? ` — "${focus.mission}"` : ""}`);
          return Response.json({ ok: true, focus });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/morning") {
        try {
          const focus = readFocus(cfg);
          const brief = buildBrief(cfg, realMorningDeps(), { repos: focus?.repos ?? [], mission: focus?.mission ?? "" });
          return Response.json({ ...brief, focusSet: focus !== null, version: UI_VERSION });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      // Begin the day: always allowed. Lifts a pause, records the start,
      // dispatches what was chosen, leaves the queue to the loop.
      if (url.pathname === "/api/begin" && req.method === "POST") {
        try {
          const { tickets } = (await req.json().catch(() => ({}))) as { tickets?: { repo: string; ticket: string }[] };
          return Response.json({ ok: true, ...beginDay(cfg, tickets ?? []) });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/dispatch" && req.method === "POST") {
        try {
          const { tickets } = (await req.json()) as { tickets?: { repo: string; ticket: string }[] };
          if (!tickets?.length) return Response.json({ error: "no tickets given" }, { status: 400 });

          const dispatched: { repo: string; ticket: string; id: string }[] = [];
          const refused: { ticket: string; why: string }[] = [];
          for (const t of tickets) {
            try {
              // dispatchTicket enforces the WIP limit itself; report what it says
              // rather than deciding here and getting the two out of step.
              const r = dispatchTicket(cfg, t.repo, t.ticket);
              dispatched.push({ ...t, id: r.id });
            } catch (e) {
              refused.push({ ticket: t.ticket, why: (e as Error).message });
            }
          }
          return Response.json({ ok: true, dispatched, refused });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/review") {
        if (req.method === "POST") {
          try {
            const { wentWell, doBetter } = (await req.json()) as { wentWell?: string; doBetter?: string };
            const r = saveReview(cfg, { wentWell: wentWell ?? "", doBetter: doBetter ?? "" });
            journal.append(cfg.homeDir, `Jaime's review — better tomorrow: ${r.doBetter || "(nothing)"}`);
            return Response.json({ ok: true, review: r });
          } catch (e) {
            return Response.json({ error: (e as Error).message }, { status: 400 });
          }
        }
        return Response.json({ today: readReview(cfg), lessons: recentLessons(cfg, 5) });
      }

      if (url.pathname === "/api/dialog" && req.method === "GET") {
        return Response.json({ instructions: standing(cfg.homeDir), dialog: readDialog(cfg.homeDir).slice(-DIALOG_TAIL) });
      }

      // Jaime talking to Ambrosio. Actions go through routeReply with the
      // real deps — the same path a text takes — so the page is not a back door.
      if (url.pathname === "/api/dialog" && req.method === "POST") {
        try {
          const { text } = (await req.json()) as { text?: string };
          const w = realDeps();
          const r = say(cfg, text ?? "", {
            snapshot: (c) => w.snapshot(c),
            route: (c, reply, snap) => routeReply(c, reply, snap, w),
            ask: (c, q) => ask(c, q),
          });
          return Response.json({ ok: r.reply.ok !== false, reply: r.reply, instructions: standing(cfg.homeDir), dialog: r.entries.slice(-DIALOG_TAIL) });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/dialog/retire" && req.method === "POST") {
        try {
          const { id } = (await req.json()) as { id?: string };
          const done = id ? retire(cfg.homeDir, id) : false;
          if (done) journal.append(cfg.homeDir, `retired standing instruction ${id}`);
          return Response.json({ ok: done, instructions: standing(cfg.homeDir) });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/ask" && req.method === "POST") {
        try {
          const { question, ticket } = (await req.json()) as { question?: string; ticket?: string };
          return Response.json(ask(cfg, question ?? "", { ticket }));
        } catch (e) {
          return Response.json({ ok: false, answer: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/decide" && req.method === "POST") {
        try {
          const body = (await req.json()) as Partial<Decision>;
          if (!body.kind || !body.ticket || !body.repo) {
            return Response.json({ error: "kind, ticket and repo are required" }, { status: 400 });
          }
          return Response.json({ ok: true, ...applyDecision(cfg, body as Decision) });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/answer" && req.method === "POST") {
        try {
          const { qid, text } = (await req.json()) as { qid?: string; text?: string };
          if (!qid || !text?.trim()) return Response.json({ error: "qid and text are required" }, { status: 400 });
          const r = applyAnswer(cfg, qid, text.trim());
          return Response.json({ ok: true, ...r });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/mission") {
        try { return Response.json(missionMap(cfg)); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
      }

      const tk = url.pathname.match(/^\/api\/ticket\/([^/]+)\/([^/]+)$/);
      if (tk) {
        try {
          const detail = buildTicketDetail(cfg, collectBoard(cfg), decodeURIComponent(tk[1]), decodeURIComponent(tk[2]));
          return detail ? Response.json(detail) : Response.json({ error: "no such ticket" }, { status: 404 });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      const worker = url.pathname.match(/^\/api\/worker\/(.+)$/);
      if (worker) {
        try {
          const detail = buildWorkerDetail(cfg, collectBoard(cfg), decodeURIComponent(worker[1]));
          if (!detail) return Response.json({ error: "no such worker" }, { status: 404 });
          return Response.json(detail);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      if (url.pathname === "/api/board") {
        try {
          const payload = buildPayload(cfg, collectBoard(cfg));
          return Response.json({ ...payload, afterHours: isAfterHours(cfg), version: UI_VERSION });
        } catch (e) {
          // The view must say what broke rather than showing an empty, calm board.
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      if (url.pathname === "/butler.js") {
        return new Response(readFileSync(join(cfg.rootDir, "ui", "butler.js"), "utf8"), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }

      if (url.pathname === "/" || url.pathname === "/morning" || url.pathname === "/review") {
        const file = url.pathname === "/" ? page : join(cfg.rootDir, "ui", `${url.pathname.slice(1)}.html`);
        return new Response(readFileSync(file, "utf8"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return { port: server.port, stop: () => server.stop(true) };
}
