import { describe, expect, test } from "bun:test";
import { applyDecision, DecideError, type DecideDeps } from "../src/decide.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const cfg = {
  homeDir: "/tmp/x",
  repos: [{ name: "gatemd-core", path: "/tmp/gatemd", prefix: "gmc" }],
} as AmbrosioConfig;

function spy(over: Partial<DecideDeps> = {}) {
  const log: string[] = [];
  const deps: DecideDeps = {
    close: (_c, _r, id, reason) => log.push(`close:${id}:${reason}`),
    comment: (_c, _r, id, text) => log.push(`comment:${id}:${text}`),
    transition: (_c, _r, id, status) => log.push(`status:${id}:${status}`),
    resume: (_c, ticket, _repo, text) => { log.push(`resume:${ticket}:${text}`); return "resumed"; },
    journal: (_c, line) => log.push(`journal:${line}`),
    openDefects: () => [],
    ...over,
  };
  return { deps, log };
}

const at = { ticket: "gmc-4or", repo: "gatemd-core" };

describe("applyDecision", () => {
  test("accepting closes the ticket and never touches the worker", () => {
    const { deps, log } = spy();
    const r = applyDecision(cfg, { kind: "accept", ...at, note: "PR 157" }, deps);

    expect(r.outcome).toBe("closed");
    expect(log.filter((l) => l.startsWith("close:"))[0]).toContain("accepted by Jaime: PR 157");
    expect(log.some((l) => l.startsWith("resume:"))).toBe(false);
  });

  test("rejecting sends the reason back to the worker and reopens the ticket", () => {
    const { deps, log } = spy();
    const r = applyDecision(cfg, { kind: "reject", ...at, note: "the migration path is untested" }, deps);

    expect(r.outcome).toBe("resumed");
    expect(log[0]).toBe("comment:gmc-4or:Jaime rejected (round 1): the migration path is untested");
    expect(log[1]).toBe("status:gmc-4or:in_progress");
    expect(log[2]).toContain("resume:gmc-4or:Round 1. Jaime rejected the hand-over: the migration path is untested");
    // The journal says what actually happened to the hand-over.
    expect(log[3]).toContain("the worker picked it up");
  });

  test("rejecting without a reason is refused: the worker would learn nothing", () => {
    const { deps } = spy();
    expect(() => applyDecision(cfg, { kind: "reject", ...at, note: "  " }, deps)).toThrow(DecideError);
  });

  test("approving a plan moves it to in_progress and restarts the worker", () => {
    const { deps, log } = spy();
    const r = applyDecision(cfg, { kind: "plan_ok", ...at }, deps);

    expect(r.outcome).toBe("resumed");
    expect(log).toContain("status:gmc-4or:in_progress");
    expect(log).toContain("comment:gmc-4or:Jaime approved the plan");
  });

  test("asking for plan changes sends it back to planning with the feedback", () => {
    const { deps, log } = spy();
    applyDecision(cfg, { kind: "plan_change", ...at, note: "split the migration" }, deps);

    expect(log).toContain("status:gmc-4or:planning");
    expect(log.find((l) => l.startsWith("resume:"))).toContain("Plan round 1. Jaime asked for changes: split the migration");
  });

  test("a decision needing the worker says so when the worker is gone, rather than pretending", () => {
    const { deps } = spy({ resume: () => "deferred" });
    const r = applyDecision(cfg, { kind: "plan_ok", ...at }, deps);

    // The ticket still moved; only the hand-over is outstanding.
    expect(r.outcome).toBe("deferred");
  });

  test("an unknown repo is refused before anything is written", () => {
    const { deps, log } = spy();
    expect(() => applyDecision(cfg, { kind: "accept", ticket: "x-1", repo: "nope" }, deps)).toThrow();
    expect(log).toEqual([]);
  });
});

// --- Feedback must survive a busy or finished worker ------------------------

import { deliverPendingFeedback, pendingFeedback, DecideError as DE } from "../src/decide.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = () => ({ ...cfg, homeDir: mkdtempSync(join(tmpdir(), "amb-dec-")) }) as AmbrosioConfig;

