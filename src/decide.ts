import { repoByName, type AmbrosioConfig } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import { deliverAnswer } from "./dispatch.ts";

export class DecideError extends Error {}

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
export function applyDecision(
  cfg: AmbrosioConfig,
  d: Decision,
  deps: DecideDeps = realDecideDeps,
): { ticket: string; outcome: "closed" | "resumed" | "deferred" } {
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
      const outcome = deps.resume(cfg, d.ticket, d.repo, text);
      deps.journal(cfg, `${d.ticket} rejected and returned to the worker (${note})`);
      return { ticket: d.ticket, outcome };
    }

    case "plan_ok": {
      deps.comment(cfg, d.repo, d.ticket, "Jaime approved the plan");
      deps.transition(cfg, d.repo, d.ticket, "in_progress");
      const outcome = deps.resume(cfg, d.ticket, d.repo, "Jaime approved the plan. Carry on and implement it.");
      deps.journal(cfg, `${d.ticket} plan approved`);
      return { ticket: d.ticket, outcome };
    }

    case "plan_change": {
      const text = `Jaime asked for changes: ${note}`;
      deps.comment(cfg, d.repo, d.ticket, text);
      deps.transition(cfg, d.repo, d.ticket, "planning");
      const outcome = deps.resume(cfg, d.ticket, d.repo, text);
      deps.journal(cfg, `${d.ticket} plan sent back (${note})`);
      return { ticket: d.ticket, outcome };
    }
  }
}
