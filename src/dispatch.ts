import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbrosioConfig, RepoConfig } from "./config.ts";
import { repoByName } from "./config.ts";
import * as tracker from "./tracker.ts";
import type { Ticket } from "./tracker.ts";
import * as agents from "./agents.ts";
import * as journal from "./journal.ts";
import * as queue from "./queue.ts";
import { recentLessons } from "./review.ts";

export class DispatchError extends Error {}

export function workDirFor(cfg: AmbrosioConfig, repo: RepoConfig, ticketId: string): string {
  return join(cfg.homeDir, "work", repo.name, ticketId);
}

/** Fill the worker contract for one ticket. Nothing in here is optional prose: the worker reads it as its whole brief. */
export function renderWorkerPrompt(cfg: AmbrosioConfig, repo: RepoConfig, ticket: Ticket): string {
  const template = readFileSync(join(cfg.rootDir, "worker", "prompt.md"), "utf8");
  const meta = ticket.metadata ?? {};
  const verify: string[] = Array.isArray(meta.verify) ? meta.verify : meta.verify ? [String(meta.verify)] : [];
  const requiresPlanApproval = meta.plan_gate === true || meta.planning_path === "architectural";

  const planGate = requiresPlanApproval
    ? `This ticket requires plan approval. When the plan is written, run \`bd -C ${repo.path} update ${ticket.id} --status plan_review\`, add a one-paragraph summary with \`bd -C ${repo.path} comment ${ticket.id} "<summary>"\`, and end your turn. Do not write code until Ambrosio restarts you with Jaime's approval.`
    : `This ticket is bounded: write the plan, then continue straight into implementation without waiting.`;

  const replacements: Record<string, string> = {
    TICKET_ID: ticket.id,
    TITLE: ticket.title,
    REPO: repo.name,
    REPO_PATH: repo.path,
    DESCRIPTION: ticket.description?.trim() || "(no description beyond the title)",
    ACCEPTANCE: ticket.acceptance_criteria?.trim() || "(none recorded — treat the title as the criterion and say so in your plan)",
    VERIFY: verify.length > 0 ? verify.join("\n") : "(none recorded — use the repo's own test command and say which you chose)",
    SCOPE: meta.scope ? String(meta.scope) : "Only what the acceptance criteria require. Anything else is a new ticket.",
    DECISION_BUDGET: meta.decision_budget
      ? String(meta.decision_budget)
      : "Implementation details, file layout, naming inside the code, and test structure. Not product behaviour, not scope, not dependencies.",
    WORK_DIR: workDirFor(cfg, repo, ticket.id),
    PLAN_GATE: planGate,
    TURN_CAP: String(cfg.turnCap),
    // What Jaime asked to be done differently, from his end-of-day reviews.
    // This is how a lesson changes tomorrow instead of sitting in a file.
    LESSONS: (() => {
      const lessons = recentLessons(cfg, 5);
      return lessons.length === 0
        ? "(nothing recorded yet)"
        : lessons.map((l) => `- ${l.lesson}  (${l.date})`).join("\n");
    })(),
  };

  let out = template;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  const leftover = /\{\{([A-Z_]+)\}\}/.exec(out);
  if (leftover) throw new DispatchError(`worker prompt still has an unfilled placeholder: ${leftover[1]}`);
  return out;
}

export type DispatchDeps = {
  dispatch: typeof agents.dispatch;
  countBusy: () => number;
};

const realDeps: DispatchDeps = {
  dispatch: agents.dispatch,
  countBusy: () => agents.busy(agents.workers()).length,
};

export function dispatchTicket(
  cfg: AmbrosioConfig,
  repoName: string,
  ticketId: string,
  deps: DispatchDeps = realDeps,
): { id: string; name: string; promptPath: string } {
  const repo = repoByName(cfg, repoName);

  const busy = deps.countBusy();
  if (busy >= cfg.wipLimit) {
    throw new DispatchError(`WIP limit reached: ${busy}/${cfg.wipLimit} workers already running. Finish or park one first.`);
  }

  const ticket = tracker.get(repo, ticketId);
  if (!["open", "needs_input", "blocked", "plan_review"].includes(ticket.status)) {
    throw new DispatchError(`${ticketId} is ${ticket.status}; only open, needs_input, blocked or plan_review tickets can be dispatched.`);
  }

  const dir = journal.workDir(cfg.homeDir, repo.name, ticket.id);
  const prompt = renderWorkerPrompt(cfg, repo, ticket);
  const promptPath = join(dir, "prompt.md");
  Bun.write(promptPath, prompt);

  tracker.transition(repo, ticket.id, "planning", "Ambrosio: dispatched a worker");

  const result = deps.dispatch({
    cwd: repo.path,
    name: ticket.id,
    prompt,
    settings: join(cfg.rootDir, "worker", "settings.json"),
    permissionMode: "auto",
    env: {
      AMBROSIO_HOME: cfg.homeDir,
      AMBROSIO_TICKET: ticket.id,
      AMBROSIO_REPO: repo.name,
    },
  });

  // Resolve the full session UUID now; `answer` needs it and the short id will not do.
  const spawned = agents.workers().find((a) => a.id === result.id || a.name === ticket.id);
  const sessionId = spawned?.sessionId;
  tracker.setMeta(repo, ticket.id, { session: result.id, ...(sessionId ? { session_uuid: sessionId } : {}) });
  journal.recordSession(cfg.homeDir, repo.name, ticket.id, {
    id: result.id,
    sessionId,
    startedAt: new Date().toISOString(),
  });
  journal.append(cfg.homeDir, `dispatched ${repo.name} ${ticket.id} (${ticket.title}) as session ${result.id}`);

  return { ...result, promptPath };
}

