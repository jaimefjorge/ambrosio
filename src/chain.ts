import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import * as journal from "./journal.ts";
import * as timeline from "./timeline.ts";

/**
 * The defect chain. Rule 4 stops a parent landing over an open defect; this
 * is the rest of the chain — the defect gets fixed first, and the parent
 * hears when it is.
 */

/** Ready work, with the defects that block a parent in review put first. */
export function orderReady(ready: Ticket[], blocking: Record<string, string>): Ticket[] {
  return [...ready].sort((a, b) => {
    const ab = a.id in blocking ? 0 : 1;
    const bb = b.id in blocking ? 0 : 1;
    return ab - bb || (a.priority ?? 9) - (b.priority ?? 9);
  });
}

export type ChainDeps = {
  /** Tickets this one was discovered from, with their status. */
  parentsOf: (cfg: AmbrosioConfig, repo: string, id: string) => { id: string; status: string }[];
  comment: (cfg: AmbrosioConfig, repo: string, id: string, text: string) => void;
  /** Drop the cached landable verdict so the next look recomputes it. */
  forgetLandable: (cfg: AmbrosioConfig, repo: string, id: string) => void;
  journal: (cfg: AmbrosioConfig, line: string) => void;
};

const DONE = new Set(["closed", "deferred"]);

export function defectChainPass(
  cfg: AmbrosioConfig,
  deps: ChainDeps,
  changes: { repo: string; ticket: string; from?: string; to: string }[],
): { woke: string[] } {
  const woke: string[] = [];
  for (const ch of changes) {
    if (!DONE.has(ch.to)) continue;
    let parents: { id: string; status: string }[] = [];
    try { parents = deps.parentsOf(cfg, ch.repo, ch.ticket); } catch { continue; }
    for (const p of parents) {
      if (p.status !== "in_review") continue;
      deps.forgetLandable(cfg, ch.repo, p.id);
      deps.comment(cfg, ch.repo, p.id, `Ambrosio: ${ch.ticket}, filed while doing this, is now ${ch.to}. Re-assessing whether this can land.`);
      timeline.record(cfg.homeDir, ch.repo, p.id, { kind: "defect_closed", note: `${ch.ticket} ${ch.to}`, by: "ambrosio" });
      deps.journal(cfg, `${ch.ticket} ${ch.to} — ${p.id} (waiting for acceptance) re-assessed`);
      woke.push(p.id);
    }
  }
  return { woke };
}

export function realChainDeps(): ChainDeps {
  return {
    parentsOf: (cfg, repo, id) => {
      // A child created with `--deps discovered-from:P` lists P downward.
      const rc = repoByName(cfg, repo);
      const me = tracker.get(rc, id);
      const born = me.created_at ? new Date(me.created_at).getTime() : 0;
      const out: { id: string; status: string }[] = [];
      for (const dir of [[], ["--direction", "up"]]) {
        try {
          for (const t of tracker.deps(rc, id, dir)) {
            const type = String((t as any).dependency_type ?? "").toLowerCase();
            if (type && type !== "discovered-from") continue;
            const at = t.created_at ? new Date(t.created_at).getTime() : 0;
            if (t.id !== id && at <= born) out.push({ id: t.id, status: t.status });
          }
        } catch { /* no links */ }
      }
      return out;
    },
    comment: (cfg, repo, id, text) => tracker.comment(repoByName(cfg, repo), id, text),
    forgetLandable: (cfg, repo, id) => {
      const f = join(cfg.homeDir, "landable.json");
      if (!existsSync(f)) return;
      try {
        const c = JSON.parse(readFileSync(f, "utf8"));
        delete c[`${repo}/${id}`];
        writeFileSync(f, JSON.stringify(c, null, 2));
      } catch { /* a torn cache just recomputes */ }
    },
    journal: (cfg, line) => journal.append(cfg.homeDir, line),
  };
}
