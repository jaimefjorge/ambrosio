import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";

/**
 * Landable: could Jaime merge this right now?
 *
 * The 2026-09-07 day ended with two draft PRs that could not land and a
 * board that said nothing about it. This is the board's answer, per ticket:
 * a PR exists, the branch merges clean, every check is green (or skipped),
 * Verity said PASS at hand-over, and no defect the worker filed is still
 * open. Every failing reason is reported at once.
 */
export type PrFacts = {
  number: number;
  url: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  draft: boolean;
  checks: { name: string; conclusion: string | null }[];
};

export type Assessment = { ok: boolean; pr: PrFacts | null; reasons: string[]; at: string };

export type LandableDeps = {
  pr: (cfg: AmbrosioConfig, repo: string, ticket: string) => PrFacts | null;
  lastComment: (cfg: AmbrosioConfig, repo: string, ticket: string) => string;
  openDefects: (cfg: AmbrosioConfig, repo: string, ticket: string) => { id: string; title: string }[];
};

const GREEN = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

export function prFromComment(text: string): number | null {
  const m = /github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

export function verdictFromComment(text: string): "PASS" | "FAIL" | "BLOCK" | null {
  const m = /Verity\s*:?\s*(PASS|FAIL|BLOCK)\b/i.exec(text);
  return m ? (m[1].toUpperCase() as "PASS" | "FAIL" | "BLOCK") : null;
}

export function assess(cfg: AmbrosioConfig, repo: string, ticket: string, deps: LandableDeps, now = new Date()): Assessment {
  const reasons: string[] = [];
  let pr: PrFacts | null = null;
  try {
    pr = deps.pr(cfg, repo, ticket);
  } catch (e) {
    reasons.push(`could not read the PR: ${(e as Error).message}`);
  }
  if (!pr && reasons.length === 0) reasons.push("no PR found for this ticket");

  if (pr) {
    if (pr.mergeable === "CONFLICTING") reasons.push(`branch conflicts with main`);
    else if (pr.mergeable !== "MERGEABLE") reasons.push(`mergeability ${pr.mergeable.toLowerCase()}`);
    const failed = pr.checks.filter((c) => c.conclusion && !GREEN.has(c.conclusion.toUpperCase()));
    const pending = pr.checks.filter((c) => !c.conclusion);
    if (failed.length) reasons.push(`${failed.map((c) => c.name).join(", ")} failed`);
    if (pending.length) reasons.push(`${pending.map((c) => c.name).join(", ")} pending`);
  }

  const verdict = verdictFromComment(deps.lastComment(cfg, repo, ticket));
  if (verdict !== "PASS") reasons.push(verdict ? `Verity ${verdict}` : "no Verity PASS recorded at hand-over");

  const defects = deps.openDefects(cfg, repo, ticket);
  if (defects.length) reasons.push(`open defects: ${defects.map((d) => d.id).join(", ")}`);

  return { ok: reasons.length === 0, pr, reasons, at: now.toISOString() };
}

// --- the real world -----------------------------------------------------------

/** gh is slow and rate-limited; the loop asks every few seconds. */
const CACHE_MS = 60_000;
const cacheFile = (home: string) => join(home, "landable.json");

function readCache(home: string): Record<string, Assessment> {
  const f = cacheFile(home);
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
}

function ghPr(cfg: AmbrosioConfig, repo: string, ticket: string): PrFacts | null {
  const path = repoByName(cfg, repo).path.replace(/^~/, process.env.HOME ?? "");
  const r = spawnSync("gh", ["pr", "list", "--state", "open", "--search", `${ticket} in:title`, "--json", "number,url,mergeable,isDraft,statusCheckRollup", "--limit", "5"], { cwd: path, encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "gh failed").trim().split("\n")[0]);
  const list = JSON.parse(r.stdout || "[]") as any[];
  const hit = list.find((p) => new RegExp(`^${ticket}\\b`, "i").test(p.title ?? "")) ?? list[0];
  if (!hit) return null;
  return {
    number: hit.number,
    url: hit.url,
    mergeable: hit.mergeable ?? "UNKNOWN",
    draft: !!hit.isDraft,
    checks: (hit.statusCheckRollup ?? []).map((c: any) => ({ name: c.name ?? c.context ?? "check", conclusion: c.conclusion ?? c.state ?? null })),
  };
}

export const realLandableDeps: LandableDeps = {
  pr: ghPr,
  lastComment: (cfg, repo, ticket) => {
    const cs = tracker.comments(repoByName(cfg, repo), ticket);
    return cs.length ? cs[cs.length - 1].text : "";
  },
  openDefects: (cfg, repo, ticket) => tracker.openDefects(repoByName(cfg, repo), ticket),
};

/** Assess with a short cache, so the watch loop can ask on every pass. */
export function landable(cfg: AmbrosioConfig, repo: string, ticket: string, deps: LandableDeps = realLandableDeps, now = new Date()): Assessment {
  const cache = readCache(cfg.homeDir);
  const hit = cache[`${repo}/${ticket}`];
  if (hit && now.getTime() - new Date(hit.at).getTime() < CACHE_MS) return hit;
  const a = assess(cfg, repo, ticket, deps, now);
  mkdirSync(cfg.homeDir, { recursive: true });
  writeFileSync(cacheFile(cfg.homeDir), JSON.stringify({ ...cache, [`${repo}/${ticket}`]: a }, null, 2));
  return a;
}
