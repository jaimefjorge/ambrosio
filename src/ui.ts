import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import type { Board } from "./board.ts";
import { collectBoard } from "./board.ts";
import { assignKeys } from "./digest.ts";
import * as queue from "./queue.ts";
import { readTranscript, type Event } from "./transcript.ts";
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

/**
 * Bumped whenever the API changes. The page carries the same constant and says
 * so when they disagree: `Bun.serve` re-reads the HTML from disk on every
 * request but keeps its routes in memory, so an old server can otherwise serve
 * a new page and fail in ways that look like missing data.
 */
export const UI_VERSION = "7";

export type UiWorker = {
  id?: string;
  name?: string;
  state: string;
  detail?: string;
  needs?: string;
  tokens?: number;
  startedAt?: number;
  cwd: string;
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
export type UiDecision = { key: string; id: string; repo: string; title: string; status: string };

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

  const workers: UiWorker[] = board.agents
    .filter((a) => a.kind === "background")
    .map((a) => {
      const ticket = a.name ? byId.get(a.name.toLowerCase()) : undefined;
      return {
        id: a.id,
        name: a.name,
        state: a.state ?? "unknown",
        detail: a.detail,
        needs: a.needs,
        tokens: a.tokens,
        startedAt: a.startedAt,
        cwd: a.cwd,
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
    Object.entries(from).map(([key, t]) => ({ key, id: t.id, repo: t.repo ?? "", title: t.title, status: t.status }));

  return {
    now: board.now.toISOString(),
    wip: { used: workers.filter((w) => BUSY.has(w.state)).length, limit: cfg.wipLimit },
    workers,
    questions,
    plans: decisions(keys.plans),
    accept: decisions(keys.accept),
    tickets: board.all.map((t) => ({ id: t.id, repo: t.repo ?? "", title: t.title, status: t.status })),
    anomalies: board.anomalies,
    tokensToday: board.tokensToday,
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
