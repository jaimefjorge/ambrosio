import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the night has already started. The after-hours lane runs every few
 * seconds; without a memory that outlives the pass, "fill the free slots"
 * becomes "start something every time a slot frees" — and on 2026-09-07 that
 * produced nine cards by morning, most of them started off tickets the
 * previous night-workers had just filed.
 */
export type NightLedger = { date: string; started: string[] };

const file = (home: string) => join(home, "night.json");

/** The night that began at today's wrap-up, or yesterday's if it is not yet morning. */
export function nightKey(now: Date, wrapUpMinutes: number): string {
  const d = new Date(now);
  if (d.getHours() * 60 + d.getMinutes() < wrapUpMinutes) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function readNight(home: string, key: string): NightLedger {
  const f = file(home);
  if (existsSync(f)) {
    try {
      const l = JSON.parse(readFileSync(f, "utf8")) as NightLedger;
      if (l.date === key) return l;
    } catch {
      // A torn file is an empty ledger; the cap below still holds per pass.
    }
  }
  return { date: key, started: [] };
}

export function recordStart(home: string, key: string, ticket: string): NightLedger {
  mkdirSync(home, { recursive: true });
  const l = readNight(home, key);
  if (!l.started.includes(ticket)) l.started.push(ticket);
  writeFileSync(file(home), JSON.stringify(l, null, 2));
  return l;
}
