import type { AmbrosioConfig } from "./config.ts";
import type { InboundMessage } from "./inbox.ts";
import { parseReplies, type Reply } from "./replies.ts";
import { isPaused, pause as setPause, resume as clearPause } from "./pause.ts";

export type Action =
  | { kind: "answered"; qid: string; ticket: string; delivery: "resumed" | "deferred" }
  | { kind: "status" }
  | { kind: "paused"; reason: string }
  | { kind: "resumed" }
  | { kind: "parked"; ticket: string; stopped: boolean }
  | { kind: "decided"; ticket: string; outcome: string }
  | { kind: "answered_question" }
  | { kind: "escalated"; why: string }
  | { kind: "failed"; why: string };

export type Handled = { text: string; at: Date; actions: Action[] };

/** What the board looks like right now, reduced to what routing needs. */
export type Snapshot = {
  keys: { questions: Record<string, any>; plans: Record<string, any>; accept: Record<string, any> };
  tickets: { id: string; repo: string }[];
};

export type WatchDeps = {
  readInbound: (cfg: AmbrosioConfig) => InboundMessage[];
  snapshot: (cfg: AmbrosioConfig) => Snapshot;
  answer: (cfg: AmbrosioConfig, qid: string, text: string) => "resumed" | "deferred";
  sendDigest: (cfg: AmbrosioConfig) => void;
  transition: (cfg: AmbrosioConfig, repo: string, ticket: string, status: string, note: string) => void;
  stopWorker: (ticket: string) => void;
  decide: (cfg: AmbrosioConfig, d: Decision) => { ticket: string; outcome: string };
  /** Answer a question Jaime texted, and text the answer back. */
  answerQuestion?: (cfg: AmbrosioConfig, question: string) => void;
  wake: (cfg: AmbrosioConfig) => void;
  /** Retry answers recorded while their worker was mid-turn. */
  deliverHeld?: (cfg: AmbrosioConfig) => { qid: string; ticket: string; repo: string }[];
  /** Decide whether Jaime hears anything this pass, and say it. */
  notify?: (cfg: AmbrosioConfig) => { digest: boolean; urgent: string[] };
  /** Retry a rejection or plan change whose worker was busy. */
  deliverFeedback?: (cfg: AmbrosioConfig) => { ticket: string }[];
  /** Keep the night going: park what is stuck, start what needs no one. */
  night?: (cfg: AmbrosioConfig) => { parked: string[]; dispatched: string[] };
};

/**
 * Route one reply, or report that it needs the manager.
 *
 * Only the mechanical replies are handled here. Approving a plan or accepting
 * work means commenting, moving a ticket and resuming a worker with the right
 * context — judgment the manager skill exists to apply. Guessing at it in a
 * background process is how a fleet ends up in a state nobody chose.
 */
export function routeReply(cfg: AmbrosioConfig, reply: Reply, snap: Snapshot, deps: WatchDeps): Action {
  switch (reply.kind) {
    case "answer": {
      const q = snap.keys.questions[reply.key];
      if (!q) return { kind: "escalated", why: `${reply.key} is not on the current board` };
      const text = reply.note ? `${reply.value}, ${reply.note}` : reply.value;
      const delivery = deps.answer(cfg, q.qid, text);
      return { kind: "answered", qid: q.qid, ticket: q.ticket, delivery };
    }

    case "pause": {
      setPause(cfg.homeDir, reply.reason ?? "paused from Messages");
      return { kind: "paused", reason: reply.reason ?? "paused from Messages" };
    }
    case "resume": {
      clearPause(cfg.homeDir);
      return { kind: "resumed" };
    }
    case "status":
      deps.sendDigest(cfg);
      return { kind: "status" };

    case "defer":
    case "stop": {
      const t = snap.tickets.find((x) => x.id.toLowerCase() === reply.ticket.toLowerCase());
      if (!t) return { kind: "escalated", why: `${reply.ticket} is not a ticket on the board` };
      const stopping = reply.kind === "stop";
      deps.transition(cfg, t.repo, t.id, "deferred", stopping ? "Jaime stopped it" : "Jaime deferred it");
      if (stopping) deps.stopWorker(t.id);
      return { kind: "parked", ticket: t.id, stopped: stopping };
    }

    case "plan":
    case "accept":
    case "reject": {
      const from = reply.kind === "plan" ? snap.keys.plans : snap.keys.accept;
      const t = from[reply.key];
      if (!t) return { kind: "escalated", why: `${reply.key} is not on the current board` };
      const kind: Decision["kind"] =
        reply.kind === "plan" ? (reply.decision === "ok" ? "plan_ok" : "plan_change")
        : reply.kind === "accept" ? "accept" : "reject";
      const r = deps.decide(cfg, { kind, ticket: t.id, repo: t.repo ?? "", note: reply.note });
      return { kind: "decided", ticket: r.ticket, outcome: r.outcome };
    }

    case "unparsed": {
      // Not a decision. If it reads like a question, answer it rather than
      // waking a session and leaving him with silence.
      if (deps.answerQuestion && looksLikeAQuestion(reply.text)) {
        deps.answerQuestion(cfg, reply.text);
        return { kind: "answered_question" };
      }
      return { kind: "escalated", why: "not something I could parse" };
    }

    default:
      return { kind: "escalated", why: `${reply.kind} needs the manager` };
  }
}

