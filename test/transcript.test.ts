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
