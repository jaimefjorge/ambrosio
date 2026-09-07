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
    journal: (_c, line) => log.push(`journal:${line.slice(0, 24)}`),
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
    expect(log).toEqual([
      "comment:gmc-4or:Jaime rejected: the migration path is untested",
      "status:gmc-4or:in_progress",
      "resume:gmc-4or:Jaime rejected: the migration path is untested",
      "journal:gmc-4or rejected and ret",
    ]);
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
