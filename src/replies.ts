/**
 * The reply grammar Jaime types in Messages. One item per line.
 * Anything we cannot parse is treated as a message to Ambrosio, never guessed at.
 */

export type Reply =
  | { kind: "answer"; key: string; value: string; note?: string }
  | { kind: "plan"; key: string; decision: "ok" | "change"; note?: string }
  | { kind: "accept"; key: string; note?: string }
  | { kind: "reject"; key: string; note?: string }
  | { kind: "defer"; ticket: string }
  | { kind: "stop"; ticket: string }
  | { kind: "message"; ticket: string; text: string }
  | { kind: "status" }
  | { kind: "quiet"; until: string }
  | { kind: "pause"; reason?: string }
  | { kind: "resume" }
  | { kind: "unparsed"; text: string };

const ANSWER = /^q\s*[-.]?\s*(\d+)\s+([^\s:]+)\s*(?::\s*(.*))?$/i;
const PLAN = /^p\s*[-.]?\s*(\d+)\s+(ok|approve|approved|yes|change|changes|no)\s*(?::\s*(.*))?$/i;
const ACCEPT = /^a\s*[-.]?\s*(\d+)\s+(accept|accepted|ok|yes|reject|rejected|no)\s*(?::\s*(.*))?$/i;
const TICKET_CMD = /^(?:t[-\s]?)?([a-z0-9]+-[a-z0-9]+)\s+(defer|stop|park)$/i;
const MENTION = /^@\s*(?:t[-\s]?)?([a-z0-9]+-[a-z0-9]+)\s+(.+)$/i;
const QUIET = /^quiet(?:\s+until)?\s+(\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))$/i;

function clean(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

export function parseLine(raw: string): Reply | null {
  const line = raw.trim();
  if (line === "") return null;

  if (/^status$/i.test(line)) return { kind: "status" };
  const pausem = /^pause(?:\s*:\s*(.+))?$/i.exec(line);
  if (pausem) return pausem[1] ? { kind: "pause", reason: pausem[1].trim() } : { kind: "pause" };
  if (/^resume$/i.test(line)) return { kind: "resume" };
  if (/^(board|what'?s up)$/i.test(line)) return { kind: "status" };

  const quiet = QUIET.exec(line);
  if (quiet) return { kind: "quiet", until: quiet[1] };

  const mention = MENTION.exec(line);
  if (mention) return { kind: "message", ticket: mention[1], text: mention[2].trim() };

  const answer = ANSWER.exec(line);
  if (answer) return { kind: "answer", key: `Q${answer[1]}`, value: answer[2], note: clean(answer[3]) };

  const plan = PLAN.exec(line);
  if (plan) {
    const yes = /^(ok|approve|approved|yes)$/i.test(plan[2]);
    return { kind: "plan", key: `P${plan[1]}`, decision: yes ? "ok" : "change", note: clean(plan[3]) };
  }

  const accept = ACCEPT.exec(line);
  if (accept) {
    const yes = /^(accept|accepted|ok|yes)$/i.test(accept[2]);
    const key = `A${accept[1]}`;
    return yes ? { kind: "accept", key, note: clean(accept[3]) } : { kind: "reject", key, note: clean(accept[3]) };
  }

  const cmd = TICKET_CMD.exec(line);
  if (cmd) {
    const ticket = cmd[1];
    return /^stop$/i.test(cmd[2]) ? { kind: "stop", ticket } : { kind: "defer", ticket };
  }

  return { kind: "unparsed", text: line };
}

export function parseReplies(text: string): Reply[] {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((r): r is Reply => r !== null);
}

/** True when the whole message was free text, i.e. Jaime is talking to Ambrosio. */
export function isConversational(replies: Reply[]): boolean {
  return replies.length > 0 && replies.every((r) => r.kind === "unparsed");
}
