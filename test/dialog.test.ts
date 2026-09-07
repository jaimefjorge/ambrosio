import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDialog, standing, retire, say, type DialogDeps } from "../src/dialog.ts";
import type { AmbrosioConfig } from "../src/config.ts";

// The dialog: Jaime talks to Ambrosio from the UI and it binds. A message is
// one of three things — an action in the Messages grammar (routed through the
// same guardrails), a question (answered, read-only), or a standing
// instruction Ambrosio reads at every tick and plan-day until it is retired.

const cfg = () => ({ homeDir: mkdtempSync(join(tmpdir(), "amb-dlg-")), wipLimit: 3, hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" } } as AmbrosioConfig);

function deps(over: Partial<DialogDeps> = {}) {
  const log: string[] = [];
  const d: DialogDeps = {
    snapshot: () => ({ keys: { questions: {}, plans: {}, accept: {} }, tickets: [{ id: "gmc-4or", repo: "gatemd-core" }] }),
    route: (_c, reply) => { log.push(`route:${reply.kind}`); return reply.kind === "pause" ? { kind: "paused", reason: "x" } : { kind: "status" }; },
    ask: (_c, q) => { log.push(`ask:${q}`); return { ok: true, answer: "It is waiting on the gate." }; },
    ...over,
  };
  return { d, log };
}

describe("what a message becomes", () => {
  test("a grammar line is an action, routed like a text from Messages, kept in his own words", () => {
    const c = cfg();
    const { d, log } = deps();
    const r = say(c, "pause: back tomorrow", d);
    expect(r.entries[0].text).toBe("pause: back tomorrow");
    expect(log).toEqual(["route:pause"]);
    expect(r.reply.kind).toBe("action");
    expect(r.reply.text).toContain("Paused");
    expect(log).not.toContain("ask:pause: back tomorrow");
  });

  test("a question is answered and nothing moves", () => {
    const c = cfg();
    const { d, log } = deps();
    const r = say(c, "why is gmc-4or stuck?", d);
    expect(log).toEqual(["ask:why is gmc-4or stuck?"]);
    expect(r.reply.kind).toBe("question");
    expect(r.reply.text).toBe("It is waiting on the gate.");
  });

  test("anything else is a standing instruction, kept until retired", () => {
    const c = cfg();
    const { d, log } = deps();
    const r = say(c, "No e2e work after hours this week.", d);
    expect(log).toEqual([]);
    expect(r.reply.kind).toBe("instruction");
    expect(r.reply.text).toContain("standing");
    expect(standing(c.homeDir).map((e) => e.text)).toEqual(["No e2e work after hours this week."]);
  });

  test("one message, several lines: each line is judged on its own", () => {
    const c = cfg();
    const { d, log } = deps();
    say(c, "status\ngatemd first this week", d);
    expect(log).toEqual(["route:status"]);
    expect(standing(c.homeDir).map((e) => e.text)).toEqual(["gatemd first this week"]);
  });
});

describe("the thread", () => {
  test("both sides are kept, in order, with who said what", () => {
    const c = cfg();
    const { d } = deps();
    say(c, "gatemd first", d);
    say(c, "why is gmc-4or stuck?", d);
    const thread = readDialog(c.homeDir);
    expect(thread.map((e) => e.from)).toEqual(["jaime", "ambrosio", "jaime", "ambrosio"]);
    expect(thread[0].text).toBe("gatemd first");
    expect(thread[3].text).toBe("It is waiting on the gate.");
  });

  test("retiring an instruction takes it out of standing but not out of the thread", () => {
    const c = cfg();
    const { d } = deps();
    say(c, "gatemd first", d);
    const id = standing(c.homeDir)[0].id;
    retire(c.homeDir, id);
    expect(standing(c.homeDir)).toEqual([]);
    expect(readDialog(c.homeDir).find((e) => e.id === id)?.retiredAt).toBeTruthy();
  });

  test("an empty message is refused, not recorded", () => {
    const c = cfg();
    const { d } = deps();
    expect(() => say(c, "   ", d)).toThrow();
    expect(readDialog(c.homeDir)).toEqual([]);
  });

  test("a failed action says so in the thread rather than pretending", () => {
    const c = cfg();
    const { d } = deps({ route: () => { throw new Error("beads is locked"); } });
    const r = say(c, "gmc-4or defer", d);
    expect(r.reply.kind).toBe("action");
    expect(r.reply.text).toContain("beads is locked");
    expect(r.reply.ok).toBe(false);
  });
});
