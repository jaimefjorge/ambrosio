import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import * as timeline from "./timeline.ts";
import { todayKey } from "./journal.ts";

/**
 * The day's ledger, read from the timelines and the board: what landed, what
 * Jaime accepted but has not merged, what bounced and how often, what was
 * escalated, what is blocked, what got added and by whom — and the net open
 * work against the morning. The wrap-up sends it; the morning brief opens
 * with yesterday's.
 */
export type LedgerItem = { id: string; repo: string; title?: string; status?: string; note?: string };

export type Ledger = {
  since: string; until: string;
  landed: LedgerItem[];
  mergedNotGreen: LedgerItem[];
  acceptedNotMerged: LedgerItem[];
  mainRed: LedgerItem[];
  bounced: { id: string; repo: string; rounds: number; last?: string; status?: string }[];
  escalated: LedgerItem[];
  blocked: LedgerItem[];
  waiting: LedgerItem[];
  added: { id: string; repo: string; title?: string; by: "jaime" | "worker" }[];
  open: { now: number; atStart: number | null; net: number | null };
};

export type LedgerDeps = {
  tickets: (cfg: AmbrosioConfig) => Ticket[];
  /** Was this ticket discovered from another — i.e. filed by a worker? */
  hasParent: (cfg: AmbrosioConfig, repo: string, id: string) => boolean;
};

const OPEN = new Set(["open", "planning", "plan_review", "in_progress", "verifying", "in_review", "needs_input", "blocked"]);

function dayFile(home: string, key: string): string { return join(home, "days", `${key}.json`); }

/** Called at plan-day: how much open work the day starts with. */
export function markDayStart(cfg: AmbrosioConfig, openCount: number, now = new Date()): void {
  mkdirSync(join(cfg.homeDir, "days"), { recursive: true });
  writeFileSync(dayFile(cfg.homeDir, todayKey(now)), JSON.stringify({ at: now.toISOString(), open: openCount }, null, 2));
}

function dayStart(cfg: AmbrosioConfig, now: Date): number | null {
  const f = dayFile(cfg.homeDir, todayKey(now));
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")).open ?? null; } catch { return null; }
}

export function ledger(cfg: AmbrosioConfig, deps: LedgerDeps, since: Date, now = new Date()): Ledger {
  const tickets = deps.tickets(cfg);
  const byId = new Map(tickets.map((t) => [`${t.repo}/${t.id}`, t]));
  const item = (repo: string, id: string, note?: string): LedgerItem => {
    const t = byId.get(`${repo}/${id}`);
    return { id, repo, title: t?.title, status: t?.status, ...(note ? { note } : {}) };
  };
  const inWindow = (e: timeline.TimelineEvent) => new Date(e.at) >= since && new Date(e.at) <= now;

  const L: Ledger = {
    since: since.toISOString(), until: now.toISOString(),
    landed: [], mergedNotGreen: [], acceptedNotMerged: [], mainRed: [], bounced: [], escalated: [],
    blocked: [], waiting: [], added: [], open: { now: 0, atStart: null, net: null },
  };

  for (const { repo, ticket, events } of timeline.readAll(cfg)) {
    const accepted = timeline.last(events, "accepted");
    const merged = timeline.last(events, "merged");
    const green = timeline.last(events, "main_green");
    const red = timeline.last(events, "main_red");
    if (red && inWindow(red)) L.mainRed.push(item(repo, ticket, red.note));
    else if (green && inWindow(green)) L.landed.push(item(repo, ticket));
    else if (merged && !green && !red) L.mergedNotGreen.push(item(repo, ticket));
    else if (accepted && !merged && inWindow(accepted)) L.acceptedNotMerged.push(item(repo, ticket));

    const rejections = events.filter((e) => e.kind === "rejected" && inWindow(e));
    if (rejections.length) {
      const t = byId.get(`${repo}/${ticket}`);
      L.bounced.push({ id: ticket, repo, rounds: timeline.iterationOf(events), last: rejections[rejections.length - 1].note, status: t?.status });
    }
    const esc = timeline.last(events, "escalated");
    if (esc && inWindow(esc)) L.escalated.push(item(repo, ticket, esc.note));
  }

  for (const t of tickets) {
    if (t.status === "needs_input" || t.status === "blocked") L.blocked.push(item(t.repo ?? "", t.id));
    if (t.status === "in_review" || t.status === "plan_review") L.waiting.push(item(t.repo ?? "", t.id));
    if (t.created_at && new Date(t.created_at) >= since && new Date(t.created_at) <= now) {
      const by = deps.hasParent(cfg, t.repo ?? "", t.id) ? "worker" : "jaime";
      L.added.push({ id: t.id, repo: t.repo ?? "", title: t.title, by });
    }
  }

  L.open.now = tickets.filter((t) => OPEN.has(t.status)).length;
  L.open.atStart = dayStart(cfg, now);
  L.open.net = L.open.atStart === null ? null : L.open.now - L.open.atStart;
  return L;
}

const line = (x: LedgerItem) => `- ${x.repo} ${x.id}${x.title ? ` ${x.title.slice(0, 60)}` : ""}${x.note ? ` — ${x.note.slice(0, 80)}` : ""}`;

export function renderLedger(L: Ledger): string {
  const out: string[] = [];
  const section = (name: string, items: string[]) => { if (items.length) out.push("", name, ...items); };
  section("LANDED (merged, main green)", L.landed.map(line));
  section("MAIN RED after merge", L.mainRed.map(line));
  section("MERGED, main not yet seen green", L.mergedNotGreen.map(line));
  section("ACCEPTED, not merged — yours to merge", L.acceptedNotMerged.map(line));
  section("BOUNCED", L.bounced.map((b) => `- ${b.repo} ${b.id} round ${b.rounds}${b.status ? ` · now ${b.status}` : ""}${b.last ? ` — last: ${b.last.slice(0, 80)}` : ""}`));
  section("ESCALATED — needs a rewrite, not another round", L.escalated.map(line));
  section("WAITING ON YOU", L.waiting.map(line));
  section("BLOCKED", L.blocked.map(line));
  section("ADDED TODAY", L.added.map((a) => `- ${a.repo} ${a.id} (${a.by})${a.title ? ` ${a.title.slice(0, 60)}` : ""}`));
  const net = L.open.net === null ? "" : ` (was ${L.open.atStart} this morning, net ${L.open.net >= 0 ? "+" : ""}${L.open.net})`;
  out.push("", `open work: ${L.open.now}${net}`);
  return out.join("\n").trim();
}

export function realLedgerDeps(): LedgerDeps {
  return {
    tickets: (cfg) => cfg.repos.flatMap((r) => { try { return tracker.list(r); } catch { return []; } }),
    hasParent: (cfg, repo, id) => {
      try {
        const rc = repoByName(cfg, repo);
        const me = tracker.get(rc, id);
        const born = me.created_at ? new Date(me.created_at).getTime() : 0;
        for (const dir of [[], ["--direction", "up"]]) {
          for (const t of tracker.deps(rc, id, dir)) {
            const at = t.created_at ? new Date(t.created_at).getTime() : 0;
            if (t.id !== id && at <= born) return true;
          }
        }
      } catch { /* no links */ }
      return false;
    },
  };
}
