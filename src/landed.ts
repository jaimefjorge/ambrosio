import { spawnSync } from "node:child_process";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import * as timeline from "./timeline.ts";

/**
 * After acceptance. `closed` means Jaime said yes; it does not mean the PR
 * merged, and it says nothing about main afterwards. Each pass looks at
 * every accepted ticket that has not yet been seen through: was it merged?
 * did main stay green at that commit? Green closes the loop. Red files a
 * defect at the parent — linked, at the parent's priority — once.
 *
 * Merging stays Jaime's (rule 2). This only watches.
 */
export type LandedDeps = {
  pr: (cfg: AmbrosioConfig, repo: string, number: number) => { merged: boolean; mergeCommit: string | null; url: string };
  /** Recent CI runs on main, newest first. */
  mainRuns: (cfg: AmbrosioConfig, repo: string) => { sha: string; conclusion: string | null; url: string; name: string }[];
  /** File a defect discovered-from the parent, at the parent's priority; returns its id. */
  fileDefect: (cfg: AmbrosioConfig, repo: string, parent: string, title: string, body: string) => string;
  journal: (cfg: AmbrosioConfig, line: string) => void;
};

export function landedPass(cfg: AmbrosioConfig, deps: LandedDeps): { merged: string[]; green: string[]; red: string[] } {
  const out = { merged: [] as string[], green: [] as string[], red: [] as string[] };
  for (const { repo, ticket, events } of timeline.readAll(cfg)) {
    const accepted = timeline.last(events, "accepted");
    if (!accepted) continue;
    if (timeline.last(events, "main_green") || timeline.last(events, "main_red")) continue;

    let merged = timeline.last(events, "merged");
    if (!merged) {
      const pr = typeof accepted.pr === "number" ? accepted.pr : null;
      if (!pr) continue;
      try {
        const facts = deps.pr(cfg, repo, pr);
        if (!facts.merged) continue;
        merged = timeline.record(cfg.homeDir, repo, ticket, { kind: "merged", commit: facts.mergeCommit ?? undefined, pr, by: "jaime" });
        deps.journal(cfg, `${ticket} merged (PR #${pr}${facts.mergeCommit ? ` · ${facts.mergeCommit.slice(0, 7)}` : ""})`);
        out.merged.push(ticket);
      } catch (e) {
        deps.journal(cfg, `landed: could not read PR #${pr} for ${ticket}: ${(e as Error).message}`);
        continue;
      }
    }

    const commit = typeof merged.commit === "string" ? merged.commit : null;
    if (!commit) continue;
    let runs: ReturnType<LandedDeps["mainRuns"]>;
    try { runs = deps.mainRuns(cfg, repo); } catch (e) { deps.journal(cfg, `landed: could not read main runs for ${repo}: ${(e as Error).message}`); continue; }
    const mine = runs.filter((r) => r.sha === commit || r.sha.startsWith(commit) || commit.startsWith(r.sha));
    if (!mine.length || mine.some((r) => !r.conclusion)) continue;
    const failed = mine.filter((r) => !["success", "skipped", "neutral"].includes((r.conclusion ?? "").toLowerCase()));
    if (failed.length === 0) {
      timeline.record(cfg.homeDir, repo, ticket, { kind: "main_green", commit, by: "ambrosio" });
      deps.journal(cfg, `${ticket}: main is green at ${commit.slice(0, 7)} — landed`);
      out.green.push(ticket);
    } else {
      const title = `main is red after merging ${ticket}: ${failed.map((f) => f.name).join(", ")} failed`;
      let id = "";
      try {
        id = deps.fileDefect(cfg, repo, ticket, title, `${failed.map((f) => f.url).join("\n")}\n\nMerged commit ${commit}. Filed by Ambrosio from the main branch's CI, discovered-from ${ticket}.`);
      } catch (e) {
        deps.journal(cfg, `landed: main is red after ${ticket} but could not file the defect: ${(e as Error).message}`);
      }
      timeline.record(cfg.homeDir, repo, ticket, { kind: "main_red", commit, note: title, defect: id || undefined, by: "ambrosio" });
      deps.journal(cfg, `${ticket}: ${title}${id ? ` — filed ${id}` : ""}`);
      out.red.push(ticket);
    }
  }
  return out;
}

function gh(cwd: string, args: string[]): string {
  const r = spawnSync("gh", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "gh failed").trim().split("\n")[0]);
  return r.stdout;
}

export function realLandedDeps(): LandedDeps {
  const cwd = (cfg: AmbrosioConfig, repo: string) => repoByName(cfg, repo).path.replace(/^~/, process.env.HOME ?? "");
  return {
    pr: (cfg, repo, number) => {
      const j = JSON.parse(gh(cwd(cfg, repo), ["pr", "view", String(number), "--json", "state,mergeCommit,url"]));
      return { merged: j.state === "MERGED", mergeCommit: j.mergeCommit?.oid ?? null, url: j.url };
    },
    mainRuns: (cfg, repo) => {
      const j = JSON.parse(gh(cwd(cfg, repo), ["run", "list", "--branch", "main", "--limit", "20", "--json", "headSha,conclusion,url,name"]));
      return (j as any[]).map((r) => ({ sha: r.headSha, conclusion: r.conclusion || null, url: r.url, name: r.name }));
    },
    fileDefect: (cfg, repo, parent, title, body) => {
      const rc = repoByName(cfg, repo);
      const p = tracker.get(rc, parent);
      const t = tracker.create(rc, { title, description: body, priority: p.priority, type: "bug", deps: [`discovered-from:${parent}`] });
      return t.id;
    },
    journal: (cfg, line) => journal.append(cfg.homeDir, line),
  };
}
