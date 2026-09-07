import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appleEpochToDate, messageText, parseAttributedBody, readInbound, recordSent } from "../src/inbox.ts";
import type { AmbrosioConfig } from "../src/config.ts";

const HANDLE = "+15550001111";

/**
 * A typedstream blob shaped exactly like the ones Messages writes:
 * … NSString \x01\x94\x84\x01 '+' <length> <utf8>
 */
function streamtyped(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const len: number[] =
    body.length < 0x80
      ? [body.length]
      : [0x81, body.length & 0xff, (body.length >> 8) & 0xff];
  const head = [
    0x04, 0x0b, ...[..."streamtyped"].map((c) => c.charCodeAt(0)),
    0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12,
    ...[..."NSAttributedString"].map((c) => c.charCodeAt(0)), 0x00,
    0x84, 0x84, 0x08, ...[..."NSObject"].map((c) => c.charCodeAt(0)), 0x00,
    0x85, 0x92, 0x84, 0x84, 0x84, 0x08,
    ...[..."NSString"].map((c) => c.charCodeAt(0)),
    0x01, 0x94, 0x84, 0x01, 0x2b, ...len,
  ];
  return new Uint8Array([...head, ...body, 0x86]);
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "ambrosio-inbox-"));
}

function tempDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), "ambrosio-chatdb-")), "chat.db");
  const db = new Database(path);
  db.run("CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT)");
  db.run(
    "CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, handle_id INTEGER)",
  );
  db.run("INSERT INTO handle (ROWID, id) VALUES (1, ?)", [HANDLE]);
  db.run("INSERT INTO handle (ROWID, id) VALUES (2, '+15559998888')");
  db.close();
  return path;
}

/** Apple epoch nanoseconds for a wall-clock time today. */
function appleNs(d: Date): number {
  return (d.getTime() - 978307200000) * 1_000_000;
}

function insert(
  dbPath: string,
  row: { rowid: number; handleId?: number; fromMe?: number; text?: string | null; body?: Uint8Array | null; at?: Date },
): void {
  const db = new Database(dbPath);
  db.run("INSERT INTO message (ROWID, text, attributedBody, date, is_from_me, handle_id) VALUES (?, ?, ?, ?, ?, ?)", [
    row.rowid,
    row.text ?? null,
    row.body ?? null,
    appleNs(row.at ?? new Date()),
    row.fromMe ?? 1,
    row.handleId ?? 1,
  ]);
  db.close();
}

function cfg(home: string): AmbrosioConfig {
  return { imessage: { handle: HANDLE }, homeDir: home } as AmbrosioConfig;
}

describe("parseAttributedBody", () => {
  test("decodes the short-string form Messages writes for a typed message", () => {
    expect(parseAttributedBody(streamtyped("status"))).toBe("status");
  });

  test("decodes a message long enough to need the two-byte length", () => {
    const long = "P2 change: ".padEnd(400, "x");
    expect(parseAttributedBody(streamtyped(long))).toBe(long);
  });

  test("keeps accented and non-ASCII text intact", () => {
    expect(parseAttributedBody(streamtyped("Ambrósio, está pronto? 👍"))).toBe("Ambrósio, está pronto? 👍");
  });

  test("returns null rather than guessing when the blob is not a typedstream", () => {
    expect(parseAttributedBody(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseAttributedBody(null)).toBeNull();
  });
});

describe("messageText", () => {
  test("prefers the text column when Messages populated it", () => {
    expect(messageText({ text: "from the column", attributedBody: streamtyped("from the blob") })).toBe("from the column");
  });

  test("falls back to attributedBody, which is the only copy in a self-chat", () => {
    expect(messageText({ text: null, attributedBody: streamtyped("status") })).toBe("status");
  });

  test("is empty when there is nothing to read", () => {
    expect(messageText({ text: null, attributedBody: null })).toBe("");
  });
});

describe("appleEpochToDate", () => {
  test("converts Apple epoch nanoseconds to a real date", () => {
    const d = new Date("2026-09-07T09:17:33.000Z");
    expect(appleEpochToDate(appleNs(d)).toISOString()).toBe(d.toISOString());
  });
});

describe("readInbound", () => {
  test("delivers what Jaime typed in the self-chat, even though it is is_from_me=1", () => {
    // The whole reason this module exists: on a Mac whose Apple ID is an email
    // but whose self-chat is a phone number, Messages never writes the
    // is_from_me=0 copy, so filtering on is_from_me drops every command.
    const home = tempHome();
    const db = tempDb();
    insert(db, { rowid: 1, fromMe: 1, text: null, body: streamtyped("status") });

    const got = readInbound(cfg(home), { dbPath: db });
    expect(got.map((m) => m.text)).toEqual(["status"]);
  });

  test("never reads Ambrosio's own digest back as a command", () => {
    const home = tempHome();
    const db = tempDb();
    recordSent(home, "Q1 What should the retry budget be?");
    insert(db, { rowid: 1, fromMe: 1, text: null, body: streamtyped("Q1 What should the retry budget be?") });
    insert(db, { rowid: 2, fromMe: 1, text: null, body: streamtyped("Q1 b") });

    expect(readInbound(cfg(home), { dbPath: db }).map((m) => m.text)).toEqual(["Q1 b"]);
  });

  test("delivers each message once, so a tick does not reprocess the last one", () => {
    const home = tempHome();
    const db = tempDb();
    insert(db, { rowid: 1, fromMe: 1, text: null, body: streamtyped("status") });

    expect(readInbound(cfg(home), { dbPath: db })).toHaveLength(1);
    expect(readInbound(cfg(home), { dbPath: db })).toHaveLength(0);

    insert(db, { rowid: 2, fromMe: 1, text: null, body: streamtyped("T-4 defer") });
    expect(readInbound(cfg(home), { dbPath: db }).map((m) => m.text)).toEqual(["T-4 defer"]);
  });

  test("ignores conversations with anyone other than Jaime himself", () => {
    const home = tempHome();
    const db = tempDb();
    insert(db, { rowid: 1, handleId: 2, fromMe: 0, text: "status", body: null });

    expect(readInbound(cfg(home), { dbPath: db })).toHaveLength(0);
  });

  test("accepts the is_from_me=0 copy on Macs that do write one, without duplicating it", () => {
    const home = tempHome();
    const db = tempDb();
    const at = new Date();
    insert(db, { rowid: 1, fromMe: 1, text: null, body: null, at });          // empty sent-receipt
    insert(db, { rowid: 2, fromMe: 0, text: null, body: streamtyped("status"), at });

    expect(readInbound(cfg(home), { dbPath: db }).map((m) => m.text)).toEqual(["status"]);
  });

  test("delivers one copy when a Mac writes the same message twice", () => {
    const home = tempHome();
    const db = tempDb();
    const at = new Date();
    insert(db, { rowid: 1, fromMe: 1, text: null, body: streamtyped("status"), at });
    insert(db, { rowid: 2, fromMe: 0, text: null, body: streamtyped("status"), at });

    expect(readInbound(cfg(home), { dbPath: db }).map((m) => m.text)).toEqual(["status"]);
  });

  test("skips blank rows: tapbacks and receipts synced from other devices", () => {
    const home = tempHome();
    const db = tempDb();
    insert(db, { rowid: 1, fromMe: 1, text: "   ", body: null });
    insert(db, { rowid: 2, fromMe: 1, text: null, body: null });

    expect(readInbound(cfg(home), { dbPath: db })).toHaveLength(0);
  });
});
