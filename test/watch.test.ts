import { describe, expect, test } from "bun:test";
import { drain, onePass, type WatchDeps } from "../src/watch.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { InboundMessage } from "../src/inbox.ts";

const cfg = {
  homeDir: "/tmp/ambrosio-test", imessage: { handle: "+15550001111" }, wipLimit: 3,
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
} as AmbrosioConfig;

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
    decide: (_c, d) => { log.push(`decide:${d.kind}:${d.ticket}${d.note ? ":" + d.note : ""}`); return { ticket: d.ticket, outcome: "closed" }; },
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

  test("a plan decision is applied here, not deferred to a session that may not be running", () => {
    const { deps, log } = spyDeps([msg("P1 change: split the migration in two")]);
    const handled = drain(cfg, deps);

    expect(log).toEqual(["decide:plan_change:T-9:split the migration in two"]);
    expect(handled[0].actions[0]).toMatchObject({ kind: "decided", ticket: "T-9" });
  });

  test("accepting finished work closes it without waking anything", () => {
    const { deps, log } = spyDeps([msg("A1 accept")], {
      snapshot: () => ({
        keys: { questions: {}, plans: {}, accept: { A1: { id: "T-5", repo: "gatemd" } as any } },
        tickets: [],
      }),
    });
    drain(cfg, deps);
    expect(log).toEqual(["decide:accept:T-5"]);
  });

  test("wakes the manager once for a burst, not once per message", () => {
    const { deps, log } = spyDeps([msg("@T-3 hurry up", 1), msg("quiet until 14:00", 2), msg("what now", 3)]);
    drain(cfg, deps);
    expect(log.filter((l) => l === "wake")).toHaveLength(1);
  });

  test("handles what it can and escalates the rest of the same message", () => {
    const { deps, log } = spyDeps([msg("Q1 b\n@T-3 hurry up")]);
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
    const r = onePass(cfg, { ...deps, notify: () => ({ digest: false, urgent: [] }), deliverHeld: () => { tried++; return [{ qid: "q-1", ticket: "T-1", repo: "r" }]; } });

    expect(tried).toBe(1);
    expect(r.delivered.map((d) => d.qid)).toEqual(["q-1"]);
    expect(r.handled).toEqual([]);
  });

  test("hands over first, then acts on new replies", () => {
    const order: string[] = [];
    const { deps } = spyDeps([msg("status")], { sendDigest: () => order.push("digest") });
    onePass(cfg, { ...deps, notify: () => ({ digest: false, urgent: [] }), deliverHeld: () => { order.push("held"); return []; } });

    expect(order).toEqual(["held", "digest"]);
  });
});

test("onePass sends after routing, so a reply just handled is reflected in what Jaime hears", () => {
  const order: string[] = [];
  const { deps } = spyDeps([msg("Q1 b")], { answer: () => { order.push("answered"); return "resumed"; } });
  onePass(cfg, {
    ...deps,
    deliverHeld: () => [],
    notify: () => { order.push("notified"); return { digest: true, urgent: [] }; },
  });
  expect(order).toEqual(["answered", "notified"]);
});

describe("asking Ambrosio a question from the phone", () => {
  test("a question is answered, not escalated into silence", () => {
    const asked: string[] = [];
    const { deps, log } = spyDeps([msg("why is gmc-4or still running?")], {
      answerQuestion: (_c, q) => asked.push(q),
    });
    const handled = drain(cfg, deps);

    expect(asked).toEqual(["why is gmc-4or still running?"]);
    expect(log).not.toContain("wake");
    expect(handled[0].actions[0]).toMatchObject({ kind: "answered_question" });
  });

  test("something that is neither a decision nor a question still wakes the manager", () => {
    const { deps, log } = spyDeps([msg("do the thing we discussed")], { answerQuestion: () => {} });
    drain(cfg, deps);
    expect(log).toContain("wake");
  });
});

// --- Paused means nothing starts and nothing resumes -------------------------

describe("paused", () => {
  const paused = { ...cfg, homeDir: require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "amb-w-")) } as AmbrosioConfig;

  test("onePass delivers nothing, starts nothing, and hands nothing to the night while paused", async () => {
    const { pause } = await import("../src/pause.ts");
    pause(paused.homeDir, "taking stock");
    const { deps, log } = spyDeps([], {
      deliverHeld: () => { log.push("deliverHeld"); return [{ qid: "q", ticket: "T-3", repo: "gatemd" }]; },
      deliverFeedback: () => { log.push("deliverFeedback"); return [{ ticket: "T-3" }]; },
      night: () => { log.push("night"); return { parked: [], dispatched: ["T-4"] }; },
      notify: () => { log.push("notify"); return { digest: false, urgent: [] }; },
    });
    const r = onePass(paused, deps);
    expect(log).not.toContain("deliverHeld");
    expect(log).not.toContain("deliverFeedback");
    expect(log).not.toContain("night");
    expect(r.delivered).toEqual([]);
    expect(r.night.dispatched).toEqual([]);
    expect(r.paused).toBe(true);
  });

  test("replies still drain while paused, so 'resume' and 'status' can get through", async () => {
    const { pause, isPaused } = await import("../src/pause.ts");
    pause(paused.homeDir, "taking stock");
    const { deps, log } = spyDeps([msg("status"), msg("resume", 2)]);
    onePass(paused, deps);
    expect(log).toContain("digest");
    expect(isPaused(paused.homeDir)).toBe(false);
  });

  test("'pause' from Messages sets the flag and says so", async () => {
    const { isPaused, resume, readPause } = await import("../src/pause.ts");
    resume(paused.homeDir);
    const { deps } = spyDeps([msg("pause: back tomorrow")]);
    const r = onePass(paused, deps);
    expect(isPaused(paused.homeDir)).toBe(true);
    expect(readPause(paused.homeDir)?.reason).toBe("back tomorrow");
    expect(r.handled[0].actions[0]).toEqual({ kind: "paused", reason: "back tomorrow" });
  });
});
