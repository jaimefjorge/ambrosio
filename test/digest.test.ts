import { expect, test } from "bun:test";
import { renderDigest, renderUrgent, chunk, assignKeys, hasDecisions, type BoardState } from "../src/digest.ts";
import type { QueueItem } from "../src/queue.ts";
import type { Ticket } from "../src/tracker.ts";

const q = (over: Partial<QueueItem> = {}): QueueItem => ({
  qid: "Q-abc", kind: "question", ticket: "gmc-a1b", repo: "gatemd-core", sessionId: "s", cwd: "/tmp",
  questions: [{ question: "Keep the legacy token path for the CLI?", options: [{ label: "Keep behind a flag" }, { label: "Remove now" }] }],
  urgent: false, status: "open", hash: "abc", createdAt: "2026-09-07T10:00:00Z", ...over,
});

const t = (over: Partial<Ticket> = {}): Ticket => ({
  id: "gmu-c3d", title: "dark mode", status: "in_review", priority: 2, repo: "gatemd-ui", ...over,
});

const board = (over: Partial<BoardState> = {}): BoardState => ({
  now: new Date(2026, 8, 7, 11, 0),
  questions: [], plans: [], accept: [], working: [], blocked: [], anomalies: [], ...over,
});

test("a digest with nothing to decide still reports the fleet", () => {
  const out = renderDigest(board({ working: [{ agent: { kind: "background", cwd: "/x", detail: "running tests", name: "gmc-a1b" } }] }));
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("Ambrosio · 11:00 · 1 working");
  expect(out[0]).toContain("FYI");
  expect(hasDecisions(board())).toBe(false);
});

test("decisions render with lettered options and a reply key", () => {
  const out = renderDigest(board({ questions: [q()] })).join("\n");
  expect(out).toContain("DECIDE");
  expect(out).toContain("Q1 [gatemd-core gmc-a1b] Keep the legacy token path for the CLI?");
  expect(out).toContain("a) Keep behind a flag");
  expect(out).toContain("b) Remove now");
});

test("urgent questions are marked", () => {
  const out = renderDigest(board({ questions: [q({ urgent: true })] })).join("\n");
  expect(out).toContain("⚠");
});

test("plans and acceptances render their evidence", () => {
  const out = renderDigest(board({
    plans: [t({ id: "tcp-e5f", status: "plan_review", title: "kanban stickers", repo: "tailor-craft", metadata: { plan_summary: "4 steps, adds a migration" } })],
    accept: [t({ metadata: { pr: "#212", tests: "48/48", verity: "PASS", review: "all 3 criteria met" } })],
  })).join("\n");
  expect(out).toContain("PLANS");
  expect(out).toContain("P1 [tailor-craft tcp-e5f kanban stickers]");
  expect(out).toContain("4 steps, adds a migration");
  expect(out).toContain("ACCEPT");
  expect(out).toContain("A1 [gatemd-ui gmu-c3d dark mode]");
  expect(out).toContain("PR #212 · tests 48/48 · Verity PASS");
});

test("keys are positional and stable", () => {
  const b = board({ questions: [q({ qid: "Q-1" }), q({ qid: "Q-2" })], accept: [t()] });
  const keys = assignKeys(b);
  expect(keys.questions["Q1"].qid).toBe("Q-1");
  expect(keys.questions["Q2"].qid).toBe("Q-2");
  expect(keys.accept["A1"].id).toBe("gmu-c3d");
});

test("long digests are chunked on line boundaries", () => {
  const many = Array.from({ length: 60 }, (_, i) => q({ qid: `Q-${i}`, ticket: `t-${i}` }));
  const out = renderDigest(board({ questions: many }));
  expect(out.length).toBeGreaterThan(1);
  for (const c of out) expect(c.length).toBeLessThanOrEqual(1500);
  expect(out.join("\n")).toContain("Q60");
});

test("chunk never splits a short line and handles one very long line", () => {
  expect(chunk("a\nb\nc", 100)).toEqual(["a\nb\nc"]);
  const long = "x".repeat(250);
  const parts = chunk(long, 100);
  expect(parts).toHaveLength(3);
  expect(parts.join("")).toBe(long);
});

test("urgent messages say what to do and how to reply", () => {
  const msg = renderUrgent(q({ urgent: true }));
  expect(msg).toContain("⚠");
  expect(msg).toContain("Reply Q-abc a|b");
});

// --- Stale workers are a decision, not an FYI --------------------------------
// On 2026-09-07 gmc-4or sat in FYI for 3h44 saying "marked working but has done
// nothing". Jaime read past it. A dead worker holding a ticket is the manager's
// most actionable fact, so it gets its own section above the noise.

test("a stale worker gets its own section, named with its ticket and how long", () => {
  const out = renderDigest(board({
    stale: [{
      agent: { kind: "background", cwd: "/x", name: "gmc-4or", state: "working" },
      ticket: t({ id: "gmc-4or", repo: "gatemd-core", title: "Fresh-repo e2e", status: "in_progress" }),
      silentMinutes: 224,
    }],
  }));
  const text = out.join("\n");
  expect(text).toContain("STALE");
  expect(text).toContain("gatemd-core gmc-4or");
  expect(text).toContain("3h44");
  expect(text).toContain("in_progress");
  // It must not be buried in FYI as well.
  expect(text.indexOf("STALE")).toBeLessThan(text.indexOf("FYI") === -1 ? Infinity : text.indexOf("FYI"));
});

test("the headline counts stale workers separately from working ones", () => {
  const out = renderDigest(board({
    working: [{ agent: { kind: "background", cwd: "/x", name: "gmc-gfh" } }],
    stale: [{ agent: { kind: "background", cwd: "/x", name: "gmc-4or" }, silentMinutes: 60 }],
  }));
  expect(out[0]).toContain("1 working");
  expect(out[0]).toContain("1 stale");
});

test("no stale workers means no stale section", () => {
  const out = renderDigest(board({ working: [{ agent: { kind: "background", cwd: "/x", name: "gmc-gfh" } }] }));
  expect(out.join("\n")).not.toContain("STALE");
});
