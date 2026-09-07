import { spawnSync } from "node:child_process";
import { standing } from "./standing.ts";
import type { AmbrosioConfig } from "./config.ts";
import { collectBoard, type Board } from "./board.ts";
import { assignKeys } from "./digest.ts";
import * as journal from "./journal.ts";
import * as queue from "./queue.ts";
import { recentLessons, readReview, type Lesson } from "./review.ts";
import { ledger, realLedgerDeps, type Ledger, type LedgerDeps } from "./ledger.ts";

/**
 * Whether a source could be read at all, and why not when it could not.
 *
 * An empty panel and a broken panel look identical, and this project has
 * already lost a decision to that. Every source says which it is.
 */
export type SourceState = { name: string; ok: boolean; detail: string };

export type PullRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  reviewDecision?: string;
  checks: "passing" | "failing" | "pending" | "none";
  updatedAt: string;
  flag: string;
  rank: number;
};

export type Carryover = { at: string; kind: string; text: string };

/** What actually happened since yesterday morning, including the night shift. */
export type Recap = { accepted: string[]; dispatched: string[]; night: string[] };

const ACCEPTED = /^- (\d\d:\d\d) (\S+) accepted and closed(.*)$/;
const DISPATCHED = /^- (\d\d:\d\d) dispatched \S+ (\S+) \((.*?)\) as session/;
const NIGHT = /^- (\d\d:\d\d) after hours: (.*)$/;

export function recapFrom(text: string): Recap {
  const recap: Recap = { accepted: [], dispatched: [], night: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    let m = ACCEPTED.exec(line);
    if (m) { recap.accepted.push(`${m[2]}${m[3]}`.trim()); continue; }
    m = DISPATCHED.exec(line);
    if (m) { recap.dispatched.push(`${m[2]} — ${m[3]}`); continue; }
    m = NIGHT.exec(line);
    if (m) recap.night.push(m[2]);
  }
  return recap;
}

export type BriefTicket = { id: string; repo: string; title: string; status: string; priority: number };

export type Scope = { repos?: string[]; mission?: string };

export type MorningBrief = {
  date: string;
  greeting: string;
  mission: string;
  repos: string[];
  recap: Recap;
  lessons: Lesson[];
  yesterdayReview: { wentWell: string; doBetter: string } | null;
  capacity: { used: number; limit: number; free: number };
  /** Standing instructions from the dialog, still in force this morning. */
  instructions: string[];
  /** Yesterday's ledger: what landed, what bounced, what is still yours to merge. */
  ledger: Ledger | null;
  carryover: Carryover[];
  waiting: { key: string; kind: "question" | "plan" | "accept"; id: string; repo: string; title: string }[];
  ready: BriefTicket[];
  inFlight: BriefTicket[];
  prs: PullRequest[];
  linear: { id: string; identifier: string; title: string; url: string; state: string }[];
  verity: { repo: string; loggedIn: boolean; runs: number }[];
  sources: SourceState[];
};

export type MorningDeps = {
  ledgerDeps?: LedgerDeps;
  board: (cfg: AmbrosioConfig) => Board;
  prs: (cfg: AmbrosioConfig) => PullRequest[];
  linear: (cfg: AmbrosioConfig) => { issues: MorningBrief["linear"]; source: SourceState };
  verity: (cfg: AmbrosioConfig) => MorningBrief["verity"];
  journal: (cfg: AmbrosioConfig) => string;
  lessons: (cfg: AmbrosioConfig) => Lesson[];
  yesterdayReview: (cfg: AmbrosioConfig) => { wentWell: string; doBetter: string } | null;
  now: () => Date;
};

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning, sir.";
  if (h < 18) return "Good afternoon, sir.";
  return "Good evening, sir.";
}

/** What a PR needs from Jaime, and how loudly. Lower rank sorts first. */
export function classifyPr(pr: { checks: string; isDraft: boolean; reviewDecision?: string }): { flag: string; rank: number } {
  if (pr.checks === "failing") return { flag: "checks failing", rank: 0 };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { flag: "changes requested", rank: 1 };
  if (pr.isDraft) return { flag: "draft", rank: 4 };
  if (pr.reviewDecision === "APPROVED") return { flag: "ready to merge", rank: 2 };
  if (pr.checks === "pending") return { flag: "checks running", rank: 5 };
  return { flag: "waiting on review", rank: 3 };
}

