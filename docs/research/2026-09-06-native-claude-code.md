# Native Claude Code & Anthropic Platform Orchestration Capabilities
## Inventory and Assessment for Multi-Agent Coordination with Human Interruption Management

**Research Date:** September 6, 2026  
**Evaluation Against:** A 6-point mission (A–F) for morning intake, breakdown, continuous tracking, interruption batching, Claude Code orchestration, and unified visibility.

---

## Executive Summary

Native Claude Code and Anthropic platform capabilities form a **tiered orchestration stack** with clear trade-offs:

- **Agent Teams** (experimental): lead + teammates with shared task list, direct inter-agent messaging; enables parallel negotiation and self-coordination
- **Subagents + Workflows**: hierarchical delegation inside one session or dynamically scripted across dozens of subagents; context-efficient
- **Agent View + Background Sessions**: dispatch-and-forget local parallel work with asynchronous progress tracking  
- **Routines (Cloud)**: unattended recurring or event-triggered work on managed infrastructure with GitHub and API triggers
- **Claude Agent SDK**: self-hosted harness with built-in tools, hooks, subagents, MCP, and session persistence; for supervised deployment

**Critical gaps for criterion D (interruption discipline):**
- No native "batch questions once per hour" mechanism—hooks can aggregate, but no first-class batching tool
- Notifications fire per event, not digested
- No urgent/routine classification for escalation

**Strongest match for criteria A–C:**
- Agent Teams (when enabled) or Workflows handle breakdown + parallel execution
- Task lists and hooks enable verification gates
- Agent View or Routines provide continuous tracking

**Weakest spot for criterion F (one place to look):**
- Sessions scattered across CLI terminal, claude.ai/code web UI, Desktop sidebar, mobile app, and slack
- No single "mission control" dashboard for all agents + questions + notifications

---

## 1. Agent Teams (Lead + Teammates)

### What It Does

**Status:** Experimental (disabled by default; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var)  
**Availability:** CLI only; unavailable in `-p` non-interactive mode, Agent SDK `-p`, Managed Agents, and cloud sessions.

