import { describe, expect, test } from "bun:test";
import { buildMap, type MapNode } from "../src/mission.ts";
import type { Ticket } from "../src/tracker.ts";

// "I also would like to see how each work relates to the original mission."
// Every ticket hangs off the mission by the chain of what it was discovered
// from; the reason it exists is the parent's title. What hangs off nothing
// is flagged, not hidden.

const t = (o: Partial<Ticket>): Ticket => ({ id: "c-1", title: "x", status: "open", priority: 2, repo: "core", created_at: "2026-09-08T10:00:00Z", ...o });

const parents: Record<string, string[]> = { "c-fix": ["c-e2e"], "c-nit": ["c-fix"], "c-old-fix": ["c-old"] };

test("plans hang off the mission; what they discovered hangs off them, with the reason", () => {
  const tickets = [
    t({ id: "c-e2e", title: "Fresh-repo e2e", priority: 0 }),
    t({ id: "c-fix", title: "no-origin gate is inert", status: "in_review" }),
    t({ id: "c-nit", title: "spinner nit", created_at: "2026-09-08T16:00:00Z" }),
  ];
  const map = buildMap({ mission: "Release the Claude Code plugin", date: "2026-09-08" }, tickets, (id) => parents[id] ?? []);
  expect(map.mission).toBe("Release the Claude Code plugin");
  expect(map.roots.map((n) => n.id)).toEqual(["c-e2e"]);
  const e2e = map.roots[0];
  expect(e2e.children.map((n) => n.id)).toEqual(["c-fix"]);
  expect(e2e.children[0].why).toBe("found while doing c-e2e: Fresh-repo e2e");
  expect(e2e.children[0].children[0].id).toBe("c-nit");
  expect(e2e.children[0].children[0].depth).toBe(2);
  expect(map.orphans).toEqual([]);
});

test("work from before the mission, and work that hangs off nothing, is shown apart and said so", () => {
  const tickets = [
    t({ id: "c-old", title: "older root", created_at: "2026-09-01T10:00:00Z", status: "in_progress" }),
    t({ id: "c-old-fix", title: "its defect", created_at: "2026-09-02T10:00:00Z" }),
    t({ id: "c-new", title: "planned today", priority: 1 }),
  ];
  const map = buildMap({ mission: "m", date: "2026-09-08" }, tickets, (id) => parents[id] ?? []);
  expect(map.roots.map((n) => n.id)).toEqual(["c-new"]);
  expect(map.earlier.map((n) => n.id)).toEqual(["c-old"]);
  expect(map.earlier[0].children.map((n) => n.id)).toEqual(["c-old-fix"]);
});

test("closed and deferred work stays on the map, marked, so the shape of the day is not lost", () => {
  const tickets = [t({ id: "c-e2e", title: "e2e" }), t({ id: "c-fix", title: "fix", status: "closed" })];
  const map = buildMap({ mission: "m", date: "2026-09-08" }, tickets, (id) => parents[id] ?? []);
  expect(map.roots[0].children[0].status).toBe("closed");
});

test("a cycle in the links does not hang the map", () => {
  const tickets = [t({ id: "a" }), t({ id: "b" })];
  const map = buildMap({ mission: "m", date: "2026-09-08" }, tickets, (id) => (id === "a" ? ["b"] : ["a"]));
  expect(map.roots.length + map.orphans.length).toBeGreaterThan(0);
});

test("no mission set today still gives a map, headed honestly", () => {
  const map = buildMap(null, [t({ id: "c-1" })], () => []);
  expect(map.mission).toBeNull();
  expect(map.roots.map((n) => n.id)).toEqual(["c-1"]);
});