/**
 * Read everything Jaime has sent since the last pass and act on it now.
 *
 * Returns what it did. Anything it cannot do mechanically wakes the manager
 * once for the whole batch, so a burst of replies costs one tick, not five.
 */
export function drain(cfg: AmbrosioConfig, deps: WatchDeps): Handled[] {
  const messages = deps.readInbound(cfg);
  if (messages.length === 0) return [];

  const snap = deps.snapshot(cfg);
  const handled: Handled[] = [];
  let needsManager = false;

  for (const m of messages) {
    const actions: Action[] = [];
    for (const reply of parseReplies(m.text)) {
      try {
        const action = routeReply(cfg, reply, snap, deps);
        if (action.kind === "escalated") needsManager = true;
        actions.push(action);
      } catch (e) {
        // One bad reply must not strand the rest of the batch, and it must not
        // vanish either: the manager gets woken to deal with it.
        needsManager = true;
        actions.push({ kind: "failed", why: (e as Error).message });
      }
    }
    handled.push({ text: m.text, at: m.at, actions });
  }

  if (needsManager) deps.wake(cfg);
  return handled;
}

// ---------------------------------------------------------------------------
// Wiring to the real world.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoByName } from "./config.ts";
import * as agents from "./agents.ts";
import * as imessage from "./imessage.ts";
import * as inbox from "./inbox.ts";
import * as journal from "./journal.ts";
import * as tracker from "./tracker.ts";
import { collectBoard } from "./board.ts";
import { notifyPass, realNotifyDeps, hourKey } from "./notify.ts";
import { isAfterHours, afterHoursPass, type NightDeps } from "./afterhours.ts";
import { dispatchTicket } from "./dispatch.ts";
import { assignKeys, chunk, renderDigest } from "./digest.ts";
import { applyAnswer, deliverHeldAnswers } from "./dispatch.ts";
import { applyDecision, deliverPendingFeedback, type Decision } from "./decide.ts";
import { ask, looksLikeAQuestion } from "./ask.ts";

/** A woken manager costs a session, so never storm it. */
const WAKE_COOLDOWN_MS = 60_000;

function wakeStatePath(home: string): string {
  return join(home, "watch.json");
}

function lastWake(home: string): number {
  const f = wakeStatePath(home);
  if (!existsSync(f)) return 0;
  try {
    return JSON.parse(readFileSync(f, "utf8")).lastWake ?? 0;
  } catch {
    return 0;
  }
}

