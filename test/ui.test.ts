import { describe, expect, test } from "bun:test";
import { buildPayload, buildWorkerDetail } from "../src/ui.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Board } from "../src/board.ts";

const cfg = { wipLimit: 3, homeDir: "/tmp/x" } as AmbrosioConfig;

function agent(over: Record<string, any> = {}) {
  return { kind: "background", cwd: "/w", ...over } as any;
}

function ticket(over: Record<string, any> = {}) {
  return { id: "T-1", title: "Fix the thing", status: "in_progress", priority: 1, repo: "gatemd", ...over } as any;
}

function board(over: Partial<Board> = {}): Board {
  return {
    now: new Date("2026-09-07T10:00:00Z"),
    questions: [], plans: [], accept: [], working: [], blocked: [],
    anomalies: [], ready: [], needsInput: [], all: [], agents: [],
    ...over,
  } as Board;
}

describe("buildPayload", () => {
  test("shows every worker, not just the busy ones, so a failure stays visible", () => {
    const p = buildPayload(cfg, board({
      agents: [
        agent({ id: "a1", name: "T-1", state: "working" }),
        agent({ id: "a2", name: "T-2", state: "failed" }),
        agent({ id: "a3", name: "T-3", state: "done" }),
      ],
    }));
    expect(p.workers.map((w) => w.state)).toEqual(["working", "failed", "done"]);
  });

  test("leaves out interactive sessions: the manager is not part of the fleet", () => {
    const p = buildPayload(cfg, board({
      agents: [agent({ name: "T-1", state: "working" }), agent({ kind: "interactive", name: "manager" })],
    }));
    expect(p.workers).toHaveLength(1);
  });

  test("joins a worker to its ticket so the view shows the title, not just an id", () => {
    const p = buildPayload(cfg, board({
      agents: [agent({ name: "T-1", state: "working" })],
      all: [ticket({ id: "T-1", title: "Fix the thing" })],
    }));
    expect(p.workers[0].title).toBe("Fix the thing");
    expect(p.workers[0].repo).toBe("gatemd");
  });

  test("counts only working and blocked against the WIP limit", () => {
    const p = buildPayload(cfg, board({
      agents: [
        agent({ name: "T-1", state: "working" }),
        agent({ name: "T-2", state: "blocked" }),
        agent({ name: "T-3", state: "done" }),
      ],
    }));
    expect(p.wip).toEqual({ used: 2, limit: 3 });
  });

  test("gives questions the same keys the digest uses, so the UI and your phone agree", () => {
    const p = buildPayload(cfg, board({
      questions: [
        { qid: "q-1", ticket: "T-1", repo: "gatemd", urgent: false, summary: "Which retry budget?" } as any,
        { qid: "q-2", ticket: "T-2", repo: "gatemd", urgent: true, summary: "Drop the table?" } as any,
      ],
    }));
    expect(p.questions.map((q) => [q.key, q.qid])).toEqual([["Q1", "q-1"], ["Q2", "q-2"]]);
    expect(p.questions[1].urgent).toBe(true);
  });

  test("surfaces what a blocked worker is waiting for", () => {
    const p = buildPayload(cfg, board({
      agents: [agent({ name: "T-1", state: "blocked", needs: "input", detail: "asked about retries" })],
    }));
    expect(p.workers[0]).toMatchObject({ needs: "input", detail: "asked about retries" });
  });

  test("passes anomalies through: they are the reason to look at this screen", () => {
    const p = buildPayload(cfg, board({ anomalies: ["T-9 has been working for 4h"] }));
    expect(p.anomalies).toEqual(["T-9 has been working for 4h"]);
  });
});

describe("buildWorkerDetail", () => {
  const b = () => board({
    agents: [agent({ id: "a1", name: "T-1", state: "working", sessionId: "sess-1" })],
    all: [ticket({ id: "T-1", title: "Fix the thing", description: "why", acceptance_criteria: "tests green" })],
    questions: [
      { qid: "q-1", ticket: "T-1", repo: "gatemd", urgent: false, summary: "Which budget?" } as any,
      { qid: "q-2", ticket: "T-2", repo: "gatemd", urgent: false, summary: "Other ticket" } as any,
    ],
  });

  test("finds a worker by session id or by ticket name", () => {
    expect(buildWorkerDetail(cfg, b(), "a1", () => [])?.worker.name).toBe("T-1");
    expect(buildWorkerDetail(cfg, b(), "T-1", () => [])?.worker.id).toBe("a1");
  });

  test("returns null for a worker that is not there, rather than an empty shell", () => {
    expect(buildWorkerDetail(cfg, b(), "nope", () => [])).toBeNull();
  });

  test("carries the ticket's acceptance criteria: that is what 'done' means", () => {
    expect(buildWorkerDetail(cfg, b(), "a1", () => [])?.ticket?.acceptance).toBe("tests green");
  });

  test("reads the transcript for that session", () => {
    const d = buildWorkerDetail(cfg, b(), "a1", (sid) => [{ kind: "text", summary: `from ${sid}` }] as any);
    expect(d?.transcript[0].summary).toBe("from sess-1");
  });

  test("shows only the questions parked by this worker", () => {
    const d = buildWorkerDetail(cfg, b(), "a1", () => []);
    expect(d?.questions.map((q) => q.qid)).toEqual(["q-1"]);
  });
});

describe("things waiting on Jaime other than questions", () => {
  test("plans and finished work reach the payload with their digest keys", () => {
    // These were on the board and in the digest but never rendered, so the view
    // said "nothing waiting on you" while two tickets sat in review.
    const p = buildPayload(cfg, board({
      plans: [ticket({ id: "T-7", title: "Plan for the migration", status: "plan_review" })],
      accept: [
        ticket({ id: "T-1", title: "Fresh-repo e2e", status: "in_review" }),
        ticket({ id: "T-2", title: "Migration e2e", status: "in_review" }),
      ],
    }));

    expect(p.plans.map((x) => [x.key, x.id])).toEqual([["P1", "T-7"]]);
    expect(p.accept.map((x) => [x.key, x.id])).toEqual([["A1", "T-1"], ["A2", "T-2"]]);
    expect(p.accept[0].repo).toBe("gatemd");
  });

  test("nothing waiting really does mean nothing", () => {
    const p = buildPayload(cfg, board());
    expect([...p.questions, ...p.plans, ...p.accept]).toEqual([]);
  });
});
