import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoByName, type AmbrosioConfig } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import { deliverAnswer } from "./dispatch.ts";

export class DecideError extends Error {}

export type Outcome = "closed" | "resumed" | "deferred" | "no_worker";

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
  | { kind: "accept"; ticket: string; repo: string; note?: string }
  | { kind: "reject"; ticket: string; repo: string; note?: string }
  | { kind: "plan_ok"; ticket: string; repo: string; note?: string }
  | { kind: "plan_change"; ticket: string; repo: string; note?: string };

export type DecideDeps = {
  close: (cfg: AmbrosioConfig, repo: string, ticket: string, reason: string) => void;
  comment: (cfg: AmbrosioConfig, repo: string, ticket: string, text: string) => void;
  transition: (cfg: AmbrosioConfig, repo: string, ticket: string, status: string) => void;
  resume: (cfg: AmbrosioConfig, ticket: string, repo: string, text: string) => "resumed" | "deferred";
  journal: (cfg: AmbrosioConfig, line: string) => void;
};

export const realDecideDeps: DecideDeps = {
  close: (cfg, repo, ticket, reason) => tracker.close(repoByName(cfg, repo), ticket, reason),
  comment: (cfg, repo, ticket, text) => tracker.comment(repoByName(cfg, repo), ticket, text),
  transition: (cfg, repo, ticket, status) => tracker.transition(repoByName(cfg, repo), ticket, status),
  resume: (cfg, ticket, repo, text) => deliverAnswer(cfg, { ticket, repo, text }),
  journal: (cfg, line) => journal.append(cfg.homeDir, line),
};

/**
 * Apply one of Jaime's decisions about a plan or a finished piece of work.
 *
 * These were reaching him only as text he had to reply to, and only a live
 * manager session could act on them. They are mechanical — the charter spells
 * each one out — so the CLI, the watcher and the fleet view now share this.
 */
function describe(o: Outcome): string {
  return o === "resumed" ? "the worker picked it up"
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
): { ticket: string; outcome: Outcome } {
  repoByName(cfg, d.repo);  // throws before anything is written
  const note = d.note?.trim();

  if ((d.kind === "reject" || d.kind === "plan_change") && !note) {
    throw new DecideError(
      `${d.kind === "reject" ? "Rejecting" : "Asking for changes"} needs a reason: the worker has nothing to act on without one.`,
    );
  }

  switch (d.kind) {
    case "accept": {
      deps.close(cfg, d.repo, d.ticket, `accepted by Jaime${note ? `: ${note}` : ""}`);
      deps.journal(cfg, `${d.ticket} accepted and closed${note ? ` (${note})` : ""}`);
      return { ticket: d.ticket, outcome: "closed" };
    }

    case "reject": {
      const text = `Jaime rejected: ${note}`;
      deps.comment(cfg, d.repo, d.ticket, text);
      deps.transition(cfg, d.repo, d.ticket, "in_progress");
      const outcome = handOver(cfg, deps, d.ticket, d.repo, text);
      deps.journal(cfg, `${d.ticket} rejected (${note}) — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome };
    }

    case "plan_ok": {
      deps.comment(cfg, d.repo, d.ticket, "Jaime approved the plan");
      deps.transition(cfg, d.repo, d.ticket, "in_progress");
      const outcome = handOver(cfg, deps, d.ticket, d.repo, "Jaime approved the plan. Carry on and implement it.");
      deps.journal(cfg, `${d.ticket} plan approved — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome };
    }

    case "plan_change": {
      const text = `Jaime asked for changes: ${note}`;
      deps.comment(cfg, d.repo, d.ticket, text);
      deps.transition(cfg, d.repo, d.ticket, "planning");
      const outcome = handOver(cfg, deps, d.ticket, d.repo, text);
      deps.journal(cfg, `${d.ticket} plan sent back (${note}) — ${describe(outcome)}`);
      return { ticket: d.ticket, outcome };
    }
  }
}
