import { describe, expect, test } from "bun:test";
import { buildBrief, classifyPr, carryoverFrom, greeting, recapFrom, type MorningDeps } from "../src/morning.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { Board } from "../src/board.ts";

const cfg = {
  homeDir: "/tmp/x", wipLimit: 3,
  repos: [{ name: "gatemd-core", path: "/tmp/gatemd", prefix: "gmc" }],
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
} as AmbrosioConfig;

const t = (o: any = {}) => ({ id: "gmc-1", title: "A ticket", status: "open", priority: 2, repo: "gatemd-core", ...o });

function board(over: Partial<Board> = {}): Board {
  return {
    now: new Date("2026-09-08T08:00:00"), questions: [], plans: [], accept: [],
    working: [], blocked: [], anomalies: [], ready: [], needsInput: [], all: [], agents: [],
    ...over,
  } as Board;
}

function deps(over: Partial<MorningDeps> = {}): MorningDeps {
  return {
    board: () => board(),
    prs: () => [],
    linear: () => ({ issues: [], source: { name: "Linear", ok: false, detail: "no api key" } }),
    verity: () => [],
    journal: () => "",
    lessons: () => [],
    yesterdayReview: () => null,
    now: () => new Date("2026-09-08T08:00:00"),
    ...over,
  };
}

describe("classifyPr", () => {
  test("a failing check is the thing to look at first", () => {
    expect(classifyPr({ checks: "failing", isDraft: false, reviewDecision: "APPROVED" } as any).flag).toBe("checks failing");
  });

  test("changes requested outranks a green build", () => {
    expect(classifyPr({ checks: "passing", isDraft: false, reviewDecision: "CHANGES_REQUESTED" } as any).flag).toBe("changes requested");
  });

  test("an approved, green, non-draft PR is ready to merge", () => {
    expect(classifyPr({ checks: "passing", isDraft: false, reviewDecision: "APPROVED" } as any).flag).toBe("ready to merge");
  });

  test("a draft is still in progress, however green", () => {
    expect(classifyPr({ checks: "passing", isDraft: true, reviewDecision: "APPROVED" } as any).flag).toBe("draft");
  });

  test("waiting on a reviewer is called that, not 'ready'", () => {
    expect(classifyPr({ checks: "passing", isDraft: false, reviewDecision: "REVIEW_REQUIRED" } as any).flag).toBe("waiting on review");
  });
});

describe("carryoverFrom", () => {
  test("picks up the things Ambrosio said it would come back to", () => {
    const j = [
      "# Ambrosio journal — 2026-09-07",
      "- 10:42 dispatched gatemd-core gmc-4or (Fresh-repo e2e) as session abc",
      "- 11:11 OPEN ACTION for the next tick: deliver Jaime's answer once gmc-gfh parks",
      "- 11:11 DEFECT (ambrosio): a deferred answer is never retried",
      "- 12:05 digest sent (1 questions, 0 plans, 0 to accept)",
      "- 12:42 decided: dropped the planned close-PR ticket, 152 already merged",
    ].join("\n");

    expect(carryoverFrom(j).map((c) => c.kind)).toEqual(["OPEN ACTION", "DEFECT", "decided"]);
    expect(carryoverFrom(j)[0].text).toContain("deliver Jaime's answer");
  });

  test("routine bookkeeping is not carryover", () => {
    expect(carryoverFrom("- 09:00 tick: all quiet\n- 09:05 sent: hello")).toEqual([]);
  });

  test("an empty journal is not an error", () => {
    expect(carryoverFrom("")).toEqual([]);
  });
});

describe("greeting", () => {
  test("changes with the hour, because a morning briefing should know it is morning", () => {
    expect(greeting(new Date("2026-09-08T07:30:00"))).toContain("Good morning");
    expect(greeting(new Date("2026-09-08T14:30:00"))).toContain("Good afternoon");
    expect(greeting(new Date("2026-09-08T20:30:00"))).toContain("Good evening");
  });
});

describe("buildBrief", () => {
  test("separates what is ready to start from what is already running", () => {
    const b = buildBrief(cfg, deps({
      board: () => board({
        ready: [t({ id: "gmc-a" }), t({ id: "gmc-b" })],
        all: [t({ id: "gmc-a" }), t({ id: "gmc-b" }), t({ id: "gmc-c", status: "in_progress" })],
      }),
    }));
    expect(b.ready.map((x) => x.id)).toEqual(["gmc-a", "gmc-b"]);
    expect(b.inFlight.map((x) => x.id)).toEqual(["gmc-c"]);
  });

  test("says how many workers today can still take", () => {
    const b = buildBrief(cfg, deps({
      board: () => board({ agents: [{ kind: "background", name: "x", state: "working", cwd: "" } as any] }),
    }));
    expect(b.capacity).toEqual({ used: 1, limit: 3, free: 2 });
  });

  test("a source that is not configured is reported, never silently empty", () => {
    // The whole point: a blank panel must be distinguishable from "nothing to show".
    const b = buildBrief(cfg, deps());
    const linear = b.sources.find((s) => s.name === "Linear")!;
    expect(linear.ok).toBe(false);
    expect(linear.detail).toContain("api key");
  });

  test("a source that throws is reported as broken rather than taking the page down", () => {
    const b = buildBrief(cfg, deps({ prs: () => { throw new Error("gh not logged in"); } }));
    expect(b.prs).toEqual([]);
    expect(b.sources.find((s) => s.name === "Pull requests")!.detail).toContain("gh not logged in");
  });

  test("carries yesterday's unfinished business into today", () => {
    const b = buildBrief(cfg, deps({ journal: () => "- 11:11 OPEN ACTION for the next tick: chase the verdict" }));
    expect(b.carryover[0].text).toContain("chase the verdict");
  });
});

