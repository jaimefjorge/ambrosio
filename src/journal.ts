import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function journalDir(home: string): string {
  const d = join(home, "journal");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function path(home: string, day = todayKey()): string {
  return join(journalDir(home), `${day}.md`);
}

/** One line per event. The journal is how tomorrow's Ambrosio learns what today decided. */
export function append(home: string, line: string, now = new Date()): void {
  const f = path(home, todayKey(now));
  if (!existsSync(f)) {
    appendFileSync(f, `# Ambrosio journal — ${todayKey(now)}\n\n`);
  }
  const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  appendFileSync(f, `- ${stamp} ${line}\n`);
}

export function read(home: string, day = todayKey()): string {
  const f = path(home, day);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

/** Per-ticket memory directory: plan.md, log.md, evidence.md, sessions.json. */
export function workDir(home: string, repo: string, ticket: string): string {
  const d = join(home, "work", repo, ticket);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function recordSession(home: string, repo: string, ticket: string, entry: { id: string; sessionId?: string; startedAt: string; prompt?: string }): void {
  const f = join(workDir(home, repo, ticket), "sessions.json");
  let all: unknown[] = [];
  if (existsSync(f)) {
    try { all = JSON.parse(readFileSync(f, "utf8")); } catch { all = []; }
  }
  all.push(entry);
  Bun.write(f, JSON.stringify(all, null, 2));
}
