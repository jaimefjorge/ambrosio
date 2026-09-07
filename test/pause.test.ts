import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPaused, pause, resume, readPause } from "../src/pause.ts";

// 2026-09-07, 15:58: Jaime said "pause all work". Every worker was stopped and
// every ticket deferred, and within minutes the watch loop's after-hours lane
// had started two more and resumed a third by delivering a held answer. There
// was no pause. There is now, and it outlives the process that set it.

const home = () => mkdtempSync(join(tmpdir(), "amb-pause-"));

test("a fresh home is not paused", () => {
  expect(isPaused(home())).toBe(false);
  expect(readPause(home())).toBeNull();
});

test("pause persists across reads, with when and why", () => {
  const h = home();
  pause(h, "taking stock before tomorrow", new Date("2026-09-07T15:58:00Z"));
  expect(isPaused(h)).toBe(true);
  const p = readPause(h)!;
  expect(p.reason).toBe("taking stock before tomorrow");
  expect(p.since).toBe("2026-09-07T15:58:00.000Z");
});

test("resume clears it, and resuming twice is harmless", () => {
  const h = home();
  pause(h, "x");
  resume(h);
  resume(h);
  expect(isPaused(h)).toBe(false);
});

test("a corrupt pause file counts as paused — the safe reading", () => {
  const h = home();
  pause(h, "x");
  require("node:fs").writeFileSync(join(h, "paused.json"), "{not json");
  expect(isPaused(h)).toBe(true);
});
