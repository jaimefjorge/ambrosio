import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type QueueKind = "question" | "permission";

export type QuestionOption = { label: string; description?: string };
export type QueueQuestion = { question: string; header?: string; options?: QuestionOption[]; multiSelect?: boolean };

export type QueueItem = {
  qid: string;
  kind: QueueKind;
  ticket: string;
  repo: string;
  sessionId: string;
  cwd: string;
  questions?: QueueQuestion[];
  tool?: string;
  summary?: string;
  urgent: boolean;
  status: "open" | "answered" | "delivered";
  hash: string;
  createdAt: string;
  answer?: string;
  answeredAt?: string;
  deliveredAt?: string;
};

function queueDir(home: string): string {
  const d = join(home, "queue");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function listAll(home: string): QueueItem[] {
  const d = queueDir(home);
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(d, f), "utf8")) as QueueItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is QueueItem => x !== null)
    // Stable order: two questions recorded in the same millisecond still sort deterministically.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.qid.localeCompare(b.qid));
}

export function listOpen(home: string): QueueItem[] {
  return listAll(home).filter((q) => q.status === "open");
}

export function listUrgentOpen(home: string): QueueItem[] {
  return listOpen(home).filter((q) => q.urgent);
}

export function get(home: string, qid: string): QueueItem | null {
  const f = join(queueDir(home), `${qid}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as QueueItem;
  } catch {
    return null;
  }
}

function save(home: string, item: QueueItem): void {
  writeFileSync(join(queueDir(home), `${item.qid}.json`), JSON.stringify(item, null, 2));
}

/** Record Jaime's answer. The item stays until a worker has actually received it. */
export function answer(home: string, qid: string, text: string): QueueItem {
  const item = get(home, qid);
  if (!item) throw new Error(`no such question: ${qid}`);
  const updated: QueueItem = { ...item, status: "answered", answer: text, answeredAt: new Date().toISOString() };
  save(home, updated);
  return updated;
}

export function markDelivered(home: string, qid: string): QueueItem {
  const item = get(home, qid);
  if (!item) throw new Error(`no such question: ${qid}`);
  const updated: QueueItem = { ...item, status: "delivered", deliveredAt: new Date().toISOString() };
  save(home, updated);
  return updated;
}

export function listAnswered(home: string): QueueItem[] {
  return listAll(home).filter((q) => q.status === "answered");
}

/** One-line human summary of what is being asked. */
export function summarize(item: QueueItem): string {
  if (item.kind === "permission") return `needs permission for ${item.tool ?? "a tool"}: ${(item.summary ?? "").slice(0, 120)}`;
  return item.questions?.[0]?.question ?? "(no question text)";
}

export function optionLabels(item: QueueItem): string[] {
  return item.questions?.[0]?.options?.map((o) => o.label) ?? [];
}
