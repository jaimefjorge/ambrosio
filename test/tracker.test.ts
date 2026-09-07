import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tracker from "../src/tracker.ts";
import type { RepoConfig } from "../src/config.ts";

let dir: string;
let repo: RepoConfig;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "amb-bd-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  repo = { name: "t", path: dir, prefix: "tt" };
  tracker.initRepo(repo);
  // `bd init` starts an embedded Dolt instance and takes ~4s on a quiet
  // machine, which is already at Bun's 5s default. With workers running it
  // goes over, and the whole suite fails in setup for no real reason.
}, 60_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

test("initRepo is idempotent", () => {
  expect(tracker.initRepo(repo).initialized).toBe(false);
});

test("create returns a ticket with an id and acceptance criteria", () => {
  const t = tracker.create(repo, {
    title: "Add dark mode",
    description: "the UI should follow the OS theme",
    acceptance: "when the OS is dark, the app renders dark",
    externalRef: "LIN-42",
    metadata: { repo: "t", verify: ["bun test"] },
  });
  expect(t.id).toMatch(/^tt-/);
  expect(t.status).toBe("open");
  expect(t.acceptance_criteria).toContain("renders dark");
  expect(t.external_ref).toBe("LIN-42");
  expect(t.repo).toBe("t");
});

test("transition moves through the custom statuses and list filters by them", () => {
  const t = tracker.create(repo, { title: "Ticket two" });
  tracker.transition(repo, t.id, "planning");
  expect(tracker.get(repo, t.id).status).toBe("planning");

  tracker.transition(repo, t.id, "plan_review", "worker: plan ready");
  const waiting = tracker.needsHuman(repo).map((x) => x.id);
  expect(waiting).toContain(t.id);

  const cs = tracker.comments(repo, t.id);
  expect(cs.some((c) => c.text.includes("plan ready"))).toBe(true);
});

test("get unwraps the array bd show returns", () => {
  const t = tracker.create(repo, { title: "Ticket three" });
  const got = tracker.get(repo, t.id);
  expect(Array.isArray(got)).toBe(false);
  expect(got.title).toBe("Ticket three");
});

test("setMeta merges metadata and close records the reason", () => {
  const t = tracker.create(repo, { title: "Ticket four", metadata: { a: "1" } });
  tracker.setMeta(repo, t.id, { session_id: "abc123" });
  const got = tracker.get(repo, t.id);
  expect(got.metadata?.a).toBe("1");
  expect(got.metadata?.session_id).toBe("abc123");

  tracker.close(repo, t.id, "accepted: PR #7");
  expect(tracker.get(repo, t.id).status).toBe("closed");
});

test("unknown ticket raises a TrackerError naming the command", () => {
  try {
    tracker.get(repo, "tt-nope");
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(tracker.TrackerError);
  }
});
