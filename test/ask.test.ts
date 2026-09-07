import { describe, expect, test } from "bun:test";
import { buildAskPrompt, looksLikeAQuestion, ask, type AskDeps } from "../src/ask.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const cfg = { homeDir: "/tmp/x", rootDir: "/repo" } as AmbrosioConfig;

const ctx = {
  board: { workers: [{ name: "gmc-4or", state: "working" }], waiting: [] },
  ticket: { id: "gmc-4or", repo: "gatemd-core", title: "Fresh-repo e2e", status: "in_progress", acceptance: "harness passes" },
  transcript: [{ kind: "tool_use", tool: "Bash", summary: "bun test", at: "2026-09-08T10:00:00Z" }],
  journal: "- 10:42 dispatched gatemd-core gmc-4or",
};

describe("buildAskPrompt", () => {
  test("puts the question first, so it cannot be lost in the context", () => {
    const p = buildAskPrompt("why is this taking so long?", ctx as any);
    expect(p.indexOf("why is this taking so long?")).toBeLessThan(p.indexOf("gmc-4or"));
  });

  test("grounds the answer in what Ambrosio actually knows", () => {
    const p = buildAskPrompt("what is it doing?", ctx as any);
    expect(p).toContain("Fresh-repo e2e");
    expect(p).toContain("bun test");
    expect(p).toContain("dispatched gatemd-core gmc-4or");
  });

  test("tells it to say when it does not know, rather than inventing", () => {
    const p = buildAskPrompt("what will it do next?", ctx as any);
    expect(p.toLowerCase()).toContain("do not know");
  });

  test("forbids acting: a question is a question", () => {
    // Asking must never move a ticket or start a worker as a side effect.
    const p = buildAskPrompt("should we stop it?", ctx as any);
    expect(p.toLowerCase()).toContain("do not change anything");
  });

  test("works with no ticket, for a question about the whole fleet", () => {
    const p = buildAskPrompt("how is the day going?", { board: ctx.board, journal: "" } as any);
    expect(p).toContain("how is the day going?");
    expect(p).not.toContain("undefined");
  });
});

describe("looksLikeAQuestion", () => {
  test("recognises a plain question from the phone", () => {
    expect(looksLikeAQuestion("why is gmc-4or still running?")).toBe(true);
    expect(looksLikeAQuestion("what is left on the release")).toBe(true);
    expect(looksLikeAQuestion("how did the e2e go?")).toBe(true);
  });

  test("does not mistake a decision for a question", () => {
    expect(looksLikeAQuestion("Q1 b")).toBe(false);
    expect(looksLikeAQuestion("A1 accept")).toBe(false);
    expect(looksLikeAQuestion("status")).toBe(false);
  });
});

describe("ask", () => {
  test("returns what the model said", () => {
    const deps: AskDeps = { run: () => "It is waiting on the Verity Stop hook.", context: () => ctx as any };
    expect(ask(cfg, "what is it doing?", {}, deps).answer).toContain("Verity Stop hook");
  });

  test("a failure comes back as an answer that says so, not as a crash", () => {
    const deps: AskDeps = { run: () => { throw new Error("claude exited 1"); }, context: () => ctx as any };
    const r = ask(cfg, "what is it doing?", {}, deps);
    expect(r.ok).toBe(false);
    expect(r.answer).toContain("claude exited 1");
  });

  test("an empty question is refused before spending anything", () => {
    let called = false;
    const deps: AskDeps = { run: () => { called = true; return ""; }, context: () => ctx as any };
    expect(ask(cfg, "   ", {}, deps).ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("an instruction is not a question", () => {
  test("phrases that open instructions are left to the manager", () => {
    for (const t of ["do the thing we discussed", "have another go at gmc-4or", "can you restart it"]) {
      expect([t, looksLikeAQuestion(t)]).toEqual([t, false]);
    }
  });

  test("unless they are actually phrased as a question", () => {
    expect(looksLikeAQuestion("can you restart it?")).toBe(true);
  });
});
