# Ambrosio — setup and the morning runbook

## One-time setup

1. **Set your iMessage handle** in `ambrosio.config.json` — the phone number or Apple ID you text yourself with:
   ```json
   "imessage": { "handle": "+3519xxxxxxx" }
   ```
2. **Give your terminal Full Disk Access** (System Settings → Privacy & Security → Full Disk Access) so the iMessage channel can read the Messages database. Restart the terminal afterwards.
3. **Text yourself once** in Messages so a self-chat exists.
4. **Run setup** and fix anything it lists:
   ```
   bin/ambrosio setup
   ```
   It checks the tools, creates `~/.ambrosio/`, and initializes Beads in each configured repo in stealth mode, so nothing beads-related is ever committed to your repos.

## Every morning

Two commands. Open two terminal tabs.

**Tab 1 — the desk.** Plan the day with Ambrosio:
```
cd ~/Workspace/ambrosio && claude
/ambrosio-plan-day
```
It shows you the state of the world, asks what today is about, drafts tickets with acceptance criteria, gets one approval from you, and dispatches up to the WIP limit.

**Tab 2 — the tick.** The session that watches the fleet and texts you:
```
cd ~/Workspace/ambrosio && claude --channels plugin:imessage@claude-plugins-official
/loop 60m /ambrosio-tick
```

**Tab 3 — the watcher.** The hourly loop is what keeps Ambrosio from interrupting you; the watcher is what keeps you from waiting on it. It reads the Messages database every few seconds — no model, no tokens — and routes your replies the moment they land, so answering `Q1 b` resumes the parked worker in about a second instead of at the top of the hour. Replies that need judgment wake the manager once.

```sh
cd ~/Workspace/ambrosio && bin/ambrosio watch
```

Leave it running. Accept the Messages automation prompt the first time it replies. Everything after this happens in Messages.

At the end of the day, in tab 1: `/ambrosio-wrap-up`.

## Replying from Messages

One item per line, case-insensitive:

```
Q3 b                          answer question 3 with option b
Q3 b: also update the docs    ...with a note
P2 ok                         approve a plan
P2 change: split step 3       bounce a plan with feedback
A1 accept                     accept finished work
A1 reject: needs a test       reject with feedback
gmc-a1b defer                 park a ticket
gmc-a1b stop                  stop its worker
@gmc-a1b rebase on main       free text to that worker
status                        send me the board now
quiet until 15:00             stop digesting until then
```

Anything else is just a message to Ambrosio, and it answers you directly.

## What you can run yourself

```
bin/ambrosio status           the board, as the digest would read
bin/ambrosio status --json    the same, for scripts
bin/ambrosio queue            questions parked for you
bin/ambrosio answer <qid> …   answer one and route it to the worker
bin/ambrosio dispatch <repo> <ticket>
bin/ambrosio digest --send    force a digest now
bin/ambrosio journal          today's decisions
```

## Things worth knowing

- **Workers edit in a worktree, not your checkout.** Claude Code moves each background session into `.claude/worktrees/<ticket>/` before it edits, so your working copy is never touched and parallel workers cannot collide. Review the branch or the PR, not the main checkout.
- **A worker never blocks on you.** If it needs a decision it asks once, the question lands in the queue, and it either carries on with independent work or parks the ticket at `needs_input`.
- **Answers restart the worker.** Ambrosio stops the parked session and resumes it under the same id with your decision, so it keeps its full context. Its memory is in `~/.ambrosio/work/<repo>/<ticket>/`.
- **Only you close a ticket.** Finished work waits in `in_review` with its PR, tests and Verity verdict attached.
- **Nothing reaches you outside working hours** (`hours` in the config). Out of hours, Ambrosio parks what is broken and tells you in the morning.
- **Running N workers uses your quota N times as fast.** That is what the WIP limit is for.

## Where things live

```
ambrosio.config.json   repos, WIP limit, hours, your handle
AMBROSIO.md            the charter the manager reads
worker/prompt.md       the contract every worker runs under
worker/hooks/          the guards that park questions and block risky commands
~/.ambrosio/queue/     parked questions
~/.ambrosio/work/      per-ticket memory: plan, log, evidence, sessions
~/.ambrosio/journal/   one file per day of decisions
```
