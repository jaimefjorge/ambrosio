import type { AmbrosioConfig } from "./config.ts";
import { isPaused, resume } from "./pause.ts";
import { markDayStart } from "./ledger.ts";
import { dispatchTicket } from "./dispatch.ts";
import { collectBoard } from "./board.ts";
import * as journal from "./journal.ts";

/**
 * Begin the day. Always possible once the brief is up: it lifts any pause
 * (a new day begins explicitly, whatever last night left set), records how
 * much is open so the ledger can say where it went, dispatches what Jaime
 * chose — if anything — and leaves the rest of the queue to the loop, which
 * already takes it in the right order.
 */
export type BeginDeps = {
  openCount: (cfg: AmbrosioConfig) => number;
  /** The queue, already in dispatch order (blocking defects first, then priority). */
  ready: (cfg: AmbrosioConfig) => { repo: string; ticket: string }[];
  freeSlots: (cfg: AmbrosioConfig) => number;
  dispatch: (cfg: AmbrosioConfig, repo: string, ticket: string) => { id: string };
  journal: (cfg: AmbrosioConfig, line: string) => void;
};

export type Begun = {
  resumed: boolean;
  open: number;
  queued: number;
  dispatched: { repo: string; ticket: string; id: string }[];
  refused: { ticket: string; why: string }[];
};

export function beginDay(cfg: AmbrosioConfig, tickets: { repo: string; ticket: string }[], deps: BeginDeps = realBeginDeps()): Begun {
  const resumed = isPaused(cfg.homeDir);
  if (resumed) resume(cfg.homeDir);

  const open = deps.openCount(cfg);
  markDayStart(cfg, open);

  const dispatched: Begun["dispatched"] = [];
  const refused: Begun["refused"] = [];
  const start = (t: { repo: string; ticket: string }) => {
    try {
      dispatched.push({ ...t, id: deps.dispatch(cfg, t.repo, t.ticket).id });
    } catch (e) {
      refused.push({ ticket: t.ticket, why: (e as Error).message });
    }
  };
  // What he chose is the day's start. With nothing chosen, the queue is the
  // day's start: in order, up to the free slots — "takes it from here" has to
  // be true the moment he clicks, not at the next tick.
  const queue = deps.ready(cfg);
  if (tickets.length) tickets.forEach(start);
  else for (const t of queue.slice(0, Math.max(0, deps.freeSlots(cfg)))) start(t);

  const started = new Set(dispatched.map((d) => d.ticket));
  const queued = queue.filter((t) => !started.has(t.ticket)).length;
  deps.journal(cfg, `day began: ${open} open, ${dispatched.length} dispatched by hand, ${queued} queued for the loop${resumed ? ", pause lifted" : ""}`);
  return { resumed, open, queued, dispatched, refused };
}

export function realBeginDeps(): BeginDeps {
  return {
    openCount: (cfg) => collectBoard(cfg).all.filter((t) => !["closed", "deferred"].includes(t.status)).length,
    ready: (cfg) => collectBoard(cfg).ready.map((t) => ({ repo: t.repo ?? "", ticket: t.id })),
    freeSlots: (cfg) => { const b = collectBoard(cfg); return Math.max(0, cfg.wipLimit - b.working.length); },
    dispatch: (cfg, repo, ticket) => dispatchTicket(cfg, repo, ticket),
    journal: (cfg, line) => journal.append(cfg.homeDir, line),
  };
}