/** Lines Ambrosio wrote meaning "come back to this". */
const CARRYOVER = /^- (\d\d:\d\d) (OPEN ACTION|DEFECT|decided|noted|parked)\b[:\s]*(.*)$/;

export function carryoverFrom(text: string): Carryover[] {
  return text
    .split("\n")
    .map((l) => CARRYOVER.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ at: m[1], kind: m[2], text: m[3].trim() }));
}

function safely<T>(name: string, fallback: T, fn: () => T, sources: SourceState[]): T {
  try {
    const value = fn();
    sources.push({ name, ok: true, detail: "read" });
    return value;
  } catch (e) {
    sources.push({ name, ok: false, detail: (e as Error).message });
    return fallback;
  }
}

/**
 * The whole state of the world, as it matters at the start of a day: what came
 * back from yesterday, what is waiting on Jaime, what is ready to start, what
 * is already running, and what is open elsewhere.
 */
export function buildBrief(cfg: AmbrosioConfig, deps: MorningDeps, scope: Scope = {}): MorningBrief {
  const now = deps.now();
  // An empty choice means the whole world; scoping to nothing would hide the
  // very work the morning exists to show.
  const only = scope.repos && scope.repos.length > 0 ? new Set(scope.repos) : null;
  const inScope = (repo: string | undefined) => !only || only.has(repo ?? "");
  const sources: SourceState[] = [];

  const board = safely("Board", null as Board | null, () => deps.board(cfg), sources);
  const keys = board ? assignKeys(board) : { questions: {}, plans: {}, accept: {} };

  const waiting: MorningBrief["waiting"] = [
    ...Object.entries(keys.questions).map(([key, q]: [string, any]) => ({
      key, kind: "question" as const, id: q.ticket, repo: q.repo, title: queue.summarize(q),
    })),
    ...Object.entries(keys.plans).map(([key, t]: [string, any]) => ({
      key, kind: "plan" as const, id: t.id, repo: t.repo ?? "", title: t.title,
    })),
    ...Object.entries(keys.accept).map(([key, t]: [string, any]) => ({
      key, kind: "accept" as const, id: t.id, repo: t.repo ?? "", title: t.title,
    })),
  ];

  const busy = (board?.agents ?? []).filter((a) => a.kind === "background" && (a.state === "working" || a.state === "blocked")).length;
  const asTicket = (t: any): BriefTicket => ({ id: t.id, repo: t.repo ?? "", title: t.title, status: t.status, priority: t.priority });

  const prs = safely("Pull requests", [] as PullRequest[], () => deps.prs(cfg), sources);
  const linear = safely("Linear", { issues: [], source: { name: "Linear", ok: false, detail: "not read" } }, () => deps.linear(cfg), sources);
  // The Linear collector reports its own state; keep that, not the wrapper's.
  const i = sources.findIndex((s) => s.name === "Linear");
  if (i >= 0 && linear.source) sources[i] = linear.source;
  const verity = safely("Verity", [] as MorningBrief["verity"], () => deps.verity(cfg), sources);
  const text = safely("Journal", "", () => deps.journal(cfg), sources);

  return {
    date: now.toISOString(),
    greeting: greeting(now),
    mission: scope.mission ?? "",
    repos: scope.repos ?? [],
    recap: recapFrom(text),
    lessons: safely("Lessons", [] as Lesson[], () => deps.lessons(cfg), sources),
    yesterdayReview: safely("Yesterday's review", null as any, () => deps.yesterdayReview(cfg), sources),
    capacity: { used: busy, limit: cfg.wipLimit, free: Math.max(0, cfg.wipLimit - busy) },
    instructions: standing(cfg.homeDir).map((e) => e.text),
    ledger: safely("Ledger", null as Ledger | null, () => ledger(cfg, deps.ledgerDeps ?? realLedgerDeps(), new Date(now.getTime() - 24 * 3600 * 1000), now), sources),
    carryover: carryoverFrom(text),
    waiting: waiting.filter((w) => inScope(w.repo)),
    ready: (board?.ready ?? []).filter((t) => inScope(t.repo)).map(asTicket),
    inFlight: (board?.all ?? []).filter((t) => (t.status === "in_progress" || t.status === "planning") && inScope(t.repo)).map(asTicket),
    prs: prs.filter((p) => inScope(p.repo)).sort((a, b) => a.rank - b.rank),
    linear: linear.issues,
    verity: verity.filter((v) => inScope(v.repo)),
    sources,
  };
}

