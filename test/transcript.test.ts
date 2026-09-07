import { describe, expect, test } from "bun:test";
import { eventsFrom, summarizeToolInput } from "../src/transcript.ts";

const at = "2026-09-07T09:54:06.681Z";

function assistant(blocks: any[], ts = at) {
  return { type: "assistant", timestamp: ts, message: { role: "assistant", content: blocks } };
}
function user(blocks: any[], ts = at) {
  return { type: "user", timestamp: ts, message: { role: "user", content: blocks } };
}

describe("summarizeToolInput", () => {
  test("shows the command for Bash, which is what you actually want to see", () => {
    expect(summarizeToolInput("Bash", { command: "bun test", description: "run tests" })).toBe("bun test");
  });

  test("shows the path for file tools", () => {
    expect(summarizeToolInput("Edit", { file_path: "/repo/src/a.ts", old_string: "x" })).toBe("/repo/src/a.ts");
    expect(summarizeToolInput("Read", { file_path: "/repo/README.md" })).toBe("/repo/README.md");
  });

  test("shows the pattern for a search", () => {
    expect(summarizeToolInput("Grep", { pattern: "TODO", path: "src" })).toBe("TODO");
  });

  test("falls back to something rather than nothing for an unknown tool", () => {
    expect(summarizeToolInput("Weird", { alpha: "one" })).toContain("one");
    expect(summarizeToolInput("Weird", {})).toBe("");
  });
});

describe("eventsFrom", () => {
  test("turns assistant prose into a readable line", () => {
    const e = eventsFrom([assistant([{ type: "text", text: "Fixing the retry budget now." }])]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "text", summary: "Fixing the retry budget now." });
  });

  test("names the tool and its subject", () => {
    const e = eventsFrom([assistant([{ type: "tool_use", name: "Bash", input: { command: "bun test" } }])]);
    expect(e[0]).toMatchObject({ kind: "tool_use", tool: "Bash", summary: "bun test" });
  });

  test("keeps tool results, and flags the failures", () => {
    const e = eventsFrom([
      user([{ type: "tool_result", content: "64 pass, 0 fail" }]),
      user([{ type: "tool_result", content: "error: no such file", is_error: true }]),
    ]);
    expect(e[0]).toMatchObject({ kind: "tool_result", isError: false });
    expect(e[1]).toMatchObject({ kind: "tool_result", isError: true });
  });

  test("reads tool_result content whether it is a string or blocks", () => {
    const e = eventsFrom([user([{ type: "tool_result", content: [{ type: "text", text: "from a block" }] }])]);
    expect(e[0].summary).toBe("from a block");
  });

  test("marks thinking as thinking, so it is not mistaken for a decision", () => {
    const e = eventsFrom([assistant([{ type: "thinking", thinking: "Maybe the cursor is off by one" }])]);
    expect(e[0].kind).toBe("thinking");
  });

  test("ignores the bookkeeping entries that are not conversation", () => {
    const e = eventsFrom([
      { type: "worktree-state", sessionId: "x" },
      { type: "permission-mode", permissionMode: "auto" },
      assistant([{ type: "text", text: "still here" }]),
    ]);
    expect(e).toHaveLength(1);
  });

  test("returns the most recent events, in order, when asked for a limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => assistant([{ type: "text", text: `step ${i}` }]));
    const e = eventsFrom(rows, 3);
    expect(e.map((x) => x.summary)).toEqual(["step 7", "step 8", "step 9"]);
  });

  test("truncates a huge tool result instead of shipping the whole file to the browser", () => {
    const e = eventsFrom([user([{ type: "tool_result", content: "x".repeat(5000) }])]);
    expect(e[0].summary.length).toBeLessThan(700);
  });

  test("survives a half-written line at the end of a live transcript", () => {
    expect(() => eventsFrom([assistant([{ type: "text", text: "ok" }]), null as any])).not.toThrow();
  });
});

test("every event carries its timestamp, which the fleet view reads to show when it happened", () => {
  const e = eventsFrom([
    assistant([{ type: "tool_use", name: "Bash", input: { command: "bun test" } }], "2026-09-07T09:54:06.681Z"),
    user([{ type: "tool_result", content: "ok" }], "2026-09-07T09:54:19.100Z"),
  ]);
  expect(e.map((x) => x.at)).toEqual(["2026-09-07T09:54:06.681Z", "2026-09-07T09:54:19.100Z"]);
});

// --- Liveness ---------------------------------------------------------------

import { lastActivityAt } from "../src/transcript.ts";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withTranscript(lines: string[], mtime?: Date): string {
  const root = mkdtempSync(join(tmpdir(), "amb-tr-"));
  process.env.CLAUDE_CONFIG_DIR = root;
  const dir = join(root, "projects", "-w");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "sess-x.jsonl");
  writeFileSync(f, lines.join("\n") + "\n");
  if (mtime) utimesSync(f, mtime, mtime);
  return "sess-x";
}

test("liveness comes from the last real entry, not the file's mtime", () => {
  // The exact fault: bookkeeping keeps touching the file while the session has
  // been silent for hours, so mtime says alive and the worker is not.
  const sid = withTranscript([
    JSON.stringify({ type: "assistant", timestamp: "2026-09-08T09:00:00.000Z", message: { content: [] } }),
    JSON.stringify({ type: "worktree-state", sessionId: "sess-x" }),
    JSON.stringify({ type: "permission-mode", permissionMode: "auto" }),
  ], new Date("2026-09-08T15:41:00Z"));

  expect(lastActivityAt(sid)!.toISOString()).toBe("2026-09-08T09:00:00.000Z");
});

test("a transcript with no timestamped entry reports nothing rather than guessing", () => {
  expect(lastActivityAt(withTranscript([JSON.stringify({ type: "worktree-state" })]))).toBeNull();
});

test("a session with no transcript at all is not an error", () => {
  expect(lastActivityAt("no-such-session")).toBeNull();
});
