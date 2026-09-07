import { describe, expect, test } from "bun:test";
import { autolinkPass, parentFor, type AutolinkDeps } from "../src/autolink.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Ticket } from "../src/tracker.ts";

// A worker that files a defect and forgets `--deps discovered-from:<parent>`
// leaves an orphan: rule 4 cannot see it, the parent gets accepted over it,
// and the defect sits at P2 under a P0 parent. Ambrosio links it and lifts
// its priority to the parent's band.

const cfg = { homeDir: "/tmp/x", wipLimit: 3, repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as AmbrosioConfig;
const t = (o: Partial<Ticket>): Ticket => ({ id: "c-1", title: "x", status: "open", priority: 2, repo: "core", ...o });

describe("who filed it", () => {
  const parent = t({ id: "c-p", status: "in_progress", priority: 0 });
  const other = t({ id: "c-q", status: "in_progress", priority: 1 });
  const started = { "c-p": "2026-09-07T15:00:00Z", "c-q": "2026-09-07T16:30:00Z" };

  test("a ticket filed while exactly one worker was running is that worker's", () => {
    const child = t({ id: "c-d", created_at: "2026-09-07T15:30:00Z" });
    expect(parentFor(child, [parent, other], (id) => started[id])?.id).toBe("c-p");
  });

  test("two candidates is ambiguous: no guess", () => {
    const child = t({ id: "c-d", created_at: "2026-09-07T17:00:00Z" });
    expect(parentFor(child, [parent, other], (id) => started[id])).toBeNull();
  });

  test("a ticket filed before any worker started belongs to nobody", () => {
    const child = t({ id: "c-d", created_at: "2026-09-07T09:00:00Z" });
    expect(parentFor(child, [parent, other], (id) => started[id])).toBeNull();
  });

  test("a ticket cannot be its own parent", () => {
    expect(parentFor(t({ id: "c-p", created_at: "2026-09-07T15:30:00Z" }), [parent], (id) => started[id])).toBeNull();
  });
});

describe("a pass", () => {
  function deps(over: Partial<AutolinkDeps> = {}) {
    const log: string[] = [];
    const d: AutolinkDeps = {
      tickets: () => [],
      startedAt: () => undefined,
      hasLinks: () => false,
      link: (_c, _r, child, parent) => log.push(`link:${child}->${parent}`),
      setPriority: (_c, _r, id, p) => log.push(`prio:${id}=${p}`),
      journal: (_c, line) => log.push(`journal:${line}`),
      ...over,
    };
    return { d, log };
  }
  const parent = t({ id: "c-p", status: "in_progress", priority: 0 });

  test("links an orphan to the one worker that was running, and lifts its priority", () => {
    const { d, log } = deps({
      tickets: () => [parent, t({ id: "c-d", created_at: "2026-09-07T15:30:00Z", priority: 2 })],
      startedAt: (_c, _r, id) => (id === "c-p" ? "2026-09-07T15:00:00Z" : undefined),
    });
    const r = autolinkPass(cfg, d);
    expect(r.linked).toEqual([{ child: "c-d", parent: "c-p" }]);
    expect(log).toContain("link:c-d->c-p");
    expect(log).toContain("prio:c-d=0");
  });

  test("leaves a ticket alone that already has links", () => {
    const { d, log } = deps({
      tickets: () => [parent, t({ id: "c-d", created_at: "2026-09-07T15:30:00Z" })],
      startedAt: (_c, _r, id) => (id === "c-p" ? "2026-09-07T15:00:00Z" : undefined),
      hasLinks: () => true,
    });
    autolinkPass(cfg, d);
    expect(log.filter((l) => l.startsWith("link"))).toEqual([]);
  });

  test("does not lower a priority that is already higher than the parent's", () => {
    const { d, log } = deps({
      tickets: () => [t({ id: "c-p", status: "in_progress", priority: 2 }), t({ id: "c-d", created_at: "2026-09-07T15:30:00Z", priority: 0 })],
      startedAt: (_c, _r, id) => (id === "c-p" ? "2026-09-07T15:00:00Z" : undefined),
    });
    autolinkPass(cfg, d);
    expect(log.some((l) => l.startsWith("prio"))).toBe(false);
  });

  test("a link that fails is journaled, and the pass goes on", () => {
    const { d, log } = deps({
      tickets: () => [parent, t({ id: "c-d", created_at: "2026-09-07T15:30:00Z" }), t({ id: "c-e", created_at: "2026-09-07T15:31:00Z" })],
      startedAt: (_c, _r, id) => (id === "c-p" ? "2026-09-07T15:00:00Z" : undefined),
      link: (_c, _r, child) => { if (child === "c-d") throw new Error("beads is locked"); },
    });
    const r = autolinkPass(cfg, d);
    expect(r.linked.map((l) => l.child)).toEqual(["c-e"]);
    expect(log.join(" ")).toContain("beads is locked");
  });
});