One session acts as **team lead** and coordinates work. Each **teammate** is a separate full Claude Code instance with its own context window, running independently. Teammates communicate directly via **mailbox** (JSON files at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`). A **shared task list** coordinates work: teammates claim tasks, mark them complete, and manage dependencies.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Teammate spawning** | Named subagents launched with the Agent tool while teams are enabled become teammates |
| **Parallel work** | No hard limit on teammate count; practical limits ~3–5 for coherent coordination |
| **Task coordination** | Agents with Task tools (TaskCreate, TaskGet, TaskList, TaskUpdate) share a task list; others use SendMessage |
| **Inter-agent messaging** | Direct SendMessage between any named teammates; inbox validation on read |
| **Display modes** | In-process (one terminal, arrow keys to select teammate) or split-pane (tmux/iTerm2 required) |
| **Plan approval** | Teammates can work in plan mode; lead auto-approves plans without re-prompting |
| **Worktree isolation** | No automatic isolation; users must partition work by file ownership to avoid conflicts |
| **Subagent definitions** | Reusable teammate role definitions from `.claude/agents/` with tools, model, skills, MCP servers |
| **Background execution** | In-process teammates cannot spawn background subagents (error or silent failure); work must run foreground |

#### Limits & Known Issues

- **No resumption with in-process mode:** `/resume` and `/rewind` do not restore teammates; lead may try to message nonexistent agents.
- **Task status lag:** Teammates sometimes fail to mark tasks complete, blocking dependent tasks.
- **Slow shutdown:** Teammates finish their current request before closing.
- **One team per session:** A session has exactly one team scoped to that session; cannot share across sessions or create additional named teams.
- **No nested teams:** Only the lead can spawn teammates; teammates cannot spawn their own teammates.
- **Permissions fixed at spawn:** All teammates inherit lead's permission mode at start; individual modes can change post-spawn but cannot be set at spawn time.
- **Lead is fixed:** The main session is always the lead; cannot promote a teammate to lead.
- **Split panes unsupported on some terminals:** VS Code integrated terminal, Windows Terminal, Ghostty do not support split-pane mode.

#### Maps to Criteria

- **A (intake):** No; teams do not help intake or goal definition.
- **B (breakdown):** Yes; lead breaks work into tasks and delegates to teammates.
- **C (tracking):** Partial; task list and idle notifications track teammates, but no built-in progress reporting to human.
- **D (interruption):** No batching mechanism; teammate idle and task completion trigger separate notifications.
- **E (Claude Code specific):** Yes; works only in CLI.
- **F (one place to look):** Partial; agent panel in the lead's terminal shows teammate roster and status.

#### Costs

Each teammate is a full session with its own token usage. Token costs scale linearly with team size.

**Source:** https://code.claude.com/docs/en/agent-teams.md

---

## 2. Subagents & Custom Subagent Definitions

### What It Does

**Status:** Generally available (stable)  
**Availability:** CLI, Desktop, web sessions, Agent SDK, Managed Agents.

Subagents are specialized workers that spawn within the parent session's context, do focused work in their own context window, and return results to the parent. Four built-in types (Explore, Plan, General, claude); users can define custom ones in `.claude/agents/` (project or user scope).

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Built-in types** | Explore (read-only code analysis), Plan (plan-mode research), General (complex multi-step), claude (catch-all) |
| **Nesting & depth** | Subagents can spawn their own subagents; default depth limit 3 levels below main conversation |
| **Communication** | SendMessage between named subagents; parent can message any named subagent |
| **Tool restriction** | Define custom tools list or disallowed-tools list per subagent type |
| **Model selection** | Set per subagent definition or inherit from parent; `CLAUDE_CODE_SUBAGENT_MODEL` for all subagents |
| **Permission modes** | Each custom subagent can set its own mode (plan, acceptEdits, auto, default) |
| **Memory/learning** | Optional persistent memory per subagent via `memory: user/project/local` in definition |
| **Background execution** | Subagents can run in foreground or background (default depends on fork mode and definition) |
| **Worktree isolation** | Subagents can run in isolated git worktrees via `isolation: worktree` in definition |
| **Resumption** | Named subagents auto-resume when receiving a message; built-in Explore/Plan are one-shot |
| **Forks** | Special case: inherit parent's full context, system prompt, and history instead of starting fresh |
| **MCP servers** | Scoped MCP server access via `mcpServers` field in subagent definition (split-pane mode only; in-process ignores) |
| **Skill injection** | Preload skills via `skills` field in definition |
| **Max turns** | Optional `maxTurns` limit to force partial result return |
| **Concurrent limit** | Up to 20 concurrent subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) |

#### Maps to Criteria

- **A (intake):** No; subagents do not define the day's work.
- **B (breakdown):** Yes; parent delegates research, planning, or verification subtasks to subagents.
- **C (tracking):** Partial; subagent results return to parent conversation; no separate progress visibility for humans.
- **D (interruption):** No; each subagent completion surfaces a result, not batched.
- **E (Claude Code specific):** Yes; works in CLI, Desktop, web, Agent SDK.
- **F (one place to look):** Partial; results appear in parent conversation.

#### Costs

Each subagent has its own context window. Background subagents run concurrently but are limited to 20 at once. Token usage multiplies with subagent count and nesting depth.

**Source:** https://code.claude.com/docs/en/sub-agents.md

---

## 3. Dynamic Workflows ("ultracode")

### What It Does

**Status:** Generally available (stable)  
**Availability:** All paid plans; API access; AWS, Google Cloud, Azure; CLI, Desktop, web, Agent SDK, `-p` mode.

A JavaScript orchestration script that runs many subagents in parallel and checks their work. Claude writes or you save a workflow; it runs in the background while your session stays responsive. Built-in `/deep-research` workflow for cross-checked fact-finding.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Script authoring** | Claude writes from a natural-language prompt; users can edit and save for reuse |
| **Agent primitives** | `agent()` spawns one subagent; `pipeline()` runs one per item in a list; `parallel()` runs a set simultaneously |
| **Phases** | Organize agents into named phases for progress tracking |
| **Result handling** | Intermediate results stored in script variables, not in Claude's context (keeps main conversation light) |
| **Cross-checking** | Agents can review each other's work before results surface |
| **Input passing** | `args` global receives input at invocation time (e.g., `/saved-workflow --args 'item1, item2'`) |
| **Parallelism** | Up to 16 concurrent agents (fewer on CPU-limited systems); up to 4,096 items per `pipeline()`/`parallel()` call; up to 1,000 agents total per run |
| **Progress tracking** | Real-time status in `/workflows` view showing phases, agent count, token usage, elapsed time |
| **Pause/resume** | Pause mid-run; resume replays completed agents from cache and reruns failed ones |
| **Prompt caching** | 5-minute default TTL for workflow agent cache; 1-hour TTL available via `subagentPromptCacheTtl` |
| **Size guidance** | Set workflow size guideline (small <5, medium <15, large <50 agents) to hint to Claude |
| **Cost estimation** | Check token usage before committing to large runs |
| **Error handling** | Failed agents return `null`; run survives, can be resumed |
| **Trigger keywords** | Type `ultracode` in prompt to trigger workflow; can be disabled in `/config` |
| **Bundled workflows** | `/deep-research` included; others can be saved to `.claude/workflows/` or `~/.claude/workflows/` |

#### Workflow Size & Cost Management

- **Default threshold:** 25 agents or 1.5M tokens triggers "Large workflow" warning (advisory only)
- **Size guideline override:** Adjust with `/config workflowSizeGuideline=small`
- **Per-run cost visibility:** `/workflows` view shows per-agent token burn

#### Limits

- **No mid-run user input:** Only agent permission prompts can pause; for sign-off between stages, run each stage as its own workflow.
- **No module imports:** Scripts are plain JavaScript; libraries must be called by agents via bash/tool calls.
- **No filesystem/shell from script:** Agents do the work; script coordinates.
- **Deterministic execution:** `Date.now()`, `Math.random()`, bare `new Date()` throw; pass timestamps via `args`.
- **Runtime constraints:** Max 16 concurrent agents, 4,096 items per call, 1,000 agents per run.

#### Maps to Criteria

- **A (intake):** Partial; `/effort ultracode` makes Claude automatically plan workflows for substantive tasks, but no explicit goal intake.
- **B (breakdown):** Yes; Claude writes a script that breaks work into agents and phases.
- **C (tracking):** Yes; `/workflows` view shows all phases, agent counts, token usage, and individual results.
- **D (interruption):** No; each agent completion fires a notification; no batching.
- **E (Claude Code specific):** Yes; works in CLI, Desktop, web, Agent SDK.
- **F (one place to look):** Yes; `/workflows` is the single view for all running orchestration.

#### Costs

Token usage scales with agent count and model used. Runs count toward plan usage and rate limits like any session.

**Source:** https://code.claude.com/docs/en/workflows.md

---

## 4. Agent View (Local Parallel Sessions)

### What It Does

**Status:** Research preview  
**Availability:** CLI (via `claude agents` command); Desktop app sidebar.

Dispatch and monitor many background sessions from a single "agent view" dashboard. Each background session is isolated, persistent, can be paused or interrupted, and surfaces its state in a table. Dispatch from agent view, shell (`claude --bg`), or inside a session (`/bg`).

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Dispatch methods** | From agent view UI, shell with `claude --bg "task"`, or in-session `/bg` or `/fork` |
| **Session isolation** | Each dispatched session gets its own git worktree (no file conflicts) |
| **Background execution** | Sessions run while you close agent view; supervisor process hosts them |
| **Status visibility** | Table shows session name, activity, state (Needs input, Working, Completed), age |
| **Interaction** | Press Space to peek at output, type reply to send without attaching; Enter to attach full conversation |
| **Persistent state** | Sessions survive machine sleep; transcripts available through `claude --resume` |
| **PR integration** | Sessions linked to PRs show status label and color by state |
| **Parallel dispatch** | Start multiple tasks and they run simultaneously in separate sessions |
| **Permission mode override** | Pass `--permission-mode plan/acceptEdits/auto/manual` when dispatching |
| **Model override** | Pass `--model` to override session model at dispatch |
| **Naming** | Sessions can be named at dispatch or auto-assigned |
| **Output capture** | `/tasks` in CLI shows status of all background work |

#### Limits

- **Local to machine:** Background sessions run on your machine, not in cloud; consume subscription quota like interactive sessions.
- **No cross-session messaging UI:** Use [`cross-session-messaging`](#cross-session-messaging) tool for inter-session communication (not built into agent view UI).
- **Supervisor dependency:** Supervisor process must stay running; closing all sessions may not clean up supervisor.

#### Maps to Criteria

- **A (intake):** Yes; describe the task when dispatching.
- **B (breakdown):** No; users partition work themselves across dispatches.
- **C (tracking):** Yes; agent view shows all sessions at a glance with state and age.
- **D (interruption):** Partial; can peek and reply from agent view without full attach, but no batching.
- **E (Claude Code specific):** Yes; CLI and Desktop only.
- **F (one place to look):** Yes; `claude agents` is the single dashboard (but Desktop sidebar is also a view).

#### Costs

Each background session consumes tokens as it works. Multiple parallel sessions multiply token usage.

**Source:** https://code.claude.com/docs/en/agent-view.md

---

## 5. Routines (Cloud Scheduled & Event-Triggered Automation)

### What It Does

**Status:** Research preview (behavior, limits, API may change)  
**Availability:** Pro, Max, Team, Enterprise plans; runs on Anthropic-managed or self-hosted cloud infrastructure.

Save a Claude Code session configuration (prompt, repos, environment, connectors, triggers) once and run it automatically on schedule, API call, or GitHub event. Routines run autonomously with no permission prompts.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Trigger types** | Schedule (recurring or one-off), API (POST /fire endpoint), GitHub event (PR opened, released, etc.) |
| **Scheduling** | Presets (hourly, daily, weekdays, weekly) or custom cron; 1-hour minimum interval; one-off runs do not count toward daily cap |
| **API trigger** | Dedicated endpoint per routine; bearer token auth; `text` field for run-specific context (alert body, etc.) |
| **GitHub filters** | PR events can filter by author, title, body, base branch, head branch, labels, draft status, merge status |
| **Repositories** | One or more GitHub repos; cloned at start of each run from default branch (user can override in prompt) |
| **Environments** | Cloud environments control network access (Trusted, Custom, Full), env vars, setup scripts, API credentials |
| **Connectors** | MCP connectors included by default (Slack, Linear, Google Drive, Gmail, etc.); can remove unused ones |
| **Autonomous execution** | No permission prompts; runs from pre-saved prompt; any tool used during run needs no approval |
| **Branch management** | Routine pushes to `claude/`-prefixed branches (auto-created); user-specified branches rejected if protected, have open PRs, or authored by someone else |
| **Network isolation** | Sessions use Trusted network (default allowlist: package registries, cloud APIs) or Custom (user-specified domains) |
| **Session visibility** | Each run creates a new session linked to the routine; full transcript and changes reviewable on web |
| **Cost tracking** | Routines count toward subscription usage and rate limits; daily run cap shown at claude.ai/code/routines |
| **Usage credits** | On overage, metered credits available if enabled; otherwise blocked until reset |

#### Limits & Constraints

- **Daily run cap:** Account-level per-day limit (shown at claude.ai/code/routines); one-off runs exempt.
- **No session inspection from routine itself:** A routine cannot query other sessions' transcripts or state.
- **Managed infrastructure:** Runs on Anthropic's cloud by default; can route to self-hosted environment for compliance/data-residency.
- **Zero Data Retention incompatible:** Routines not eligible for ZDR or HIPAA BAA (session state persists server-side).
- **GitHub token scope:** Routine inherits GitHub access from connecting account; no per-routine GitHub authorization.
- **MCP tunnels in preview:** Direct MCP calls to private servers require self-hosted sandbox or MCP tunnels (research preview).

#### Maps to Criteria

- **A (intake):** Yes; routine prompt is the intake.
- **B (breakdown):** No; routine is not designed for planning/approval before execution.
- **C (tracking):** Yes; each run creates a session viewable on claude.ai/code/routines.
- **D (interruption):** No; runs autonomously, no human interruptions.
- **E (Claude Code specific):** Partial; orchestrates Claude Code on cloud infrastructure but accessed via web or API.
- **F (one place to look):** Yes; claude.ai/code/routines shows all routines and run history.

#### Costs

Token usage per run counted toward plan; daily run cap enforced; overage handled via credits or rejection.

**Source:** https://code.claude.com/docs/en/routines.md

---

## 6. Notifications & Interruption Management

### What It Does

**Status:** Generally available (stable)  
**Availability:** Hooks (all platforms); push notifications (Remote Control, mobile app); email and Slack (via webhooks/connectors).

Hooks fire at lifecycle events (PreToolUse, PostToolUse, Notification, Stop, SessionEnd, etc.). The Notification hook fires when Claude needs input or permission; matchers can target specific events (permission_prompt, idle_prompt, elicitation_dialog, agent_needs_input, etc.).

#### Notification Matchers

| Matcher | Fires When |
|---------|-----------|
| `permission_prompt` | Claude needs tool approval; ~6 second wait before notification |
| `idle_prompt` | Claude idle ~60 seconds; you haven't typed |
| `auth_success` | Authentication completes |
| `elicitation_dialog` | MCP server opens form; ~6 second wait |
| `elicitation_url_dialog` | MCP server asks to open browser URL; ~6 second wait |
| `agent_needs_input` | Background session waiting on input; agent view open |
| `agent_completed` | Background session finishes/fails; agent view open |
| `quota_auto_resume_fired` | Usage limit reset; auto-resume triggered |

#### Interruption Architecture

- **Per-event notifications:** Each hook fires independently; no native batching.
- **Aggregation via custom hooks:** Users can write shell-script hooks to aggregate (e.g., write to file, batch-send digest) but Claude Code does not provide a "batch questions once per hour" primitive.
- **Push notifications:** Remote Control and mobile app can receive push when goal finishes or input needed (requires `agentPushNotifEnabled` setting).
- **Urgent escalation:** No first-class urgent/routine classification; all notifications fire at same priority.
- **Statusline:** Optional custom statusline can display task count, goal status, or custom fields.
- **Stop hook:** Prompt-based hook can pause after every turn (for checking/approval between turns).

#### Maps to Criteria

- **A–C:** No direct support.
- **D (interruption discipline):** Poor fit; no batching primitive, no urgent classification, no "collect for 1 hour" gate.
- **E (Claude Code specific):** Yes; hooks work in CLI, Desktop, Agent SDK.
- **F (one place to look):** No; notifications scatter across terminal notifications, push notifications, Slack, email.

**Source:** https://code.claude.com/docs/en/hooks-guide.md

---

## 7. Scheduled Tasks: /loop, CronCreate, ScheduleWakeup

### What It Does

**Status:** Generally available (stable)  
**Availability:** `/loop` (CLI, Desktop, web, Agent SDK, `-p` mode); CronCreate/CronList/CronDelete (CLI, Desktop); ScheduleWakeup (agent loop tool).

Session-scoped scheduling: run a prompt on a fixed interval or on Claude's dynamically chosen interval. Tasks expire after 7 days; resuming a session with `--resume` or `--continue` restores unexpired tasks.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Fixed interval** | `/loop 5m check the deploy` runs every 5 minutes (converted to cron) |
| **Dynamic interval** | `/loop check the deploy` (no interval) lets Claude choose 1–60 minute waits based on progress |
| **Built-in maintenance** | Bare `/loop` or `/loop 15m` uses built-in prompt to tend PRs, run cleanup, continue unfinished work |
| **Custom loop prompt** | `.claude/loop.md` or `~/.claude/loop.md` overrides built-in prompt |
| **One-off reminders** | Natural language: `remind me at 3pm to push the release` or `in 45 minutes, check tests` |
| **Cron syntax** | 5-field cron expressions; minute granularity; `0 9 * * *` = 9am daily |
| **Jitter** | Recurring tasks fire up to 30 min after scheduled time (or half interval if < hourly); deterministic per task ID |
| **Tool access** | `CronCreate`, `CronList`, `CronDelete` tools; `/loop` is CLI-level shorthand |
| **Session persistence** | Tasks survive session close if unexpired; restored on `--resume` or `--continue` |
| **Seven-day expiry** | Recurring tasks auto-delete 7 days after creation; one-shot tasks delete after firing |
| **Monitor limit** | Session can hold up to 50 scheduled tasks at once |
| **Background Bash** | Can pair with background shell command or Monitor tool for streaming |
| **Skill invocation** | Scheduled task can invoke a skill if Claude is allowed to invoke it (respects disable-model-invocation) |

#### Comparison: /loop vs /goal vs Routines

| Aspect | /loop | /goal | Routines |
|--------|-------|-------|----------|
| **When next turn fires** | After interval elapses | After turn ends (if condition not met) | On schedule/API/GitHub event |
| **Stops when** | You stop it or Claude decides done | Condition met, impossible, or unrecoverable error | Scheduled time or disabled |
| **Interval flexibility** | Fixed cron or dynamic (Claude chooses) | Fixed (evaluator checks after each turn) | Fixed cron or one-off |
| **Session scope** | Current session only; expires in 7 days | Current session only | Runs independent sessions indefinitely |
| **Requires open session** | Yes | Yes | No (cloud infrastructure) |
| **Useful for** | Polling, babysitting, reminders | Toward a verifiable goal | Recurring, unattended, event-driven work |

#### Maps to Criteria

- **A (intake):** No; `/loop` is reactive polling, not intake.
- **B (breakdown):** No.
- **C (tracking):** Partial; `/tasks` lists running scheduled work.
- **D (interruption):** Partial; `/loop` can batch by interval, but no "once per hour" gate.
- **E (Claude Code specific):** Yes; works in CLI, Desktop, Agent SDK, `-p` mode.
- **F (one place to look):** Partial; `/tasks` in CLI shows scheduled work alongside subagents.

**Source:** https://code.claude.com/docs/en/scheduled-tasks.md, https://code.claude.com/docs/en/goal.md

---

## 8. Remote Control (Continue Local Session from Browser/Phone)

### What It Does

**Status:** Generally available (off by default on Team/Enterprise)  
**Availability:** CLI, Desktop, web (claude.ai/code), mobile app (iOS/Android).

Connect a local Claude Code session to the web or mobile app so you can steer it, send messages, answer questions, and receive push notifications from anywhere—while code execution and filesystem access stay local.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Device connectivity** | Terminal, browser, phone all connect to same local session |
| **Code execution local** | All tool calls (Bash, Read, Edit, etc.) run on your machine, not cloud |
| **Attachments** | Photos from mobile attach directly; other files download to machine and pass via `@` reference |
| **Push notifications** | Mobile can receive notifications when task finishes or input needed (requires `agentPushNotifEnabled`) |
| **Multiple devices** | Can connect from phone, browser, and desktop simultaneously; conversation syncs across all |
| **Session QR code** | Terminal displays QR code to scan from mobile |
| **Session persistence** | If machine sleeps, reconnects when it wakes |
| **Peek & reply** | From browser, can peek at latest output without full attach |
| **Real-time sync** | Subagent progress, workflows, and background work updates across all connected devices |

#### Limits

- **Machine must stay on:** Remote Control drives a local machine; if it sleeps or Claude exits, connection breaks.
- **No command-level access from mobile:** Some commands only work in terminal (e.g., `/plugin`, `/resume`).
- **No plan mode from mobile:** Cannot select Bypass permissions or certain modes from app.
- **Push notifications optional:** Requires enabling `agentPushNotifEnabled` and working notification infrastructure.

#### Maps to Criteria

- **A–C:** No direct support; Remote Control is a connection mechanism.
- **D (interruption):** Yes; can peek and reply without full attach, reducing context-switch friction.
- **E (Claude Code specific):** Yes; works with CLI sessions.
- **F (one place to look):** Partial; connects to one session but device can connect to multiple sessions via the app.

**Source:** https://code.claude.com/docs/en/remote-control.md

---

## 9. Claude Code on the Web & Mobile (Cloud Sessions)

### What It Does

**Status:** Research preview (Pro, Max, Team, Enterprise with premium seats)  
**Availability:** Web at claude.ai/code; mobile app (iOS/Android); Desktop app; CLI via `--cloud` flag.

Run Claude Code sessions on Anthropic-managed cloud infrastructure (or self-hosted environments). Sessions persist even if you close your laptop or phone. Move sessions between web, terminal (via `--teleport`), and mobile.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Cloud environments** | Network access (Trusted, Custom, Full), env vars, setup scripts, API credentials |
| **GitHub authentication** | GitHub App authorization or `/web-setup` token sync |
| **Start from web** | Describe task at claude.ai/code; VM clones repo, runs setup, executes autonomously |
| **Start from CLI** | `claude --cloud "task"` creates new cloud session; your local changes don't push (push first) |
| **Teleport to terminal** | `claude --teleport <session-id>` pulls cloud session and branch into local checkout |
| **Follow-ups from CLI** | `claude -p "message" --cloud <session-id>` sends message without teleporting |
| **Mobile access** | Claude mobile app can monitor, steer, and answer questions on cloud sessions |
| **Session persistence** | Sessions survive browser close; transcripts available across devices |
| **PR auto-fix** | Turn on auto-fix toggle; Claude watches PR for CI failures and review comments, auto-fixes |
| **Diff review** | Inline comment on diffs; send comments to Claude with next message |
| **Session sharing** | Share with teammates (Team/Enterprise) or publicly (Pro/Max) |
| **Permission modes** | Plan, Auto, Accept edits (no Bypass from app) |
| **Archived sessions** | Archive to keep sidebar organized; can filter to view archived |
| **Auto-compaction** | Triggers mid-window to free context (can be tuned via env var) |
| **Commands available** | `/compact`, `/context`, `/model <name>`, `/effort <level>`, `/fast`, `/color`, `/rename`; `/clear` and `/config` behave differently |

#### GitHub Integration

- **Auto-fix PR monitoring:** Claude receives GitHub webhooks for review comments, CI failures, merge conflicts; reacts autonomously.
- **Branch management:** Routines and cloud sessions push to `claude/`-prefixed branches; user branches rejected if protected.
- **Commit signing:** Works via proxy; keys stay outside sandbox.

#### Limits

- **No local filesystem by default:** Cloud sessions clone GitHub repos; local-only files need bundling via `CCR_FORCE_BUNDLE=1`.
- **Network restricted:** Default Trusted access limits outbound to package registries and known domains.
- **No resume across accounts:** `--teleport` requires same claude.ai account that started the session.
- **IP allowlist incompatibility:** Organization IP allowlist blocks cloud session API calls (request exemption from Anthropic support).
- **No ZDR eligibility:** Session state persists server-side; not eligible for Zero Data Retention or HIPAA BAA.
- **Rate limits shared:** Cloud sessions consume subscription rate limits; multiple parallel sessions compound usage.

#### Maps to Criteria

- **A (intake):** Yes; describe task at web or CLI.
- **B (breakdown):** No direct support.
- **C (tracking):** Yes; claude.ai/code sidebar shows all cloud sessions with status; mobile app can monitor.
- **D (interruption):** Partial; can answer questions from web or mobile without context-switch.
- **E (Claude Code specific):** Yes; orchestrates Claude Code on cloud.
- **F (one place to look):** Yes; claude.ai/code sidebar is the hub for cloud sessions (separate from local sessions in CLI).

**Source:** https://code.claude.com/docs/en/claude-code-on-the-web.md, https://code.claude.com/docs/en/mobile.md

---

## 10. Claude Tag (Claude in Slack)

### What It Does

**Status:** Generally available (Team and Enterprise plans only; Pro/Max use older Claude Code in Slack)  
**Availability:** Slack channels; each thread backed by a remote Claude Code session.

Mention `@Claude` in a Slack channel thread. Thread runs as a Claude Code session using your organization's shared identity. Sessions have admin-configured access to repositories, connectors, and environments.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Org identity** | Sessions run as organization (not individual user) |
| **Channel threads** | Each thread is a separate session; messages in the thread reach the agent |
| **Admin config** | Owner sets up Claude Tag, scopes environments, connectors, and repository access |
| **Shared memory** | Sessions in the same channel can inherit context via channel history |
| **Auto-fix PRs** | Can watch PRs and respond to review comments (posts as Claude, labeled) |
| **Connectors** | Uses org-level or self-hosted environments; MCP tools available as configured |
| **Permission model** | Org admin controls what Claude can do (network access, tool access) |

#### Limits

- **Org-only setup:** Not available for individual users; requires Team/Enterprise plan.
- **Admin control:** Individual users cannot override org permissions.
- **Slack thread scope:** Work stays within one thread unless explicitly copied.

#### Maps to Criteria

- **A (intake):** Yes; task is described in Slack thread.
- **B (breakdown):** Partial; Claude can plan, but no separate approval gate.
- **C (tracking):** Partial; Slack thread shows progress; not a separate dashboard.
- **D (interruption):** Partial; can reply in thread without leaving Slack.
- **E (Claude Code specific):** Partial; orchestrates Claude Code but from Slack.
- **F (one place to look):** No; Claude Tag is one place, but agents also in claude.ai/code, CLI, Desktop.

**Source:** https://code.claude.com/docs/en/claude-tag.md, https://claude.com/docs/claude-tag/overview

---

## 11. Claude Agent SDK (Self-Hosted Harness)

### What It Does

**Status:** Generally available (stable)  
**Availability:** Python (`claude-agent-sdk`) and TypeScript (`@anthropic-ai/claude-agent-sdk`) libraries; you host the application.

A library that runs the same agent loop, tools, and context management as Claude Code, but in your own Python or TypeScript application. No sandbox; you implement permissions, tool execution, and session storage.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Built-in tools** | Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch (same as CLI) |
| **Hooks** | PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, UserPromptSubmit, PermissionRequest, Notification |
| **Subagents** | Can spawn subagents with custom definitions; full nesting support |
| **MCP servers** | Load and manage MCP servers programmatically |
| **Sessions** | Persist transcripts to your own backend via sessionStore adapter; resume from any session ID |
| **Permissions** | Granular control: per-tool allow/deny rules, modes (auto, plan, manual) |
| **Skills** | Load from project `.claude/skills/` and user `~/.claude/skills/`; can load programmatically |
| **Custom tools** | Define your own tools in the tool loop; pass results back to agent |
| **Message history** | Can build custom message history or fetch from storage |
| **Output formats** | JSON streaming, text, structured output |
| **Effort level** | Support for xhigh (extended thinking) on compatible models |
| **Transcripts** | Full access to conversation history for logging, analysis, or external storage |
| **Prompt caching** | Built-in; can configure TTL |
| **Context compaction** | Auto-compaction on large conversations |

#### Supervision Patterns (Custom Implementation Required)

The SDK does NOT provide a built-in supervision harness, but users can implement:

- **Hooks for interception:** PreToolUse hook can block or log tool calls; Stop hook can check external state and pause.
- **Session resume:** Read transcript from storage, resume session from any point, intercept AskUserQuestion via custom PermissionRequest hook.
- **Async operation:** Spawn agent loop in a thread or async task; poll session state via hooks.
- **Multi-agent dispatch:** User's application can spawn multiple SDK agents and coordinate via custom messaging.
- **Approval gates:** Implement custom tool that raises AskUserQuestion or PermissionRequest for human approval.

#### No Built-In

- **Managed Agents features:** Agent SDK does not provide managed infrastructure, memory stores, or Anthropic-hosted sandbox. User must deploy and manage the application.
- **FleetView:** No built-in dashboard; users must build their own monitoring.
- **Automatic session clustering:** Users must implement grouping/tracking themselves.

#### Maps to Criteria

- **A (intake):** User-defined; SDK provides no intake UI.
- **B (breakdown):** User-defined; can build planning + approval logic.
- **C (tracking):** User-defined; can log to DB and build dashboard.
- **D (interruption):** User-defined; can implement batching via hooks and message queueing.
- **E (Claude Code specific):** Partial; SDK runs Claude Code harness but not the CLI itself.
- **F (one place to look):** User-defined; SDK provides no UI.

#### Costs

Token usage billed per API request; no sandbox or infrastructure charge. User pays for compute to run the application.

**Source:** https://code.claude.com/docs/en/agent-sdk/overview.md, search results on SDK sessions and hooks.

---

## 12. Managed Agents (Anthropic-Hosted, Server-Side)

### What It Does

**Status:** Beta (requires `managed-agents-2026-04-01` beta header)  
**Availability:** Anthropic API (platform.claude.com); Claude Platform on AWS; optional self-hosted sandbox or MCP tunnels (research preview).

Anthropic-hosted stateful agent harness. Create an agent once with model, prompt, tools, MCP, and skills. Start sessions referencing the agent; Claude autonomously works toward a goal. Anthropic manages the sandbox, persistence, and scaling.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **Stateful sessions** | Server-side persistence; conversation history, file system, and agent state survive across events |
| **Long-running work** | Sessions can run for minutes or hours with multiple tool calls |
| **Built-in tools** | Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch |
| **MCP servers** | Can attach MCP servers; MCP tunnels allow private network access (research preview) |
| **Skills** | Can define skills in agent configuration |
| **SSE event stream** | Receive agent messages, tool calls, and results via server-sent events |
| **Event history** | Can fetch full event history for a session |
| **Self-hosted sandbox** | Private beta: run execution on your own infrastructure or via managed providers (Cloudflare, Modal, Vercel) |
| **Scheduled deployments** | Run agent sessions on a cron schedule (not documented in basic overview) |
| **Dreaming** | Store and retrieve agent context/memory (research preview) |
| **Managed infrastructure** | Anthropic handles sandbox, persistence, scaling; no deployment burden |

#### No Built-In Orchestration

- **No lead-teammate model:** Managed Agents does not have the shared task list / direct messaging of Agent Teams.
- **No dynamic workflow scripts:** Orchestration is not codified; agent loop is proprietary.
- **No inter-session messaging:** Sessions are independent; you must build messaging via your application.
- **No approval gates in the platform:** User must intercept events and inject decisions.

#### Limits

- **Stateful design:** Not eligible for Zero Data Retention or HIPAA BAA; session state persists.
- **Cloud-only execution:** Anthropic-managed sandbox by default; self-hosted sandbox in private beta.
- **MCP tunnels in preview:** Private network MCP access is research preview, limited availability.
- **Rate limits:** Sessions count toward API rate limits; no separate quota.

#### Maps to Criteria

- **A (intake):** Yes; agent prompt is the intake.
- **B (breakdown):** No; Managed Agents does not support multi-agent planning or approval.
- **C (tracking):** Partial; you can fetch session events and build a dashboard.
- **D (interruption):** Partial; you can inject events mid-execution, but no native batching.
- **E (Claude Code specific):** No; this is the Anthropic API, not Claude Code.
- **F (one place to look):** User-defined; you must build the dashboard.

#### Costs

Usage counted toward API quota; no infrastructure charge beyond compute. Price per million tokens.

**Source:** https://platform.claude.com/docs/en/managed-agents/overview

---

## 13. Desktop App (Multi-Session, Worktrees, Dispatch)

### What It Does

**Status:** Generally available (stable)  
**Availability:** macOS, Windows, Linux (beta); includes Chat, Cowork, and Code tabs.

Desktop application with multi-session sidebar, drag-and-drop pane layout, integrated terminal, drag-and-drop file upload, visual diff review, PR monitoring, and **Dispatch** for delegating cloud work.

#### Capabilities (Code Tab)

| Feature | Detail |
|---------|--------|
| **Multi-session sidebar** | Left sidebar shows all local and cloud sessions; click to open |
| **Background sessions** | Sessions in sidebar can run in background while you switch between them |
| **Worktree support** | Each session gets isolated git checkout; changes don't conflict |
| **Drag-and-drop panes** | Arrange terminal, file editor, and diff view in custom layout |
| **Visual diff review** | Review all changes with inline comments before committing |
| **Remote Control via mobile** | Desktop session can be controlled from Claude mobile app |
| **Dispatch (Pro/Max)** | Message a task to Dispatch; it spawns a cloud session autonomously |
| **PR status** | Desktop app shows PR merge status and can trigger auto-fix |
| **Team workspace** | Can invite teammates to collaborate (Team/Enterprise feature TBD) |
| **SSH integration** | Can connect to remote machines via SSH |
| **Computer use** | Can see and click desktop screen (requires permission) |
| **Connectors** | MCP connectors available in sessions |

#### Desktop Scheduled Tasks

- Separate from session-scoped `/loop` tasks; local tasks run on your machine.
- Can access local files and tools.
- Persistent across machine restarts.
- Require machine to stay on or task to wake it.

#### Maps to Criteria

- **A (intake):** Yes; message a task to Dispatch or describe in session.
- **B (breakdown):** Partial; visual diff review enables verification gates.
- **C (tracking):** Yes; sidebar shows all sessions with status.
- **D (interruption):** Partial; sidebar reduces context-switch friction.
- **E (Claude Code specific):** Yes; Desktop is purpose-built for Claude Code.
- **F (one place to look):** Yes; Desktop sidebar is the unified view.

**Source:** https://code.claude.com/docs/en/desktop.md, desktop-quickstart.md

---

## 14. Cross-Session Messaging & Worktrees

### What It Does

**Status:** Generally available (stable)  
**Availability:** CLI, Desktop, Agent SDK.

Sessions can query and message each other using built-in tools. Git worktrees isolate each session's file edits to prevent conflicts.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **SendMessage tool** | Sessions can send text to any other named session on this machine, another machine, or in cloud |
| **Session discovery** | Can list other sessions to find the one to message |
| **Message delivery** | Messages land in recipient's conversation; recipient can reply |
| **Worktree isolation** | Each session (via agent view, subagent in worktree mode, or manual setup) gets its own git branch and checkout |
| **Worktree cleanup** | Automatic or manual cleanup when session ends |

#### Maps to Criteria

- **D (interruption):** Partial; can coordinate between sessions via messaging.
- **E (Claude Code specific):** Yes; CLI and Desktop.

**Source:** https://code.claude.com/docs/en/cross-session-messaging.md, worktrees.md

---

## 15. GitHub Integration & Auto-Fix

### What It Does

**Status:** Generally available (stable)  
**Availability:** Claude Code on the web, routines, Managed Agents (via MCP).

Claude can watch pull requests, respond to CI failures and review comments, and auto-fix. Works via GitHub App webhooks or periodic polling.

#### Capabilities

| Feature | Detail |
|---------|--------|
| **PR monitoring** | Turn on auto-fix toggle; Claude receives webhooks for PR events |
| **CI failure response** | Claude investigates failed checks, proposes fixes, and pushes |
| **Review comment handling** | Claude reads comments, asks for clarification if ambiguous, makes changes if clear |
| **Duplicate/no-op handling** | Claude notes and skips duplicates or redundant events |
| **Conflict detection** | GitHub does not webhook merge conflicts; user must ask Claude to rebase |
| **Comment threading** | Claude replies on GitHub using your account (labeled as Claude Code) |
| **Comment-triggered automation** | Terraform Cloud, Atlantis, custom Actions fire on Claude's PR replies |
| **Routine triggers** | Routine can react to PR events (opened, closed, merged, etc.) with filters |

#### Limits

- **Comment-triggered risks:** If your repo has automation on issue_comment events, Claude's replies can trigger unintended workflows (e.g., deploy infrastructure).

#### Maps to Criteria

- **A–B:** No direct support.
- **C (tracking):** Yes; PR status visible in session.
- **D (interruption):** No; auto-fix runs autonomously.

---

## 16. Anthropic Guidance: Effective Harnesses for Long-Running Agents

### What the Engineering Blog Post Says

From https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents:

**Key Principles**

1. **Two-part architecture:** Initialize once with a specialized setup agent that creates progress tracking, feature lists, and foundational structure. Then run incremental coding agents, each tackling one feature.
2. **Persistent state across sessions:** Use progress files (document completed work), git history (revert failures), and feature lists in JSON (resists unwanted edits better than Markdown).
3. **Session initialization protocol:** Each agent session verifies the working directory, reviews progress, selects the next incomplete feature, runs basic tests, then implements.
4. **Failure modes to avoid:** 
   - Premature completion (mark features done too early)
   - Undocumented progress (no feature list; agent can't see what's done)
   - Inadequate testing (changes don't work when next agent arrives)
   - Operational confusion (agent doesn't know what to do next)

**Notable Absence:**

The post does NOT address approval gates, human interruption discipline, or governance structures for agent oversight. It focuses on technical orchestration to maintain state coherence across many context windows.

---

## 17. What a Native-Only Assembly Would Look Like

Given the above capabilities, here is the most plausible native-only orchestration for A–F:

### Architecture: "Lead + Workflow Teams"

```
┌─────────────────────────────────────────────────────────────┐
│ Morning Intake (Criterion A)                                │
│                                                              │
│ • User runs: `claude /plan-day` (custom skill in repo)      │
│ • Skill asks for mission/tickets; Claude writes goal.md     │
│ • Goal is committed to repo and version-controlled           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Breakdown & Approval (Criterion B)                          │
│                                                              │
│ Option 1 (Agent Teams):                                     │
│ • Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1                │
│ • Lead session reads goal.md                                │
│ • Lead spawns teammates (architect, reviewer, etc.)         │
│ • Lead uses Plan mode; teammates plan before editing        │
│ • User reviews team's plan in agent panel; approves         │
│                                                              │
│ Option 2 (Workflows):                                       │
│ • Type `ultracode: break this work into phases...`          │
│ • Claude writes workflow script; user approves in UI        │
│ • Workflow runs; each phase spawns agents in parallel       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Continuous Tracking (Criterion C)                           │
│                                                              │
│ Option 1 (Agent Teams):                                     │
│ • Lead's agent panel shows teammate list + idle/working     │
│ • Task list at ~/.claude/tasks/{team}/                      │
│ • `/tasks` in lead terminal lists all work                  │
│ • TeammateIdle, TaskCompleted hooks trigger custom logging  │
│                                                              │
│ Option 2 (Workflows):                                       │
│ • `/workflows` view shows phases, agent count, tokens       │
│ • Can drill into any phase to see agent results             │
│ • Progress bar visible in task panel while session open     │
│                                                              │
│ Option 3 (Agent View + Routines):                           │
│ • Dispatch each phase as separate background session        │
│ • `claude agents` shows all sessions at glance              │
│ • Routine runs for next day's batch work autonomously       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Interruption Discipline (Criterion D) — WEAKEST POINT      │
│                                                              │
│ Partial workaround using hooks:                             │
│ • PostToolUse hook: log each tool call to a digest file     │
│ • Notification hook (idle_prompt, permission_prompt):      │
│   write question to ~/.claude/pending-questions.jsonl       │
│ • Custom skill `/digest` runs every 60min:                  │
│   reads pending-questions.jsonl, batches into email/Slack   │
│ • User reviews digest once per hour                         │
│ • User answers in batch via `/answer-batch <json>`          │
│                                                              │
│ Gaps:                                                        │
│ • No native "hold questions for 60min" gate                 │
│ • No urgent/routine classification                          │
│ • No first-class escalation priority                        │
│ • Batching requires custom skill + manual implementation    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Verification & Acceptance (Criterion C Continued)          │
│                                                              │
│ • TaskCompleted hook triggers verification subagent         │
│ • Verification subagent runs tests, reviews diffs           │
│ • Findings logged; lead or human can re-open task           │
│ • Stop hook: after each turn, check completion condition    │
│   via `/goal` or custom evaluator                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Unified Visibility (Criterion F)                            │
│                                                              │
│ • Primary: Desktop app sidebar (all local + cloud sessions) │
│ • Secondary: claude.ai/code web UI (cloud-only)             │
│ • Mobile: Claude app Code tab (mirror of web + Remote Ctrl) │
│ • Monitoring: `/tasks` in CLI shows background work         │
│ • MCP connector to Slack/Linear: post digest & updates      │
│                                                              │
│ Gaps:                                                        │
│ • No single unified dashboard                               │
│ • Sessions scatter across Desktop, web, CLI, mobile         │
│ • Questions/interruptions not centralized                   │
│ • Would require building custom dashboard UI                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Implementation Details                                      │
│                                                              │
│ Settings (~/.claude/settings.json or .claude/settings.json):
│                                                              │
│ {                                                           │
│   "env": {                                                  │
│     "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"             │
│   },                                                        │
│   "hooks": {                                                │
│     "TaskCompleted": [                                      │
│       {                                                     │
│         "matcher": "",                                      │
│         "hooks": [                                          │
│           {                                                 │
│             "type": "command",                              │
│             "command": "script to spawn verification sub"   │
│           }                                                 │
│         ]                                                   │
│       }                                                     │
│     ],                                                      │
│     "Notification": [                                       │
│       {                                                     │
│         "matcher": "permission_prompt,idle_prompt",         │
│         "hooks": [                                          │
│           {                                                 │
│             "type": "command",                              │
│             "command": "append to digest file"              │
│           }                                                 │
│         ]                                                   │
│       }                                                     │
│     ]                                                       │
│   }                                                         │
│ }                                                           │
│                                                              │
│ Codebase:                                                   │
│ • .claude/skills/plan-day.md: intake skill                  │
│ • .claude/skills/digest.md: batch questions skill           │
│ • .claude/agents/verifier.md: verification subagent         │
│ • goal.md (or goals.json): persisted daily mission         │
│ • .claude/workflows/daily-audit.js: if using workflows      │
└─────────────────────────────────────────────────────────────┘
```

### Workflow Diagram

```
    Day 0 Evening (Intake)
             ↓
      claude /plan-day
             ↓
      goal.md written & committed
             ↓
    ═════════════════════════════════════════
    Day 1 Morning (Execution)
             ↓
   ┌─────────┴────────────┐
   │                      │
   v (Teams enabled)      v (Workflows)
   
   Lead session        Claude writes
   |                   orchestration
   +→ Teammates        script
   |  (architect)      |
   |  (coder)          +→ Phase 1 agents
   |  (reviewer)       +→ Phase 2 agents
   |                   +→ Phase 3 agents
   │                   |
   └────┬──────────────┘
        │
        v (Both routes)
   
   Verification
   (subagent runs tests)
   │
   v
   
   Digest Hook
   (batches questions every 60min)
   │
   v
   
   User Review (Email/Slack)
   │
   v
   
   `/answer-batch` command
   │
   v
   
   Sessions resume with answers
   │
   v
   
   Track in Desktop sidebar or claude.ai/code
```

### Mapping to Criteria

| Criterion | Coverage | Mechanism | Gap |
|-----------|----------|-----------|-----|
| **A (intake)** | Yes | `/plan-day` skill reads mission, writes goal.md | Requires custom skill |
| **B (breakdown)** | Partial | Agent Teams or Workflows split work into tasks/phases | Teams blocked by experimental flag; Workflows require user approval |
| **C (tracking)** | Partial | Agent panel, `/tasks`, `/workflows`, Desktop sidebar | No unified dashboard; must check multiple surfaces |
| **D (interruption)** | Poor | Custom hook-based digest + manual `/answer-batch` | No native batching, no urgent classification, manual implementation |
| **E (orchestration)** | Yes | Agent Teams + Workflows + Routines all native Claude Code | Depends on feature enablement (Teams experimental) |
| **F (visibility)** | Partial | Desktop sidebar for local; claude.ai/code for cloud; mobile app | Sessions scattered; no single control center; must build monitoring |

### Weaknesses of Native-Only Assembly

1. **No first-class "batch questions once per hour" gate** → Must implement via hooks + custom skill + manual answer. Prone to missed questions if hook/skill fails.

2. **Agent Teams experimental** → Requires environment variable flag. If it becomes unstable or is deprecated, the assembly breaks.

3. **Workflows are autonomous once running** → Cannot easily pause mid-phase for human approval between phases; each phase runs to completion or timeout.

4. **No urgent/routine escalation** → All interruptions fire at same priority. Cannot distinguish "PR review comment" from "deployment failed"; need custom classifier.

5. **Questions/approvals scatter** → Permission prompts in one place, Notification hooks in another, task status in `/tasks`, agent progress in agent panel. Would require building custom unified dashboard (essentially re-inventing Anthropic's control plane).

6. **No native agent memory/memory stores** → Agents don't retain cross-session learnings; each session starts fresh. Anthropic Managed Agents' "Dreams" feature could solve this but requires moving away from pure Claude Code.

7. **Multi-device coordination fragile** → Remote Control works but requires machine to stay on. Cloud sessions work but cannot be easily supervised centrally. Would need custom session supervisor application.

8. **Interruption during long-running Workflow** → If a Workflow is running 50 agents and the user wants to halt/redirect, the only option is press `p` to pause; cannot inject a mid-phase approval gate. Would need custom Workflow script that explicitly pauses.

9. **Async availability bias** → All mechanisms are "do work, report result" (post-hoc) rather than "wait for approval, then do work" (pre-act). Goal completion is checked post-turn, not pre-turn.

10. **Context fragmentation** → Workflow agent results live in script variables, not in main conversation. Agent Team messages live in mailboxes, not in main lead conversation. Task list is separate JSON. Would need to continuously pull these together for a human-facing "state of the work" document.

---

## 18. Recommended Path Forward

### If You Can Wait for Stabilization (6–12 months)

1. **Agent Teams** will likely graduate from experimental status.
   - Expect better resumption, cleaner shutdown, and lead->teammate promotion.
   - Hooks will mature for phase gates and approval chains.

2. **Managed Agents** will mature.
   - May support stateless execution (no server-side persistence requirement).
   - MCP tunnels will be stable for private network access.
   - Could run a Managed Agent as the "lead" that spawns Claude Code teams as workers.

3. **Unified orchestration dashboard** may arrive.
   - Current roadmap mentions "FleetView" as a potential future feature (mentioned in system prompts but not yet publicly documented).
   - Would centralize all agent state, questions, and notifications.

### If You Need to Ship Now

**Hybrid Approach: Agent SDK + Native Features**

```
Build a lightweight Agent SDK application (Python/TypeScript) that:

1. Reads goal.md from your repo (intake via skill or manual entry)
2. Spawns one local Claude Code session per phase/workstream
   (via Agent SDK or `subprocess claude --bg`)
3. Monitors each session's transcript (via sessionStore adapter)
4. Collects AskUserQuestion calls into a digest
5. Batches digest delivery once per hour via email/Slack
6. Injects user answers back into each session
7. Tracks completion via hooks (SessionEnd, Stop hook verdicts)
8. Builds a custom dashboard (web app) showing all sessions + questions + status

Cost: ~2 weeks of engineering to build the SDK harness + API integration + dashboard UI.
Benefit: Criteria A–D fully addressed; F mostly covered; E works (orchestrates Claude Code).
```

**Pure Native Approach (if no custom code allowed):**

```
1. Use Workflows + Routines for unattended multi-phase work (overnight batch)
2. Use Agent Teams (experimental) for interactive breakdowns during the day
3. Use Desktop app sidebar as the primary "one place to look"
4. Use `/loop` or `/goal` for polling/continuation
5. Implement custom `.claude/skills/digest.md` skill for batching questions
6. Accept that criterion D (true batching) will remain weak
7. Trade-off: lower friction, no custom code, but higher context-switch burden on human
```

---

## Appendix: Source Documentation

| Topic | Primary URL | Status |
|-------|-------------|--------|
| Agent Teams | https://code.claude.com/docs/en/agent-teams.md | Experimental |
| Subagents | https://code.claude.com/docs/en/sub-agents.md | Stable |
| Workflows | https://code.claude.com/docs/en/workflows.md | Stable |
| Agent View | https://code.claude.com/docs/en/agent-view.md | Research Preview |
| Routines | https://code.claude.com/docs/en/routines.md | Research Preview |
| Remote Control | https://code.claude.com/docs/en/remote-control.md | Stable |
| Claude Code on Web | https://code.claude.com/docs/en/claude-code-on-the-web.md | Research Preview |
| Claude Tag | https://code.claude.com/docs/en/claude-tag.md | Stable (Team/Ent only) |
| Hooks | https://code.claude.com/docs/en/hooks-guide.md | Stable |
| Scheduled Tasks | https://code.claude.com/docs/en/scheduled-tasks.md | Stable |
| /goal | https://code.claude.com/docs/en/goal.md | Stable |
| Desktop | https://code.claude.com/docs/en/desktop.md | Stable |
| Mobile | https://code.claude.com/docs/en/mobile.md | Stable |
| Agent SDK | https://code.claude.com/docs/en/agent-sdk/overview.md | Stable |
| Managed Agents | https://platform.claude.com/docs/en/managed-agents/overview | Beta |
| Effective Harnesses | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | Reference (no approval gates) |

---

**End of Report**
