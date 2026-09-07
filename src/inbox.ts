import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AmbrosioConfig } from "./config.ts";

export class InboxError extends Error {}

/** Messages stores dates as nanoseconds since 2001-01-01. */
const APPLE_EPOCH_MS = 978_307_200_000;

/** How far back the very first read looks, before a cursor exists. */
const FIRST_RUN_WINDOW_MS = 15 * 60 * 1000;

/** How long a sent digest stays known, so it is never read back as a command. */
const ECHO_TTL_MS = 30 * 60 * 1000;

/** Two copies of one message (Macs that write the is_from_me=0 loopback) land this close. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export type InboundMessage = {
  rowid: number;
  text: string;
  at: Date;
  fromMe: boolean;
};

type State = { cursor?: number; sent: { h: string; at: number }[] };

export function appleEpochToDate(ns: number): Date {
  return new Date(ns / 1_000_000 + APPLE_EPOCH_MS);
}

function defaultDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

/**
 * Pull the text out of a typedstream NSAttributedString.
 *
 * Modern macOS leaves `message.text` NULL and puts the body here. The layout is
 * stable and shallow enough to read directly:
 *
 *   … NSString \x01\x94\x84\x01 '+' <length> <utf8 bytes> \x86
 *
 * `length` is one byte below 0x80, otherwise 0x81 introduces two little-endian
 * bytes and 0x82 introduces four. Anything that does not match returns null, so
 * a format change surfaces as "no text" rather than as mojibake.
 */
export function parseAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length === 0) return null;
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);

  const marker = indexOfBytes(bytes, new TextEncoder().encode("NSString"));
  if (marker < 0) return null;

  const plus = bytes.indexOf(0x2b, marker);
  if (plus < 0) return null;

  let i = plus + 1;
  if (i >= bytes.length) return null;
  let length = bytes[i++];
  if (length === 0x81) {
    if (i + 1 >= bytes.length) return null;
    length = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
  } else if (length === 0x82) {
    if (i + 3 >= bytes.length) return null;
    length = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    i += 4;
  } else if (length >= 0x80) {
    return null;
  }

  if (length <= 0 || i + length > bytes.length) return null;
  return new TextDecoder().decode(bytes.slice(i, i + length));
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** The text column when Messages filled it, the blob when it did not. */
export function messageText(row: { text: string | null; attributedBody: Uint8Array | null }): string {
  return row.text ?? parseAttributedBody(row.attributedBody) ?? "";
}

/** Whitespace is not meaningful for matching a digest against its echo. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function statePath(home: string): string {
  return join(home, "inbox.json");
}

function readState(home: string): State {
  const f = statePath(home);
  if (!existsSync(f)) return { sent: [] };
  try {
    const raw = JSON.parse(readFileSync(f, "utf8"));
    return { cursor: raw.cursor, sent: Array.isArray(raw.sent) ? raw.sent : [] };
  } catch {
    // A half-written state file must not wedge the inbox; start clean.
    return { sent: [] };
  }
}

function writeState(home: string, state: State): void {
  if (!existsSync(home)) mkdirSync(home, { recursive: true });
  writeFileSync(statePath(home), JSON.stringify(state, null, 2));
}

/**
 * Remember something Ambrosio sent. Its own digests come back from Messages as
 * is_from_me=1 rows in the same self-chat, indistinguishable from what Jaime
 * types, so without this the manager would answer its own questions forever.
 */
export function recordSent(home: string, text: string, now = new Date()): void {
  const state = readState(home);
  state.sent = [...state.sent, { h: normalize(text), at: now.getTime() }].filter(
    (s) => now.getTime() - s.at < ECHO_TTL_MS,
  );
  writeState(home, state);
}

export type ReadOptions = { dbPath?: string; now?: Date };

/**
 * Everything Jaime has sent in the self-chat since the last read.
 *
 * This exists because the iMessage channel plugin drops these messages. It
 * assumes a self-chat echoes back as is_from_me=0 and filters is_from_me=1 as
 * its own sends; on a Mac whose Apple ID is an email but whose self-chat is a
 * phone number, Messages never writes that second copy, so every command was
 * being discarded silently.
 */
export function readInbound(cfg: AmbrosioConfig, opts: ReadOptions = {}): InboundMessage[] {
  const handle = cfg.imessage.handle;
  if (!handle) {
    throw new InboxError(
      "No iMessage handle configured. Set imessage.handle in ambrosio.config.json to the number you text yourself with.",
    );
  }
  const dbPath = opts.dbPath ?? defaultDbPath();
  const now = opts.now ?? new Date();
  const state = readState(cfg.homeDir);

  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e) {
    throw new InboxError(
      `cannot open the Messages database at ${dbPath}: ${(e as Error).message}. ` +
        `Give your terminal Full Disk Access (System Settings -> Privacy & Security), then restart it.`,
    );
  }

  try {
    // No cursor yet means a first run: look back a little rather than replaying
    // years of history. Afterwards the cursor alone decides, so nothing is
    // missed however long Ambrosio was down.
    const firstRun = state.cursor === undefined;
    const cutoffNs = (now.getTime() - FIRST_RUN_WINDOW_MS - APPLE_EPOCH_MS) * 1_000_000;
    const rows = db
      .query(
        `SELECT m.ROWID AS rowid, m.text AS text, m.attributedBody AS body, m.date AS date, m.is_from_me AS fromMe
         FROM message m JOIN handle h ON m.handle_id = h.ROWID
         WHERE lower(h.id) = lower($handle) AND m.ROWID > $cursor ${firstRun ? "AND m.date >= $cutoff" : ""}
         ORDER BY m.ROWID`,
      )
      .all(
        firstRun
          ? { $handle: handle, $cursor: state.cursor ?? 0, $cutoff: cutoffNs }
          : { $handle: handle, $cursor: state.cursor ?? 0 },
      ) as { rowid: number; text: string | null; body: Uint8Array | null; date: number; fromMe: number }[];

    const fresh = state.sent.filter((s) => now.getTime() - s.at < ECHO_TTL_MS);
    const echoes = new Set(fresh.map((s) => s.h));

    const out: InboundMessage[] = [];
    let cursor = state.cursor ?? 0;
    for (const r of rows) {
      cursor = Math.max(cursor, r.rowid);
      const text = messageText({ text: r.text, attributedBody: r.body });
      if (!text.trim()) continue;                       // tapbacks and sent-receipts
      const key = normalize(text);
      if (echoes.has(key)) continue;                    // Ambrosio's own digest
      const at = appleEpochToDate(r.date);
      // Some Macs write both an is_from_me=1 and an is_from_me=0 copy of the
      // same message. Deliver it once.
      if (out.some((m) => normalize(m.text) === key && Math.abs(m.at.getTime() - at.getTime()) < DUPLICATE_WINDOW_MS)) {
        continue;
      }
      out.push({ rowid: r.rowid, text, at, fromMe: r.fromMe === 1 });
    }

    writeState(cfg.homeDir, { cursor, sent: fresh });
    return out;
  } finally {
    db.close();
  }
}
