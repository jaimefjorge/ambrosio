import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBoard, detectAnomalies, canDispatch, wipUsed, type Deps } from "../src/board.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Ticket } from "../src/tracker.ts";
import type { Agent } from "../src/agents.ts";

const cfg = (): AmbrosioConfig => ({
  repos: [{ name: "core", path: "/tmp/core", prefix: "c" }, { name: "ui", path: "/tmp/ui", prefix: "u" }],
  wipLimit: 3, turnCap: 150,
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
  imessage: { handle: "" }, urgentPatterns: [],
  homeDir: mkdtempSync(join(tmpdir(), "amb-b-")), rootDir: "/tmp/root",
});

const t = (o: Partial<Ticket>): Ticket => ({ id: "c-1", title: "x", status: "open", priority: 2, repo: "core", ...o });
const a = (o: Partial<Agent>): Agent => ({ kind: "background", cwd: "/tmp/core", ...o } as Agent);

function deps(tickets: Ticket[], list: Agent[], q: any[] = []): Deps {
  return {
    listTickets: (repo) => tickets.filter((x) => x.repo === repo.name),
    listAgents: () => list,
    listQueue: () => q as any,
  };
}

test("collectBoard groups tickets by what the human must do", () => {
  const tickets = [
    t({ id: "c-1", status: "open" }),
    t({ id: "c-2", status: "plan_review" }),
    t({ id: "c-3", status: "in_review" }),
    t({ id: "c-4", status: "needs_input" }),
    t({ id: "u-1", status: "in_progress", repo: "ui" }),
  ];
  const board = collectBoard(cfg(), new Date(), deps(tickets, [a({ name: "u-1", state: "working", id: "j1" })]));
  expect(board.ready.map((x) => x.id)).toEqual(["c-1"]);
  expect(board.plans.map((x) => x.id)).toEqual(["c-2"]);
  expect(board.accept.map((x) => x.id)).toEqual(["c-3"]);
  expect(board.needsInput.map((x) => x.id)).toEqual(["c-4"]);
  expect(board.working).toHaveLength(1);
  expect(board.working[0].ticket?.id).toBe("u-1");
});

test("a repo that cannot be read becomes an anomaly, not a crash", () => {
  const broken: Deps = {
    listTickets: (repo) => { if (repo.name === "ui") throw new Error("dolt is locked"); return [t({})]; },
    listAgents: () => [],
    listQueue: () => [],
  };
  const board = collectBoard(cfg(), new Date(), broken);
  expect(board.anomalies.some((x) => x.includes("could not read tickets in ui"))).toBe(true);
  expect(board.all).toHaveLength(1);
});

test("listing sessions failing does not lose the tickets", () => {
  const d: Deps = { listTickets: () => [t({})], listAgents: () => { throw new Error("daemon down"); }, listQueue: () => [] };
  const board = collectBoard(cfg(), new Date(), d);
  expect(board.anomalies.some((x) => x.includes("could not list sessions"))).toBe(true);
  expect(board.all.length).toBeGreaterThan(0);
});

test("anomalies: failed worker, orphaned ticket, urgent questions", () => {
  const out = detectAnomalies(
    cfg(),
    [t({ id: "c-9", status: "in_progress" })],
    [a({ name: "c-8", state: "failed", detail: "API error" })],
    [{ urgent: true } as any],
  );
  expect(out.some((x) => x.includes("c-8 failed"))).toBe(true);
  expect(out.some((x) => x.includes("c-9 is in_progress but no session is running"))).toBe(true);
  expect(out.some((x) => x.includes("1 urgent question"))).toBe(true);
});

test("WIP limit gates dispatch", () => {
  const c = cfg();
  const busyBoard = collectBoard(c, new Date(), deps(
    [t({ id: "c-1", status: "in_progress" }), t({ id: "c-2", status: "in_progress" }), t({ id: "c-3", status: "in_progress" })],
    [a({ name: "c-1", state: "working" }), a({ name: "c-2", state: "working" }), a({ name: "c-3", state: "blocked" })],
  ));
  expect(wipUsed(busyBoard)).toBe(3);
  expect(canDispatch(c, busyBoard)).toBe(false);

  const quiet = collectBoard(c, new Date(), deps([t({})], []));
  expect(canDispatch(c, quiet)).toBe(true);
});
