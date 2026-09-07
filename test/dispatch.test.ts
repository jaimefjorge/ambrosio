import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWorkerPrompt, workDirFor, DispatchError } from "../src/dispatch.ts";
import { rootDir, type AmbrosioConfig } from "../src/config.ts";
import type { Ticket } from "../src/tracker.ts";

const cfg = (): AmbrosioConfig => ({
  repos: [{ name: "core", path: "/tmp/core", prefix: "c" }],
  wipLimit: 3, turnCap: 150,
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
  imessage: { handle: "" }, urgentPatterns: [],
  homeDir: mkdtempSync(join(tmpdir(), "amb-d-")), rootDir: rootDir(),
});

const repo = { name: "core", path: "/tmp/core", prefix: "c" };
const ticket = (o: Partial<Ticket> = {}): Ticket => ({
  id: "c-a1b", title: "Add dark mode", status: "open", priority: 2, repo: "core",
  description: "Follow the OS theme.",
  acceptance_criteria: "when the OS is dark, the app renders dark",
  metadata: { verify: ["bun test", "bun run lint"] },
  ...o,
});

test("the worker prompt carries the ticket, criteria, verify commands and parking rules", () => {
  const c = cfg();
  const p = renderWorkerPrompt(c, repo, ticket());
  expect(p).toContain("c-a1b — Add dark mode");
  expect(p).toContain("when the OS is dark, the app renders dark");
  expect(p).toContain("bun test");
  expect(p).toContain("bun run lint");
  expect(p).toContain("needs_input");
  expect(p).toContain("Never merge. Never close the ticket.");
  expect(p).toContain(workDirFor(c, repo, "c-a1b"));
  expect(p).toContain("150");
});

test("no placeholder survives rendering", () => {
  const p = renderWorkerPrompt(cfg(), repo, ticket({ description: undefined, acceptance_criteria: undefined, metadata: {} }));
  expect(p).not.toMatch(/\{\{[A-Z_]+\}\}/);
  expect(p).toContain("(none recorded");
});

test("architectural tickets get a plan gate, bounded ones do not", () => {
  const gated = renderWorkerPrompt(cfg(), repo, ticket({ metadata: { planning_path: "architectural" } }));
  expect(gated).toContain("requires plan approval");
  expect(gated).toContain("--status plan_review");

  const bounded = renderWorkerPrompt(cfg(), repo, ticket({ metadata: { planning_path: "bounded" } }));
  expect(bounded).toContain("bounded: write the plan, then continue");
  expect(bounded).not.toContain("requires plan approval");
});

test("scope and decision budget fall back to safe defaults", () => {
  const p = renderWorkerPrompt(cfg(), repo, ticket({ metadata: {} }));
  expect(p).toContain("Anything else is a new ticket");
  expect(p).toContain("Not product behaviour, not scope");
});

test("dispatchTicket refuses when the WIP limit is reached", async () => {
  const { dispatchTicket } = await import("../src/dispatch.ts");
  const c = cfg();
  expect(() =>
    dispatchTicket(c, "core", "c-a1b", { dispatch: () => { throw new Error("should not be called"); }, countBusy: () => 3 }),
  ).toThrow(DispatchError);
});

test("dispatchTicket refuses an unknown repo", async () => {
  const { dispatchTicket } = await import("../src/dispatch.ts");
  expect(() => dispatchTicket(cfg(), "nope", "c-a1b", { dispatch: () => ({ id: "x", name: "y" }), countBusy: () => 0 })).toThrow(/unknown repo/);
});

test("deliverAnswer holds the answer while the worker is still running", async () => {
  const { deliverAnswer } = await import("../src/dispatch.ts");
  let resumed = false;
  const how = deliverAnswer(
    cfg(), { ticket: "c-a1b", repo: "core", sessionId: "s1", text: "option a" },
    { workers: () => [{ kind: "background", cwd: "/tmp/core", name: "c-a1b", state: "working", id: "s1" } as any],
      resume: () => { resumed = true; } },
  );
  expect(how).toBe("deferred");
  expect(resumed).toBe(false);
});

test("deliverAnswer errors clearly when there is no session to resume", async () => {
  const { deliverAnswer } = await import("../src/dispatch.ts");
  expect(() =>
    deliverAnswer(cfg(), { ticket: "c-a1b", repo: "core", text: "x" }, { workers: () => [], resume: () => {} }),
  ).toThrow(/no session UUID found/);
});

test("deliverAnswer resumes with the session UUID, never the short job id", async () => {
  const { deliverAnswer } = await import("../src/dispatch.ts");
  let usedId = "";
  // A parked worker: short id "c391", full uuid in sessionId.
  try {
    deliverAnswer(
      cfg(), { ticket: "c-a1b", repo: "core", sessionId: "c3912149-1d31-4660-b2ee-56ebac4905fc", text: "a" },
      {
        workers: () => [{ kind: "background", cwd: "/tmp/core", name: "c-a1b", state: "blocked",
                          id: "c3912149", sessionId: "c3912149-1d31-4660-b2ee-56ebac4905fc" } as any],
        resume: (_short, uuid) => { usedId = uuid; },
      },
    );
  } catch { /* tracker write is not stubbed; the id is what this test asserts */ }
  expect(usedId).toBe("c3912149-1d31-4660-b2ee-56ebac4905fc");
});
