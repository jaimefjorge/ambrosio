import { expect, test, beforeEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootDir } from "../src/config.ts";

const HOOKS = join(rootDir(), "worker", "hooks");
/** Each case spawns bash, jq and shasum; 5s is not enough on a busy machine. */
const HOOK_TIMEOUT = 60_000;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "amb-home-"));
});

function run(script: string, payload: unknown, env: Record<string, string> = {}) {
  const r = spawnSync("bash", [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, AMBROSIO_HOME: home, ...env },
  });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function queueFiles() {
  try { return readdirSync(join(home, "queue")).filter((f) => f.endsWith(".json")); } catch { return []; }
}

const askPayload = (q = "Keep the legacy token path?") => ({
  session_id: "sess-1",
  cwd: "/tmp/repo",
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: {
    questions: [{
      question: q,
      header: "Legacy",
      options: [{ label: "Keep behind a flag" }, { label: "Remove now" }],
      multiSelect: false,
    }],
  },
});

test("ask-guard denies and records the question with its options", () => {
  const r = run("ask-guard.sh", askPayload(), { AMBROSIO_TICKET: "tt-1", AMBROSIO_REPO: "core" });
  expect(r.status).toBe(0);
  const decision = JSON.parse(r.out);
  expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("Q-");

  const files = queueFiles();
  expect(files.length).toBe(1);
  const entry = JSON.parse(readFileSync(join(home, "queue", files[0]), "utf8"));
  expect(entry.kind).toBe("question");
  expect(entry.ticket).toBe("tt-1");
  expect(entry.repo).toBe("core");
  expect(entry.sessionId).toBe("sess-1");
  expect(entry.status).toBe("open");
  expect(entry.questions[0].question).toContain("legacy token");
  expect(entry.questions[0].options.map((o: any) => o.label)).toEqual(["Keep behind a flag", "Remove now"]);
  expect(entry.urgent).toBe(false);
}, HOOK_TIMEOUT);

test("ask-guard dedupes an identical question into one entry", () => {
  run("ask-guard.sh", askPayload(), { AMBROSIO_TICKET: "tt-1" });
  const second = run("ask-guard.sh", askPayload(), { AMBROSIO_TICKET: "tt-1" });
  expect(queueFiles().length).toBe(1);
  expect(JSON.parse(second.out).hookSpecificOutput.permissionDecisionReason).toContain("Already recorded");
}, HOOK_TIMEOUT);

test("ask-guard flags genuinely risky questions as urgent", () => {
  for (const q of [
    "Should I drop the production users table?",
    "Which API key should the client use?",
    "This migration is irreversible, proceed?",
  ]) {
    home = mkdtempSync(join(tmpdir(), "amb-home-"));
    run("ask-guard.sh", askPayload(q), { AMBROSIO_TICKET: "tt-u" });
    const entry = JSON.parse(readFileSync(join(home, "queue", queueFiles()[0]), "utf8"));
    expect(entry.urgent).toBe(true);
  }
}, HOOK_TIMEOUT);

test("ask-guard leaves ordinary engineering questions non-urgent", () => {
  for (const q of [
    "Keep the legacy token path for the CLI?",
    "Should the migration run before or after the backfill?",
    "Name the new column tenant_id or org_id?",
    "Delete the unused helper function?",
  ]) {
    home = mkdtempSync(join(tmpdir(), "amb-home-"));
    run("ask-guard.sh", askPayload(q), { AMBROSIO_TICKET: "tt-n" });
    const entry = JSON.parse(readFileSync(join(home, "queue", queueFiles()[0]), "utf8"));
    expect(entry.urgent).toBe(false);
  }
}, HOOK_TIMEOUT);

test("ask-guard survives a malformed payload and still denies", () => {
  const r = spawnSync("bash", [join(HOOKS, "ask-guard.sh")], {
    input: "not json at all",
    encoding: "utf8",
    env: { ...process.env, AMBROSIO_HOME: home },
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
}, HOOK_TIMEOUT);

test("permission-guard records an urgent entry and denies", () => {
  const r = run("permission-guard.sh", {
    session_id: "sess-2", cwd: "/tmp/repo", tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
  }, { AMBROSIO_TICKET: "tt-3" });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.out).decision.behavior).toBe("deny");
  const entry = JSON.parse(readFileSync(join(home, "queue", queueFiles()[0]), "utf8"));
  expect(entry.kind).toBe("permission");
  expect(entry.urgent).toBe(true);
  expect(entry.tool).toBe("Bash");
}, HOOK_TIMEOUT);

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

