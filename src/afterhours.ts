import { hhmm, type AmbrosioConfig } from "./config.ts";
import type { Ticket } from "./tracker.ts";
import type { Agent } from "./agents.ts";

/**
 * After the working day, Jaime is not at the Mac. Ambrosio keeps going, but
 * only on work that cannot need him: finishing, tidying, and the bounded
 * tickets nobody has to weigh in on. Anything that gets stuck is parked for
 * the morning rather than left waiting for an answer that will not come.
 */
export function isAfterHours(cfg: AmbrosioConfig, now = new Date()): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins < hhmm(cfg.hours.digestFrom) || mins >= hhmm(cfg.hours.wrapUp);
}

/** Types the night never starts: new capability is a daytime decision. */
const DAYTIME_ONLY = new Set(["feature", "epic", "story"]);

/**
 * @param wrapUpAt when today's working day ended. Anything filed after it was
 * filed by tonight's workers, and starting it is how one night-worker becomes
 * nine by morning. Those wait for the plan-day, where Jaime sees them.
 */
export function nightEligible(tickets: Ticket[], wrapUpAt?: Date): Ticket[] {
  return tickets
    .filter((t) => {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      if (meta.plan_gate === true || meta.planning_path === "architectural") return false;
      if (wrapUpAt) {
        const created = t.created_at ? new Date(t.created_at) : null;
        if (!created || isNaN(created.getTime()) || created >= wrapUpAt) return false;
      }
      return !DAYTIME_ONLY.has((t.issue_type ?? "task").toLowerCase());
    })
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
}

export type NightDeps = {
  workers: () => Agent[];
  ready: (cfg: AmbrosioConfig) => Ticket[];
  /** Which repo a ticket belongs to; a blocked worker's ticket is not in `ready`. */
  repoOf?: (cfg: AmbrosioConfig, ticket: string) => string;
  stop: (sessionId: string) => void;
  park: (cfg: AmbrosioConfig, repo: string, ticket: string) => void;
  dispatch: (cfg: AmbrosioConfig, repo: string, ticket: string) => void;
  journal: (cfg: AmbrosioConfig, line: string) => void;
  /** WIP slots held right now, as the board reconciles them — never the raw daemon state. */
  busy?: (cfg: AmbrosioConfig) => number;
  /** When today's working day ended; tickets filed after it are not the night's to start. */
  wrapUpAt?: (cfg: AmbrosioConfig) => Date;
  /** Tickets this night has already started, whether or not they are still running. */
  startedTonight?: (cfg: AmbrosioConfig) => string[];
  recordStart?: (cfg: AmbrosioConfig, ticket: string) => void;
};

export function afterHoursPass(
  cfg: AmbrosioConfig,
  deps: NightDeps,
): { parked: string[]; dispatched: string[] } {
  const workers = deps.workers().filter((a) => a.kind === "background");
  const parked: string[] = [];

  // Anything waiting on Jaime stops here and waits for the morning. Leaving it
  // blocked would hold a slot all night for an answer nobody is awake to give.
  for (const w of workers) {
    if (w.state !== "blocked" || !w.name) continue;
    try {
      if (w.id) deps.stop(w.id);
      deps.park(cfg, deps.repoOf?.(cfg, w.name) ?? "", w.name);
      deps.journal(cfg, `after hours: parked ${w.name}, it needs Jaime`);
      parked.push(w.name);
    } catch (e) {
      deps.journal(cfg, `after hours: could not park ${w.name}: ${(e as Error).message}`);
    }
  }

  const stillBusy = deps.busy
    ? Math.max(0, deps.busy(cfg) - parked.length)
    : workers.filter((a) => a.state === "working" && !parked.includes(a.name ?? "")).length;
  const free = Math.max(0, cfg.wipLimit - stillBusy);

  // Two ceilings: the slots free right now, and how much a whole night may
  // start at all. The second is the one that keeps the morning readable —
  // without it every finished worker frees a slot that starts another.
  const already = deps.startedTonight?.(cfg) ?? [];
  const budget = Math.max(0, cfg.wipLimit - already.length);

  const dispatched: string[] = [];
  for (const ticket of nightEligible(deps.ready(cfg), deps.wrapUpAt?.(cfg))) {
    if (dispatched.length >= free || dispatched.length >= budget) break;
    if (already.includes(ticket.id)) continue;
    try {
      deps.dispatch(cfg, ticket.repo ?? "", ticket.id);
      deps.recordStart?.(cfg, ticket.id);
      deps.journal(cfg, `after hours: started ${ticket.id} (${ticket.title}) — ${already.length + dispatched.length + 1}/${cfg.wipLimit} for the night`);
      dispatched.push(ticket.id);
    } catch (e) {
      // One ticket that will not start is not a reason to stop for the night.
      deps.journal(cfg, `after hours: could not start ${ticket.id}: ${(e as Error).message}`);
    }
  }

  return { parked, dispatched };
}
