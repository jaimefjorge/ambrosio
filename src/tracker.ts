import { spawnSync } from "node:child_process";
import type { RepoConfig } from "./config.ts";

export const CUSTOM_STATUSES = "planning:wip,plan_review:wip,needs_input:wip,verifying:wip,in_review:wip";

/** Statuses that mean "a human has to look at this". */
export const HUMAN_STATUSES = ["plan_review", "needs_input", "in_review"] as const;
/** Statuses that mean a worker should be running. */
export const ACTIVE_STATUSES = ["planning", "in_progress", "verifying"] as const;

export type Ticket = {
  id: string;
  title: string;
  description?: string;
  acceptance_criteria?: string;
  status: string;
  priority: number;
  issue_type?: string;
  external_ref?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  comment_count?: number;
  repo?: string;
};

export type Comment = { id: string; author: string; text: string; created_at: string };

export class TrackerError extends Error {
  constructor(message: string, readonly cmd: string, readonly stderr: string) {
    super(message);
  }
}

function isLockError(stderr: string): boolean {
  return /database is locked|lock|busy|another process/i.test(stderr);
}

function bd(repo: RepoConfig, args: string[], opts: { retries?: number } = {}): string {
  const retries = opts.retries ?? 1;
  const full = ["-C", repo.path, ...args];
  for (let attempt = 0; ; attempt++) {
    const r = spawnSync("bd", full, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (r.error) throw new TrackerError(`bd failed to start: ${r.error.message}`, full.join(" "), "");
    if (r.status === 0) return r.stdout ?? "";
    const stderr = (r.stderr ?? "").trim();
    if (attempt < retries && isLockError(stderr)) {
      Bun.sleepSync(300 * (attempt + 1));
      continue;
    }
    throw new TrackerError(`bd ${args[0]} failed in ${repo.name}: ${stderr.split("\n")[0]}`, full.join(" "), stderr);
  }
}

function bdJson<T>(repo: RepoConfig, args: string[]): T {
  const out = bd(repo, [...args, "--json"]).trim();
  if (out === "") return [] as unknown as T;
  try {
    return JSON.parse(out) as T;
  } catch (e) {
    throw new TrackerError(`bd returned non-JSON: ${out.slice(0, 200)}`, args.join(" "), String(e));
  }
}

function tag(repo: RepoConfig, t: Ticket): Ticket {
  return { ...t, repo: repo.name };
}

/** Idempotent: initialize beads in a repo without touching its git history or agent docs. */
export function initRepo(repo: RepoConfig): { initialized: boolean } {
  const probe = spawnSync("bd", ["-C", repo.path, "list", "--json"], { encoding: "utf8" });
  const already = probe.status === 0;
  if (!already) {
    // `bd -C <dir>` requires an existing beads project, so init runs with cwd instead.
    const r = spawnSync(
      "bd",
      ["init", "--prefix", repo.prefix, "--stealth", "--skip-agents", "--non-interactive", "--init-if-missing", "--quiet"],
      { encoding: "utf8", cwd: repo.path },
    );
    if (r.status !== 0) {
      throw new TrackerError(`bd init failed in ${repo.name}: ${(r.stderr ?? "").trim().split("\n")[0]}`, "bd init", r.stderr ?? "");
    }
  }
  // Always (re)assert the custom statuses; cheap and idempotent.
  bd(repo, ["config", "set", "status.custom", CUSTOM_STATUSES]);
  return { initialized: !already };
}

export function list(repo: RepoConfig, statuses?: string[]): Ticket[] {
  const args = ["list"];
  if (statuses && statuses.length > 0) args.push("-s", statuses.join(","));
  return bdJson<Ticket[]>(repo, args).map((t) => tag(repo, t));
}

export function listAll(repo: RepoConfig): Ticket[] {
  return bdJson<Ticket[]>(repo, ["list", "--all"]).map((t) => tag(repo, t));
}

export function ready(repo: RepoConfig): Ticket[] {
  return bdJson<Ticket[]>(repo, ["ready"]).map((t) => tag(repo, t));
}

export function get(repo: RepoConfig, id: string): Ticket {
  const rows = bdJson<Ticket[]>(repo, ["show", id]);
  const row = Array.isArray(rows) ? rows[0] : (rows as unknown as Ticket);
  if (!row) throw new TrackerError(`ticket not found: ${id}`, `bd show ${id}`, "");
  return tag(repo, row);
}

export type CreateInput = {
  title: string;
  description?: string;
  acceptance?: string;
  priority?: number;
  type?: string;
  externalRef?: string;
  labels?: string[];
  metadata?: Record<string, any>;

  /** e.g. ["discovered-from:gmc-axx"] */
  deps?: string[];
};

export function create(repo: RepoConfig, input: CreateInput): Ticket {
  const args = ["create", input.title];
  if (input.description) args.push("-d", input.description);
  if (input.acceptance) args.push("--acceptance", input.acceptance);
  if (input.priority !== undefined) args.push("-p", String(input.priority));
  if (input.type) args.push("-t", input.type);
  if (input.externalRef) args.push("--external-ref", input.externalRef);
  if (input.labels?.length) args.push("-l", input.labels.join(","));
  if (input.metadata) args.push("--metadata", JSON.stringify(input.metadata));
  if (input.deps?.length) args.push("--deps", input.deps.join(","));
  const created = bdJson<Ticket | Ticket[]>(repo, args);
  const t = Array.isArray(created) ? created[0] : created;
  return tag(repo, t);
}

export function transition(repo: RepoConfig, id: string, status: string, note?: string): Ticket {
  const rows = bdJson<Ticket[]>(repo, ["update", id, "--status", status]);
  if (note) comment(repo, id, note);
  const row = Array.isArray(rows) ? rows[0] : (rows as unknown as Ticket);
  return tag(repo, row);
}

export function comment(repo: RepoConfig, id: string, text: string): void {
  bd(repo, ["comment", id, text]);
}

export function comments(repo: RepoConfig, id: string): Comment[] {
  return bdJson<Comment[]>(repo, ["comments", id]);
}

export function setMeta(repo: RepoConfig, id: string, kv: Record<string, string>): void {
  const args = ["update", id];
  for (const [k, v] of Object.entries(kv)) args.push("--set-metadata", `${k}=${v}`);
  bd(repo, [...args, "--json"]);
}

export function close(repo: RepoConfig, id: string, reason: string): void {
  bd(repo, ["close", id, "-r", reason, "--json"]);
}

/** Tickets a human has to look at, across one repo. */
/**
 * Issues discovered while doing this one — the defects a worker filed as it
 * went. Beads records them as dependents (`--direction up`), so a ticket knows
 * what came out of it.
 */
export function discoveredFrom(repo: RepoConfig, id: string): Ticket[] {
  // Beads lists discovered-from children downward from the parent, and the
  // same downward list carries the parent's own parent. Direction cannot tell
  // them apart; time can: what was discovered while doing this ticket was
  // created after it. (2026-09-07: reading `--direction up` alone missed
  // gmc-sz7, and rule 4 saw nothing.)
  let born = 0;
  try {
    const me = get(repo, id);
    born = me.created_at ? new Date(me.created_at).getTime() : 0;
  } catch {
    return [];
  }
  const seen = new Map<string, Ticket>();
  // `--deps discovered-from:P` on create puts the child in P's `up` list;
  // `bd dep add` by hand can put it in the `down` list, next to P's own
  // parent. Up is trusted as is; down only for tickets strictly newer than P.
  for (const dir of [["--direction", "up"], []]) {
    const strict = dir.length === 0;
    try {
      for (const t of bdJson<Ticket[]>(repo, ["dep", "list", id, ...dir]) ?? []) {
        const type = String((t as any).dependency_type ?? "").toLowerCase();
        if (type && type !== "discovered-from") continue;
        let full: Ticket = t;
        if (!t.created_at || !t.status) {
          try { full = get(repo, t.id); } catch { continue; }
        }
        const at = full.created_at ? new Date(full.created_at).getTime() : 0;
        if (full.id === id) continue;
        if (strict ? at > born : at >= born) seen.set(full.id, tag(repo, full));
      }
    } catch {
      // A ticket with no links makes bd exit non-zero on some versions; that
      // is not a reason to block an acceptance.
    }
  }
  return [...seen.values()];
}

/** Of those, the ones still open. Accepting over these is the thing to refuse. */
export function openDefects(repo: RepoConfig, id: string): Ticket[] {
  const done = new Set(["closed", "accepted", "done", "deferred"]);
  return discoveredFrom(repo, id).filter((t) => !done.has((t.status ?? "").toLowerCase()));
}

export function needsHuman(repo: RepoConfig): Ticket[] {
  return list(repo, [...HUMAN_STATUSES]);
}

export function active(repo: RepoConfig): Ticket[] {
  return list(repo, [...ACTIVE_STATUSES]);
}

/** Any link in either direction: a ticket with one is not an orphan. */
export function hasLinks(repo: RepoConfig, id: string): boolean {
  try {
    const down = bdJson<Ticket[]>(repo, ["dep", "list", id]) ?? [];
    if (down.length) return true;
    return (bdJson<Ticket[]>(repo, ["dep", "list", id, "--direction", "up"]) ?? []).length > 0;
  } catch {
    return false;
  }
}

/** `child` came out of `parent`: what rule 4 reads to refuse an acceptance. */
export function addDep(repo: RepoConfig, child: string, parent: string, type = "discovered-from"): void {
  bd(repo, ["dep", "add", child, parent, "--type", type, "--json"]);
}

export function setPriority(repo: RepoConfig, id: string, priority: number): void {
  bd(repo, ["update", id, "-p", String(priority), "--json"]);
}
