import { describe, expect, test } from "bun:test";
import { assess, verdictFromComment, prFromComment, type LandableDeps } from "../src/landable.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// "Work should always be in a mergeable state" — Jaime, 2026-09-07, at the end
// of a day that closed with two draft PRs neither of which could land and a
// board that said nothing about it. Landable is now a fact the board asserts,
// per ticket, from the PR, its checks, the Verity verdict and the open defects.

const cfg = { homeDir: "/tmp/x", repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as AmbrosioConfig;

const good = (over: Partial<LandableDeps> = {}): LandableDeps => ({
  pr: () => ({ number: 161, url: "https://github.com/x/y/pull/161", mergeable: "MERGEABLE", draft: true, checks: [{ name: "unit", conclusion: "SUCCESS" }, { name: "preview", conclusion: "SKIPPED" }] }),
  lastComment: () => "https://github.com/x/y/pull/161 · tests 19/19 · Verity PASS · reviewer: ACCEPT",
  openDefects: () => [],
  ...over,
});

describe("landable", () => {
  test("a clean PR, green checks, Verity PASS and no open defects is landable", () => {
    const r = assess(cfg, "core", "c-1", good());
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.pr?.number).toBe(161);
  });

  test("no PR at all is the first reason", () => {
    const r = assess(cfg, "core", "c-1", good({ pr: () => null, lastComment: () => "" }));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no PR/);
  });

  test("a conflicting branch is not landable, and says so", () => {
    const r = assess(cfg, "core", "c-1", good({ pr: () => ({ ...good().pr()!, mergeable: "CONFLICTING" }) }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/conflict/i);
  });

  test("a failed check names itself; a pending check is 'not yet', not 'no'", () => {
    const failed = assess(cfg, "core", "c-1", good({ pr: () => ({ ...good().pr()!, checks: [{ name: "integration", conclusion: "FAILURE" }] }) }));
    expect(failed.reasons.join(" ")).toMatch(/integration.*fail/i);
    const pending = assess(cfg, "core", "c-1", good({ pr: () => ({ ...good().pr()!, checks: [{ name: "unit", conclusion: null }] }) }));
    expect(pending.ok).toBe(false);
    expect(pending.reasons.join(" ")).toMatch(/unit.*pending/i);
  });

  test("a Verity verdict that is not PASS blocks, and a missing one is named as missing", () => {
    const fail = assess(cfg, "core", "c-1", good({ lastComment: () => "PR · tests 3/3 · Verity FAIL · reviewer: ok" }));
    expect(fail.reasons.join(" ")).toMatch(/Verity FAIL/);
    const none = assess(cfg, "core", "c-1", good({ lastComment: () => "PR · tests 3/3 · Verity: push guard did not block, Stop-hook verdict pending" }));
    expect(none.ok).toBe(false);
    expect(none.reasons.join(" ")).toMatch(/Verity/);
  });

  test("open defects the worker filed block it, by id", () => {
    const r = assess(cfg, "core", "c-1", good({ openDefects: () => [{ id: "c-9", title: "spinner nit" }] }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toContain("c-9");
  });

  test("every reason is reported at once, so one fix does not reveal the next", () => {
    const r = assess(cfg, "core", "c-1", good({
      pr: () => ({ ...good().pr()!, mergeable: "CONFLICTING", checks: [{ name: "unit", conclusion: "FAILURE" }] }),
      lastComment: () => "no verdict here",
      openDefects: () => [{ id: "c-9", title: "x" }],
    }));
    expect(r.reasons).toHaveLength(4);
  });

  test("gh being unreachable is a reason, not a crash and not a pass", () => {
    const r = assess(cfg, "core", "c-1", good({ pr: () => { throw new Error("gh: not logged in"); } }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toContain("gh: not logged in");
  });
});

describe("reading the hand-over comment", () => {
  test("finds the PR url and the Verity verdict in the worker's line", () => {
    const c = "https://github.com/codacy/gatemd-core/pull/161 · tests 19/19 · Verity PASS · reviewer: ACCEPT";
    expect(prFromComment(c)).toBe(161);
    expect(verdictFromComment(c)).toBe("PASS");
  });
  test("a verdict written with a colon still reads", () => {
    expect(verdictFromComment("… · Verity: PASS · …")).toBe("PASS");
  });
  test("no verdict is null, not a guess", () => {
    expect(verdictFromComment("… · Verity: Stop-hook verdict pending at turn end · …")).toBeNull();
    expect(prFromComment("nothing here")).toBeNull();
  });
});
