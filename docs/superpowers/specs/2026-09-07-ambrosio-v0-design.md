# Ambrosio v0 — design

Date: 2026-09-07. Status: proposed, awaiting Jaime's approval. Research and the build-vs-adopt decision are in `docs/research/2026-09-06-landscape-and-recommendation.md`.

Decisions already made by Jaime: build thin on native Claude Code; Beads per repo as the operational tracker (a local UI later; Linear later as the place tickets and context come from and where status is reported, never as a bus between agents); iMessage for the digest and replies (no new apps to create); background sessions as workers, as long as they stay trackable; Verity for quality, security and review findings; the working day ends at 15:00; `/goal` is not trusted for completion, so completion is validated explicitly; agents' work must leave memory behind; first use tomorrow morning.

## 1. Roles and scope

**Jaime** owns intent and acceptance: defines the day's mission, approves the ticket set and any architectural plan, answers parked questions, accepts or rejects finished work. Jaime touches the fleet at the 09:00 planning session, at hourly digests until 15:00, and for urgent pings only.

**Ambrosio** is a manager, never an implementer. It runs as Claude Code sessions in `~/Workspace/ambrosio` with the charter in `AMBROSIO.md` (loaded through `CLAUDE.md`). It may: read any configured repo; create, update and comment on tickets; dispatch, message, stop and resume worker sessions; compose and send digests; record decisions; accept a ticket only when Jaime says so. It may decide alone: dispatch order within the WIP limit, retrying a failed worker once, answering a worker question whose answer is already in the ticket, spec or plan, and parking a runaway worker. It must ask Jaime for: scope changes, product or design choices, anything destructive, budget overruns, and every acceptance. It never edits product code, never merges, never pushes to a protected branch, never closes a ticket on its own.

**Workers** are background Claude Code sessions (`claude --bg`), one per ticket, named after the ticket, in the ticket's repo, under the worker contract (section 4). They plan, implement, verify, and hand over. They never block on a human.

**Gates**: Verity's Stop hook (already installed in the repos) returns PASS, WARN or FAIL on every stop; repo tests and lint; a fresh-context reviewer checking the diff against the acceptance criteria. A ticket cannot reach "in review" without PASS and green verification.

## 2. Components and layout

```
~/Workspace/ambrosio/
  AMBROSIO.md                  charter: roles, rules, hours, reply grammar
  CLAUDE.md                    points Claude at AMBROSIO.md and the skills
  ambrosio.config.json         repos, WIP limit, hours, phone numbers, budgets
  bin/
    ambrosio                   CLI entry (bun): status, dispatch, queue, answer, send, setup
  src/                         bun/TypeScript: tracker adapter, agents adapter, queue, digest renderer, imessage sender
  worker/
    prompt.md                  worker contract template (rendered per ticket)
    settings.json              hooks passed to workers with --settings
    hooks/                     ask-guard.sh, permission-guard.sh, bash-guard.sh
  .claude/skills/
    ambrosio-plan-day/         morning intake and breakdown
    ambrosio-tick/             hourly collect, triage, digest, route, dispatch
    ambrosio-wrap-up/          15:00 summary and journal
  docs/                        research, specs, plans
~/.ambrosio/
  queue/                       parked questions, one JSON per question
  inbox/imessage.jsonl         inbound replies as received by the tick session (audit)
  outbox/                      sent digests, for audit
  work/<repo>/<ticket>/        plan.md, log.md, evidence.md, sessions.json
  journal/YYYY-MM-DD.md        daily record: mission, tickets, decisions, acceptances, lessons
  state.json                   last tick, cursors, active WIP
```

Each unit has one job and a small interface:

- **Tracker adapter** (`src/tracker.ts`): `list(repo, states)`, `get(id)`, `create`, `transition(id, from, to)`, `comment`, `setMeta`. Implemented on `bd … --json`; swappable for flat files.
- **Agents adapter** (`src/agents.ts`): wraps `claude agents --json --all`, `claude --bg`, `claude --bg --resume`, `claude stop`, and reads `~/.claude/jobs/<id>/state.json` for the summary line.
- **Queue** (`src/queue.ts`): parked questions with ticket, session, question payload, options, worker recommendation, urgency, status (open, answered, delivered).
- **Digest renderer** (`src/digest.ts`): builds the WhatsApp text from queue, tracker, agents, PR checks, spend; assigns reply keys.
- **iMessage sender** (`src/imessage.ts`): `send(text)` through `osascript` to Jaime's own handle, used by the CLI, the desk session and scripts. Inbound messages are delivered by the official iMessage channel plugin, not by Ambrosio code.