describe("scoping the brief to the day's projects", () => {
  const wide = () => deps({
    board: () => board({
      ready: [t({ id: "gmc-1", repo: "gatemd-core" }), t({ id: "gmu-1", repo: "gatemd-ui" })],
      all: [t({ id: "gmc-2", repo: "gatemd-core", status: "in_progress" }), t({ id: "gmu-2", repo: "gatemd-ui", status: "in_progress" })],
    }),
    prs: () => [
      { repo: "gatemd-core", number: 1, title: "a", url: "", isDraft: false, checks: "passing", updatedAt: "", flag: "waiting on review", rank: 3 },
      { repo: "gatemd-ui", number: 2, title: "b", url: "", isDraft: false, checks: "passing", updatedAt: "", flag: "waiting on review", rank: 3 },
    ] as any,
  });

  test("shows only the projects chosen for today", () => {
    const b = buildBrief(cfg, wide(), { repos: ["gatemd-core"] });
    expect(b.ready.map((x) => x.id)).toEqual(["gmc-1"]);
    expect(b.inFlight.map((x) => x.id)).toEqual(["gmc-2"]);
    expect(b.prs.map((p) => p.repo)).toEqual(["gatemd-core"]);
  });

  test("no chosen projects means the whole world, not an empty page", () => {
    const b = buildBrief(cfg, wide(), { repos: [] });
    expect(b.ready).toHaveLength(2);
    expect(b.prs).toHaveLength(2);
  });

  test("carries the mission so the brief knows what today is for", () => {
    const b = buildBrief(cfg, wide(), { repos: ["gatemd-core"], mission: "ship the gate" });
    expect(b.mission).toBe("ship the gate");
  });
});

describe("what happened since yesterday morning", () => {
  const day = [
    "- 09:10 dispatched gatemd-core gmc-4or (Fresh-repo e2e) as session abc",
    "- 14:20 gmc-gfh accepted and closed (PR 156)",
    "- 15:40 after hours: started gmc-szb (verity bin symlink removed)",
    "- 16:10 after hours: parked gmc-szb, it needs Jaime",
    "- 12:00 digest sent (1 questions, 0 plans, 0 to accept)",
  ].join("\n");

  test("separates what was accepted, what was started, and what the night did", () => {
    const r = recapFrom(day);
    expect(r.accepted).toEqual(["gmc-gfh (PR 156)"]);
    expect(r.dispatched).toEqual(["gmc-4or — Fresh-repo e2e"]);
    expect(r.night).toEqual(["started gmc-szb (verity bin symlink removed)", "parked gmc-szb, it needs Jaime"]);
  });

  test("routine lines are not achievements", () => {
    expect(recapFrom("- 12:00 digest sent (1 questions)").accepted).toEqual([]);
  });

  test("the brief carries the recap and the lessons forward", () => {
    const b = buildBrief(cfg, deps({
      journal: () => day,
      lessons: () => [{ date: "2026-09-07", lesson: "ask about branches first" }],
      yesterdayReview: () => ({ wentWell: "two landed", doBetter: "ask about branches first" }),
    }));
    expect(b.recap.night).toHaveLength(2);
    expect(b.lessons[0].lesson).toBe("ask about branches first");
    expect(b.yesterdayReview!.wentWell).toBe("two landed");
  });
});

test("collectors only read the repos in the day's scope", () => {
  const cfg = {
    repos: [
      { name: "a", path: "/tmp/a", prefix: "a" },
      { name: "b", path: "/tmp/b", prefix: "b" },
      { name: "c", path: "/tmp/c", prefix: "c" },
    ],
    wipLimit: 3, turnCap: 150,
    hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
    imessage: { handle: "" }, urgentPatterns: [], homeDir: "/tmp/h", rootDir: "/tmp/r", missingRepos: [],
  } as any;

  const prsAsked: string[][] = [];
  const verityAsked: string[][] = [];
  const deps = {
    board: () => ({ ready: [], all: [], agents: [], questions: [], plans: [], accept: [], working: [], blocked: [], anomalies: [], needsInput: [], now: new Date() }) as any,
    prs: (_c: any, repos: any[]) => { prsAsked.push(repos.map((r) => r.name)); return []; },
    linear: () => ({ issues: [], source: { name: "Linear", ok: true, detail: "read" } }),
    verity: (_c: any, repos: any[]) => { verityAsked.push(repos.map((r) => r.name)); return []; },
    journal: () => "",
    lessons: () => [],
    yesterdayReview: () => null,
    now: () => new Date(2026, 8, 7, 9, 0),
  } as any;

  buildBrief(cfg, deps, { repos: ["b"] });
  expect(prsAsked[0]).toEqual(["b"]);
  expect(verityAsked[0]).toEqual(["b"]);

  // No choice means the whole world, which is the documented behaviour.
  buildBrief(cfg, deps, {});
  expect(prsAsked[1]).toEqual(["a", "b", "c"]);
});
