import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoByName, type AmbrosioConfig } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import { landable, type Assessment } from "./landable.ts";
import * as timeline from "./timeline.ts";
import type { TimelineEvent } from "./timeline.ts";
import { deliverAnswer } from "./dispatch.ts";

export class DecideError extends Error {}

export type Outcome = "closed" | "resumed" | "deferred" | "no_worker" | "escalated";

/** Feedback that could not be handed over yet, kept until it can be. */
export type Pending = { ticket: string; repo: string; text: string; at: string };

function pendingPath(home: string): string {
  return join(home, "pending-feedback.json");
}

export function pendingFeedback(cfg: AmbrosioConfig): Pending[] {
  const f = pendingPath(cfg.homeDir);
  if (!existsSync(f)) return [];
  try {
    const raw = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writePending(cfg: AmbrosioConfig, all: Pending[]): void {
  if (!existsSync(cfg.homeDir)) mkdirSync(cfg.homeDir, { recursive: true });
  writeFileSync(pendingPath(cfg.homeDir), JSON.stringify(all, null, 2));
}

/**
 * Try again to give a worker the reason its work came back.
 *
 * Rejecting work or sending a plan back only means something if the worker
 * hears why. `deliverAnswer` refuses to interrupt a busy session, and nothing
 * was retrying afterwards, so the reason was written on the ticket and then
 * lost.
 */
export function deliverPendingFeedback(
  cfg: AmbrosioConfig,
  deliver: (cfg: AmbrosioConfig, ticket: string, repo: string, text: string) => Outcome =
    (c, ticket, repo, text) => realDecideDeps.resume(c, ticket, repo, text),
): Pending[] {
  const all = pendingFeedback(cfg);
  if (all.length === 0) return [];

  const done: Pending[] = [];
  const left: Pending[] = [];
  for (const p of all) {
    try {
      if (deliver(cfg, p.ticket, p.repo, p.text) === "resumed") done.push(p);
      else left.push(p);
    } catch {
      left.push(p);            // worker is gone; it needs dispatching again
    }
  }
  if (done.length) writePending(cfg, left);
  return done;
}

export type Decision =
  | { kind: "accept"; ticket: string; repo: string; note?: string; force?: boolean }
  | { kind: "reject"; ticket: string; repo: string; note?: string }
  | { kind: "plan_ok"; ticket: string; repo: string; note?: string }
  | { kind: "plan_change"; ticket: string; repo: string; note?: string };

export type DecideDeps = {
  close: (cfg: AmbrosioConfig, repo: string, ticket: string, reason: string) => void;
  comment: (cfg: AmbrosioConfig, repo: string, ticket: string, text: string) => void;
  transition: (cfg: AmbrosioConfig, repo: string, ticket: string, status: string) => void;
  resume: (cfg: AmbrosioConfig, ticket: string, repo: string, text: string) => "resumed" | "deferred";
  journal: (cfg: AmbrosioConfig, line: string) => void;
  /** Defects discovered while doing this ticket that are still open. */
  openDefects: (cfg: AmbrosioConfig, repo: string, ticket: string) => { id: string; title: string }[];
  /** Could Jaime merge this right now? PR, checks, Verity, defects — every reason at once. */
  landable?: (cfg: AmbrosioConfig, repo: string, ticket: string) => Assessment;
  /** The ticket's timeline, for counting rounds. */
  history?: (cfg: AmbrosioConfig, repo: string, ticket: string) => TimelineEvent[];
  record?: (cfg: AmbrosioConfig, repo: string, ticket: string, ev: Omit<TimelineEvent, "at">) => void;
};

export const realDecideDeps: DecideDeps = {
  close: (cfg, repo, ticket, reason) => tracker.close(repoByName(cfg, repo), ticket, reason),
  comment: (cfg, repo, ticket, text) => tracker.comment(repoByName(cfg, repo), ticket, text),
  transition: (cfg, repo, ticket, status) => tracker.transition(repoByName(cfg, repo), ticket, status),
  resume: (cfg, ticket, repo, text) => deliverAnswer(cfg, { ticket, repo, text }),
  journal: (cfg, line) => journal.append(cfg.homeDir, line),
  openDefects: (cfg, repo, ticket) => tracker.openDefects(repoByName(cfg, repo), ticket),
  landable: (cfg, repo, ticket) => landable(cfg, repo, ticket),
  history: (cfg, repo, ticket) => timeline.read(cfg.homeDir, repo, ticket),
  record: (cfg, repo, ticket, ev) => { timeline.record(cfg.homeDir, repo, ticket, ev); },
};

/** What each earlier round asked for, oldest first, for the worker and for Jaime. */
function rounds(events: TimelineEvent[], kind: "rejected" | "plan_change"): string[] {
  return events.filter((e) => e.kind === kind).map((e) => `${kind === "rejected" ? "Round" : "Plan round"} ${e.iteration ?? "?"}: ${e.note ?? ""}`);
}

/**
 * The brief for a round of rework. The rejection is the round's acceptance
 * delta: each point addressed by name, and the reviewer re-checks those
 * points against the new diff rather than re-reading everything.
 */
export function reworkBrief(n: number, note: string, earlier: string[]): string {
  return [
    `Round ${n}. Jaime rejected the hand-over: ${note}`,
    "",
    "Treat that as this round's acceptance criteria. Address each point explicitly. When you hand over again, list every point and say for each whether it is addressed, and if not, why. Your reviewer subagent must re-check those points against the new diff, and its verdict goes in evidence.md under a heading for this round.",
    earlier.length ? `\nEarlier rounds, so nothing regresses:\n${earlier.map((e) => `- ${e}`).join("\n")}` : "",
  ].filter((l) => l !== "").join("\n");
}

/**
 * Apply one of Jaime's decisions about a plan or a finished piece of work.
 *
 * These were reaching him only as text he had to reply to, and only a live
 * manager session could act on them. They are mechanical — the charter spells
 * each one out — so the CLI, the watcher and the fleet view now share this.
 */
function describe(o: Outcome): string {
  return o === "escalated" ? "escalated to Jaime, not re-dispatched"
    : o === "resumed" ? "the worker picked it up"
    : o === "deferred" ? "worker busy, kept for the next pass"
    : "no live worker, it needs dispatching again";
}

/**
 * Give the worker the reason, and keep it if that is not possible right now.
 * Saying "returned to the worker" when it was not is worse than saying nothing.
 */
function handOver(cfg: AmbrosioConfig, deps: DecideDeps, ticket: string, repo: string, text: string): Outcome {
  let outcome: Outcome;
  try {
    outcome = deps.resume(cfg, ticket, repo, text);
  } catch {
    outcome = "no_worker";
  }
  if (outcome !== "resumed") {
    writePending(cfg, [...pendingFeedback(cfg).filter((p) => p.ticket !== ticket), { ticket, repo, text, at: new Date().toISOString() }]);
  }
  return outcome;
}

export function applyDecision(
  cfg: AmbrosioConfig,
  d: Decision,
  deps: DecideDeps = realDecideDeps,
): { ticket: string; outcome: Outcome; iteration?: number } {
  repoByName(cfg, d.repo);  // throws before anything is written
  const note = d.note?.trim();

  if ((d.kind === "reject" || d.kind === "plan_change") && !note) {
    throw new DecideError(
      `${d.kind === "reject" ? "Rejecting" : "Asking for changes"} needs a reason: the worker has nothing to act on without one.`,
    );
  }

  switch (d.kind) {
    case "accept": {
      // Work with known defects does not get accepted, and therefore does not
      // reach main. Jaime can overrule it; Ambrosio never does it quietly.
      const defects = deps.openDefects(cfg, d.repo, d.ticket);
      if (defects.length > 0 && !d.force) {
        throw new DecideError(
          `${d.ticket} filed ${defects.length} defect${defects.length > 1 ? "s" : ""} that ${defects.length > 1 ? "are" : "is"} still open: ` +
            defects.map((x) => `${x.id} (${x.title.slice(0, 60)})`).join("; ") +
            `. Close or defer them first, or accept anyway if you have decided they do not block this.`,
        );
      }
      // Rule 4, widened: what is not landable is not finished. Same shape —
      // every reason named, Jaime can overrule, the journal says he did.
      const land = deps.landable?.(cfg, d.repo, d.ticket);
      if (land && !land.ok && !d.force) {
        throw new DecideError(`${d.ticket} is not landable: ${land.reasons.join("; ")}. Fix those first, or accept anyway if you have decided they do not block this.`);
      }
      const over = [
        defects.length > 0 ? `over ${defects.length} open defect${defects.length > 1 ? "s" : ""}` : "",
        land && !land.ok ? `not landable (${land.reasons.join("; ")})` : "",
      ].filter(Boolean).map((x) => ` ${x}`).join(",");
      deps.record?.(cfg, d.repo, d.ticket, { kind: "accepted", by: "jaime", note: `${note ?? ""}${over}`.trim() || undefined, pr: land?.pr?.number });
      deps.close(cfg, d.repo, d.ticket, `accepted by Jaime${over}${note ? `: ${note}` : ""}`);
      deps.journal(cfg, `${d.ticket} accepted and closed${over}${note ? ` (${note})` : ""}`);
      return { ticket: d.ticket, outcome: "closed" };
    }

    case "reject": {
      const history = deps.history?.(cfg, d.repo, d.ticket) ?? [];
      const earlier = rounds(history, "rejected");
      const n = earlier.length + 1;
      const cap = cfg.maxIterations ?? 3;
      if (n > cap) {
        // Three rounds in and still bouncing: the ticket is the problem, not
        // the worker. Stop re-dispatching and put it in front of Jaime with
        // every round's ask, so the plan-day can rewrite it.
        const text = [
          `Bounced ${earlier.length} times; not re-dispatching. The ticket itself is probably underspecified. What each round asked for:`,
          ...earlier.map((e) => `- ${e}`),
          `- Round ${n}: ${note}`,
          "Rewrite the acceptance criteria, or say which round's ask should win, then dispatch again.",
        ].join("\n");
        deps.comment(cfg, d.repo, d.ticket, text);
        deps.transition(cfg, d.repo, d.ticket, "needs_input");
        deps.record?.(cfg, d.repo, d.ticket, { kind: "rejected", iteration: n, note, by: "jaime" });
        deps.record?.(cfg, d.repo, d.ticket, { kind: "escalated", iteration: n, note: `bounced ${earlier.length} times`, by: "ambrosio" });
        deps.journal(cfg, `${d.ticket} rejected a ${n}th time (${note}) — escalated, needs a rewrite, not another round`);
        return { ticket: d.ticket, outcome: "escalated", iteration: n };
      }
      const text = `Jaime rejected (round ${n}): ${note}`;
      deps.comment(cfg, d.repo, d.ticket, text);
      deps.transition(cfg, d.repo, d.ticket, "in_progress");
      deps.record?.(cfg, d.repo, d.ticket, { kind: "rejected", iteration: n, note, by: "jaime" });
      const outcome = handOver(cfg, deps, d.ticket, d.repo, reworkBrief(n, note!, earlier));
      deps.journal(cfg, `${d.ticket} rejected, round ${n} (${note}) — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome, iteration: n };
    }

    case "plan_ok": {
      deps.comment(cfg, d.repo, d.ticket, "Jaime approved the plan");
      deps.record?.(cfg, d.repo, d.ticket, { kind: "plan_ok", by: "jaime", note });
      deps.transition(cfg, d.repo, d.ticket, "in_progress");
      const outcome = handOver(cfg, deps, d.ticket, d.repo, "Jaime approved the plan. Carry on and implement it.");
      deps.journal(cfg, `${d.ticket} plan approved — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome };
    }

    case "plan_change": {
      const history = deps.history?.(cfg, d.repo, d.ticket) ?? [];
      const earlier = rounds(history, "plan_change");
      const n = earlier.length + 1;
      const text = `Jaime asked for changes (plan round ${n}): ${note}`;
      deps.comment(cfg, d.repo, d.ticket, text);
      deps.transition(cfg, d.repo, d.ticket, "planning");
      deps.record?.(cfg, d.repo, d.ticket, { kind: "plan_change", iteration: n, note, by: "jaime" });
      const brief = [
        `Plan round ${n}. Jaime asked for changes: ${note}`,
        "Revise plan.md to address each point, keep what he did not object to, and stop at plan_review again.",
        earlier.length ? `Earlier plan rounds:\n${earlier.map((e) => `- ${e}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");
      const outcome = handOver(cfg, deps, d.ticket, d.repo, brief);
      deps.journal(cfg, `${d.ticket} plan sent back, round ${n} (${note}) — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome, iteration: n };
    }
  }
}
