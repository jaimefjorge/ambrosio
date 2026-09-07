# Running Ambrosio on another computer

## What travels, and what does not

| Thing | Travels? |
|---|---|
| Ambrosio's code, skills, charter, worker contract, hooks | Yes, through git |
| `ambrosio.config.json`, `worker/settings.json` | No — both hold absolute paths. `ambrosio setup` regenerates them from the templates on each machine. They are gitignored on purpose. |
| **Beads tickets** | **No.** Beads runs in stealth mode, so its Dolt database lives in `.beads/` and is excluded from git. Each machine has its own tickets. |
| Parked questions, per-ticket memory, the journal (`~/.ambrosio/`) | No — machine-local |
| Worker sessions | No — background sessions are local to the machine that started them |

The one that will surprise you is Beads. See "Sharing tickets" below.

## Steps

**1. Push this repo somewhere you can reach.** It has no remote yet:

```
gh repo create ambrosio --private --source=. --remote=origin --push
```

**2. On the other machine, install the dependencies.**

```
brew install beads jq gh          # beads pulls in dolt
curl -fsSL https://bun.sh/install | bash
```
Claude Code must already be installed and signed in there (`claude auth`).

**3. Clone and set up.**

```
git clone <your remote> ~/Workspace/ambrosio
cd ~/Workspace/ambrosio
bin/ambrosio setup
```

Setup writes `ambrosio.config.json` from the example and `worker/settings.json` with this machine's paths, creates `~/.ambrosio/`, and initializes Beads in each configured repo.

**4. Edit `ambrosio.config.json`** for that machine: the repo paths (the example uses `~/Workspace/...`, which is expanded automatically), your iMessage handle, and the WIP limit if the machine is smaller. Then run `bin/ambrosio setup` again to confirm it is clean.

**5. Only if the other machine is a Mac:** install the channel and grant permissions.

```
claude plugin install imessage@claude-plugins-official -s user
```
Then Full Disk Access for the terminal, and text yourself once. Same as the first machine.

**6. If it is not a Mac,** iMessage is unavailable. Swap the channel for Telegram, which is the same shape:

```
claude plugin install telegram@claude-plugins-official -s user
/telegram:configure <bot token from BotFather>
claude --channels plugin:telegram@claude-plugins-official
```
Then replace `src/imessage.ts`'s `send` with a Telegram call, or simply let the tick session reply through the channel's own reply tool and stop using `ambrosio send`.

## Run one manager, not two

Two machines both running `/loop 60m /ambrosio-tick` would text you two digests and could dispatch the same ticket twice. **Designate one machine as the manager** and run the tick session only there. The other machine can still run `bin/ambrosio status`, `dispatch` and `answer` by hand for its own repos.

## Sharing tickets between machines

Three options, cheapest first:

1. **Do not.** Plan the day on whichever machine you are working on. Each machine's tickets are its own. This is fine if the two machines cover different repos.
2. **Linear as the shared source of truth.** This is what the v1 bridge is for: Linear holds the work and the context, each machine imports what it is going to run into its local Beads, and status flows back to Linear. Since Linear is already where your work lives, this is the intended answer.
3. **A Dolt remote per repo.** Beads can push and pull its database (`bd dolt push` / `bd dolt pull`). It genuinely syncs tickets, but it adds a hosted Dolt dependency and a sync step you have to remember, and Beads' own docs warn that claims are replica-local and lag by a sync cycle. Only worth it if you truly need the same ticket queue on both machines.

## Quick check that it works

```
bun test                 # 58 tests, all should pass
bin/ambrosio status      # should print a board, not an error
bin/ambrosio setup       # should report no TODOs
```
