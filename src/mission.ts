import type { AmbrosioConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import { readFocus } from "./today.ts";

/**
 * The mission map. Every ticket hangs off the mission through the chain of
 * what it was discovered from, and each node says why it exists: the title
 * of the work that surfaced it. Work from before the mission is shown apart;
 * work that hangs off nothing is flagged rather than hidden. Closed and
 * deferred tickets stay on the map, marked, so the shape of the day is
 * not lost when it is done.
 */
export type MapNode = {
  id: string; repo: string; title: string; status: string; priority: number;
  depth: number;
  /** Why this exists, in one line. */
  why: string;
  children: MapNode[];
};

export type MissionMap = {
  mission: string | null;
  date: string | null;
  roots: MapNode[];
  earlier: MapNode[];
  orphans: MapNode[];
};

export function buildMap(
  focus: { mission: string; date: string } | null,
  tickets: Ticket[],
  parentsOf: (id: string) => string[],
): MissionMap {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const parentOf = new Map<string, string | null>();
  for (const t of tickets) {
    const ps = parentsOf(t.id).filter((p) => byId.has(p) && p !== t.id);
    parentOf.set(t.id, ps[0] ?? null);
  }
  const children = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const p = parentOf.get(t.id);
    if (p) children.set(p, [...(children.get(p) ?? []), t]);
  }
  const byPriority = (a: Ticket, b: Ticket) => (a.priority ?? 9) - (b.priority ?? 9) || (a.created_at ?? "").localeCompare(b.created_at ?? "");

  const seen = new Set<string>();
  const node = (t: Ticket, depth: number, why: string): MapNode => {
    seen.add(t.id);
    const kids = (children.get(t.id) ?? []).filter((k) => !seen.has(k.id)).sort(byPriority);
    return {
      id: t.id, repo: t.repo ?? "", title: t.title, status: t.status, priority: t.priority, depth, why,
      children: kids.map((k) => node(k, depth + 1, `found while doing ${t.id}: ${t.title}`)),
    };
  };

  const dayStart = focus ? new Date(`${focus.date}T00:00:00`) : null;
  const roots: MapNode[] = [];
  const earlier: MapNode[] = [];
  for (const t of [...tickets].sort(byPriority)) {
    if (parentOf.get(t.id) || seen.has(t.id)) continue;
    const created = t.created_at ? new Date(t.created_at) : null;
    const fromBefore = dayStart && created && created < dayStart;
    const n = node(t, 0, fromBefore ? "from before today's mission" : focus ? "planned for the mission" : "planned");
    (fromBefore ? earlier : roots).push(n);
  }
  // Anything left is inside a cycle: show it flat rather than lose it.
  const orphans = tickets.filter((t) => !seen.has(t.id)).sort(byPriority).map((t) => node(t, 0, "linked in a loop; hangs off nothing"));
  return { mission: focus?.mission ?? null, date: focus?.date ?? null, roots, earlier, orphans };
}

/** Parents by creation order, direction-agnostic — the same reading rule 4 uses. */
export function realParentsOf(cfg: AmbrosioConfig, repo: string): (id: string) => string[] {
  const rc = repoByName(cfg, repo);
  const cache = new Map<string, string[]>();
  return (id) => {
    if (cache.has(id)) return cache.get(id)!;
    const out: string[] = [];
    try {
      const me = tracker.get(rc, id);
      const born = me.created_at ? new Date(me.created_at).getTime() : 0;
      for (const dir of [[], ["--direction", "up"]]) {
        try {
          for (const t of tracker.deps(rc, id, dir)) {
            const type = String((t as any).dependency_type ?? "").toLowerCase();
            if (type && type !== "discovered-from") continue;
            const at = t.created_at ? new Date(t.created_at).getTime() : 0;
            if (t.id !== id && at <= born) out.push(t.id);
          }
        } catch { /* no links this way */ }
      }
    } catch { /* unreadable ticket: a root */ }
    cache.set(id, out);
    return out;
  };
}

export function missionMap(cfg: AmbrosioConfig, now = new Date()): MissionMap {
  const focus = readFocus(cfg, now);
  const tickets = cfg.repos.flatMap((r) => { try { return tracker.list(r); } catch { return []; } });
  const lookups = new Map(cfg.repos.map((r) => [r.name, realParentsOf(cfg, r.name)]));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return buildMap(focus ? { mission: focus.mission, date: focus.date } : null, tickets, (id) => {
    const t = byId.get(id);
    const look = t?.repo ? lookups.get(t.repo) : undefined;
    return look ? look(id) : [];
  });
}
