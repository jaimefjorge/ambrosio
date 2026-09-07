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

export function nightEligible(tickets: Ticket[]): Ticket[] {
  return tickets
    .filter((t) => {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      if (meta.plan_gate === true || meta.planning_path === "architectural") return false;
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

  const stillBusy = workers.filter((a) => a.state === "working" && !parked.includes(a.name ?? "")).length;
  const free = Math.max(0, cfg.wipLimit - stillBusy);

  const dispatched: string[] = [];
  for (const ticket of nightEligible(deps.ready(cfg))) {
    if (dispatched.length >= free) break;
    try {
      deps.dispatch(cfg, ticket.repo ?? "", ticket.id);
      deps.journal(cfg, `after hours: started ${ticket.id} (${ticket.title})`);
      dispatched.push(ticket.id);
    } catch (e) {
      // One ticket that will not start is not a reason to stop for the night.
      deps.journal(cfg, `after hours: could not start ${ticket.id}: ${(e as Error).message}`);
    }
  }

  return { parked, dispatched };
}