// ---------------------------------------------------------------------------
// Real collectors.
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd?: string, timeout = 30_000): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]}: ${(r.stderr ?? "").trim().split("\n")[0] || `exit ${r.status}`}`);
  return r.stdout ?? "";
}

function checksOf(rollup: any[]): PullRequest["checks"] {
  if (!rollup?.length) return "none";
  const states = rollup.map((c) => c.conclusion ?? c.state ?? c.status);
  if (states.some((s) => s === "FAILURE" || s === "TIMED_OUT" || s === "CANCELLED")) return "failing";
  if (states.some((s) => s === "IN_PROGRESS" || s === "QUEUED" || s === "PENDING")) return "pending";
  return "passing";
}

export function collectPrs(cfg: AmbrosioConfig): PullRequest[] {
  const out: PullRequest[] = [];
  for (const repo of cfg.repos) {
    const slug = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], repo.path).trim();
    const raw = JSON.parse(run("gh", [
      "pr", "list", "-R", slug, "--author", "@me", "--limit", "30",
      "--json", "number,title,url,isDraft,reviewDecision,statusCheckRollup,updatedAt",
    ]));
    for (const p of raw) {
      const checks = checksOf(p.statusCheckRollup);
      const { flag, rank } = classifyPr({ checks, isDraft: p.isDraft, reviewDecision: p.reviewDecision });
      out.push({
        repo: repo.name, number: p.number, title: p.title, url: p.url,
        isDraft: p.isDraft, reviewDecision: p.reviewDecision, checks,
        updatedAt: p.updatedAt, flag, rank,
      });
    }
  }
  return out;
}

/**
 * Linear needs a personal API key in `ambrosio.config.json`:
 *   "linear": { "apiKey": "lin_api_..." }
 * Without one the panel says so, rather than looking like an empty backlog.
 */
export function collectLinear(cfg: AmbrosioConfig): { issues: MorningBrief["linear"]; source: SourceState } {
  const key = (cfg as any).linear?.apiKey;
  if (!key) {
    return { issues: [], source: { name: "Linear", ok: false, detail: 'no api key — add "linear": { "apiKey": "lin_api_…" } to ambrosio.config.json' } };
  }
  try {
    const query = `{ viewer { assignedIssues(first: 20, filter: { state: { type: { nin: ["completed","canceled"] } } }) { nodes { id identifier title url state { name } } } } }`;
    const body = run("curl", ["-sS", "-X", "POST", "https://api.linear.app/graphql",
      "-H", `Authorization: ${key}`, "-H", "Content-Type: application/json",
      "--data", JSON.stringify({ query })]);
    const json = JSON.parse(body);
    if (json.errors) throw new Error(json.errors[0]?.message ?? "Linear rejected the query");
    const nodes = json.data?.viewer?.assignedIssues?.nodes ?? [];
    return {
      issues: nodes.map((n: any) => ({ id: n.id, identifier: n.identifier, title: n.title, url: n.url, state: n.state?.name ?? "" })),
      source: { name: "Linear", ok: true, detail: `${nodes.length} assigned to you` },
    };
  } catch (e) {
    return { issues: [], source: { name: "Linear", ok: false, detail: (e as Error).message } };
  }
}

export function collectVerity(cfg: AmbrosioConfig): MorningBrief["verity"] {
  return cfg.repos.map((repo) => {
    try {
      const d = JSON.parse(run("verity", ["status", "--json", "--history", "--limit", "5"], repo.path, 25_000));
      return { repo: repo.name, loggedIn: d.auth?.logged_in === true, runs: (d.runs ?? []).length };
    } catch {
      return { repo: repo.name, loggedIn: false, runs: 0 };
    }
  });
}

export function realMorningDeps(): MorningDeps {
  return {
    board: (cfg) => collectBoard(cfg),
    prs: collectPrs,
    linear: collectLinear,
    verity: collectVerity,
    journal: (cfg) => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return `${journal.read(cfg.homeDir, journal.todayKey(y))}\n${journal.read(cfg.homeDir)}`;
    },
    lessons: (cfg) => recentLessons(cfg, 5),
    yesterdayReview: (cfg) => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const r = readReview(cfg, y);
      return r ? { wentWell: r.wentWell, doBetter: r.doBetter } : null;
    },
    now: () => new Date(),
  };
}
