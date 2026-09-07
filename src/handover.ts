import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import * as journal from "./journal.ts";
import * as timeline from "./timeline.ts";
import type { TimelineEvent } from "./timeline.ts";
import { landable as assessLandable } from "./landable.ts";

/**
 * The hand-over brief. Jaime was not watching; now there is a PR to accept.
 * The manager's job is to onboard him onto the work: the problem, the
 * approach and what was rejected, what changed, how it was proven, where
 * the judgment calls were, what was found and not fixed, and a
 * recommendation — written from the ticket, plan, evidence, log, timeline
 * and diff, and from nothing else. Once per round, cached in the work dir.
 */
export type BriefMaterial = {
  ticket: { id: string; repo: string; title: string; description?: string; acceptance: string[]; priority: number };
  plan: string;
  evidence: string;
  log: string;
  handover: string;
  diffStat: string;
  diff: string;
  timeline: TimelineEvent[];
  landable?: { ok: boolean; reasons: string[] };
  defects: { id: string; title: string; status: string }[];
  iteration: number;
};

export type Brief = { text: string; at: string; iteration: number; ok: boolean; summary: string };

export type BriefDeps = {
  material: (cfg: AmbrosioConfig, repo: string, ticket: string) => BriefMaterial | null;
  run: (cfg: AmbrosioConfig, prompt: string) => string;
};

const SECTIONS = [
  ["Recommendation", "accept, or reject with the exact reason to give the worker — one or two sentences, in Ambrosio's own voice; this comes first so that reading only this line is enough"],
  ["The problem", "why this ticket existed, in plain words a person who was not there can follow; what was broken or missing and for whom"],
  ["What was done", "the approach taken and why; the alternatives the worker considered and rejected, and the reason each was rejected"],
  ["What changed", "the files and the shape of the change — what a reviewer will see in the diff, in two or three sentences; call out anything that touches product behaviour as opposed to tests or docs"],
  ["How it was proven", "the exact tests and commands run and their results; the independent reviewer's verdict; the Verity verdict; anything that was NOT proven"],
  ["Where to look", "the two or three places a careful reviewer should actually read, and the judgment calls the worker made inside its decision budget that Jaime might disagree with"],
  ["Found and not fixed", "defects and nits the worker filed instead of fixing, and whether any of them should block this"],
] as const;

const DIFF_CAP = 60_000;

function clip(text: string, cap: number): { text: string; cut: boolean } {
  return text.length > cap ? { text: text.slice(0, cap), cut: true } : { text, cut: false };
}

export function buildBriefPrompt(m: BriefMaterial, now = new Date()): string {
  const diff = clip(m.diff, DIFF_CAP);
  const rounds = m.timeline.filter((e) => e.kind === "rejected");
  const parts: string[] = [
    `You are Ambrosio, Jaime's engineering manager. A worker has handed over ${m.ticket.id} for his acceptance. He was not watching; write him the story of this work so he can decide without reconstructing it.`,
    `It is ${now.toLocaleString()}.`,
    "Write only from the material below. If something is not in the material, say it is not recorded rather than inferring it. Do not praise; describe. Be concrete: name files, commands, numbers.",
    "His time is the scarce thing. Under 250 words in total. No section longer than three sentences. Recommendation first, so that reading only the first line is enough; every section after it exists to let him check the recommendation, not to be complete. Leave out anything that does not change whether he should accept.",
    m.iteration > 0
      ? `This is round ${m.iteration} of rework. Earlier rounds asked for:\n${rounds.map((r) => `- round ${r.iteration}: ${r.note ?? ""}`).join("\n")}\nOpen with what changed since the last rejection and whether each point was addressed, before the sections below.`
      : "",
    "",
    "Use exactly these headings, in this order, each as a markdown '## ' heading:",
    ...SECTIONS.map(([h, what]) => `## ${h}\n${what}`),
    "",
    "# Material",
    `## Ticket ${m.ticket.id} (P${m.ticket.priority}) — ${m.ticket.title}`,
    m.ticket.description ?? "(no description)",
    "### Acceptance criteria",
    m.ticket.acceptance.length ? m.ticket.acceptance.map((a) => `- ${a}`).join("\n") : "(none recorded)",
    "## The worker's plan (plan.md)", m.plan || "(none)",
    "## The worker's log (log.md)", m.log || "(none)",
    "## Evidence (evidence.md)", m.evidence || "(none)",
    "## Hand-over line", m.handover || "(none)",
    "## Landable", m.landable ? (m.landable.ok ? "yes" : `no: ${m.landable.reasons.join("; ")}`) : "(not assessed)",
    "## Defects filed from this ticket", m.defects.length ? m.defects.map((d) => `- ${d.id} ${d.title} (${d.status})`).join("\n") : "(none)",
    "## Timeline", m.timeline.map((e) => `${e.at} ${e.kind}${e.iteration ? ` round ${e.iteration}` : ""}${e.status ? ` → ${e.status}` : ""}${e.note ? `: ${e.note}` : ""}`).join("\n") || "(none)",
    "## Diff stat", m.diffStat || "(none)",
    `## Diff${diff.cut ? " (truncated — say so where it matters)" : ""}`, diff.text || "(none)",
  ];
  return parts.filter((p) => p !== "").join("\n");
}

