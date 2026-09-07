import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hhmm, withinHours, type AmbrosioConfig } from "./config.ts";
import { reviewDue as isReviewDue } from "./review.ts";
import { hasDecisions, renderDigest, renderUrgent, type BoardState } from "./digest.ts";
import { collectBoard } from "./board.ts";
import * as imessage from "./imessage.ts";
import * as journal from "./journal.ts";
import * as queue from "./queue.ts";
import type { QueueItem } from "./queue.ts";

export type NotifyState = { lastDigestHour?: string; urgentSent?: string[]; reviewAskedOn?: string };

export type NotifyDeps = {
  now: () => Date;
  board: (cfg: AmbrosioConfig) => BoardState;
  urgentOpen: (cfg: AmbrosioConfig) => QueueItem[];
  sendDigest: (cfg: AmbrosioConfig, board: BoardState) => void;
  sendUrgent: (cfg: AmbrosioConfig, item: QueueItem) => void;
  reviewDue: (cfg: AmbrosioConfig, now: Date) => boolean;
  sendReviewAsk: (cfg: AmbrosioConfig) => void;
  readState: (cfg: AmbrosioConfig) => NotifyState;
  writeState: (cfg: AmbrosioConfig, s: NotifyState) => void;
};

/** "2026-09-07T10" — the digest cap is per clock hour, as the charter words it. */
export function hourKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}

/**
 * Decide what Jaime hears, and say it. This is the manager's notification
 * policy from AMBROSIO.md, encoded so it does not need a live session:
 *
 *   - outside working hours, send nothing at all, not even urgent
 *   - inside hours with nothing to decide, send nothing; a silent tick is good
 *   - at most one digest per clock hour
 *   - if a digest already went out this hour, an urgent question still gets
 *     through on its own
 */
/** The wrap-up ask belongs to the end of the day, not to the evening. */
const REVIEW_WINDOW_MIN = 4 * 60;

export function notifyPass(cfg: AmbrosioConfig, deps: NotifyDeps): { digest: boolean; urgent: string[]; reviewAsked: boolean } {
  const now = deps.now();
  const state = deps.readState(cfg);
  const day = hourKey(now).slice(0, 10);

  // Asking how the day went is the one thing that happens *after* hours, and
  // only in a window: it closes the working day rather than interrupting the
  // evening.
  const mins = now.getHours() * 60 + now.getMinutes();
  const wrap = hhmm(cfg.hours.wrapUp);
  let reviewAsked = false;
  if (mins >= wrap && mins < wrap + REVIEW_WINDOW_MIN && state.reviewAskedOn !== day && deps.reviewDue(cfg, now)) {
    deps.sendReviewAsk(cfg);
    deps.writeState(cfg, { ...state, reviewAskedOn: day });
    reviewAsked = true;
  }

  if (!withinHours(cfg, now)) return { digest: false, urgent: [], reviewAsked };
  const alreadySent = new Set(state.urgentSent ?? []);
  const board = deps.board(cfg);
  const pending = deps.urgentOpen(cfg).filter((q) => !alreadySent.has(q.qid));

  const worthADigest = hasDecisions(board) || board.anomalies.length > 0;
  const sendDigest = worthADigest && state.lastDigestHour !== hourKey(now);

  const next: NotifyState = { ...state };
  const urgent: string[] = [];

  if (sendDigest) {
    deps.sendDigest(cfg, board);
    next.lastDigestHour = hourKey(now);
    // The digest already names them, so they must not arrive twice.
    next.urgentSent = [...alreadySent, ...pending.map((q) => q.qid)];
  } else {
    for (const item of pending) {
      deps.sendUrgent(cfg, item);
      urgent.push(item.qid);
      alreadySent.add(item.qid);
    }
    next.urgentSent = [...alreadySent];
  }

  deps.writeState(cfg, { ...next, ...(reviewAsked ? { reviewAskedOn: day } : {}) });
  return { digest: sendDigest, urgent, reviewAsked };
}

function statePath(home: string): string {
  return join(home, "notify.json");
}

export function realNotifyDeps(): NotifyDeps {
  return {
    now: () => new Date(),
    board: (cfg) => collectBoard(cfg),
    urgentOpen: (cfg) => queue.listUrgentOpen(cfg.homeDir),

    sendDigest: (cfg, board) => {
      imessage.sendAll(cfg, renderDigest(board as any));
      journal.append(cfg.homeDir, `digest sent by the watcher (${board.questions.length} questions, ${board.plans.length} plans, ${board.accept.length} to accept)`);
    },

    sendUrgent: (cfg, item) => {
      imessage.send(cfg, renderUrgent(item));
      journal.append(cfg.homeDir, `urgent sent by the watcher: ${item.qid} (${item.ticket})`);
    },

    reviewDue: (cfg, now) => isReviewDue(cfg, now),

    sendReviewAsk: (cfg) => {
      imessage.send(cfg, "That is the day, sir. What went well, and what should we do differently tomorrow?\n\nhttp://127.0.0.1:4317/review");
      journal.append(cfg.homeDir, "asked Jaime for the day's review");
    },

    readState: (cfg) => {
      const f = statePath(cfg.homeDir);
      if (!existsSync(f)) return {};
      try {
        return JSON.parse(readFileSync(f, "utf8")) as NotifyState;
      } catch {
        return {};
      }
    },

    writeState: (cfg, s) => {
      if (!existsSync(cfg.homeDir)) mkdirSync(cfg.homeDir, { recursive: true });
      writeFileSync(statePath(cfg.homeDir), JSON.stringify(s, null, 2));
    },
  };
}
