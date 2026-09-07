import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type EventKind = "text" | "thinking" | "tool_use" | "tool_result";

export type Event = {
  at?: string;
  kind: EventKind;
  tool?: string;
  summary: string;
  isError?: boolean;
};

/** Enough to see what happened; not so much that the browser chokes. */
const MAX_SUMMARY = 600;

function trim(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY)}…` : flat;
}

/**
 * The part of a tool call worth reading at a glance: the command, the file, the
 * pattern. Falls back to the first string value rather than showing nothing.
 */
export function summarizeToolInput(tool: string, input: Record<string, any> | undefined): string {
  if (!input) return "";
  const preferred = ["command", "file_path", "pattern", "path", "prompt", "url", "description"];
  for (const k of preferred) {
    if (typeof input[k] === "string" && input[k].trim()) return trim(input[k]);
  }
  const first = Object.values(input).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? trim(first) : "";
}

function resultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : b?.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Flatten a session transcript into an activity feed.
 *
 * Claude Code writes one JSON object per line, most of them bookkeeping
 * (worktree state, permission mode, titles). Only the assistant and user
 * entries carry what the worker actually did.
 */
export function eventsFrom(rows: any[], limit = 60): Event[] {
  const events: Event[] = [];

  for (const row of rows) {
    if (!row || (row.type !== "assistant" && row.type !== "user")) continue;
    const content = row.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const at = row.timestamp;

      if (block.type === "text" && block.text?.trim()) {
        events.push({ at, kind: "text", summary: trim(block.text) });
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        events.push({ at, kind: "thinking", summary: trim(block.thinking) });
      } else if (block.type === "tool_use") {
        events.push({ at, kind: "tool_use", tool: block.name, summary: summarizeToolInput(block.name, block.input) });
      } else if (block.type === "tool_result") {
        events.push({ at, kind: "tool_result", summary: trim(resultText(block.content)), isError: block.is_error === true });
      }
    }
  }

  return events.slice(-limit);
}

/** `/a/b/.c` becomes `-a-b--c`, which is how Claude Code names project directories. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/**
 * Locate a session's transcript. The directory name is derived from the
 * session's cwd, but a worker that moved into a worktree has a cwd that no
 * longer matches, so fall back to looking for the file by name.
 */
export function findTranscript(sessionId: string, cwd?: string): string | null {
  const root = projectsDir();
  if (cwd) {
    const guess = join(root, encodeCwd(cwd), `${sessionId}.jsonl`);
    if (existsSync(guess)) return guess;
  }
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const f = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/**
 * When a session last did anything, from its transcript's mtime.
 *
 * Costs one stat, so it is cheap enough for every board read, where parsing a
 * transcript of hundreds of kilobytes would not be. The file is also touched by
 * bookkeeping entries, not only by real output, so this errs towards saying a
 * session is alive — which is the safe direction for something that raises an
 * alarm.
 */
export function lastActivityAt(sessionId: string, cwd?: string): Date | null {
  const file = findTranscript(sessionId, cwd);
  if (!file) return null;
  try {
    return statSync(file).mtime;
  } catch {
    return null;
  }
}

export function readTranscript(sessionId: string, cwd?: string, limit = 60): Event[] {
  const file = findTranscript(sessionId, cwd);
  if (!file) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const rows = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      // A live transcript can end mid-write; that line is simply not ready yet.
      return null;
    }
  });
  return eventsFrom(rows, limit);
}
