import { existsSync, readFileSync } from "node:fs";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import type { Ticket } from "./tracker.ts";

/**
 * Defects a worker files belong to the ticket it was working on. Beads
 * records that as `discovered-from`, and rule 4 reads it — but only if the
 * worker remembered the flag. When it did not, the defect is an orphan: the
 * parent can be accepted over it, and it sits at P2 under a P0 parent where
 * the night lane never reaches it. This pass finds orphans filed while
 * exactly one worker was running in that repo, links them, and lifts their
 * priority into the parent's band. Two candidates is ambiguous, and Ambrosio
 * does not guess at lineage.
 */
export type AutolinkDeps = {
  tickets: (cfg: AmbrosioConfig, repo: string) => Ticket[];
  /** When the worker for this ticket was dispatched, from its sessions.json. */
  startedAt: (cfg: AmbrosioConfig, repo: string, ticket: string) => string | undefined;
  hasLinks: (cfg: AmbrosioConfig, repo: string, ticket: string) => boolean;
  link: (cfg: AmbrosioConfig, repo: string, child: string, parent: string) => void;
  setPriority: (cfg: AmbrosioConfig, repo: string, ticket: string, priority: number) => void;
  journal: (cfg: AmbrosioConfig, line: string) => void;
};

/** Tickets whose worker could have filed something. */
const WORKING = new Set(["planning", "in_progress", "verifying", "in_review", "needs_input", "blocked"]);

export function parentFor(child: Ticket, candidates: Ticket[], startedAt: (id: string) => string | undefined): Ticket | null {
  if (!child.created_at) return null;
  const born = new Date(child.created_at).getTime();
  if (isNaN(born)) return null;
  const running = candidates.filter((c) => {
    if (c.id === child.id || !WORKING.has(c.status)) return false;
    const s = startedAt(c.id);
    return !!s && new Date(s).getTime() <= born;
  });
  return running.length === 1 ? running[0] : null;
}

export function autolinkPass(cfg: AmbrosioConfig, deps: AutolinkDeps): { linked: { child: string; parent: string }[] } {
  const linked: { child: string; parent: string }[] = [];
  for (const repo of cfg.repos) {
    let all: Ticket[] = [];
    try { all = deps.tickets(cfg, repo.name); } catch (e) { deps.journal(cfg, `autolink: could not read ${repo.name}: ${(e as Error).message}`); continue; }
    const candidates = all.filter((t) => WORKING.has(t.status));
    for (const child of all) {
      if (child.status === "closed" || WORKING.has(child.status) && deps.startedAt(cfg, repo.name, child.id)) continue;
      const parent = parentFor(child, candidates, (id) => deps.startedAt(cfg, repo.name, id));
      if (!parent) continue;
      if (deps.hasLinks(cfg, repo.name, child.id)) continue;
      try {
        deps.link(cfg, repo.name, child.id, parent.id);
        if ((child.priority ?? 9) > (parent.priority ?? 9)) deps.setPriority(cfg, repo.name, child.id, parent.priority);
        deps.journal(cfg, `autolink: ${child.id} discovered-from ${parent.id} (filed while it was the only worker running)`);
        linked.push({ child: child.id, parent: parent.id });
      } catch (e) {
        deps.journal(cfg, `autolink: could not link ${child.id} to ${parent.id}: ${(e as Error).message}`);
      }
    }
  }
  return { linked };
}

export function realAutolinkDeps(): AutolinkDeps {
  return {
    tickets: (cfg, repo) => tracker.list(repoByName(cfg, repo)),
    startedAt: (cfg, repo, ticket) => {
      const f = `${journal.workDir(cfg.homeDir, repo, ticket)}/sessions.json`;
      if (!existsSync(f)) return undefined;
      try { const s = JSON.parse(readFileSync(f, "utf8")); return s[0]?.startedAt; } catch { return undefined; }
    },
    hasLinks: (cfg, repo, ticket) => tracker.hasLinks(repoByName(cfg, repo), ticket),
    link: (cfg, repo, child, parent) => tracker.addDep(repoByName(cfg, repo), child, parent, "discovered-from"),
    setPriority: (cfg, repo, ticket, p) => tracker.setPriority(repoByName(cfg, repo), ticket, p),
    journal: (cfg, line) => journal.append(cfg.homeDir, line),
  };
}
