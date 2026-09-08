import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginDay, type BeginDeps } from "../src/begin.ts";
import { pause, isPaused } from "../src/pause.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// 2026-09-08, 09:xx: "I can't start ambrosio in the morning." Begin was
// disabled until tickets were chosen, and once chosen every dispatch was
// refused because the fleet was still paused from the night before. The
// morning must always be able to begin: it lifts the pause, records the
// start, dispatches what was chosen, and leaves the rest to the loop.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-bg-")), wipLimit: 3, repos: [{ name: "core", path: "/tmp/core", prefix: "c" }] } as unknown as AmbrosioConfig);

function deps(over: Partial<BeginDeps> = {}) {
  const log: string[] = [];
  const d: BeginDeps = {
    openCount: () => 4,
    readyCount: () => 2,
    dispatch: (_c, repo, ticket) => { log.push(`dispatch:${repo}/${ticket}`); return { id: "j" }; },
    journal: (_c, line) => log.push(`journal:${line}`),
    ...over,
  };
  return { d, log };
}

describe("beginning the day", () => {
  test("with nothing chosen it still begins: pause lifted, start recorded, queue left to the loop", () => {
    const c = cfg();
    pause(c.homeDir, "dry run complete");
    const { d, log } = deps();
    const r = beginDay(c, [], d);
    expect(isPaused(c.homeDir)).toBe(false);
    expect(r.resumed).toBe(true);
    expect(r.open).toBe(4);
    expect(r.queued).toBe(2);
    expect(r.dispatched).toEqual([]);
    expect(existsSync(join(c.homeDir, "days"))).toBe(true);
    expect(readdirSync(join(c.homeDir, "days"))).toHaveLength(1);
    expect(log.some((l) => l.startsWith("journal:day began"))).toBe(true);
  });

  test("chosen tickets are dispatched after the pause is lifted, and refusals are named", () => {
    const c = cfg();
    pause(c.homeDir, "x");
    const { d, log } = deps({ dispatch: (_c, _r, t) => { if (t === "c-2") throw new Error("WIP limit reached"); log.push(`dispatch:${t}`); return { id: "j" }; } });
    const r = beginDay(c, [{ repo: "core", ticket: "c-1" }, { repo: "core", ticket: "c-2" }], d);
    expect(r.dispatched.map((x) => x.ticket)).toEqual(["c-1"]);
    expect(r.refused).toEqual([{ ticket: "c-2", why: "WIP limit reached" }]);
    expect(log).toContain("dispatch:c-1");
  });

  test("beginning twice is harmless: not paused stays not paused, start is recorded once per day", () => {
    const c = cfg();
    const { d } = deps();
    const a = beginDay(c, [], d);
    const b = beginDay(c, [], d);
    expect(a.resumed).toBe(false);   // nothing was paused
    expect(b.resumed).toBe(false);
    expect(readdirSync(join(c.homeDir, "days"))).toHaveLength(1);
  });
});
