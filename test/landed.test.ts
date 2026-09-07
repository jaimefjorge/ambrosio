import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landedPass, type LandedDeps } from "../src/landed.ts";
import { record, read } from "../src/timeline.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// Acceptance was the end of the world: `closed` meant "Jaime said yes", and
// nothing tracked whether it merged or whether main stayed green. "Defects
// not shipped" has to include after acceptance.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-ld-")), repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as unknown as AmbrosioConfig);

function deps(over: Partial<LandedDeps> = {}) {
  const log: string[] = [];
  const d: LandedDeps = {
    pr: () => ({ merged: false, mergeCommit: null, url: "u" }),
    mainRuns: () => [],
    fileDefect: (_c, _r, parent, title) => { log.push(`defect:${parent}:${title}`); return "c-new"; },
    journal: (_c, line) => log.push(`journal:${line}`),
    ...over,
  };
  return { d, log };
}

describe("after acceptance", () => {
  test("an accepted ticket whose PR merged is recorded as merged, once", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "accepted", by: "jaime", pr: 161 });
    const { d } = deps({ pr: () => ({ merged: true, mergeCommit: "abc123", url: "u" }) });
    landedPass(c, d);
    landedPass(c, d);
    const ev = read(c.homeDir, "core", "c-1");
    expect(ev.filter((e) => e.kind === "merged")).toHaveLength(1);
    expect(ev.find((e) => e.kind === "merged")?.commit).toBe("abc123");
  });

  test("main green after the merge is recorded; main red files a defect at the parent, once", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "accepted", by: "jaime", pr: 161 });
    record(c.homeDir, "core", "c-1", { kind: "merged", commit: "abc123" });
    const { d, log } = deps({ mainRuns: () => [{ sha: "abc123", conclusion: "failure", url: "run-url", name: "Integration Tests" }] });
    const r = landedPass(c, d);
    expect(r.red).toEqual(["c-1"]);
    expect(log.filter((l) => l.startsWith("defect:"))).toEqual(["defect:c-1:main is red after merging c-1: Integration Tests failed"]);
    landedPass(c, d);
    expect(log.filter((l) => l.startsWith("defect:"))).toHaveLength(1);
    expect(read(c.homeDir, "core", "c-1").some((e) => e.kind === "main_red")).toBe(true);
  });

  test("main green closes the loop", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "accepted", by: "jaime", pr: 161 });
    record(c.homeDir, "core", "c-1", { kind: "merged", commit: "abc123" });
    const { d } = deps({ mainRuns: () => [{ sha: "abc123", conclusion: "success", url: "", name: "ci" }] });
    const r = landedPass(c, d);
    expect(r.green).toEqual(["c-1"]);
    expect(read(c.homeDir, "core", "c-1").some((e) => e.kind === "main_green")).toBe(true);
  });

  test("a run still pending decides nothing; a ticket already observed is not asked again", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "accepted", by: "jaime", pr: 161 });
    record(c.homeDir, "core", "c-1", { kind: "merged", commit: "abc123" });
    const { d, log } = deps({ mainRuns: () => [{ sha: "abc123", conclusion: null, url: "", name: "ci" }] });
    expect(landedPass(c, d)).toEqual({ merged: [], green: [], red: [] });
    record(c.homeDir, "core", "c-1", { kind: "main_green" });
    let asked = 0;
    landedPass(c, deps({ pr: () => { asked++; return { merged: true, mergeCommit: "x", url: "" }; }, mainRuns: () => { asked++; return []; } }).d);
    expect(asked).toBe(0);
  });

  test("gh failing is journaled and the pass goes on", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "accepted", by: "jaime", pr: 161 });
    const { d, log } = deps({ pr: () => { throw new Error("gh down"); } });
    expect(() => landedPass(c, d)).not.toThrow();
    expect(log.join(" ")).toContain("gh down");
  });
});
