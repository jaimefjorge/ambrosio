import { randomBytes } from "node:crypto";
import type { AmbrosioConfig } from "./config.ts";
import { parseReplies, type Reply } from "./replies.ts";
import { looksLikeAQuestion } from "./ask.ts";
import type { Action, Snapshot } from "./watch.ts";
import * as journal from "./journal.ts";

/**
 * The dialog: Jaime talks to Ambrosio from the fleet view and it binds.
 *
 * `ask` answers and must not move anything. This is the other half. A line
 * is one of three things, judged in this order:
 *   1. an action in the Messages grammar — routed through routeReply, the
 *      same guardrails a text goes through, so the UI is never a back door;
 *   2. a question — answered read-only;
 *   3. anything else — a standing instruction, kept and shown to Ambrosio at
 *      every tick and plan-day until Jaime retires it.
 *
 * Everything said, by either side, stays in the thread on disk.
 */
export { readDialog, standing, retire, type Entry, type EntryKind } from "./standing.ts";
import { readDialog, writeDialog, type Entry, type EntryKind } from "./standing.ts";

export type DialogDeps = {
  snapshot: (cfg: AmbrosioConfig) => Snapshot;
  route: (cfg: AmbrosioConfig, reply: Reply, snap: Snapshot) => Action;
  ask: (cfg: AmbrosioConfig, question: string) => { ok: boolean; answer: string };
};

const newId = () => randomBytes(4).toString("hex");

/** What an action came to, in a sentence Jaime can read back in the thread. */
export function describe(a: Action): { ok: boolean; text: string } {
  switch (a.kind) {
    case "paused": return { ok: true, text: `Paused: ${a.reason}. Nothing starts or resumes until you say resume.` };
    case "resumed": return { ok: true, text: "Resumed. The next pass dispatches and delivers again." };
    case "status": return { ok: true, text: "Sent you the board." };
    case "parked": return { ok: true, text: `${a.ticket} ${a.stopped ? "stopped, worker killed" : "parked"}${a.note ? ` — "${a.note}" is on its timeline and its ticket` : ""}.` };
    case "decided": return { ok: a.outcome !== "no_worker", text: a.outcome === "escalated" ? `${a.ticket}: bounced too many times — escalated to you for a rewrite, not re-dispatched.` : `${a.ticket}: ${a.outcome}.` };
    case "answered": return { ok: true, text: `Answer routed to ${a.ticket} (${a.delivery}).` };
    case "answered_question": return { ok: true, text: "Answered." };
    case "escalated": return { ok: false, text: `I could not do that on my own: ${a.why}` };
    case "failed": return { ok: false, text: `That did not work: ${a.why}` };
  }
}

/**
 * Take one message from Jaime, act on each line, and reply in the thread.
 * Throws on an empty message so nothing blank is ever recorded.
 */
export function say(cfg: AmbrosioConfig, text: string, deps: DialogDeps, now = new Date()): { entries: Entry[]; reply: Entry } {
  const clean = text.trim();
  if (!clean) throw new Error("say something");

  const at = now.toISOString();
  const all = readDialog(cfg.homeDir);
  const replies = parseReplies(clean);
  const snap = deps.snapshot(cfg);

  const said: Entry[] = [];
  const answers: string[] = [];
  const actions: Action[] = [];
  let kind: EntryKind = "note";
  let ok = true;

  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  replies.forEach((r, i) => {
    if (r.kind !== "unparsed") {
      // Jaime's own words, not the parsed shape: the thread is his record.
      const me: Entry = { id: newId(), at, from: "jaime", text: lines[i] ?? clean, kind: "action" };
      said.push(me);
      let a: Action;
      try {
        a = deps.route(cfg, r, snap);
      } catch (e) {
        a = { kind: "failed", why: (e as Error).message };
      }
      actions.push(a);
      const d = describe(a);
      ok = ok && d.ok;
      answers.push(d.text);
      kind = "action";
      journal.append(cfg.homeDir, `dialog: ${me.text} -> ${d.text}`, now);
      return;
    }
    if (looksLikeAQuestion(r.text)) {
      said.push({ id: newId(), at, from: "jaime", text: r.text, kind: "question" });
      const a = deps.ask(cfg, r.text);
      ok = ok && a.ok;
      answers.push(a.answer);
      if (kind !== "action") kind = "question";
      return;
    }
    const me: Entry = { id: newId(), at, from: "jaime", text: r.text, kind: "instruction", standing: true };
    said.push(me);
    answers.push(`Noted, and standing until you retire it: "${r.text}"`);
    if (kind === "note") kind = "instruction";
    journal.append(cfg.homeDir, `standing instruction: ${r.text}`, now);
  });

  const reply: Entry = {
    id: newId(), at, from: "ambrosio", kind, ok,
    text: answers.join("\n"),
    inReplyTo: said[0]?.id,
    ...(actions.length ? { actions } : {}),
  };
  const entries = [...all, ...said, reply];
  writeDialog(cfg.homeDir, entries);
  return { entries, reply };
}
