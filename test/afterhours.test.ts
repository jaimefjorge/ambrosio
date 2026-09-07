import { describe, expect, test } from "bun:test";
import { isAfterHours, nightEligible, afterHoursPass, type NightDeps } from "../src/afterhours.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Ticket } from "../src/tracker.ts";

const cfg = {
  homeDir: "/tmp/x", wipLimit: 3,
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
} as AmbrosioConfig;

const at = (h: number, m = 0) => new Date(2026, 8, 8, h, m);
const t = (o: Partial<Ticket> = {}): Ticket =>
  ({ id: "gmc-1", title: "x", status: "open", priority: 2, repo: "gatemd-core", issue_type: "task", ...o } as Ticket);

describe("when after hours begins", () => {
  test("after wrap-up, and overnight", () => {
    expect(isAfterHours(cfg, at(15, 30))).toBe(true);
    expect(isAfterHours(cfg, at(23))).toBe(true);
    expect(isAfterHours(cfg, at(6))).toBe(true);
  });

  test("not during the working day", () => {
    expect(isAfterHours(cfg, at(9))).toBe(false);
    expect(isAfterHours(cfg, at(14, 59))).toBe(false);
  });
});

describe("what may run unattended", () => {
  test("bounded work, which needs no decision from anyone", () => {
    expect(nightEligible([t({ id: "a", metadata: { planning_path: "bounded" } })]).map((x) => x.id)).toEqual(["a"]);
  });

  test("never work that would need Jaime to approve a plan — he is not there", () => {
    expect(nightEligible([
      t({ id: "gate", metadata: { plan_gate: true } }),
      t({ id: "arch", metadata: { planning_path: "architectural" } }),
    ])).toEqual([]);
  });

  test("never a new feature: the night is for finishing and tidying", () => {
    expect(nightEligible([t({ id: "f", issue_type: "feature" }), t({ id: "e", issue_type: "epic" })])).toEqual([]);
  });

  test("bugs and chores are exactly the night's work", () => {
    expect(nightEligible([t({ id: "b", issue_type: "bug" }), t({ id: "c", issue_type: "chore" })]).map((x) => x.id))
      .toEqual(["b", "c"]);
  });

  test("the most important first, since the night may not finish everything", () => {
    expect(nightEligible([t({ id: "low", priority: 3 }), t({ id: "high", priority: 0 })]).map((x) => x.id))
      .toEqual(["high", "low"]);
  });
});

function deps(over: Partial<NightDeps> = {}): NightDeps {
  return {
    workers: () => [],
    ready: () => [],
    stop: () => {},
    park: () => {},
    dispatch: () => {},
    journal: () => {},
    ...over,
  };
}

describe("a pass of the night", () => {
  test("a worker that got stuck is parked, not left waiting for an answer nobody will give", () => {
    const parked: string[] = [];
    const stopped: string[] = [];
    const r = afterHoursPass(cfg, deps({
      workers: () => [{ name: "gmc-1", id: "s1", state: "blocked", kind: "background", cwd: "" } as any],
      stop: (id) => stopped.push(id),
      park: (_c, _r, id) => parked.push(id),
    }));

    expect(stopped).toEqual(["s1"]);
    expect(parked).toEqual(["gmc-1"]);
    expect(r.parked).toEqual(["gmc-1"]);
  });

  test("and the night moves on to the next thing rather than stopping there", () => {
    const dispatched: string[] = [];
    const r = afterHoursPass(cfg, deps({
      workers: () => [{ name: "gmc-1", id: "s1", state: "blocked", kind: "background", cwd: "" } as any],
      ready: () => [t({ id: "gmc-2" })],
      dispatch: (_c, _r, id) => dispatched.push(id),
    }));

    expect(dispatched).toEqual(["gmc-2"]);
    expect(r.dispatched).toEqual(["gmc-2"]);
  });

  test("fills the free slots and no more", () => {
    const dispatched: string[] = [];
    const r = afterHoursPass(cfg, deps({
      workers: () => [{ name: "a", state: "working", kind: "background", cwd: "" } as any],
      ready: () => [t({ id: "1" }), t({ id: "2" }), t({ id: "3" }), t({ id: "4" })],
      dispatch: (_c, _r, id) => dispatched.push(id),
    }));

    expect(dispatched).toHaveLength(2);       // 3 slots, one already busy
    expect(r.dispatched).toEqual(["1", "2"]);
  });

  test("a dispatch that fails does not end the night", () => {
    const dispatched: string[] = [];
    afterHoursPass(cfg, deps({
      ready: () => [t({ id: "bad" }), t({ id: "good" })],
      dispatch: (_c, _r, id) => { if (id === "bad") throw new Error("beads is locked"); dispatched.push(id); },
    }));
    expect(dispatched).toEqual(["good"]);
  });
});