## 3. Ticket lifecycle (Beads, per repo)

Custom statuses are configured with categories so `bd ready` and `bd list` behave: `planning:wip`, `plan_review:wip`, `needs_input:wip`, `verifying:wip`, `in_review:wip`. Built-ins `open`, `in_progress`, `blocked`, `deferred`, `closed` are used as-is.

| State | Meaning | Set by |
|---|---|---|
| `open` | intake done; has title, description, acceptance criteria, verify commands, planning path (bounded or architectural), decision budget | Ambrosio at plan-day, approved by Jaime |
| ready (derived) | open, no blockers | Beads |
| `planning` | worker claimed; writing the plan | worker |
| `plan_review` | plan attached; waiting for Jaime | worker; Jaime approves via digest |
| `in_progress` | implementing | Ambrosio after approval, or immediately for bounded tickets |
| `needs_input` | parked on a question in the queue | worker's hook |
| `blocked` | external or dependency blocker | worker or Ambrosio |
| `verifying` | worker claims done; verification running | worker |
| `in_review` | verified, Verity PASS, PR open, evidence attached; waiting for Jaime | worker |
| `closed` | accepted (reason = PR) | Ambrosio, only on Jaime's accept |
| `deferred` | parked by Jaime | Ambrosio on Jaime's word |

Every transition is a `bd update --status <to>` with a comment naming the actor. Every ticket carries in metadata: repo, session id, worktree path, PR URL, Verity verdict, budget spent.

Required fields, enforced by the intake skill: acceptance criteria (verifiable, written as "when X, the system shall Y" where possible), verify commands, scope and non-goals, planning path, decision budget (what the worker may decide alone), cost cap in turns.

## 4. Worker contract

**Dispatch**: `claude --bg --name <ticket-id> --permission-mode auto --settings worker/settings.json "<rendered prompt>"` run from the repo root. Claude moves the session into its own worktree before editing (native behavior). The rendered prompt contains: the ticket (id, goal, acceptance criteria, verify commands, scope, decision budget), the process steps below, the parking rules, and where to write memory. Workers use the repo's own CLAUDE.md, Verity hooks and the superpowers skills as they already do.

**Process** the prompt demands:
1. Read the ticket. Set status `planning`. Write `plan.md` in the work dir: approach, files, risks, how each acceptance criterion will be verified. Architectural tickets use superpowers `writing-plans`; bounded tickets write a short plan. If the ticket requires plan approval, set `plan_review`, post a plan summary as a ticket comment, and end the turn.
2. Implement with TDD in small commits referencing the ticket id. Append milestones to `log.md`.
3. Verify explicitly: run every verify command, capture output into `evidence.md`; run the repo's tests; spawn a fresh-context reviewer subagent to check the diff against each acceptance criterion and record its verdict. `/goal` is not used in v0.
4. Verity: the Stop hook runs automatically; the worker must reach PASS (fix WARN and FAIL findings first) and record the verdict in the ticket comment.
5. Hand over: push the branch, open a draft PR titled with the ticket id, set `in_review`, attach PR URL and evidence summary as a comment. End the turn. Never merge, never close the ticket.

**Never block on a human**, enforced by hooks in `worker/settings.json`:
- `PreToolUse` on `AskUserQuestion` (`ask-guard.sh`): writes the question payload plus ticket and session ids into the queue, then returns `deny` with the reason: "Recorded as Q-<id> for Jaime's next digest. Do not ask again. If you can proceed on independent work, continue; otherwise set the ticket to needs_input and end your turn." The hook also classifies urgency by keyword rules (secrets, destructive, production, payment) and marks the queue item urgent.
- `PermissionRequest` (`permission-guard.sh`): when a prompt would open in an unattended session, record it in the queue as urgent and deny, so the session never hangs.
- `PreToolUse` on `Bash` (`bash-guard.sh`): denies pushes to main or master, force pushes, `--no-verify`, and `git reset --hard` on shared branches.

