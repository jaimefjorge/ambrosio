import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledger, renderLedger, markDayStart, type LedgerDeps } from "../src/ledger.ts";
import { record } from "../src/timeline.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// The wrap-up was a summary. A manager needs a ledger: what landed, what is
// accepted but not merged, what bounced and how many times, what is blocked
// on what, what got added and by whom — and net open work against the
// morning. A day should trend toward zero.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-lg-")), repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as unknown as AmbrosioConfig);
const SINCE = new Date("2026-09-08T09:00:00Z");
const NOW = new Date("2026-09-08T15:00:00Z");
const at = (h: number) => `2026-09-08T${String(h).padStart(2, "0")}:00:00Z`;

function deps(over: Partial<LedgerDeps> = {}): LedgerDeps {
  return {
    tickets: () => [],
    hasParent: () => false,
    ...over,
  };
}

describe("the ledger", () => {
  test("sorts the day into landed, accepted-not-merged, bounced, escalated", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { at: at(10), kind: "accepted", by: "jaime", pr: 1 });
    record(c.homeDir, "core", "c-1", { at: at(11), kind: "merged", commit: "a" });
    record(c.homeDir, "core", "c-1", { at: at(12), kind: "main_green" });
    record(c.homeDir, "core", "c-2", { at: at(13), kind: "accepted", by: "jaime", pr: 2 });
    record(c.homeDir, "core", "c-3", { at: at(11), kind: "rejected", iteration: 1, note: "no test" });
    record(c.homeDir, "core", "c-3", { at: at(14), kind: "rejected", iteration: 2, note: "still no test" });
    record(c.homeDir, "core", "c-4", { at: at(12), kind: "escalated", iteration: 4, note: "bounced 3 times" });
    record(c.homeDir, "core", "c-0", { at: "2026-09-07T10:00:00Z", kind: "accepted", pr: 9 });   // yesterday
    const l = ledger(c, deps({ tickets: () => [
      { id: "c-2", repo: "core", title: "two", status: "closed", priority: 1 },
      { id: "c-3", repo: "core", title: "three", status: "in_review", priority: 1 },
      { id: "c-4", repo: "core", title: "four", status: "needs_input", priority: 0 },
    ] as any }), SINCE, NOW);
    expect(l.landed.map((x) => x.id)).toEqual(["c-1"]);
    expect(l.acceptedNotMerged.map((x) => x.id)).toEqual(["c-2"]);
    expect(l.bounced).toEqual([{ id: "c-3", repo: "core", rounds: 2, last: "still no test", status: "in_review" }]);
    expect(l.escalated.map((x) => x.id)).toEqual(["c-4"]);
  });

  test("counts what was added today and by whom, and the net against the morning", () => {
    const c = cfg();
    markDayStart(c, 5, SINCE);
    const l = ledger(c, deps({
      tickets: () => [
        { id: "c-a", repo: "core", title: "by jaime", status: "open", priority: 1, created_at: at(10) },
        { id: "c-b", repo: "core", title: "by a worker", status: "open", priority: 2, created_at: at(11) },
        { id: "c-c", repo: "core", title: "old", status: "in_progress", priority: 2, created_at: "2026-09-01T10:00:00Z" },
        { id: "c-d", repo: "core", title: "done", status: "closed", priority: 2, created_at: at(12) },
      ] as any,
      hasParent: (_c, _r, id) => id === "c-b",
    }), SINCE, NOW);
    expect(l.added.map((x) => [x.id, x.by])).toEqual([["c-a", "jaime"], ["c-b", "worker"], ["c-d", "worker"]].filter(([id]) => id !== "c-d").concat([["c-d", "jaime"]]));
    expect(l.open).toEqual({ now: 3, atStart: 5, net: -2 });
  });

  test("blocked and waiting come from the board as it is now", () => {
    const c = cfg();
    const l = ledger(c, deps({ tickets: () => [
      { id: "c-x", repo: "core", title: "x", status: "needs_input", priority: 1 },
      { id: "c-y", repo: "core", title: "y", status: "blocked", priority: 1 },
      { id: "c-z", repo: "core", title: "z", status: "in_review", priority: 1 },
    ] as any }), SINCE, NOW);
    expect(l.blocked.map((x) => x.id).sort()).toEqual(["c-x", "c-y"]);
    expect(l.waiting.map((x) => x.id)).toEqual(["c-z"]);
  });

  test("renders as a short ledger a phone can read", () => {
    const c = cfg();
    markDayStart(c, 2, SINCE);
    record(c.homeDir, "core", "c-1", { at: at(10), kind: "accepted", pr: 1 });
    record(c.homeDir, "core", "c-1", { at: at(11), kind: "merged", commit: "a" });
    record(c.homeDir, "core", "c-1", { at: at(12), kind: "main_green" });
    const text = renderLedger(ledger(c, deps({ tickets: () => [{ id: "c-1", repo: "core", title: "one", status: "closed", priority: 1 }] as any }), SINCE, NOW));
    expect(text).toContain("LANDED");
    expect(text).toContain("c-1");
    expect(text).toMatch(/open work: 0 .*was 2/);
  });
});
