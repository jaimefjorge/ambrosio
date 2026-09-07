import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hhmm, type AmbrosioConfig } from "./config.ts";
import { todayKey } from "./journal.ts";

export class ReviewError extends Error {}

export type Review = { date: string; wentWell: string; doBetter: string; savedAt: string };

export type Lesson = { date: string; lesson: string };

function dir(home: string): string {
  const d = join(home, "reviews");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function readReview(cfg: AmbrosioConfig, now = new Date()): Review | null {
  const f = join(dir(cfg.homeDir), `${todayKey(now)}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Review;
  } catch {
    return null;
  }
}

export function saveReview(
  cfg: AmbrosioConfig,
  input: { wentWell: string; doBetter: string },
  now = new Date(),
): Review {
  const wentWell = (input.wentWell ?? "").trim();
  const doBetter = (input.doBetter ?? "").trim();
  if (!wentWell && !doBetter) {
    throw new ReviewError("Say what went well, or what to do better. An empty review teaches nothing.");
  }
  const review: Review = { date: todayKey(now), wentWell, doBetter, savedAt: now.toISOString() };
  writeFileSync(join(dir(cfg.homeDir), `${review.date}.json`), JSON.stringify(review, null, 2));
  return review;
}

/**
 * What Jaime asked to be done differently, newest first.
 *
 * This is the part that makes the review worth giving: it is read into the
 * morning brief and into every worker's prompt, so a lesson changes the next
 * day rather than sitting in a file.
 */
export function recentLessons(cfg: AmbrosioConfig, limit = 5): Lesson[] {
  const d = dir(cfg.homeDir);
  const out: Lesson[] = [];
  for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort().reverse()) {
    try {
      const r = JSON.parse(readFileSync(join(d, f), "utf8")) as Review;
      if (r.doBetter?.trim()) out.push({ date: r.date, lesson: r.doBetter.trim() });
    } catch {
      // A corrupt review is not worth failing a morning over.
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** After wrap-up, and only until it has been given. */
export function reviewDue(cfg: AmbrosioConfig, now = new Date()): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < hhmm(cfg.hours.wrapUp)) return false;
  return readReview(cfg, now) === null;
}