describe("feedback that could not be handed over", () => {
  test("a busy worker means the reason is kept, not dropped", () => {
    const c = home();
    const { deps } = spy({ resume: () => "deferred" });
    const r = applyDecision(c, { kind: "reject", ...at, note: "push to experimental" }, deps);

    expect(r.outcome).toBe("deferred");
    const kept = pendingFeedback(c);
    expect(kept.map((p) => p.ticket)).toEqual(["gmc-4or"]);
    expect(kept[0].text).toContain("Round 1. Jaime rejected the hand-over: push to experimental");
  });

  test("it is handed over on a later pass, then forgotten", () => {
    const c = home();
    applyDecision(c, { kind: "reject", ...at, note: "push to experimental" }, spy({ resume: () => "deferred" }).deps);

    expect(deliverPendingFeedback(c, () => "deferred")).toEqual([]);      // still busy
    expect(pendingFeedback(c)).toHaveLength(1);

    expect(deliverPendingFeedback(c, () => "resumed").map((d) => d.ticket)).toEqual(["gmc-4or"]);
    expect(pendingFeedback(c)).toHaveLength(0);
  });

  test("a worker that has finished is reported as needing a fresh dispatch", () => {
    const c = home();
    const { deps } = spy({ resume: () => { throw new Error("no session UUID found for gmc-4or"); } });
    const r = applyDecision(c, { kind: "reject", ...at, note: "push to experimental" }, deps);

    // The ticket still moved and the reason is still on it; only the hand-over
    // is impossible, and saying "returned to the worker" would be a lie.
    expect(r.outcome).toBe("no_worker");
    expect(pendingFeedback(c)).toHaveLength(1);
  });

  test("accepting never records feedback: there is no worker to tell", () => {
    const c = home();
    applyDecision(c, { kind: "accept", ...at }, spy().deps);
    expect(pendingFeedback(c)).toHaveLength(0);
  });
});

describe("accepting work that still has known defects", () => {
  const withDefects = (defects: any[]) => spy({ openDefects: () => defects });

  test("is refused, and names them", () => {
    const { deps } = withDefects([
      { id: "gmc-vxt", title: "/verity:setup never runs init --plugin-mode", status: "open" },
      { id: "gmc-br5", title: "a repo with no origin gets an inert gate", status: "open" },
    ]);
    expect(() => applyDecision(cfg, { kind: "accept", ...at }, deps)).toThrow(/gmc-vxt/);
    expect(() => applyDecision(cfg, { kind: "accept", ...at }, deps)).toThrow(/gmc-br5/);
  });

  test("nothing is closed when it is refused", () => {
    const { deps, log } = withDefects([{ id: "gmc-vxt", title: "x", status: "open" }]);
    try { applyDecision(cfg, { kind: "accept", ...at }, deps); } catch {}
    expect(log).toEqual([]);
  });

  test("Jaime can still override, because it is his call in the end", () => {
    const { deps, log } = withDefects([{ id: "gmc-vxt", title: "x", status: "open" }]);
    const r = applyDecision(cfg, { kind: "accept", ...at, force: true }, deps);

    expect(r.outcome).toBe("closed");
    expect(log.find((l) => l.startsWith("close:"))).toContain("over 1 open defect");
  });

  test("defects that are already closed do not stand in the way", () => {
    const { deps } = withDefects([]);
    expect(applyDecision(cfg, { kind: "accept", ...at }, deps).outcome).toBe("closed");
  });

  test("rejecting is never blocked by defects — that is the point of rejecting", () => {
    const { deps } = withDefects([{ id: "gmc-vxt", title: "x", status: "open" }]);
    expect(applyDecision(cfg, { kind: "reject", ...at, note: "fix these first" }, deps).outcome).toBe("resumed");
  });
});

// --- Rule 4, widened: nothing that is not landable gets accepted -----------------

