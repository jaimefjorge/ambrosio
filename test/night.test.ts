import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nightKey, readNight, recordStart } from "../src/night.ts";

const home = () => mkdtempSync(join(tmpdir(), "amb-night-"));
const WRAP = 15 * 60;

test("the night is named for the day it followed, past midnight included", () => {
  expect(nightKey(new Date(2026, 8, 7, 16, 0), WRAP)).toBe("2026-09-07");
  expect(nightKey(new Date(2026, 8, 8, 2, 0), WRAP)).toBe("2026-09-07");
  expect(nightKey(new Date(2026, 8, 8, 15, 0), WRAP)).toBe("2026-09-08");
});

test("starts accumulate across passes and do not double count", () => {
  const h = home();
  recordStart(h, "2026-09-07", "gmc-1");
  recordStart(h, "2026-09-07", "gmc-2");
  recordStart(h, "2026-09-07", "gmc-1");
  expect(readNight(h, "2026-09-07").started).toEqual(["gmc-1", "gmc-2"]);
});

test("a new night starts from nothing", () => {
  const h = home();
  recordStart(h, "2026-09-07", "gmc-1");
  expect(readNight(h, "2026-09-08").started).toEqual([]);
});