const file = (home: string, repo: string, ticket: string) => join(journal.workDir(home, repo, ticket), "brief.md");
const meta = (home: string, repo: string, ticket: string) => join(journal.workDir(home, repo, ticket), "brief.json");

export function readBrief(home: string, repo: string, ticket: string): Brief | null {
  const f = file(home, repo, ticket), m = meta(home, repo, ticket);
  if (!existsSync(f) || !existsSync(m)) return null;
  try {
    const j = JSON.parse(readFileSync(m, "utf8"));
    const text = readFileSync(f, "utf8");
    return { text, at: j.at, iteration: j.iteration ?? 0, ok: true, summary: j.summary ?? summaryOf(text) };
  } catch {
    return null;
  }
}

/** The first sentence of the recommendation, or of the whole brief. */
export function summaryOf(text: string): string {
  const rec = /## Recommendation\s*\n([\s\S]*)/i.exec(text);
  const body = (rec ? rec[1] : text).replace(/^#+.*$/gm, "").replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(body);
  return (m ? m[1] : body).slice(0, 240);
}

/** Write the brief for this round if it is not written yet. Never throws. */
export function handoverBrief(cfg: AmbrosioConfig, repo: string, ticket: string, deps: BriefDeps = realBriefDeps()): Brief | null {
  let m: BriefMaterial | null;
  try { m = deps.material(cfg, repo, ticket); } catch (e) { return { text: `Could not gather the material: ${(e as Error).message}`, at: new Date().toISOString(), iteration: 0, ok: false, summary: "" }; }
  if (!m) return null;
  const existing = readBrief(cfg.homeDir, repo, ticket);
  if (existing && existing.iteration === m.iteration) return existing;
  const at = new Date().toISOString();
  try {
    const text = deps.run(cfg, buildBriefPrompt(m)).trim();
    if (!text) throw new Error("empty brief");
    const summary = summaryOf(text);
    mkdirSync(journal.workDir(cfg.homeDir, repo, ticket), { recursive: true });
    writeFileSync(file(cfg.homeDir, repo, ticket), text);
    writeFileSync(meta(cfg.homeDir, repo, ticket), JSON.stringify({ at, iteration: m.iteration, summary }, null, 2));
    timeline.record(cfg.homeDir, repo, ticket, { kind: "briefed", iteration: m.iteration, note: summary, by: "ambrosio" });
    journal.append(cfg.homeDir, `briefed ${ticket}${m.iteration ? ` (round ${m.iteration})` : ""}: ${summary}`);
    return { text, at, iteration: m.iteration, ok: true, summary };
  } catch (e) {
    return { text: `Brief not written yet: ${(e as Error).message}. It will be tried again on the next pass.`, at, iteration: m.iteration, ok: false, summary: "" };
  }
}

// --- the real world -----------------------------------------------------------

function sh(cmd: string, args: string[], cwd: string, cap = 200_000): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout ?? "").slice(0, cap) : "";
}

function workFile(cfg: AmbrosioConfig, repo: string, ticket: string, name: string): string {
  const f = join(journal.workDir(cfg.homeDir, repo, ticket), name);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

export function realBriefDeps(): BriefDeps {
  return {
    material: (cfg, repo, ticket) => {
      const rc = repoByName(cfg, repo);
      const t = tracker.get(rc, ticket);
      const events = timeline.read(cfg.homeDir, repo, ticket);
      const comments = tracker.comments(rc, ticket);
      const cwd = rc.path.replace(/^~/, process.env.HOME ?? "");
      const land = assessLandable(cfg, repo, ticket);
      const pr = land.pr?.number;
      return {
        ticket: { id: t.id, repo, title: t.title, description: t.description, acceptance: (t.acceptance_criteria ?? "").split("\n").map((l) => l.trim()).filter(Boolean), priority: t.priority },
        plan: workFile(cfg, repo, ticket, "plan.md"),
        evidence: workFile(cfg, repo, ticket, "evidence.md"),
        log: workFile(cfg, repo, ticket, "log.md"),
        handover: comments.length ? comments[comments.length - 1].text : "",
        diffStat: pr ? sh("gh", ["pr", "diff", String(pr), "--stat"], cwd, 8_000) : "",
        diff: pr ? sh("gh", ["pr", "diff", String(pr)], cwd) : "",
        timeline: events,
        landable: { ok: land.ok, reasons: land.reasons },
        defects: tracker.discoveredFrom(rc, ticket).map((d) => ({ id: d.id, title: d.title, status: d.status })),
        iteration: timeline.iterationOf(events),
      };
    },
    run: (cfg, prompt) => {
      const r = spawnSync("claude", ["-p", prompt], { cwd: cfg.rootDir, encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
      if (r.status !== 0) throw new Error((r.stderr ?? "").trim().split("\n")[0] || `claude exited ${r.status}`);
      return (r.stdout ?? "").trim();
    },
  };
}
