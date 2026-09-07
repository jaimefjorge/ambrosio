import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";
import { todayKey } from "./journal.ts";

export class FocusError extends Error {}

/** What Jaime decided the day is for, before seeing anything else. */
export type Focus = {
  date: string;
  repos: string[];
  mission: string;
  setAt: string;
};

function focusPath(home: string): string {
  return join(home, "today.json");
}

/**
 * The focus is only valid for the day it was set. A stale one silently scoping
 * a new morning would hide work rather than help choose it.
 */
export function readFocus(cfg: AmbrosioConfig, now = new Date()): Focus | null {
  const f = focusPath(cfg.homeDir);
  if (!existsSync(f)) return null;
  try {
    const raw = JSON.parse(readFileSync(f, "utf8")) as Focus;
    return raw.date === todayKey(now) ? raw : null;
  } catch {
    return null;
  }
}

export function setFocus(
  cfg: AmbrosioConfig,
  input: { repos: string[]; mission: string },
  now = new Date(),
): Focus {
  const mission = (input.mission ?? "").trim();
  const repos = input.repos ?? [];

  const known = new Set(cfg.repos.map((r) => r.name));
  const unknown = repos.filter((r) => !known.has(r));
  if (unknown.length > 0) {
    throw new FocusError(`unknown project${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Known: ${[...known].join(", ")}`);
  }
  if (repos.length === 0 && mission === "") {
    throw new FocusError("Pick at least one project, or say what today is for.");
  }

  const focus: Focus = { date: todayKey(now), repos, mission, setAt: now.toISOString() };
  if (!existsSync(cfg.homeDir)) mkdirSync(cfg.homeDir, { recursive: true });
  writeFileSync(focusPath(cfg.homeDir), JSON.stringify(focus, null, 2));
  return focus;
}
