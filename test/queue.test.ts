import { expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as queue from "../src/queue.ts";
import * as journal from "../src/journal.ts";
import { enrich, parseDispatchId, busy } from "../src/agents.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "amb-q-")); });

function put(item: Partial<queue.QueueItem> & { qid: string }) {
  const dir = join(home, "queue");
  mkdirSync(dir, { recursive: true });
  const full: queue.QueueItem = {
    kind: "question", ticket: "t-1", repo: "core", sessionId: "s1", cwd: "/tmp",
    urgent: false, status: "open", hash: item.qid, createdAt: new Date().toISOString(),
    questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }],
    ...item,
  } as queue.QueueItem;
  writeFileSync(join(dir, `${item.qid}.json`), JSON.stringify(full));
}

test("listOpen returns only open items, oldest first", () => {
  put({ qid: "Q-1", createdAt: "2026-09-07T09:00:00Z" });
  put({ qid: "Q-2", createdAt: "2026-09-07T08:00:00Z" });
  put({ qid: "Q-3", status: "delivered" });
  const open = queue.listOpen(home);
  expect(open.map((q) => q.qid)).toEqual(["Q-2", "Q-1"]);
});

test("answer then markDelivered moves an item through its lifecycle", () => {
  put({ qid: "Q-1" });
  const answered = queue.answer(home, "Q-1", "A: keep the flag");
  expect(answered.status).toBe("answered");
  expect(answered.answer).toBe("A: keep the flag");
  expect(queue.listAnswered(home).map((q) => q.qid)).toEqual(["Q-1"]);
  expect(queue.markDelivered(home, "Q-1").status).toBe("delivered");
  expect(queue.listOpen(home)).toHaveLength(0);
});

test("answering an unknown question is an error", () => {
  expect(() => queue.answer(home, "Q-nope", "x")).toThrow(/no such question/);
});

test("urgent items are separable and a corrupt file is skipped", () => {
  put({ qid: "Q-1", urgent: true });
  put({ qid: "Q-2" });
  mkdirSync(join(home, "queue"), { recursive: true });
  writeFileSync(join(home, "queue", "broken.json"), "{not json");
  expect(queue.listUrgentOpen(home).map((q) => q.qid)).toEqual(["Q-1"]);
  expect(queue.listAll(home)).toHaveLength(2);
});

test("summarize and optionLabels render both kinds", () => {
  put({ qid: "Q-1" });
  put({ qid: "Q-2", kind: "permission", tool: "Bash", summary: '{"command":"rm -rf x"}', questions: undefined });
  const [q1, q2] = queue.listOpen(home);
  expect(queue.summarize(q1)).toBe("Which one?");
  expect(queue.optionLabels(q1)).toEqual(["A", "B"]);
  expect(queue.summarize(q2)).toContain("needs permission for Bash");
});

test("journal appends timestamped lines under a dated heading", () => {
  journal.append(home, "dispatched t-1", new Date(2026, 8, 7, 9, 5));
  journal.append(home, "accepted t-2", new Date(2026, 8, 7, 11, 30));
  const text = journal.read(home, "2026-09-07");
  expect(text).toContain("# Ambrosio journal — 2026-09-07");
  expect(text).toContain("- 09:05 dispatched t-1");
  expect(text).toContain("- 11:30 accepted t-2");
});

test("agents: enrich reads the job summary, parseDispatchId reads the id, busy filters", () => {
  const a = enrich({ id: "nojob", name: "w", kind: "background", state: "working", cwd: "/tmp" });
  expect(a.kind).toBe("background");
  expect(a.state).toBe("working");

  expect(parseDispatchId("Starting background service…\nbackgrounded · 83efb182 · smoke-ask\n")).toBe("83efb182");
  expect(parseDispatchId("no id here")).toBe(null);

  const list = [
    { kind: "background", state: "working", cwd: "/a" },
    { kind: "background", state: "done", cwd: "/b" },
    { kind: "background", state: "blocked", cwd: "/c" },
  ] as any;
  expect(busy(list)).toHaveLength(2);
});

test("agents.resume refuses a short job id rather than silently forking the session", async () => {
  const { resume, AgentError } = await import("../src/agents.ts");
  expect(() => resume("c3912149", "go")).toThrow(AgentError);
  expect(() => resume("c3912149", "go")).toThrow(/full session UUID/);
});