test("bash-guard blocks pushes to main, force pushes and --no-verify", () => {
  for (const cmd of [
    "git push origin main",
    "git push -u origin main",
    "git push --force origin feature",
    "git commit --no-verify -m wip",
    "git reset --hard origin/main",
  ]) {
    const r = run("bash-guard.sh", bash(cmd));
    expect(r.status).toBe(0);
    expect(r.out.length).toBeGreaterThan(0);
    expect(JSON.parse(r.out).hookSpecificOutput.permissionDecision).toBe("deny");
  }
}, HOOK_TIMEOUT);

test("bash-guard allows ordinary commands", () => {
  for (const cmd of [
    "bun test",
    "git push -u origin ticket/tt-1",
    "git commit -m 'feat: add thing'",
    "npm run lint",
    "git reset --hard HEAD~1",
  ]) {
    const r = run("bash-guard.sh", bash(cmd));
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("");
  }
}, HOOK_TIMEOUT);

// --- Ticket attribution -----------------------------------------------------
// A background session can inherit AMBROSIO_TICKET from an earlier spawn, which
// once filed a worker's question against another worker's ticket. Jaime's answer
// would have been injected into the wrong session.

import { mkdirSync, writeFileSync } from "node:fs";

function withSession(repo: string, ticket: string, sessionId: string) {
  const dir = join(home, "work", repo, ticket);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sessions.json"), JSON.stringify([{ id: "short1", sessionId, startedAt: "now" }]));
}

function queued() {
  const f = queueFiles()[0];
  return JSON.parse(readFileSync(join(home, "queue", f), "utf8"));
}

test("ask-guard files the question against the session's real ticket, not a stale env var", () => {
  withSession("gatemd", "gmc-gfh", "sess-real");
  const r = run("ask-guard.sh", { ...askPayload(), session_id: "sess-real", cwd: "/w/gmc-gfh-migration" },
    { AMBROSIO_TICKET: "gmc-4or", AMBROSIO_REPO: "wrong-repo" });

  expect(r.status).toBe(0);
  expect(queued()).toMatchObject({ ticket: "gmc-gfh", repo: "gatemd" });
}, HOOK_TIMEOUT);

test("ask-guard falls back to the worktree path when there is no session record", () => {
  mkdirSync(join(home, "work", "gatemd", "gmc-gfh"), { recursive: true });
  run("ask-guard.sh", { ...askPayload(), session_id: "unrecorded", cwd: "/w/.claude/worktrees/gmc-gfh-migration-e2e" },
    { AMBROSIO_TICKET: "gmc-4or", AMBROSIO_REPO: "wrong-repo" });

  expect(queued()).toMatchObject({ ticket: "gmc-gfh", repo: "gatemd" });
}, HOOK_TIMEOUT);

test("ask-guard still uses the env var when nothing better is known", () => {
  run("ask-guard.sh", { ...askPayload(), session_id: "unknown-sess", cwd: "/tmp/nowhere" },
    { AMBROSIO_TICKET: "gmc-4or", AMBROSIO_REPO: "gatemd" });

  expect(queued()).toMatchObject({ ticket: "gmc-4or", repo: "gatemd" });
}, HOOK_TIMEOUT);

test("two workers asking the same question get separate entries, not one merged one", () => {
  // The dedupe hash keys on the ticket, so a wrong ticket used to collapse
  // two workers' questions into a single entry and lose one of them.
  withSession("gatemd", "gmc-gfh", "sess-a");
  withSession("gatemd", "gmc-4or", "sess-b");
  run("ask-guard.sh", { ...askPayload("Which fixture?"), session_id: "sess-a", cwd: "/w/a" }, { AMBROSIO_TICKET: "gmc-4or" });
  run("ask-guard.sh", { ...askPayload("Which fixture?"), session_id: "sess-b", cwd: "/w/b" }, { AMBROSIO_TICKET: "gmc-4or" });

  const tickets = queueFiles()
    .map((f) => JSON.parse(readFileSync(join(home, "queue", f), "utf8")).ticket)
    .sort();
  expect(tickets).toEqual(["gmc-4or", "gmc-gfh"]);
}, HOOK_TIMEOUT);

test("permission-guard resolves the ticket the same way", () => {
  withSession("gatemd", "gmc-gfh", "sess-real");
  run("permission-guard.sh", { session_id: "sess-real", cwd: "/w/gmc-gfh", tool_name: "Bash", tool_input: { command: "gh auth login" } },
    { AMBROSIO_TICKET: "gmc-4or", AMBROSIO_REPO: "wrong-repo" });

  expect(queued()).toMatchObject({ ticket: "gmc-gfh", repo: "gatemd", kind: "permission", urgent: true });
}, HOOK_TIMEOUT);
