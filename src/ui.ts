import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import type { Board } from "./board.ts";
import { collectBoard } from "./board.ts";
import { assignKeys } from "./digest.ts";
import * as queue from "./queue.ts";

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
