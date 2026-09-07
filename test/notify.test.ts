import { describe, expect, test } from "bun:test";
import { notifyPass, hourKey, type NotifyDeps, type NotifyState } from "../src/notify.ts";
import type { AmbrosioConfig } from "../src/config.ts";
import type { BoardState } from "../src/digest.ts";
import type { QueueItem } from "../src/queue.ts";

const cfg = {
  homeDir: "/tmp/x",
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
} as AmbrosioConfig;

const at = (h: number, m = 0) => new Date(2026, 8, 7, h, m);

function board(over: Partial<BoardState> = {}): BoardState {
  return { now: at(10), questions: [], plans: [], accept: [], working: [], blocked: [], anomalies: [], ...over } as BoardState;
}

const q = (qid: string, urgent = false) => ({ qid, ticket: "T-1", repo: "r", urgent, status: "open" } as QueueItem);

function spy(over: Partial<NotifyDeps> = {}, state: NotifyState = {}) {
  const log: string[] = [];
  let saved: NotifyState = state;
  const deps: NotifyDeps = {
    now: () => at(10),
    board: () => board({ questions: [q("q-1")] }),
    urgentOpen: () => [],
    sendDigest: () => log.push("digest"),
    sendUrgent: (_c, item) => log.push("urgent:" + item.qid),
    readState: () => saved,
    writeState: (_c, s) => { saved = s; },
    ...over,
  };
  return { deps, log, state: () => saved };
}

describe("notifyPass", () => {
  test("sends the digest when there is something to decide", () => {
    const { deps, log } = spy();
    expect(notifyPass(cfg, deps).digest).toBe(true);
    expect(log).toEqual(["digest"]);
  });

  test("a silent tick is a good tick: nothing to decide, nothing sent", () => {
    const { deps, log } = spy({ board: () => board() });
    expect(notifyPass(cfg, deps).digest).toBe(false);
    expect(log).toEqual([]);
  });

  test("outside working hours it sends nothing at all, not even urgent", () => {
    const { deps, log } = spy({ now: () => at(22), urgentOpen: () => [q("q-9", true)] });
    notifyPass(cfg, deps);
    expect(log).toEqual([]);
  });

  test("never two digests in the same hour", () => {
    const { deps, log, state } = spy();
    notifyPass(cfg, deps);
    notifyPass(cfg, deps);
    expect(log).toEqual(["digest"]);
    expect(state().lastDigestHour).toBe(hourKey(at(10)));
  });

  test("a new hour earns a new digest", () => {
    let clock = at(10);
    const { deps, log } = spy({ now: () => clock });
    notifyPass(cfg, deps);
    clock = at(11);
    notifyPass(cfg, deps);
    expect(log).toEqual(["digest", "digest"]);
  });

  test("when a digest already went out this hour, an urgent question still gets through", () => {
    const { deps, log } = spy(
      { board: () => board(), urgentOpen: () => [q("q-9", true)] },
      { lastDigestHour: hourKey(at(10)) },
    );
    notifyPass(cfg, deps);
    expect(log).toEqual(["urgent:q-9"]);
  });

  test("the same urgent question is never sent twice", () => {
    const { deps, log } = spy({ board: () => board(), urgentOpen: () => [q("q-9", true)] });
    notifyPass(cfg, deps);
    notifyPass(cfg, deps);
    expect(log).toEqual(["urgent:q-9"]);
  });

  test("a digest covers the urgent items in it, so they are not also sent on their own", () => {
    const { deps, log, state } = spy({
      board: () => board({ questions: [q("q-9", true)] }),
      urgentOpen: () => [q("q-9", true)],
    });
    notifyPass(cfg, deps);
    expect(log).toEqual(["digest"]);
    expect(state().urgentSent).toContain("q-9");
  });

  test("anomalies alone are worth a digest, even with nothing to decide", () => {
    const { deps, log } = spy({ board: () => board({ anomalies: ["T-9 has run for 4h"] }) });
    notifyPass(cfg, deps);
    expect(log).toEqual(["digest"]);
  });
});

// --- Asking for the day's review -------------------------------------------

import { reviewDue } from "../src/review.ts";

describe("the end-of-day review nudge", () => {
  const nudgeDeps = (over: Partial<NotifyDeps> = {}, state: NotifyState = {}) => {
    const log: string[] = [];
    let saved = state;
    const deps: NotifyDeps = {
      now: () => at(15, 5),
      board: () => board(),
      urgentOpen: () => [],
      sendDigest: () => log.push("digest"),
      sendUrgent: (_c, i) => log.push("urgent:" + i.qid),
      reviewDue: () => true,
      sendReviewAsk: () => log.push("review-ask"),
      readState: () => saved,
      writeState: (_c, s) => { saved = s; },
      ...over,
    };
    return { deps, log, state: () => saved };
  };

  test("asks once the working day is over", () => {
    const { deps, log } = nudgeDeps();
    expect(notifyPass(cfg, deps).reviewAsked).toBe(true);
    expect(log).toEqual(["review-ask"]);
  });

  test("asks once, not every pass", () => {
    const { deps, log } = nudgeDeps();
    notifyPass(cfg, deps);
    notifyPass(cfg, deps);
    expect(log).toEqual(["review-ask"]);
  });

  test("does not ask during the working day", () => {
    const { deps, log } = nudgeDeps({ now: () => at(11) });
    notifyPass(cfg, deps);
    expect(log).toEqual([]);
  });

  test("does not ask once the review has been given", () => {
    const { deps, log } = nudgeDeps({ reviewDue: () => false });
    notifyPass(cfg, deps);
    expect(log).toEqual([]);
  });

  test("stops asking late at night rather than nagging into the small hours", () => {
    const { deps, log } = nudgeDeps({ now: () => at(23, 30) });
    notifyPass(cfg, deps);
    expect(log).toEqual([]);
  });
});