export function realDeps(): WatchDeps {
  return {
    readInbound: (cfg) => inbox.readInbound(cfg),

    snapshot: (cfg) => {
      const board = collectBoard(cfg);
      return { keys: assignKeys(board), tickets: board.all.map((t) => ({ id: t.id, repo: t.repo ?? "" })) };
    },

    answer: (cfg, qid, text) => applyAnswer(cfg, qid, text).delivery,

    sendDigest: (cfg) => {
      imessage.sendAll(cfg, renderDigest(collectBoard(cfg)));
      journal.append(cfg.homeDir, "sent the digest because Jaime asked for status");
      const n = realNotifyDeps();
      n.writeState(cfg, { ...n.readState(cfg), lastDigestHour: hourKey(new Date()) });
    },

    transition: (cfg, repo, ticket, status, note) => {
      tracker.transition(repoByName(cfg, repo), ticket, status, `Ambrosio: ${note}`);
      journal.append(cfg.homeDir, `${ticket} -> ${status} (${note})`);
    },

    stopWorker: (ticket) => {
      const worker = agents.byName(ticket);
      if (worker?.id) agents.stop(worker.id);
    },

    decide: (cfg, d) => applyDecision(cfg, d),

    answerQuestion: (cfg, question) => {
      const r = ask(cfg, question);
      imessage.sendAll(cfg, chunk(r.answer));
    },

    // The real world lives here, so a caller that builds its own deps — a test,
    // say — cannot reach it by forgetting a field.
    deliverHeld: (cfg) => deliverHeldAnswers(cfg),
    deliverFeedback: (cfg) => deliverPendingFeedback(cfg),
    notify: (cfg) => notifyPass(cfg, realNotifyDeps()),
    night: (cfg) => afterHoursPass(cfg, realNightDeps()),

    wake: (cfg) => {
      const now = Date.now();
      if (now - lastWake(cfg.homeDir) < WAKE_COOLDOWN_MS) return;
      writeFileSync(wakeStatePath(cfg.homeDir), JSON.stringify({ lastWake: now }));
      // Detached: the watcher must not die with the tick, nor wait for it.
      const child = spawn("claude", ["-p", "/ambrosio-tick"], {
        cwd: cfg.rootDir,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      journal.append(cfg.homeDir, "woke the manager for a reply that needs judgment");
    },
  };
}

/**
 * One pass of the watcher: hand over anything still held, then act on whatever
 * Jaime has sent. Held answers are retried every pass, not only when a message
 * arrives, because what unblocks them is the worker parking — not Jaime typing.
 */
export function onePass(
  cfg: AmbrosioConfig,
  deps: WatchDeps,
): {
  handled: Handled[];
  delivered: { qid: string; ticket: string; repo: string }[];
  notified: { digest: boolean; urgent: string[]; reviewAsked?: boolean };
  feedback: { ticket: string }[];
  night: { parked: string[]; dispatched: string[] };
  paused: boolean;
} {
  // While paused, nothing reaches a worker and nothing starts. Replies still
  // drain, because `resume` is one of them. Checked once per pass: a `pause`
  // handled in this pass takes effect on the next.
  const paused = isPaused(cfg.homeDir);
  const delivered = paused ? [] : (deps.deliverHeld?.(cfg) ?? []);
  // A rejection only means something once the worker hears why, and that
  // hand-over waits for the worker to park just as an answer does.
  const feedback = paused ? [] : (deps.deliverFeedback?.(cfg) ?? []);
  const handled = drain(cfg, deps);
  // Outbound last: a reply handled in this same pass should be reflected in
  // whatever Jaime is about to be told.
  const notified = deps.notify?.(cfg) ?? { digest: false, urgent: [], reviewAsked: false };
  // Once the day is over Ambrosio keeps working, quietly, on what cannot need
  // Jaime. Nothing here ever sends him anything.
  const night = !paused && isAfterHours(cfg) ? (deps.night?.(cfg) ?? { parked: [], dispatched: [] }) : { parked: [], dispatched: [] };
  return { handled, delivered, notified, feedback, night, paused };
}

export function realNightDeps(): NightDeps {
  return {
    workers: () => agents.workers(),
    ready: (cfg) => collectBoard(cfg).ready,
    repoOf: (cfg, ticket) => collectBoard(cfg).all.find((t) => t.id === ticket)?.repo ?? "",
    stop: (id) => agents.stop(id),
    park: (cfg, repo, ticket) => {
      if (repo) tracker.transition(repoByName(cfg, repo), ticket, "needs_input", "Ambrosio: parked overnight, it needs Jaime");
    },
    dispatch: (cfg, repo, ticket) => { dispatchTicket(cfg, repo, ticket); },
    journal: (cfg, line) => journal.append(cfg.homeDir, line),
  };
}

export type WatchOptions = { intervalMs?: number; deps?: WatchDeps; onEvent?: (h: Handled[]) => void };

/**
 * Poll for replies and act on them. Reading the inbox is a local SQLite query
 * against a row-id cursor, so a few seconds between passes costs nothing and
 * keeps an answer from sitting unread until the next hourly tick.
 */
export async function runWatch(cfg: AmbrosioConfig, opts: WatchOptions = {}): Promise<never> {
  const interval = opts.intervalMs ?? 5_000;
  const deps = opts.deps ?? realDeps();
  for (;;) {
    try {
      const { handled, delivered, notified, feedback, night } = onePass(cfg, deps);
      for (const d of delivered) {
        opts.onEvent?.([{ text: `held answer delivered to ${d.ticket}`, at: new Date(), actions: [] }]);
      }
      for (const f of feedback) {
        opts.onEvent?.([{ text: `feedback delivered to ${f.ticket}`, at: new Date(), actions: [] }]);
      }
      for (const p of night.parked) opts.onEvent?.([{ text: `after hours: parked ${p} for the morning`, at: new Date(), actions: [] }]);
      for (const d of night.dispatched) opts.onEvent?.([{ text: `after hours: started ${d}`, at: new Date(), actions: [] }]);
      if (handled.length > 0) opts.onEvent?.(handled);
      if (notified.digest) opts.onEvent?.([{ text: "digest sent", at: new Date(), actions: [] }]);
      for (const qid of notified.urgent) {
        opts.onEvent?.([{ text: `urgent sent: ${qid}`, at: new Date(), actions: [] }]);
      }
    } catch (e) {
      // Never let one bad pass kill the watcher: it is meant to run all day.
      opts.onEvent?.([{ text: `watch error: ${(e as Error).message}`, at: new Date(), actions: [] }]);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
