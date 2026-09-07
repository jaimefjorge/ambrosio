# Ambrosio

A manager for a fleet of Claude Code agents, built so one person can supervise many of them without being interrupted all day.

You define the day's work once. Workers run as background Claude Code sessions, one per ticket, each in its own git worktree. When a worker needs a decision it asks **once**; a hook records the question and tells the worker to keep going, so it never sits blocked. Every question, plan and finished piece of work reaches you in a single message at most once an hour, with the context needed to decide. Only genuinely urgent things interrupt sooner. You answer from your phone in a few keystrokes and the right worker picks up where it left off.

```
morning:  you + Ambrosio agree the day's tickets        (one conversation)
all day:  workers plan → implement → verify → hand over (no interruptions)
hourly:   one message: decide, approve, accept          (five minutes)
15:00:    wrap up, park the fleet                       (one conversation)
```

## Why it exists

Across roughly sixty orchestration tools surveyed in `docs/research/`, none batches agent questions on a schedule with an urgent tier and routes the answers back. Claude Code shipped the primitives to do it — background sessions, scriptable session state, hooks that can intercept a question, two-way chat channels — so Ambrosio is a thin layer over them rather than another control plane.

## How it is put together

| Piece | What it does |
|---|---|
| `AMBROSIO.md` | The charter. What the manager may decide alone, what it must ask, the hard rules. |
| `.claude/skills/` | `ambrosio-plan-day`, `ambrosio-tick`, `ambrosio-wrap-up` — the manager's three routines. |
| `worker/prompt.md` | The contract every worker runs under: plan, implement, verify with evidence, hand over. Never merge, never close a ticket. |
| `worker/hooks/` | Guards that park questions instead of blocking, turn unattended permission prompts into queue items, and refuse pushes to main. |
| `bin/ambrosio` | The CLI: `status`, `dispatch`, `queue`, `answer`, `digest`, `tick`, `setup`. |
| `src/` | Tracker (Beads), sessions, question queue, digest renderer, reply grammar, per-ticket memory. |

Tickets live in [Beads](https://github.com/gastownhall/beads) per repo. Quality is gated by [Verity](https://verity.md). Messages arrive over the official iMessage channel plugin.

## Getting started

`docs/SETUP.md` is the runbook. `docs/SECOND-MACHINE.md` covers running it elsewhere. `docs/STATUS.md` says what is built and what is not.

```
bin/ambrosio setup     # generates machine-local config, initializes Beads
bun test               # 58 tests
```

## Status

v0, working and rehearsed end to end. Not published as a product, not packaged for anyone else's setup yet.
