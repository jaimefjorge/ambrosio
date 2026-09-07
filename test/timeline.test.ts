import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record, read, readAll, iterationOf, last, observe } from "../src/timeline.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-tl-")), repos: [] } as unknown as AmbrosioConfig);

describe("a ticket's timeline", () => {
  test("is append-only, in order, and survives a torn line", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "dispatched", by: "ambrosio", at: "2026-09-08T09:00:00Z" });
    record(c.homeDir, "core", "c-1", { kind: "status", from: "planning", status: "in_progress", by: "worker", at: "2026-09-08T09:10:00Z" });
    require("node:fs").appendFileSync(join(c.homeDir, "work", "core", "c-1", "timeline.jsonl"), "{torn\n");
    record(c.homeDir, "core", "c-1", { kind: "rejected", note: "needs a test", by: "jaime", iteration: 1, at: "2026-09-08T13:00:00Z" });
    const ev = read(c.homeDir, "core", "c-1");
    expect(ev.map((e) => e.kind)).toEqual(["dispatched", "status", "rejected"]);
    expect(ev[1].status).toBe("in_progress");
  });

  test("counts rounds of rework and finds the last event of a kind", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "rejected", iteration: 1 });
    record(c.homeDir, "core", "c-1", { kind: "status", status: "in_review" });
    record(c.homeDir, "core", "c-1", { kind: "rejected", iteration: 2, note: "still no test" });
    const ev = read(c.homeDir, "core", "c-1");
    expect(iterationOf(ev)).toBe(2);
    expect(last(ev, "rejected")?.note).toBe("still no test");
    expect(last(ev, "merged")).toBeUndefined();
  });

  test("readAll walks every repo and ticket that has one", () => {
    const c = cfg();
    record(c.homeDir, "core", "c-1", { kind: "dispatched" });
    record(c.homeDir, "ui", "u-2", { kind: "dispatched" });
    expect(readAll(c).map((x) => `${x.repo}/${x.ticket}`).sort()).toEqual(["core/c-1", "ui/u-2"]);
    expect(read(c.homeDir, "core", "nope")).toEqual([]);
  });
});

describe("observing what workers do on their own", () => {
  test("a status change since last look is recorded as the worker's; the first sighting is not", () => {
    const c = cfg();
    const first = observe(c, [{ id: "c-1", repo: "core", status: "planning" }]);
    expect(first).toEqual([]);
    const second = observe(c, [{ id: "c-1", repo: "core", status: "in_progress" }]);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ kind: "status", from: "planning", status: "in_progress", by: "worker" });
    expect(observe(c, [{ id: "c-1", repo: "core", status: "in_progress" }])).toEqual([]);
    expect(read(c.homeDir, "core", "c-1")).toHaveLength(1);
  });
});
