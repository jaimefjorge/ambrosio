import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBriefPrompt, handoverBrief, readBrief, summaryOf, type BriefMaterial, type BriefDeps } from "../src/handover.ts";
import { record, read } from "../src/timeline.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// "It's hard to accept work that I don't understand." When work reaches
// in_review, Ambrosio writes the story of it — the problem, the approach and
// what was rejected, what changed, how it was proven, the judgment calls, and
// a recommendation — from the ticket, plan, evidence, timeline and diff only.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-hb-")), rootDir: "/tmp", repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as unknown as AmbrosioConfig);

const material = (over: Partial<BriefMaterial> = {}): BriefMaterial => ({
  ticket: { id: "c-1", repo: "core", title: "spinner tests fail under FORCE_COLOR", description: "Three subtests assert uncoloured output.", acceptance: ["When FORCE_COLOR is set, the suite passes"], priority: 3 },
  plan: "## Approach\nPin colour per test with a withColor helper. Rejected: strip ANSI globally.",
  evidence: "19/19 under FORCE_COLOR=1,3,unset. Reviewer: ACCEPT.",
  log: "10:41 started\n10:52 repro\n11:20 fix",
  handover: "PR #161 · tests 1925/1925 · Verity: pending · reviewer: ACCEPT",
  diffStat: " cli/tests/lib/banner-spinner.test.ts | 86 +++++++---\n 1 file changed",
  diff: "+function withColor(enabled, fn) { ... }",
  timeline: [{ at: "2026-09-08T09:00:00Z", kind: "dispatched" }],
  landable: { ok: false, reasons: ["open defects: c-9"] },
  defects: [{ id: "c-9", title: "spinner nit", status: "open" }],
  iteration: 0,
  ...over,
});

describe("the prompt", () => {
  test("asks for the fixed sections, in order, grounded in the material and nothing else", () => {
    const p = buildBriefPrompt(material());
    for (const h of ["The problem", "What was done", "What changed", "How it was proven", "Where to look", "Found and not fixed", "Recommendation"]) expect(p).toContain(h);
    expect(p.indexOf("## Recommendation")).toBeLessThan(p.indexOf("## The problem"));
    expect(p).toMatch(/under 250 words/i);
    expect(p).toMatch(/only from the material/i);
    expect(p).toContain("spinner tests fail under FORCE_COLOR");
    expect(p).toContain("Rejected: strip ANSI globally");
    expect(p).toContain("+function withColor");
    expect(p).toContain("open defects: c-9");
  });

  test("a second round says so and carries what was rejected, so the brief speaks to the delta", () => {
    const p = buildBriefPrompt(material({ iteration: 2, timeline: [{ at: "x", kind: "rejected", iteration: 1, note: "needs a test for null" }] }));
    expect(p).toContain("round 2");
    expect(p).toContain("needs a test for null");
    expect(p).toMatch(/what changed since/i);
  });

  test("a huge diff is cut, and the prompt says so rather than pretending it saw it all", () => {
    const p = buildBriefPrompt(material({ diff: "x".repeat(200_000) }));
    expect(p.length).toBeLessThan(120_000);
    expect(p).toMatch(/truncated/i);
  });
});

describe("writing the brief", () => {
  function deps(over: Partial<BriefDeps> = {}) {
    const runs: string[] = [];
    const d: BriefDeps = {
      material: () => material(),
      run: (_c, prompt) => { runs.push(prompt); return "## The problem\nTests failed under colour.\n\n## Recommendation\nAccept."; },
      ...over,
    };
    return { d, runs };
  }

  test("is written to the work dir, recorded on the timeline, and read back", () => {
    const c = cfg();
    const { d } = deps();
    const b = handoverBrief(c, "core", "c-1", d)!;
    expect(b.text).toContain("Tests failed under colour");
    expect(existsSync(join(c.homeDir, "work", "core", "c-1", "brief.md"))).toBe(true);
    expect(readBrief(c.homeDir, "core", "c-1")?.text).toBe(b.text);
    expect(read(c.homeDir, "core", "c-1").some((e) => e.kind === "briefed")).toBe(true);
  });

  test("is written once per round: the same round is not regenerated, a new round is", () => {
    const c = cfg();
    const { d, runs } = deps();
    handoverBrief(c, "core", "c-1", d);
    handoverBrief(c, "core", "c-1", d);
    expect(runs).toHaveLength(1);
    const { d: d2, runs: runs2 } = deps({ material: () => material({ iteration: 1 }) });
    handoverBrief(c, "core", "c-1", d2);
    expect(runs2).toHaveLength(1);
    expect(readBrief(c.homeDir, "core", "c-1")?.iteration).toBe(1);
  });

  test("a failed generation leaves an honest placeholder, not a fake brief", () => {
    const c = cfg();
    const { d } = deps({ run: () => { throw new Error("claude: not logged in"); } });
    const b = handoverBrief(c, "core", "c-1", d)!;
    expect(b.ok).toBe(false);
    expect(b.text).toContain("claude: not logged in");
    expect(readBrief(c.homeDir, "core", "c-1")).toBeNull();   // nothing cached, so the next pass tries again
  });
});

test("the one-line summary is the first sentence of the recommendation, or of the whole thing", () => {
  expect(summaryOf("## The problem\nTests failed.\n\n## Recommendation\nAccept — it is test-only and proven under every colour state. More words.")).toBe("Accept — it is test-only and proven under every colour state.");
  expect(summaryOf("Just a line. And another.")).toBe("Just a line.");
});
