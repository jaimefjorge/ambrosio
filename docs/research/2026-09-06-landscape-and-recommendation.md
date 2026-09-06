# Ambrosio: landscape research and recommendation

Date: 2026-09-06. Local Claude Code: 2.1.263. Detailed reports (verified against primary sources on this date) live beside this file:

- `2026-09-06-native-claude-code.md` — native Claude Code and Anthropic platform capabilities
- `2026-09-06-batched-questions-niche.md` — the "hourly digest + urgent escalation" niche
- `2026-09-06-process-layers-and-trackers.md` — process frameworks, trackers, acceptance gates
- `2026-09-06-orchestrators.md` — third-party control planes and session managers

## 1. The brief

Jaime supervises many Claude Code sessions all day (eleven live sessions across five repos at the time of writing). The context switching is the cost. The tool must:

- **A. Morning intake** — define the day's work as a mission or a set of tickets.
- **B. Breakdown** — produce plans, or require each agent to write its own plan and have it accepted.
- **C. Continuous progress with acceptance** — track many agents to done, with a real acceptance step; a sustainable but pragmatic dev process.
- **D. Interruption discipline** — batch every agent's questions into one digest at most hourly, with the context needed to decide; escalate immediately only when truly urgent.
- **E. Orchestrates Claude Code** specifically.
- **F. One place to look**; minimal context switching.

## 2. Bottom line

