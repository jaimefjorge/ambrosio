import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orderReady, defectChainPass, type ChainDeps } from "../src/chain.ts";
import { record, read } from "../src/timeline.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Ticket } from "../src/tracker.ts";

// The defect chain: a defect that blocks a parent waiting for acceptance is
// dispatched before new work, and when it closes the parent hears about it —
// its landable verdict is recomputed and the row says so.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-ch-")), repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as unknown as AmbrosioConfig);
const t = (o: Partial<Ticket>): Ticket => ({ id: "c-1", title: "x", status: "open", priority: 2, repo: "core", ...o });

describe("what to start next", () => {
  test("a defect blocking a parent in review comes before higher-priority new work", () => {
    const ready = [t({ id: "new", priority: 0 }), t({ id: "fix", priority: 2 }), t({ id: "other", priority: 1 })];
    const out = orderReady(ready, { fix: "parent" });
    expect(out.map((x) => x.id)).toEqual(["fix", "new", "other"]);
  });
  test("with nothing blocking, priority order stands", () => {
    expect(orderReady([t({ id: "b", priority: 3 }), t({ id: "a", priority: 0 })], {}).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("when a defect closes", () => {
  function deps(over: Partial<ChainDeps> = {}) {
    const log: string[] = [];
    const d: ChainDeps = {
      parentsOf: () => [],
      comment: (_c, _r, id, text) => log.push(`comment:${id}:${text}`),
      forgetLandable: (_c, _r, id) => log.push(`forget:${id}`),
      journal: (_c, line) => log.push(`journal:${line}`),
      ...over,
    };
    return { d, log };
  }

  test("its parent, waiting for acceptance, is told and re-assessed", () => {
    const c = cfg();
    const { d, log } = deps({ parentsOf: (_c, _r, id) => (id === "c-fix" ? [{ id: "c-parent", status: "in_review" }] : []) });
    const r = defectChainPass(c, d, [{ repo: "core", ticket: "c-fix", from: "in_progress", to: "closed" }]);
    expect(r.woke).toEqual(["c-parent"]);
    expect(log).toContain("forget:c-parent");
    expect(log.find((l) => l.startsWith("comment:c-parent"))).toContain("c-fix");
    expect(read(c.homeDir, "core", "c-parent").some((e) => e.kind === "defect_closed")).toBe(true);
  });

  test("a parent not waiting on Jaime is left alone, and non-closing changes do nothing", () => {
    const c = cfg();
    const { d, log } = deps({ parentsOf: () => [{ id: "c-parent", status: "in_progress" }] });
    expect(defectChainPass(c, d, [{ repo: "core", ticket: "c-fix", from: "in_progress", to: "closed" }]).woke).toEqual([]);
    expect(defectChainPass(c, d, [{ repo: "core", ticket: "c-fix", from: "open", to: "planning" }]).woke).toEqual([]);
    expect(log.filter((l) => l.startsWith("comment"))).toEqual([]);
  });
});
