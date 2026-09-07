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
    expect(log.slice(0, 3)).toEqual([
      "comment:gmc-4or:Jaime rejected: the migration path is untested",
      "status:gmc-4or:in_progress",
      "resume:gmc-4or:Jaime rejected: the migration path is untested",
    ]);
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
    expect(log).toContain("resume:gmc-4or:Jaime asked for changes: split the migration");
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
    expect(pendingFeedback(c).map((p) => [p.ticket, p.text])).toEqual([["gmc-4or", "Jaime rejected: push to experimental"]]);
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