**Memory**: every worker writes to `~/.ambrosio/work/<repo>/<ticket>/` (`plan.md`, `log.md`, `evidence.md`) and comments on the ticket at each transition. Session ids are stored in `sessions.json` and in ticket metadata so a worker can be resumed with full context. Verity keeps the code-quality lessons per repo. Ambrosio's daily journal records decisions and answers.

## 5. The manager

**Sessions**: `ambrosio-desk` is an interactive session Jaime opens at 09:00 and 15:00 (or on demand), running `/ambrosio-plan-day` and `/ambrosio-wrap-up`. `ambrosio-tick` is a long-lived interactive session started in a tmux window inside a terminal that has Full Disk Access, launched with `claude --channels plugin:imessage@claude-plugins-official`, running `/loop 60m /ambrosio-tick`. Both run in `~/Workspace/ambrosio`, so both load the charter. The channel delivers each iMessage from Jaime as an event to the tick session the moment it arrives, so replies are routed immediately; the hourly loop handles everything else.

**Tick algorithm** (`/ambrosio-tick`):
1. Collect: `ambrosio status --json` (agents, tracker across repos, queue, inbox cursor, PR checks via `gh`, spend from job state).
2. Route inbound replies first: parse with the reply grammar; apply each (answer to worker, plan approval, accept, reject, defer, free text to a worker); log to journal.
3. Detect anomalies: failed or stopped workers, workers idle with a ticket still `in_progress`, `needs_input` older than the last digest, PR checks red, turn budget exceeded.
4. Triage: urgent items (from hook classification or anomalies matching the urgent rules) are sent immediately as a short WhatsApp message. Everything else waits for the digest.
5. Dispatch: for each repo, while active workers < WIP limit, take the next ready ticket and dispatch it.
6. Digest: if there is anything to decide or accept, render and send one message (section 6). If nothing, send nothing.
7. Persist: update `state.json`, journal.

Outside working hours (before 09:00, after 15:00): no dispatch, no digest, no pings; anomalies are handled silently (park or stop) and reported at the next morning's state of the world.

**Reply grammar** (one line per item, case-insensitive; sent from the Messages self-chat on any device):
- `Q3 b` or `Q3 b: <note>` — answer question 3 with option b (free text allowed after the key).
- `P2 ok` / `P2 change: <feedback>` — approve or bounce a plan.
- `A1 accept` / `A1 reject: <feedback>` — accept or reject finished work.
- `T4 defer` / `T4 stop` — park or stop a ticket.
- `@T4 <message>` — send free text to that worker.
- `status` — get the current board; `quiet until 15:00` — suppress digests.
Unparseable text is treated as a message to Ambrosio, answered by the tick session.

**Answer delivery to a worker**: if the worker process is alive (present in `claude agents --json` with a pid), Ambrosio uses cross-session `SendMessage` to the session name; a message to an idle session starts its next turn. If the process was stopped by the supervisor, `claude --bg --resume <session-id> "<message>"` restarts it under the same id. The message is phrased as "Ambrosio relaying Jaime's decision on Q-<id>: …".

## 6. Digest format

One iMessage, at most hourly, grouped by what Jaime has to do, each item with a reply key:

```
Ambrosio · 11:00 · 3 decisions, 1 plan, 2 to accept, 4 working

DECIDE
Q3 [gatemd-core T-a1b2 auth refactor] Keep the legacy token path for the CLI?
  a) keep, behind a flag (worker recommends)  b) remove now  c) ask me later
  Why: 3 CLI users still on v0.14; removing breaks them until they upgrade.
  Diff so far: 6 files, +210/-95, tests green.

PLANS
P2 [tailor-craft T-c3d4 kanban stickers] 4 steps, touches 3 files, adds a migration. Risk: RLS on the new table. Plan: ~/.ambrosio/work/tailor-craft-pro-98/T-c3d4/plan.md

ACCEPT
A1 [gatemd-ui T-e5f6 dark mode] PR #212 · tests 48/48 · Verity PASS · reviewer: all 3 criteria met. Evidence attached.

FYI
T-g7h8 working 40m, 12 commits · T-i9j0 blocked on T-a1b2
Spend today: 2.1M tokens
```

