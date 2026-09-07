import { expect, test } from "bun:test";
import { parseLine, parseReplies, isConversational } from "../src/replies.ts";

test("answers, in the shapes Jaime actually types", () => {
  expect(parseLine("Q3 b")).toEqual({ kind: "answer", key: "Q3", value: "b", note: undefined });
  expect(parseLine("q3 B: keep the flag")).toEqual({ kind: "answer", key: "Q3", value: "B", note: "keep the flag" });
  expect(parseLine("Q10 remove")).toEqual({ kind: "answer", key: "Q10", value: "remove", note: undefined });
});

test("plan approvals and bounces", () => {
  expect(parseLine("P2 ok")).toEqual({ kind: "plan", key: "P2", decision: "ok", note: undefined });
  expect(parseLine("p2 approve")).toMatchObject({ kind: "plan", decision: "ok" });
  expect(parseLine("P2 change: split step 3")).toEqual({ kind: "plan", key: "P2", decision: "change", note: "split step 3" });
});

test("accept and reject", () => {
  expect(parseLine("A1 accept")).toEqual({ kind: "accept", key: "A1", note: undefined });
  expect(parseLine("a1 reject: needs a test for empty input")).toEqual({
    kind: "reject", key: "A1", note: "needs a test for empty input",
  });
});

test("ticket commands and free text to a worker", () => {
  expect(parseLine("gmc-a1b defer")).toEqual({ kind: "defer", ticket: "gmc-a1b" });
  expect(parseLine("T-gmc-a1b stop")).toMatchObject({ kind: "stop" });
  expect(parseLine("@gmc-a1b rebase on main first")).toEqual({
    kind: "message", ticket: "gmc-a1b", text: "rebase on main first",
  });
});

test("commands", () => {
  expect(parseLine("status")).toEqual({ kind: "status" });
  expect(parseLine("quiet until 15:00")).toEqual({ kind: "quiet", until: "15:00" });
});

test("anything else is unparsed, never guessed", () => {
  expect(parseLine("what happened with the auth work?")).toEqual({
    kind: "unparsed", text: "what happened with the auth work?",
  });
  expect(parseLine("   ")).toBe(null);
});

test("multi-line replies parse independently and blank lines are dropped", () => {
  const rs = parseReplies("Q1 a\n\nP2 ok\nA1 reject: flaky test\n");
  expect(rs.map((r) => r.kind)).toEqual(["answer", "plan", "reject"]);
});

test("isConversational distinguishes chat from commands", () => {
  expect(isConversational(parseReplies("how is the fleet doing?"))).toBe(true);
  expect(isConversational(parseReplies("Q1 a\nchat too"))).toBe(false);
});

test("pause and resume are part of the grammar", () => {
  expect(parseReplies("pause")).toEqual([{ kind: "pause" }]);
  expect(parseReplies("Pause: back tomorrow")).toEqual([{ kind: "pause", reason: "back tomorrow" }]);
  expect(parseReplies("resume")).toEqual([{ kind: "resume" }]);
});