/**
 * Record Jaime's answer and get it to the worker.
 *
 * The CLI, the watcher and the fleet view all answer questions, and all three
 * must do it identically: record it, deliver it, and only mark it delivered if
 * the worker actually took it.
 */
export function applyAnswer(
  cfg: AmbrosioConfig,
  qid: string,
  text: string,
  deliver: typeof deliverAnswer = deliverAnswer,
): { qid: string; ticket: string; repo: string; delivery: "resumed" | "deferred" } {
  const item = queue.get(cfg.homeDir, qid);
  if (!item) throw new DispatchError(`no such question: ${qid}`);

  queue.answer(cfg.homeDir, qid, text);
  const delivery = deliver(cfg, { ticket: item.ticket, repo: item.repo, sessionId: item.sessionId, text });
  if (delivery === "resumed") queue.markDelivered(cfg.homeDir, qid);

  return { qid, ticket: item.ticket, repo: item.repo, delivery };
}

/**
 * Hand over answers that were recorded while their worker was mid-turn.
 *
 * `deliverAnswer` refuses to resume a running session, because resuming one
 * forks it into a second worker on the same ticket. That leaves the answer
 * recorded but undelivered, and something has to come back for it — otherwise
 * answering from the phone or the fleet view silently does nothing whenever the
 * worker happened to be busy at that moment.
 */
export function deliverHeldAnswers(
  cfg: AmbrosioConfig,
  deliver: typeof deliverAnswer = deliverAnswer,
): { qid: string; ticket: string; repo: string }[] {
  const delivered: { qid: string; ticket: string; repo: string }[] = [];

  for (const item of queue.listAnswered(cfg.homeDir)) {
    if (!item.answer) continue;
    try {
      const how = deliver(cfg, { ticket: item.ticket, repo: item.repo, sessionId: item.sessionId, text: item.answer, quiet: true });
      if (how !== "resumed") continue;
      queue.markDelivered(cfg.homeDir, item.qid);
      journal.append(cfg.homeDir, `held answer for ${item.ticket} delivered (${item.qid})`);
      delivered.push({ qid: item.qid, ticket: item.ticket, repo: item.repo });
    } catch (e) {
      // A worker that died takes its answer nowhere; the rest still go.
      journal.append(cfg.homeDir, `held answer for ${item.ticket} could not be delivered: ${(e as Error).message}`);
    }
  }

  return delivered;
}

/**
 * Send an answer back to the worker that asked.
 *
 * `claude --bg --resume <id>` continues the session under the same id, but it
 * starts a *copy* if that session is still running. So a worker that is mid-turn
 * is never interrupted: its answer stays queued and the next tick delivers it
 * once the worker has parked. A working worker is making progress anyway.
 */
export function deliverAnswer(
  cfg: AmbrosioConfig,
  opts: { ticket: string; repo: string; sessionId?: string; text: string; quiet?: boolean },
  deps: { workers: () => agents.Agent[]; resume: typeof agents.resumeStopped } = { workers: agents.workers, resume: agents.resumeStopped },
): "resumed" | "deferred" {
  const repo = repoByName(cfg, opts.repo);
  const live = deps.workers().find((a) => a.name === opts.ticket);

  if (live?.state === "working") {
    // `quiet` is for the watcher's retry loop: it asks every few seconds, and
    // a line per attempt would bury the day's actual decisions.
    if (!opts.quiet) journal.append(cfg.homeDir, `answer for ${opts.ticket} held: worker is still running`);
    return "deferred";
  }

  // The full session UUID, never the short job id: the short id starts a copy.
  const id = live?.sessionId ?? opts.sessionId;
  if (!id) throw new DispatchError(`no session UUID found for ${opts.ticket}; dispatch it again instead`);

  const body = [
    `Ambrosio relaying Jaime's decision: ${opts.text}`,
    "",
    "Continue the ticket from where you stopped. Read your work directory first (plan.md, log.md, evidence.md) to remember what you already did, then carry on through verification and hand-over.",
  ].join("\n");

  // Stop before resuming: a merely-blocked session still has a live process, and
  // resuming a running session forks it into a second worker on the same ticket.
  deps.resume(live?.id, id, body, repo.path);
  tracker.transition(repo, opts.ticket, "in_progress", `Ambrosio: answer delivered — ${opts.text.slice(0, 200)}`);
  journal.append(cfg.homeDir, `answered ${opts.ticket} (resumed session ${id})`);
  return "resumed";
}