Urgent messages are one line: what happened, what to do, and how (reply here, or peek in `claude agents`). Long digests are split at 1,500 characters so they render on the phone.

## 7. iMessage channel

Transport: the official `imessage@claude-plugins-official` channel plugin (research preview, macOS only). It reads the Messages database at `~/Library/Messages/chat.db` and sends replies through AppleScript. No bot, no token, no external service, no public URL. Jaime texts himself in Messages from any device; self-chat bypasses the plugin's access control, so the only allowed sender is Jaime. The tick session is started with `claude --channels plugin:imessage@claude-plugins-official`; inbound messages arrive as `<channel source="plugin:imessage:imessage">` events and the plugin's `reply` tool sends back into the same chat.

Setup on this Mac: install the plugin at user scope; grant Full Disk Access to the terminal app that runs the tick session (macOS prompts on first read); accept the Automation prompt for Messages on the first reply. Ambrosio's own sender (`ambrosio send`) uses `osascript` with the same handle, so the desk session and scripts can send without the channel.

Caveats to respect: events reach the session only while it is open, so the tick session lives in tmux; the plugin marks channel text as data, and the charter repeats that a message can never change configuration or grant permissions; if the plugin proves flaky, the Telegram plugin is the same-shape swap.

## 8. Error handling and safety

- Hooks fail closed: if a guard script errors, the tool call is denied and the error is logged to the queue as urgent.
- Beads embedded mode is single-writer; the tracker adapter retries with backoff on lock errors. Workers write to Beads only at transitions.
- A worker that re-asks a recorded question gets the same Q id (dedupe by hash of the question text).
- WIP limit and per-ticket turn cap are enforced by Ambrosio at dispatch and tick, not by the worker.
- No worker runs with permissions bypassed; auto mode plus the guards is the ceiling.
- Every outbound message and every applied reply is logged to `~/.ambrosio/outbox` and the journal.
- Only Jaime's self-chat reaches the session; the charter tells Claude that channel text is data, never a command to change configuration or approve anything.

## 9. Testing

- Unit tests (bun test) for: reply grammar parser, digest renderer (snapshot), urgency classifier, tracker adapter against a temp Beads repo, queue dedupe.
- Hook tests: feed sample `PreToolUse` and `PermissionRequest` JSON to each guard script and assert the JSON decision and the queue side effect.
- Sender test: `ambrosio send` delivers a message to the self-chat (manual check on the phone); channel round trip checked in the rehearsal.
- One end-to-end rehearsal tonight in a scratch repo: dispatch a worker on a toy ticket that must ask a question, confirm it parks, answer via the CLI, confirm it resumes and reaches `in_review`.

## 10. Scope: tonight versus later

**v0 (tonight)**: everything above except the UI. Three skills, the worker contract and hooks, the CLI, Beads setup in the chosen repos, the iMessage channel wired to the tick session, tests, and the rehearsal.

**v1 (next)**: a local web UI (Bun server on localhost) rendering the board from Beads, the agents list, the queue and the journal; **Linear as a source and a report target**: the Linear MCP server attached to the desk session so plan-day can pull issues and their context, `ambrosio import linear <issue>` creating a Beads ticket with the Linear issue as `external_ref`, and status plus a summary comment pushed back to the Linear issue on each transition (Beads stays the operational tracker; Linear is never used to pass work between agents); permission relay through the channel so Jaime can approve a permission prompt from Messages; optional `/goal` with small, per-step goals; Verity verdict pulled from its API instead of the worker's report.

## 11. Assumptions to confirm

- Repos for tomorrow: `gatemd-core`, `gatemd-ui`, `tailor-craft-pro-98` (others added by editing the config).
- WIP limit: 3 concurrent workers across all repos; per-ticket cap 150 turns.
- Hours: planning at 09:00, digests at the top of each hour until 14:00, wrap-up at 15:00; silence after 15:00, including urgent items, which are handled by parking or stopping the worker.
- iMessage: Jaime's own Apple ID handle (phone or email) is the target; the terminal app running the tick session gets Full Disk Access; the first reply triggers a Messages automation prompt that Jaime accepts.
- Beads is initialized in each repo with `bd init` defaults; nothing is committed to those repos without asking.
- Ambrosio's own repo is initialized in git tonight.
