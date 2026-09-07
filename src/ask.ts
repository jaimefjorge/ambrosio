import { spawnSync } from "node:child_process";
import type { AmbrosioConfig } from "./config.ts";
import { collectBoard } from "./board.ts";
import { buildPayload, buildWorkerDetail } from "./ui.ts";
import * as journal from "./journal.ts";

export type AskContext = {
  board: unknown;
  ticket?: { id: string; repo: string; title: string; status: string; acceptance?: string };
  transcript?: { kind: string; tool?: string; summary: string; at?: string }[];
  journal: string;
};

export type AskDeps = {
  run: (cfg: AmbrosioConfig, prompt: string) => string;
  context: (cfg: AmbrosioConfig, ticket?: string) => AskContext;
};

/** A reply that is not a decision, and reads like a question, is one. */
const GRAMMAR = /^(status|board|what'?s up|quiet|[qpa]\s*[-.]?\s*\d+\b|@|(?:t[-\s]?)?[a-z0-9]+-[a-z0-9]+\s+(defer|stop|park)\b)/i;

export function looksLikeAQuestion(text: string): boolean {
  const t = text.trim();
  if (t === "" || GRAMMAR.test(t)) return false;
  if (t.endsWith("?")) return true;
  // Only the interrogatives. Auxiliaries like "do" open instructions at least
  // as often as questions — "do the thing we discussed" is not a question —
  // and guessing wrong answers when it should have acted.
  return /^(why|what|what'?s|how|when|where|which|who|whose)\b/i.test(t);
}

/**
 * The prompt Ambrosio answers a question with.
 *
 * The question comes first so a long context cannot bury it, and the rules are
 * explicit: ground the answer in what is here, say so when that is not enough,
 * and never act. A question must not move a ticket as a side effect.
 */
export function buildAskPrompt(question: string, ctx: AskContext): string {
  const parts: string[] = [
    `Jaime asks: ${question.trim()}`,
    "",
    "You are Ambrosio, his engineering manager. Answer him directly, in a few sentences.",
    "Answer only from the state below. If it does not say, reply that you do not know and name what you would have to look at.",
    "This is a question, not an instruction: do not change anything, do not run anything, do not move a ticket or start a worker.",
    "",
  ];

  if (ctx.ticket) {
    parts.push("## The ticket he is asking about", JSON.stringify(ctx.ticket, null, 2), "");
  }
  if (ctx.transcript?.length) {
    parts.push(
      "## What that worker has been doing, oldest first",
      ctx.transcript.map((e) => `${e.at ?? ""} [${e.tool ?? e.kind}] ${e.summary}`).join("\n"),
      "",
    );
  }
  parts.push("## The board", JSON.stringify(ctx.board, null, 2), "");
  if (ctx.journal.trim()) parts.push("## Today's journal", ctx.journal.trim(), "");

  return parts.join("\n");
}

export function realAskDeps(): AskDeps {
  return {
    context: (cfg, ticket) => {
      const board = collectBoard(cfg);
      const payload = buildPayload(cfg, board);
      const detail = ticket ? buildWorkerDetail(cfg, board, ticket) : null;
      return {
        board: { wip: payload.wip, workers: payload.workers, waiting: [...payload.questions, ...payload.plans, ...payload.accept], anomalies: payload.anomalies },
        ticket: detail?.ticket,
        transcript: detail?.transcript?.slice(-40),
        journal: journal.read(cfg.homeDir),
      };
    },
    run: (cfg, prompt) => {
      const r = spawnSync("claude", ["-p", prompt], {
        cwd: cfg.rootDir,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (r.status !== 0) {
        throw new Error((r.stderr ?? "").trim().split("\n")[0] || `claude exited ${r.status}`);
      }
      return (r.stdout ?? "").trim();
    },
  };
}

export function ask(
  cfg: AmbrosioConfig,
  question: string,
  opts: { ticket?: string } = {},
  deps: AskDeps = realAskDeps(),
): { ok: boolean; answer: string } {
  if (!question.trim()) return { ok: false, answer: "Ask me something and I will answer it." };
  try {
    const answer = deps.run(cfg, buildAskPrompt(question, deps.context(cfg, opts.ticket)));
    journal.append(cfg.homeDir, `Jaime asked: ${question.trim().slice(0, 100)}`);
    return { ok: true, answer: answer || "(no answer came back)" };
  } catch (e) {
    return { ok: false, answer: `I could not answer that: ${(e as Error).message}` };
  }
}
