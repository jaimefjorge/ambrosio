import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The pause. While it is set, nothing starts and nothing resumes: the watch
 * loop still reads Messages (so `resume` and `status` get through) but hands
 * no answers to workers, delivers no feedback, and runs no night shift.
 *
 * It lives on disk, not in a process, because on 2026-09-07 the process that
 * needed to know about it was a `start` loop in another terminal that had
 * been told nothing — it restarted three workers within minutes of Jaime
 * saying "pause all work".
 */
export type Pause = { since: string; reason: string };

const file = (home: string) => join(home, "paused.json");

export function readPause(home: string): Pause | null {
  const f = file(home);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Pause;
  } catch {
    // An unreadable flag is still a flag. Someone meant to stop the fleet;
    // guessing otherwise is how it starts again.
    return { since: "", reason: "(unreadable pause file)" };
  }
}

export function isPaused(home: string): boolean {
  return readPause(home) !== null;
}

export function pause(home: string, reason: string, now = new Date()): Pause {
  mkdirSync(home, { recursive: true });
  const p: Pause = { since: now.toISOString(), reason };
  writeFileSync(file(home), JSON.stringify(p, null, 2));
  return p;
}

export function resume(home: string): void {
  rmSync(file(home), { force: true });
}
