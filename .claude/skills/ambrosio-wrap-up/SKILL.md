---
name: ambrosio-wrap-up
description: End of the working day. Summarize what was accepted and what is outstanding, record lessons, park every running worker, and leave tomorrow set up. Use at the configured wrap-up time.
---

# Wrap up the day

Read `AMBROSIO.md` first if you have not this session.

## 1. Collect

```
bin/ambrosio status --json
bin/ambrosio journal
```

## 2. Report to Jaime, once

One message, in this order:

- **Accepted today**: tickets he closed, with PR links.
- **Waiting on you**: anything still in `plan_review`, `in_review` or `needs_input`. This is the honest list; do not soften it.
- **In flight**: workers still running, and what each is on.
- **Blocked**: with the reason in a few words each.
- **Spend**: total tokens today.

Keep it under fifteen lines. It is a summary, not a transcript.

## 3. Park the fleet

The day ends. For every running worker:

- If it is close to a hand-over (its ticket is `verifying`), let it finish, then check again in a few minutes.
- Otherwise ask it to write its state into the ticket's work log, then `claude stop <session>`. Set its ticket to `needs_input` or leave it `in_progress` with a comment saying where it stopped. Never leave a worker running unsupervised overnight unless Jaime explicitly said to.

## 4. Record lessons

Append to today's journal, in Jaime's words where he gave them:

- Decisions made today and why, so tomorrow's Ambrosio does not re-ask.
- Questions that turned out to be unnecessary — those are prompt or ticket bugs worth fixing.
- Anything that made a worker stall.

If a lesson is about code quality in a specific repo, that belongs in Verity's knowledge base rather than here; say so and let Jaime run the reflection.

## 5. Set up tomorrow

List the tickets that should lead tomorrow, in order, and say so in one line. Do not create them yet — that is the morning's job with Jaime present.

## 6. Go quiet

After this message, send nothing until tomorrow's planning time unless Jaime writes first.
