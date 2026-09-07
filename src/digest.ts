import type { QueueItem } from "./queue.ts";
import { optionLabels, summarize } from "./queue.ts";
import type { Ticket } from "./tracker.ts";
import type { Agent } from "./agents.ts";

export const CHUNK_LIMIT = 1500;

export type BoardState = {
  now: Date;
  questions: QueueItem[];
  plans: Ticket[];
  accept: Ticket[];
  working: { ticket?: Ticket; agent: Agent }[];
  blocked: Ticket[];
  anomalies: string[];
  tokensToday?: number;
};

/** Digest keys are positional and stable within one digest: Q1..Qn, P1..Pn, A1..An. */
export type DigestKeys = {
  questions: Record<string, QueueItem>;
  plans: Record<string, Ticket>;
  accept: Record<string, Ticket>;
};

export function assignKeys(board: BoardState): DigestKeys {
  const keys: DigestKeys = { questions: {}, plans: {}, accept: {} };
  board.questions.forEach((q, i) => (keys.questions[`Q${i + 1}`] = q));
  board.plans.forEach((t, i) => (keys.plans[`P${i + 1}`] = t));
  board.accept.forEach((t, i) => (keys.accept[`A${i + 1}`] = t));
  return keys;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function short(id: string): string {
  return id;
}

function ticketLabel(t: Ticket): string {
  return `[${t.repo ?? "?"} ${short(t.id)} ${t.title}]`;
}

export function hasDecisions(board: BoardState): boolean {
  return board.questions.length > 0 || board.plans.length > 0 || board.accept.length > 0;
}

/** Render the digest body. Returns chunks small enough to read on a phone. */
export function renderDigest(board: BoardState): string[] {
  const keys = assignKeys(board);
  const lines: string[] = [];

  const counts = [
    board.questions.length ? `${board.questions.length} decision${board.questions.length > 1 ? "s" : ""}` : null,
    board.plans.length ? `${board.plans.length} plan${board.plans.length > 1 ? "s" : ""}` : null,
    board.accept.length ? `${board.accept.length} to accept` : null,
    board.working.length ? `${board.working.length} working` : null,
  ].filter(Boolean);
  lines.push(`Ambrosio · ${hhmm(board.now)} · ${counts.length ? counts.join(", ") : "all quiet"}`);

  if (board.questions.length > 0) {
    lines.push("", "DECIDE");
    for (const [key, q] of Object.entries(keys.questions)) {
      const opts = optionLabels(q);
      const letters = "abcdefgh".split("");
      lines.push(`${key} [${q.repo} ${q.ticket}] ${summarize(q)}${q.urgent ? " ⚠" : ""}`);
      if (opts.length > 0) {
        lines.push(`  ${opts.map((o, i) => `${letters[i]}) ${o}`).join("  ")}`);
      } else {
        lines.push("  reply with free text");
      }
    }
  }

  if (board.plans.length > 0) {
    lines.push("", "PLANS");
    for (const [key, t] of Object.entries(keys.plans)) {
      lines.push(`${key} ${ticketLabel(t)}`);
      const note = t.metadata?.plan_summary ?? t.description;
      if (note) lines.push(`  ${String(note).replace(/\s+/g, " ").slice(0, 220)}`);
    }
  }

  if (board.accept.length > 0) {
    lines.push("", "ACCEPT");
    for (const [key, t] of Object.entries(keys.accept)) {
      lines.push(`${key} ${ticketLabel(t)}`);
      const bits = [
        t.metadata?.pr ? `PR ${t.metadata.pr}` : null,
        t.metadata?.tests ? `tests ${t.metadata.tests}` : null,
        t.metadata?.verity ? `Verity ${t.metadata.verity}` : null,
        t.metadata?.review ? String(t.metadata.review).slice(0, 80) : null,
      ].filter(Boolean);
      if (bits.length) lines.push(`  ${bits.join(" · ")}`);
    }
  }

  const fyi: string[] = [];
  for (const w of board.working) {
    const name = w.ticket ? `${w.ticket.repo} ${w.ticket.id}` : (w.agent.name ?? w.agent.id ?? "session");
    fyi.push(`${name}: ${w.agent.detail ?? w.agent.state ?? "working"}`);
  }
  for (const t of board.blocked) fyi.push(`${t.repo} ${t.id} blocked: ${t.title}`);
  for (const a of board.anomalies) fyi.push(a);
  if (board.tokensToday) fyi.push(`spend today: ${(board.tokensToday / 1_000_000).toFixed(1)}M tokens`);

  if (fyi.length > 0) {
    lines.push("", "FYI");
    for (const f of fyi) lines.push(f.length > 160 ? `${f.slice(0, 157)}...` : f);
  }

  return chunk(lines.join("\n"));
}

export function renderUrgent(item: QueueItem): string {
  const opts = optionLabels(item);
  const head = `Ambrosio ⚠ [${item.repo} ${item.ticket}] ${summarize(item)}`;
  const tail = opts.length
    ? `Reply ${item.qid} a|b — ${opts.map((o, i) => `${"ab"[i] ?? "?"}) ${o}`).join("  ")}`
    : `Reply ${item.qid} <your answer>`;
  return `${head}\n${tail}`;
}

/** Split on line boundaries so a message never breaks mid-item. */
export function chunk(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current === "" ? line : `${current}\n${line}`;
    if (candidate.length > limit && current !== "") {
      out.push(current);
      current = line;
    } else if (candidate.length > limit) {
      // A single line longer than the limit: hard split it.
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      current = "";
    } else {
      current = candidate;
    }
  }
  if (current !== "") out.push(current);
  return out;
}
