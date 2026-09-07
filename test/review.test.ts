import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveReview, readReview, recentLessons, reviewDue, ReviewError } from "../src/review.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const cfg = (): AmbrosioConfig => ({
  homeDir: mkdtempSync(join(tmpdir(), "amb-rev-")),
  hours: { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" },
} as AmbrosioConfig);

const at = (h: number, m = 0) => new Date(2026, 8, 8, h, m);

describe("the end-of-day review", () => {
  test("keeps what went well and what to do better", () => {
    const c = cfg();
    saveReview(c, { wentWell: "two tickets landed clean", doBetter: "ask about branches before starting" }, at(15));

    const r = readReview(c, at(15))!;
    expect(r.wentWell).toContain("landed clean");
    expect(r.doBetter).toContain("ask about branches");
  });

  test("refuses an empty review rather than storing nothing", () => {
    expect(() => saveReview(cfg(), { wentWell: "  ", doBetter: "" }, at(15))).toThrow(ReviewError);
  });

  test("one of the two is enough", () => {
    const c = cfg();
    saveReview(c, { wentWell: "", doBetter: "smaller tickets" }, at(15));
    expect(readReview(c, at(15))!.doBetter).toBe("smaller tickets");
  });

  test("saving again the same day replaces it", () => {
    const c = cfg();
    saveReview(c, { wentWell: "first", doBetter: "" }, at(15));
    saveReview(c, { wentWell: "second", doBetter: "" }, at(16));
    expect(readReview(c, at(16))!.wentWell).toBe("second");
  });
});

describe("lessons carried into the next days", () => {
  test("are the 'do better' lines, newest first — that is the whole point", () => {
    const c = cfg();
    saveReview(c, { wentWell: "", doBetter: "ask about branches first" }, new Date(2026, 8, 6, 15));
    saveReview(c, { wentWell: "", doBetter: "smaller tickets" }, new Date(2026, 8, 7, 15));

    expect(recentLessons(c).map((l) => l.lesson)).toEqual(["smaller tickets", "ask about branches first"]);
  });

  test("a day with nothing to improve contributes no lesson", () => {
    const c = cfg();
    saveReview(c, { wentWell: "all smooth", doBetter: "" }, new Date(2026, 8, 6, 15));
    expect(recentLessons(c)).toEqual([]);
  });

  test("only the recent ones, so the prompt does not grow without bound", () => {
    const c = cfg();
    for (let d = 1; d <= 10; d++) saveReview(c, { wentWell: "", doBetter: `lesson ${d}` }, new Date(2026, 8, d, 15));
    expect(recentLessons(c, 5)).toHaveLength(5);
    expect(recentLessons(c, 5)[0].lesson).toBe("lesson 10");
  });
});

describe("when the review is due", () => {
  test("at wrap-up, once the day is over", () => {
    expect(reviewDue(cfg(), at(15, 1))).toBe(true);
    expect(reviewDue(cfg(), at(16))).toBe(true);
  });

  test("not before then — the day is still running", () => {
    expect(reviewDue(cfg(), at(11))).toBe(false);
  });

  test("not once it has been given", () => {
    const c = cfg();
    saveReview(c, { wentWell: "done", doBetter: "" }, at(15, 30));
    expect(reviewDue(c, at(16))).toBe(false);
  });
});