test("accept refuses work that is not landable, naming every reason", () => {
  const { deps, log } = spy({
    openDefects: () => [],
    landable: () => ({ ok: false, pr: null, reasons: ["integration failed", "no Verity PASS recorded at hand-over"], at: "" }),
  });
  expect(() => applyDecision(cfg, { kind: "accept", ...at }, deps)).toThrow(/integration failed.*no Verity PASS/);
  expect(log.some((l) => l.startsWith("close"))).toBe(false);
});

test("Jaime can overrule it deliberately, and the journal says he did", () => {
  const { deps, log } = spy({
    openDefects: () => [],
    landable: () => ({ ok: false, pr: null, reasons: ["unit pending"], at: "" }),
  });
  applyDecision(cfg, { kind: "accept", ...at, force: true }, deps);
  expect(log.some((l) => l.startsWith("close"))).toBe(true);
  expect(log.join(" ")).toContain("not landable");
});

// --- Reject is a cycle, not a dead end ------------------------------------------
// A rejection creates a numbered round with the rejection as its delta; the
// worker must address each point; past the cap, Ambrosio stops re-dispatching
// and says the ticket itself may be the problem.

const withHistory = (events: any[], over: Partial<DecideDeps> = {}) => {
  const recorded: any[] = [];
  const r = spy({
    history: () => events,
    record: (_c, _r, _t, ev) => recorded.push(ev),
    ...over,
  });
  return { ...r, recorded };
};

test("the first rejection opens round 1 and tells the worker exactly what to address", () => {
  const { deps, log, recorded } = withHistory([]);
  const r = applyDecision(cfg, { kind: "reject", ...at, note: "needs a test for empty input" }, deps);
  expect(r.outcome).toBe("resumed");
  expect(r.iteration).toBe(1);
  const resume = log.find((l) => l.startsWith("resume:"))!;
  expect(resume).toContain("Round 1");
  expect(resume).toContain("needs a test for empty input");
  expect(resume).toMatch(/address each point/i);
  expect(resume).toMatch(/reviewer/i);
  expect(recorded[0]).toMatchObject({ kind: "rejected", iteration: 1, note: "needs a test for empty input" });
});

test("a second rejection is round 2, and carries what round 1 asked for", () => {
  const { deps, log } = withHistory([{ kind: "rejected", iteration: 1, note: "needs a test for empty input" }, { kind: "status", status: "in_review" }]);
  const r = applyDecision(cfg, { kind: "reject", ...at, note: "the test does not cover null" }, deps);
  expect(r.iteration).toBe(2);
  const resume = log.find((l) => l.startsWith("resume:"))!;
  expect(resume).toContain("Round 2");
  expect(resume).toContain("Round 1: needs a test for empty input");
});

test("past the cap, the ticket is escalated instead of re-dispatched, with every round listed", () => {
  const { deps, log, recorded } = withHistory([
    { kind: "rejected", iteration: 1, note: "a" }, { kind: "rejected", iteration: 2, note: "b" }, { kind: "rejected", iteration: 3, note: "c" },
  ]);
  const r = applyDecision({ ...cfg, maxIterations: 3 } as any, { kind: "reject", ...at, note: "d" }, deps);
  expect(r.outcome).toBe("escalated");
  expect(log.some((l) => l.startsWith("resume:"))).toBe(false);
  expect(log).toContain("status:gmc-4or:needs_input");
  const comment = log.find((l) => l.startsWith("comment:"))!;
  expect(comment).toMatch(/bounced/i);
  for (const n of ["a", "b", "c", "d"]) expect(comment).toContain(n);
  expect(recorded.some((e) => e.kind === "escalated")).toBe(true);
});

test("a plan sent back is a plan round, counted apart from rework", () => {
  const { deps, log } = withHistory([{ kind: "plan_change", iteration: 1, note: "split step 3" }]);
  const r = applyDecision(cfg, { kind: "plan_change", ...at, note: "and drop step 5" }, deps);
  expect(r.iteration).toBe(2);
  expect(log.find((l) => l.startsWith("resume:"))).toContain("Plan round 2");
});
