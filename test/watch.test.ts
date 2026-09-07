import { describe, expect, test } from "bun:test";
import { drain, onePass, type WatchDeps } from "../src/watch.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { InboundMessage } from "../src/inbox.ts";

const cfg = { homeDir: "/tmp/ambrosio-test", imessage: { handle: "+15550001111" } } as AmbrosioConfig;

function msg(text: string, rowid = 1): InboundMessage {
  return { rowid, text, at: new Date(), fromMe: true };
}

/** Records what the watcher did, so a test can assert on the side effects. */
function spyDeps(inbound: InboundMessage[], over: Partial<WatchDeps> = {}) {
  const log: string[] = [];
  const deps: WatchDeps = {
    readInbound: () => inbound,
    snapshot: () => ({
      keys: {
        questions: { Q1: { qid: "q-7", ticket: "T-3", repo: "gatemd" } as any },
        plans: { P1: { id: "T-9", repo: "gatemd" } as any },
        accept: {},
      },
      tickets: [
        { id: "T-3", repo: "gatemd" },
        { id: "T-4", repo: "gatemd" },
      ],
    }),
    answer: (_c, qid, text) => { log.push(`answer:${qid}:${text}`); return "resumed"; },
    sendDigest: () => { log.push("digest"); },
    transition: (_c, repo, ticket, status) => { log.push(`transition:${repo}:${ticket}:${status}`); },
    stopWorker: (ticket) => { log.push(`stop:${ticket}`); },
    wake: () => { log.push("wake"); },
    ...over,
  };
  return { deps, log };
}

describe("drain", () => {
  test("an answer resumes the parked worker immediately, without waking the manager", () => {
    // This is the whole point: 'Q1 b' must not wait for the hourly tick.
    const { deps, log } = spyDeps([msg("Q1 b")]);
    const handled = drain(cfg, deps);

    expect(log).toEqual(["answer:q-7:b"]);
    expect(log).not.toContain("wake");
    expect(handled[0].actions[0]).toMatchObject({ kind: "answered", qid: "q-7", ticket: "T-3" });
  });

  test("carries the note along with the chosen option", () => {
    const { deps, log } = spyDeps([msg("Q1 b: cap it at three retries")]);
    drain(cfg, deps);
    expect(log).toEqual(["answer:q-7:b, cap it at three retries"]);
  });

  test("status sends the digest at once", () => {
    const { deps, log } = spyDeps([msg("status")]);
    drain(cfg, deps);
    expect(log).toEqual(["digest"]);
  });

  test("defer and stop act on the ticket without a model in the loop", () => {
    const { deps, log } = spyDeps([msg("T-4 defer", 1), msg("T-3 stop", 2)]);
    drain(cfg, deps);
    expect(log).toEqual([
      "transition:gatemd:T-4:deferred",
      "transition:gatemd:T-3:deferred",
      "stop:T-3",
    ]);
  });

  test("a plan decision needs judgment, so it wakes the manager", () => {
    const { deps, log } = spyDeps([msg("P1 change: split the migration in two")]);
    const handled = drain(cfg, deps);

    expect(log).toEqual(["wake"]);
    expect(handled[0].actions[0]).toMatchObject({ kind: "escalated" });
  });

  test("wakes the manager once for a burst, not once per message", () => {
    const { deps, log } = spyDeps([msg("P1 ok", 1), msg("A1 accept", 2), msg("@T-3 hurry up", 3)]);
    drain(cfg, deps);
    expect(log.filter((l) => l === "wake")).toHaveLength(1);
  });

  test("handles what it can and escalates the rest of the same message", () => {
    const { deps, log } = spyDeps([msg("Q1 b\nP1 ok")]);
    drain(cfg, deps);
    expect(log).toEqual(["answer:q-7:b", "wake"]);
  });

  test("an unknown key escalates instead of guessing which question was meant", () => {
    const { deps, log } = spyDeps([msg("Q9 b")]);
    drain(cfg, deps);
    expect(log).toEqual(["wake"]);
  });

  test("an unknown ticket escalates instead of acting on the wrong one", () => {
    const { deps, log } = spyDeps([msg("T-99 stop")]);
    drain(cfg, deps);
    expect(log).toEqual(["wake"]);
  });

  test("does nothing at all when there is nothing to read", () => {
    const { deps, log } = spyDeps([]);
    expect(drain(cfg, deps)).toEqual([]);
    expect(log).toEqual([]);
  });

  test("a failure is escalated, not swallowed, and the rest still run", () => {
    const { deps, log } = spyDeps([msg("Q1 b\nstatus")], {
      answer: () => { throw new Error("worker is gone"); },
    });
    const handled = drain(cfg, deps);

    // The digest still goes out, and the failed answer wakes the manager
    // rather than disappearing.
    expect(log).toEqual(["digest", "wake"]);
    expect(handled[0].actions[0]).toMatchObject({ kind: "failed" });
  });
});

describe("onePass", () => {
  test("retries held answers even when Jaime has sent nothing", () => {
    // What unblocks a held answer is the worker parking, not a new message.
    const { deps } = spyDeps([]);
    let tried = 0;
    const r = onePass(cfg, { ...deps, deliverHeld: () => { tried++; return [{ qid: "q-1", ticket: "T-1", repo: "r" }]; } });

    expect(tried).toBe(1);
    expect(r.delivered.map((d) => d.qid)).toEqual(["q-1"]);
    expect(r.handled).toEqual([]);
  });

  test("hands over first, then acts on new replies", () => {
    const order: string[] = [];
    const { deps } = spyDeps([msg("status")], { sendDigest: () => order.push("digest") });
    onePass(cfg, { ...deps, deliverHeld: () => { order.push("held"); return []; } });

    expect(order).toEqual(["held", "digest"]);
  });
});
