import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import * as journal from "./journal.ts";

/**
 * The timeline: one append-only record per ticket of everything that
 * happened to it — dispatched, each status it passed through, every
 * rejection and which round it was, acceptance, merge, main going red.
 *
 * The board is a snapshot and cannot answer "how did we get here". Every row
 * on it is the last line of one of these; the morning diff, the wrap-up
 * ledger and the ticket drawer are all read from here.
 */
export type EventKind =
  | "dispatched" | "status" | "question" | "answered"
  | "plan_ok" | "plan_change" | "rejected" | "accepted"
  | "iteration" | "escalated" | "stale"
  | "defect_linked" | "defect_closed"
  | "merged" | "main_green" | "main_red";

export type TimelineEvent = {
  at: string;
  kind: EventKind;
  /** For `status`: where it went. */
  status?: string;
  from?: string;
  /** Which round of rework this belongs to, from 1. */
  iteration?: number;
  note?: string;
  by?: "jaime" | "ambrosio" | "worker";
  [k: string]: unknown;
};

const FILE = "timeline.jsonl";

function path(home: string, repo: string, ticket: string): string {
  return join(journal.workDir(home, repo, ticket), FILE);
}

export function record(home: string, repo: string, ticket: string, ev: Omit<TimelineEvent, "at"> & { at?: string }): TimelineEvent {
  const dir = journal.workDir(home, repo, ticket);
  mkdirSync(dir, { recursive: true });
  const full: TimelineEvent = { at: ev.at ?? new Date().toISOString(), ...ev } as TimelineEvent;
  appendFileSync(path(home, repo, ticket), JSON.stringify(full) + "\n");
  return full;
}

export function read(home: string, repo: string, ticket: string): TimelineEvent[] {
  const f = path(home, repo, ticket);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .flatMap((l) => { try { return [JSON.parse(l) as TimelineEvent]; } catch { return []; } });
}

/** Every ticket that has a timeline, across the repos Ambrosio manages. */
export function readAll(cfg: AmbrosioConfig): { repo: string; ticket: string; events: TimelineEvent[] }[] {
  const out: { repo: string; ticket: string; events: TimelineEvent[] }[] = [];
  const root = join(cfg.homeDir, "work");
  if (!existsSync(root)) return out;
  for (const repo of readdirSync(root)) {
    const rdir = join(root, repo);
    if (!statSync(rdir).isDirectory()) continue;
    for (const ticket of readdirSync(rdir)) {
      const events = read(cfg.homeDir, repo, ticket);
      if (events.length) out.push({ repo, ticket, events });
    }
  }
  return out;
}

/** How many times this ticket has been sent back for rework. */
export function iterationOf(events: TimelineEvent[]): number {
  return events.filter((e) => e.kind === "rejected").length;
}

export function last(events: TimelineEvent[], kind: EventKind): TimelineEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === kind) return events[i];
  return undefined;
}

/**
 * Notice status changes Ambrosio did not make itself — workers move their own
 * tickets with `bd update` — by comparing the board to what was last seen.
 */
export function observe(cfg: AmbrosioConfig, tickets: { id: string; repo?: string; status: string }[], now = new Date()): TimelineEvent[] {
  const f = join(cfg.homeDir, "seen.json");
  let seen: Record<string, string> = {};
  if (existsSync(f)) { try { seen = JSON.parse(readFileSync(f, "utf8")); } catch { seen = {}; } }
  const out: TimelineEvent[] = [];
  const next: Record<string, string> = { ...seen };
  for (const t of tickets) {
    const key = `${t.repo ?? ""}/${t.id}`;
    const before = seen[key];
    if (before !== t.status) {
      next[key] = t.status;
      // The first sighting of a ticket is not a transition; only a change is.
      if (before !== undefined) {
        const ev = record(cfg.homeDir, t.repo ?? "", t.id, { at: now.toISOString(), kind: "status", from: before, status: t.status, by: "worker" });
        out.push({ ...ev, repo: t.repo ?? "", ticket: t.id });
      }
    }
  }
  if (out.length || Object.keys(next).length !== Object.keys(seen).length) {
    mkdirSync(cfg.homeDir, { recursive: true });
    Bun.write(f, JSON.stringify(next, null, 2));
  }
  return out;
}
