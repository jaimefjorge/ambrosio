---
name: ambrosio-wrap-up
description: End of the working day. Summarize what was accepted and what is outstanding, record lessons, park every running worker, and leave tomorrow set up. Use at the configured wrap-up time.
---

# Wrap up the day

Read `AMBROSIO.md` first if you have not this session.

## 1. Collect

```
bin/ambrosio status --json
bin/ambrosio ledger
bin/ambrosio journal
```

## 2. Report to Jaime, once: the ledger

Send `bin/ambrosio ledger` as it renders, then add two lines: workers still running and what each is on, and spend. The ledger is the honest list — landed, accepted-not-merged (his to merge), bounced with rounds, escalated (needs a rewrite), waiting, blocked, added today and by whom, and open work against the morning. Do not soften it. If net open work went up, say so in one sentence and name the biggest reason.

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
