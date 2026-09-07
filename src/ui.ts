import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import type { Board } from "./board.ts";
import { collectBoard } from "./board.ts";
import { assignKeys } from "./digest.ts";
import * as queue from "./queue.ts";
import { readTranscript, type Event } from "./transcript.ts";

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

export type UiPayload = {
  now: string;
  wip: { used: number; limit: number };
  workers: UiWorker[];
  questions: UiQuestion[];
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

  return {
    now: board.now.toISOString(),
    wip: { used: workers.filter((w) => BUSY.has(w.state)).length, limit: cfg.wipLimit },
    workers,
    questions,
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
    fetch(req) {
      const url = new URL(req.url);

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
          return Response.json(payload);
        } catch (e) {
          // The view must say what broke rather than showing an empty, calm board.
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      if (url.pathname === "/") {
        return new Response(readFileSync(page, "utf8"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return { port: server.port, stop: () => server.stop(true) };
}
