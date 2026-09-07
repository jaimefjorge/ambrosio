import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Action } from "./watch.ts";

/**
 * The dialog's store. Split from the dialog itself so the board, the digest
 * and `ask` can read standing instructions without importing the routing that
 * imports them — a cycle that would otherwise run board → dialog → ask → ui →
 * board.
 */
export type EntryKind = "action" | "question" | "instruction" | "note";

export type Entry = {
  id: string;
  at: string;
  from: "jaime" | "ambrosio";
  text: string;
  kind: EntryKind;
  /** True for an instruction still in force. */
  standing?: boolean;
  retiredAt?: string;
  /** For an Ambrosio reply: whether what it describes actually happened. */
  ok?: boolean;
  actions?: Action[];
  /** The Jaime entry this reply answers. */
  inReplyTo?: string;
};

const file = (home: string) => join(home, "dialog.json");

export function readDialog(home: string): Entry[] {
  const f = file(home);
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Entry[];
  } catch {
    return [];
  }
}

export function writeDialog(home: string, entries: Entry[]): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(file(home), JSON.stringify(entries, null, 2));
}

/** Instructions still in force, oldest first. */
export function standing(home: string): Entry[] {
  return readDialog(home).filter((e) => e.from === "jaime" && e.kind === "instruction" && e.standing && !e.retiredAt);
}

export function retire(home: string, id: string, now = new Date()): boolean {
  const all = readDialog(home);
  const e = all.find((x) => x.id === id && x.standing && !x.retiredAt);
  if (!e) return false;
  e.standing = false;
  e.retiredAt = now.toISOString();
  writeDialog(home, all);
  return true;
}
