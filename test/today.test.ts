import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFocus, setFocus, FocusError } from "../src/today.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const cfg = (): AmbrosioConfig => ({
  homeDir: mkdtempSync(join(tmpdir(), "amb-today-")),
  repos: [
    { name: "gatemd-core", path: "/tmp/a", prefix: "gmc" },
    { name: "gatemd-ui", path: "/tmp/b", prefix: "gmu" },
  ],
} as AmbrosioConfig);

describe("the day's focus", () => {
  test("is nothing until Jaime sets it", () => {
    expect(readFocus(cfg())).toBeNull();
  });

  test("remembers the projects and the mission", () => {
    const c = cfg();
    setFocus(c, { repos: ["gatemd-core"], mission: "ship the release gate" });

    const f = readFocus(c)!;
    expect(f.repos).toEqual(["gatemd-core"]);
    expect(f.mission).toBe("ship the release gate");
  });

  test("a mission on its own is a valid day", () => {
    const c = cfg();
    setFocus(c, { repos: [], mission: "read the incident report and decide" });
    expect(readFocus(c)!.mission).toContain("incident report");
  });

  test("refuses a project that is not configured, rather than filtering to nothing", () => {
    const c = cfg();
    expect(() => setFocus(c, { repos: ["not-a-repo"], mission: "" })).toThrow(FocusError);
  });

  test("refuses a day with neither projects nor a mission", () => {
    expect(() => setFocus(cfg(), { repos: [], mission: "   " })).toThrow(FocusError);
  });

  test("yesterday's focus does not become today's", () => {
    const c = cfg();
    setFocus(c, { repos: ["gatemd-core"], mission: "yesterday" }, new Date("2026-09-07T09:00:00"));
    expect(readFocus(c, new Date("2026-09-08T09:00:00"))).toBeNull();
  });

  test("setting it again the same day replaces it", () => {
    const c = cfg();
    setFocus(c, { repos: ["gatemd-core"], mission: "first" });
    setFocus(c, { repos: ["gatemd-ui"], mission: "second" });

    expect(readFocus(c)!.repos).toEqual(["gatemd-ui"]);
    expect(readFocus(c)!.mission).toBe("second");
  });
});
