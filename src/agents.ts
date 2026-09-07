import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A Claude Code session as Ambrosio sees it. */
export type Agent = {
  id?: string;
  name?: string;
  kind: "background" | "interactive";
  state?: "working" | "blocked" | "done" | "failed" | "stopped";
  status?: string;
  waitingFor?: string;
  cwd: string;
  sessionId?: string;
  startedAt?: number;
  pid?: number;
  /** From the job's state.json: the one-line summary Claude Code keeps for the row. */
  detail?: string;
  needs?: string;
  tokens?: number;
};

export class AgentError extends Error {}

function jobsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "jobs");
}

/** Merge `claude agents --json` with each job's state.json, which carries the summary line. */
export function list(): Agent[] {
  const r = spawnSync("claude", ["agents", "--json", "--all"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new AgentError(`claude agents failed: ${(r.stderr ?? "").trim().split("\n")[0]}`);
  }
  let rows: any[];
  try {
    rows = JSON.parse(r.stdout ?? "[]");
  } catch (e) {
    throw new AgentError(`claude agents returned non-JSON: ${(r.stdout ?? "").slice(0, 200)}`);
  }
  return rows.map((row) => enrich(row));
}

export function enrich(row: any): Agent {
  const agent: Agent = {
    id: row.id,
    name: row.name,
    kind: row.kind === "background" ? "background" : "interactive",
    state: row.state,
    status: row.status,
    waitingFor: row.waitingFor,
    cwd: row.cwd,
    sessionId: row.sessionId,
    startedAt: row.startedAt,
    pid: row.pid,
  };
  if (row.id) {
    const f = join(jobsDir(), row.id, "state.json");
    if (existsSync(f)) {
      try {
        const s = JSON.parse(readFileSync(f, "utf8"));
        agent.detail = s.detail ?? undefined;
        agent.needs = s.needs ?? undefined;
        agent.tokens = s.tokens ?? undefined;
        agent.state = agent.state ?? s.state;
        agent.name = agent.name ?? s.name;
      } catch {
        // A half-written state.json is not worth failing the whole board for.
      }
    }
  }
  return agent;
}

/** Background sessions only — the ones Ambrosio dispatched. */
export function workers(): Agent[] {
  return list().filter((a) => a.kind === "background");
}

export function byName(name: string): Agent | undefined {
  return workers().find((a) => a.name === name);
}

/** Sessions that are still consuming a WIP slot. */
export function busy(agents: Agent[]): Agent[] {
  return agents.filter((a) => a.state === "working" || a.state === "blocked");
}

export type DispatchResult = { id: string; name: string };

export function dispatch(opts: {
  cwd: string;
  name: string;
  prompt: string;
  settings: string;
  permissionMode?: string;
  model?: string;
  env?: Record<string, string>;
}): DispatchResult {
  const args = ["--bg", "--name", opts.name, "--permission-mode", opts.permissionMode ?? "auto", "--settings", opts.settings];
  if (opts.model) args.push("--model", opts.model);
  args.push(opts.prompt);

  const r = spawnSync("claude", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    maxBuffer: 8 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.status !== 0) throw new AgentError(`dispatch failed for ${opts.name}: ${out.trim().split("\n").slice(-3).join(" ")}`);
  const id = parseDispatchId(out);
  if (!id) throw new AgentError(`could not read the session id from dispatch output: ${out.slice(0, 300)}`);
  return { id, name: opts.name };
}

/** `backgrounded · 83efb182 · smoke-ask` */
export function parseDispatchId(output: string): string | null {
  const m = /backgrounded\s+·\s+([0-9a-f]{6,})\s+·/.exec(output);
  if (m) return m[1];
  const alt = /\b([0-9a-f]{8})\b/.exec(output);
  return alt ? alt[1] : null;
}

/** Deliver text to a running session by name (starts its next turn if idle). */
export function message(name: string, text: string): void {
  const r = spawnSync("claude", ["-p", `Send this message to the session named ${name}: ${text}`], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) throw new AgentError(`message to ${name} failed: ${(r.stderr ?? "").trim().slice(0, 200)}`);
}

/** Restart a stopped background session under the same id with a new prompt. */
export function resume(id: string, prompt: string, cwd?: string): void {
  const r = spawnSync("claude", ["--bg", "--resume", id, prompt], {
    encoding: "utf8",
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) throw new AgentError(`resume ${id} failed: ${(r.stderr ?? "").trim().slice(0, 200)}`);
}

export function stop(id: string): void {
  spawnSync("claude", ["stop", id], { encoding: "utf8" });
}

export function logs(id: string, lines = 40): string {
  const r = spawnSync("claude", ["logs", id], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  // Strip ANSI so the digest and journal stay readable.
  const clean = (r.stdout ?? "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return clean.split("\n").slice(-lines).join("\n");
}
