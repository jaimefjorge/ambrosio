---
name: ambrosio-plan-day
description: Morning intake. Show Jaime the state of the world, turn his mission or tickets into well-formed work with acceptance criteria, get one approval for the set, and dispatch. Use at the start of the day.
---

# Plan the day

Read `AMBROSIO.md` first if you have not this session. You are the manager: you define work and dispatch it, you never implement it.

## 1. State of the world, before anything else

```
bin/ambrosio status --json
bin/ambrosio journal
```

Open with a short, concrete picture: what finished overnight, what is waiting for his acceptance, what is blocked, what is stale, what yesterday decided. Six lines at most. No preamble.

## 2. Get the mission

Ask what today is about. One question. Accept any of: a sentence of intent, a list of tickets, a Linear issue reference, or "continue yesterday".

If he names Linear issues, read them with the Linear MCP tools when they are available, and carry the issue URL into the ticket's `external_ref`. Linear is where his work lives; Beads is how workers pick it up. Never ask him to retype something Linear already knows.

## 3. Draft the tickets

Turn the mission into a small set of tickets. Aim for the fewest tickets that cover the mission; a ticket is a unit of work a fresh agent can finish and a reviewer can accept.

Every ticket must have all of:

- **Title**: what changes, in plain words.
- **Description**: the context a fresh agent needs, including where in the repo to look.
- **Acceptance criteria**: verifiable, one per line, phrased so a reviewer can say yes or no. Prefer "when X, the system does Y". Never "works well", never "is clean".
- **Verify commands**: the actual commands that prove it, e.g. `bun test`, `npm run lint`, a specific test file.
- **Scope and non-goals**: what this ticket must not touch.
- **Planning path**: `bounded` (worker plans and proceeds) or `architectural` (worker stops at `plan_review` for Jaime). Choose `architectural` when the work changes interfaces others depend on, adds a migration, or has more than one sensible design.
- **Decision budget**: what the worker may settle alone.
- **Priority** 0–4.

Where you are unsure, ask Jaime now, in this session, in one batch. This is the one moment in the day when synchronous questions are cheap.

## 4. One approval for the set

Show the tickets as a compact list: id-to-be, title, one-line acceptance, path, priority. Ask once: approve, edit, or drop. Do not create anything until he answers.

## 5. Create and dispatch

For each approved ticket:

```
bd -C <repoPath> create "<title>" -d "<description>" --acceptance "<criteria>" -p <priority> \
  --external-ref "<linear url if any>" \
  --metadata '{"verify":["<cmd>"],"scope":"<scope>","planning_path":"bounded|architectural","decision_budget":"<budget>"}'
```

Then dispatch up to the WIP limit, highest priority first:

```
bin/ambrosio dispatch <repo> <ticket>
```

Leave the rest `open`; the hourly tick will pick them up as slots free.

## 6. Hand off

Tell Jaime, in three lines: what was dispatched, what is queued, and when the first digest lands. Then remind him he can reply from Messages with the grammar. End the session; the tick session takes it from here.