1. **Nothing installable does D.** Across roughly sixty tools examined, none batches agent questions on a schedule with an urgent tier and routes answers back. The closest are pull-based inboxes (Paperclip's Decisions desk, Multica's inbox, Claude's own agent view) and per-event relays (Telegram and Discord bridges, Remote Control push). One 30-star project (codecast) designed an away-time decision digest; three (Gas Town, 5dive, agent-deck) model urgent versus routine; none combines the two.
2. **Claude Code itself now covers most of A, C, E and F natively**, largely through features shipped March–September 2026: background sessions under a supervisor with automatic worktrees, a scriptable agent view, `/goal` evaluators, hard-gate hooks, a documented way to defer an agent's question at zero cost, cross-session messaging, two-way Telegram/Discord channels, and phone push.
3. **Process and acceptance are already in the toolbox**: the superpowers plugin (installed) for brainstorm → spec → plan → subagent-driven implementation → verification, Verity (Jaime's own product) as the PASS/WARN/FAIL quality gate on every Stop, and Beads as an agent-native, scriptable tracker.
4. **Recommendation: build a thin layer on native primitives rather than adopt a control plane.** Call it Ambrosio. It is mostly prompts, hooks and a small manager loop, not a server. Estimated first working version: two to three days of agent time, with the hourly digest as the first thing to ship.

## 3. What exists (verdicts)

| Candidate | What it is | Maturity (2026-09-06) | Covers | Verdict for this brief |
|---|---|---|---|---|
| Claude Code native (agent view, `--bg`, `/goal`, hooks, channels, Remote Control, cross-session messaging) | Official primitives | Agent view, channels, routines are research preview; the rest stable | A, C, E, F; D partial | **Substrate.** Use as-is. |
| superpowers (obra) | Process skills: brainstorm, spec, plan, SDD, verify, finish | v6.3.0, 282k stars, active | B, part of C | **Keep.** Adds no tracking or events (open issue #1442). |
| Verity (Jaime) | Independent AI review gate on Stop; knowledge system | Own product | Acceptance in C | **Keep as the acceptance gate.** The Verity PRD already positions it under an orchestrator. |
| Beads (`bd`, gastownhall) | Git-native, dependency-aware issue tracker for agents; `bd ready --json`, custom statuses, human gates, events journal | v1.2.2 stable, 1.3.0-rc.1; 27k stars; heavy churn; Dolt dependency | A, C tracking | **Recommended tracker.** Swappable for flat files if Dolt annoys. |
| Paperclip | "AI company" control plane: goals, issues, per-issue plan approval, heartbeats, Decisions desk, blocked inbox, watchdogs that verify stopped work, budgets; local Claude Code adapter | 80k stars, MIT, weekly releases, 5.3k open issues, pseudonymous maintainer | A, B, C, E, F solid; D partial (ranked pull queue with typed options and triage buckets; no digest, no urgency tier, notifications are a DIY routine) | **The strongest existing product** (scores 11 of 12). Still leaves D to build, adds a server and an org-chart worldview, defaults workers to skip-permissions, and takes them out of native agent view. |
| Untrivial agent-orchestrator | Open-source desktop control plane: worktree per task, hooks report blocked/waiting, kanban columns Needs you / In review / Ready to merge derived from PR and CI facts, reviewer agents | 11k stars, Apache-2.0, 94 contributors; 760 open issues after a rewrite; Slack/Discord notifiers dropped | A, C, E, F solid; B partial; D per-event only | Second-best product. Same shape as native agent view plus a kanban; no digest. |
| Multica | "Linear for agents": issues, inbox that consolidates agent needs and routes replies | 49k stars, custom license, daily releases | A, C, F; D partial (in-app inbox only; Telegram is an open feature request) | Good UI, but D is still missing, workers run with permissions bypassed, and it becomes a second place to look. |
| HumanLayer (ex-CodeLayer) | Closed-source rebuild: research and plan artifacts must be approved before implementation, task board by stage, collaborative diff review, remote daemons running the `claude` CLI | Product active (71 releases this summer); OSS repo deprecated; Pro is $100 per user per month | B strongest in the landscape; C, E, F solid; D per-session | Best plan gating, but closed, paid, cloud-dependent, and no digest. |
| OpenAI Symphony | Ticket-driven supervisor spec: poll Linear, one worker per issue, handoff states | 27k stars; Codex-only; Claude ports are tiny | Design reference | Copy the spec's ideas (tracker as truth, handoff states, "blocked" exposure), not the code. |
| Gas Town / Gas City | Beads-native multi-agent orchestrator with merge queue and severity-tiered escalation to a human | Gas Town: no commits on main since 2026-07-23, and its author wrote in August that it "fell apart at the seams"; Gas City (successor SDK) 1.2k stars | C, D (escalation tiers only) | Not a candidate. Its escalation design (severity to mail, email, SMS; stale re-escalation) is the prior art for urgency tiers. |
| Design references only: codecast, 5dive, agent-deck, sortie, octomux | codecast has the only designed decision digest (`cast decide` with options and context, batched into an away-time email); 5dive has tiered gates (destructive, secrets, spend always reach a human); agent-deck runs a conductor session on a heartbeat that forwards only lines marked NEED; sortie is the cleanest ticket-to-verified-PR loop; octomux builds one inbox from native PermissionRequest hooks | All tiny (22 to 141 stars), one developer each | D ideas | Copy the ideas, not the code. |
| Vibe Kanban, OpenClaw, Ruflo (Claude Flow) | Kanban; chat gateway; "swarm" framework | Vibe Kanban's company shut down (Apr 2026); OpenClaw has two CVSS 9.9 CVEs this year; Ruflo's tools were audited as mostly stubs | — | Not candidates. |
| Conductor, Crystal, Claude Squad, cmux, Emdash, Mux, Superset | Run-many-sessions UIs | Various | E, F partially | Agent view now does this natively. cmux has good per-pane attention cues but no batching. |
| Compound Engineering, BMAD, Spec Kit, CCPM | Process frameworks | Active / dormant (CCPM) | B | Duplicate superpowers. Borrow only ticket fields (Definition of Done, Verification Contract, EARS acceptance criteria). |
| Ralph loops (official `ralph-loop` plugin, snarktank/ralph) | "Keep going until done" loops | Active | C (persistence only) | `/goal` supersedes them; they are designed to never ask a human. |
| Relays (ccgram, claude-remote-approver, claude-threads, ask-user-questions-mcp) | Hook-based bridges to Telegram/ntfy/Slack; one shared question queue | Small, active | D partial (immediate only) | Reuse code patterns for the urgent path. None batch on a schedule. |

## 4. The native primitives that changed the calculus

All verified in the official docs on 2026-09-06 (versions from the changelog):

- **Background sessions and agent view** (`claude --bg "<prompt>"`, `claude agents`, research preview since 2.1.140). A supervisor process runs sessions after the terminal closes; each session moves into its own worktree before editing; rows show Working / Needs input / Idle / Completed / Failed with a one-line Haiku summary. `claude agents --json --all` returns `id`, `state` (working, blocked, done, failed, stopped), `waitingFor` (permission prompt, input needed, sandbox request, dialog open), `cwd`, `sessionId`. State also sits on disk at `~/.claude/jobs/<id>/state.json`. `claude --bg --resume <session-id> "<prompt>"` restarts a stopped session under the same id with a new prompt.
- **Deferring a question at zero cost** (2.1.89). In print mode a PreToolUse hook on `AskUserQuestion` can return `permissionDecision: "defer"`; the process exits with `stop_reason: "tool_deferred"` and the question payload; later `claude -p --resume <id>` re-fires the hook, which returns `allow` plus `updatedInput.answers`. No timeout. This is the documented primitive for a batched question queue.
- **Answering programmatically in any mode** (2.1.85). A PreToolUse hook can supply `updatedInput: {questions, answers}` to answer `AskUserQuestion` without a terminal, or `deny` with a reason Claude sees.
- **`/goal`** (2.1.139). A separate small model judges a completion condition after every turn; works in `-p`; survives resume; check-ins for long background work.
- **Hard gates**: `Stop`, `SubagentStop`, `TaskCompleted` (exit 2 blocks completion and feeds the reason back), `PreToolUse` (blocks even in bypass mode). These are deterministic where CLAUDE.md is advisory.
- **Cross-session messaging** (2.1.224). A manager session can list and message any local session by name; a message to an idle session starts a new turn. A message never counts as consent, so it cannot answer a pending permission prompt. Each session exposes a Unix inbox socket that scripts and hooks can post into.
- **Channels** (research preview). Official Telegram, Discord and iMessage plugins push messages into a running session and let Claude reply in the same chat. `claude --channels plugin:telegram@claude-plugins-official`.
- **Push to phone**: the `PushNotification` tool reaches the Claude mobile app when Remote Control is connected (`agentPushNotifEnabled` is already on in Jaime's settings).
- **Scheduling**: `/loop 60m <prompt>` inside a session (note: hourly loops jitter up to 30 minutes, so pick the cadence and tolerate drift, or drive the tick from launchd); cloud Routines with a one-hour minimum.

Gaps to respect: agent view, channels and routines are research previews and may change; `agent_needs_input` notifications fire only while agent view is open; subagents cannot call `AskUserQuestion`; Task tools are off by default on current models unless enabled; a cross-session message cannot approve a permission prompt.

## 5. Recommendation: Ambrosio as a thin layer

Ambrosio is a manager, a worker contract, and a digest. It owns the human's attention; Claude Code owns execution; Beads owns state; Verity owns quality.

**Components**

1. **Tracker**: Beads per repo with custom statuses (`planning`, `plan_review`, `needs_input`, `verifying`, `in_review`) so "waiting on a human" and "done but unaccepted" are first-class and queryable with `bd list --json`. Acceptance criteria are a required field.
2. **Worker contract**: a prompt template plus hooks that every dispatched session runs under.
   - Read the ticket; plan first (superpowers `writing-plans` for architectural tickets, a short plan in the ticket for bounded ones); stop at `plan_review` when the ticket requires approval.
   - Implement with TDD; commits reference the ticket; `/goal` set to the acceptance criteria.
   - **Never block on a human.** A PreToolUse hook on `AskUserQuestion` records the question (with ticket, options, the agent's recommendation) into the queue and denies the call with the instruction to continue on independent work or park the ticket at `needs_input`. A PermissionRequest hook does the same for unattended permission prompts.
   - Verify: tests, Verity gate on Stop (PASS required), then push branch, open a draft PR, set `in_review` with the PR link and evidence. Closing a ticket is never the worker's act.
   - Guardrails as hooks: no push to main, no `--no-verify`, budget and turn caps.
3. **Manager (Ambrosio session)**: a long-lived Claude Code session with the manager skill, running the hourly tick via `/loop` and connected to Telegram via the channel plugin. It is the only agent that talks to the human.
   - Intake and breakdown in the morning; dispatch with a WIP limit via `claude --bg --name <ticket-id>` in the right repo.
   - Every tick: read `claude agents --json`, `bd list --json` across repos, the question queue, PR checks and budgets; classify urgent vs digest; render the digest; deliver via Telegram plus a push notification; parse replies; route answers back (cross-session message to a live idle worker, or `claude --bg --resume` for a stopped one); dispatch the next ready tickets.
   - Urgent path fires immediately: failed session, worker blocked on a permission prompt for more than N minutes, CI red on main, budget threshold, security-flagged action, or a ticket the human marked "ping me".
4. **Human surfaces**: Telegram (digest and replies), the Claude mobile app (push, Remote Control for ad-hoc steering), and `claude agents` in a terminal for peeking. Optionally an artifact page regenerated hourly as the board.

**What we deliberately do not build**: a server, a database, a kanban UI, a process framework, a code reviewer, or a session runner. Each exists natively or in Jaime's own tools.

## 6. The flow

**Attention budget per day**: one planning session (20–30 min), hourly digest sessions (5–10 min each, only when there is something to decide), one wrap-up (10 min), and rare urgent pings. Everything else is asynchronous.

**Morning intake (A, B)**
1. Jaime tells the manager the mission or pastes tickets, in the terminal or on Telegram.
2. The manager presents the state of the world in one screen: overnight results, items awaiting acceptance, blocked items, stale work.
3. The manager drafts tickets: goal, acceptance criteria (verifiable, EARS style), scope and non-goals, repo, priority, planning path (spike, bounded, architectural), decision budget (what the worker may decide alone), cost cap. Jaime edits and approves the set once.
4. Dispatch under a WIP limit. Bounded tickets go straight to implementation; architectural ones stop at `plan_review`, and the plan appears in the next digest (or immediately, if Jaime chooses to stay for it).

**Work loop (C)**: workers run the contract above in their own worktrees. Questions become queue entries, not blocked sessions. Verification is a hook outcome, not a claim.

**Hourly digest (D, F)**, grouped by what Jaime has to do:
- *Decisions needed*: each question with options, the worker's recommendation, why it matters, ticket and diff summary. Reply key per item.
- *Plans to approve*: one-paragraph plan summary, link to the plan file, risk flags.
- *Ready to accept*: PR link, test status, Verity verdict, evidence, a reviewer subagent's whole-feature verdict.
- *FYI*: progress, done, blocked, spend.
Replies look like `Q1 b`, `P2 approve`, `A3 accept`, `A4 reject: needs a test for the empty case`. The manager routes each one and only pings again when there is something new.

**Urgent (D)**: immediate push plus Telegram message with the one thing to do, and how (peek in agent view, tap in the app, or reply here).

**Acceptance (C)**: a worker's "done" moves the ticket to `verifying` (hooks: tests, Verity, evaluator against acceptance criteria); passing moves it to `in_review` with a PR; only Jaime (or a merge bot acting on Jaime's PR approval) closes it. Rejections go back to the worker with feedback.

**Evening**: the manager summarizes accepted, in progress, blocked and spent; extracts lessons (into Verity's reflection); proposes tomorrow's leftovers; optionally leaves safe tickets running overnight with pings only for urgent items.

**Sustainability rules**
1. No ticket without acceptance criteria.
2. WIP limit on concurrent workers.
3. Workers never block on a human; they park.
4. Jaime touches the fleet at most hourly, except for urgent items.
5. Verification is a gate, not an assertion.
6. Closing a ticket is a human act.
7. Everything is a file or a ticket you can read later.

**Ticket states** (Beads status; who transitions):
`open` → *ready* (derived) → `planning` (worker claims) → `plan_review` (worker; human approves) → `in_progress` (human or auto-policy for bounded) → `needs_input` / `blocked` (worker; human answers or daemon unblocks) → `verifying` (worker claims done; hooks decide) → `in_review` (hooks; human accepts) → `closed` (human). `deferred` and cancelled are human acts.

## 7. Alternatives considered

- **Adopt Paperclip.** The strongest existing product: goals and issues as intake, per-issue plan approval before implementation, an enforced review-then-approval policy with watchdogs that verify stopped work, a Decisions desk with typed options, a local Claude Code adapter, one dashboard. Jaime already knows it from the Verity PRD. What it does not do is D: decisions are a ranked pull queue, not an hourly digest, and there is no urgent tier, so the digest layer must be built either way. Costs: a Node server and database, an org-chart worldview, workers run with permissions skipped by default (Verity's Stop hook still runs, but auto mode's judgment is gone), workers disappear from native agent view, weekly releases with 5.3k open issues, and a pseudonymous single maintainer. Right for a team running heterogeneous agents; heavier than one person needs. **If the thin layer stalls, this is the fallback.**
- **Adopt Untrivial agent-orchestrator.** Open source, well staffed, and the kanban derives "Needs you" from real PR and CI facts. But it is agent view plus a board, with no plan gate, no digest, and its chat notifiers were dropped in the rewrite.
- **Adopt Multica.** The inbox is the best existing "one place to look" for agent needs and it routes replies back. But delivery is in-app only, there is no batching or urgency, workers run with permissions bypassed, and it becomes a second board next to Beads.
- **Build a `-p` daemon with the Agent SDK.** Cleanest question parking (defer/resume) and full control, at the cost of building process management and a view. Keep as the fallback if the `--bg` park protocol proves unreliable.
- **Wait for Anthropic.** Agent view and channels are moving fast, but nothing announced batches attention. The primitives exist now.

## 8. Risks and things to verify in a spike

- Research-preview surfaces (agent view, channels, routines) can change flags and behavior. Keep Ambrosio file-based and thin so a change costs a script, not a rewrite.
- Verify that a `--bg` worker whose `AskUserQuestion` is denied reliably parks rather than looping; measure re-ask rates.
- Verify `claude --bg "/goal <condition>"` sets a goal in a background session (documented for `-p`, not explicitly for `--bg`).
- Verify answer delivery to a stopped background session via `claude --bg --resume <id>` versus a live idle one via cross-session messaging.
- `/loop` hourly jitter (up to 30 minutes). If cadence matters, drive the tick from launchd calling `claude -p` with the manager skill.
- Beads churn: pin v1.2.2, one version across all repos; keep the manager's tracker interface small so flat files can replace it.
- Cost: N background sessions multiply subscription usage N times; the WIP limit and per-ticket caps are the control.
- Policy: Anthropic's SDK terms say third parties may not offer claude.ai login or rate limits in their products. Spawning your own local `claude` sessions is the intended path; tools that route a subscription token through their own harness sit in a grey zone. The planned separate credit pool for `claude -p` and SDK usage was paused on 2026-06-15, so headless usage still draws on the subscription today.

## 9. Decisions needed

1. Build thin on native (recommended), or adopt Multica/Paperclip as the board and still build the digest?
2. Tracker: Beads per repo (recommended), Linear (hosted UI, mobile app, more plumbing), or flat markdown tickets (simplest, weakest)?
3. Digest delivery: Telegram channel (recommended, two-way, phone), push plus an hourly artifact page, or terminal only?
4. Worker model: `--bg` sessions with the park protocol (recommended, native visibility), or `-p` workers with defer/resume (cleaner parking, own view)?
