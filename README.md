```
     _              _                    _
    / \   _ __ ___ | |__  _ __ ___  ___ (_) ___
   / _ \ | '_ ` _ \| '_ \| '__/ _ \/ __|| |/ _ \
  / ___ \| | | | | | |_) | | | (_) \__ \| | (_) |
 /_/   \_\_| |_| |_|_.__/|_|  \___/|___/|_|\___/

        " o  s e u  m o r d o m o  d i g i t a l "
```

<pre>
 *~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*
     >>> WELCOME TO THE AMBROSIO HOME PAGE - EST. 1995 <<<
 *~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*
</pre>

```
    +----------------------------------------------------------+
    |  [!]  U N D E R   C O N S T R U C T I O N   [!]          |
    |       ( it is v0. it works. do not touch the wires. )    |
    +----------------------------------------------------------+
```

> **BEST VIEWED IN** NETSCAPE NAVIGATOR 3.0 @ 800x600 @ 256 COLOURS
> **THIS PAGE IS** `Y2K COMPLIANT` * `100% HAND-CODED` * `FRAMES-FREE`

---

## `[*]` WHAT IS THIS??

A manager for a fleet of Claude Code agents, built so **one person** can supervise
many of them **without being interrupted all day**.

You define the day's work once. Workers run as background Claude Code sessions, one
per ticket, each in its own git worktree. When a worker needs a decision it asks
**once** -- a hook records the question and tells the worker to keep going, so it
never sits blocked. Every question, plan and finished piece of work reaches you in a
single message at most once an hour, with the context needed to decide. Only
genuinely urgent things interrupt sooner. You answer from your phone in a few
keystrokes and the right worker picks up where it left off.

```
morning:  you + Ambrosio agree the day's tickets        (one conversation)
all day:  workers plan -> implement -> verify -> hand over (no interruptions)
hourly:   one message: decide, approve, accept          (five minutes)
15:00:    wrap up, park the fleet                       (one conversation)
```

---

## `[!]` WHY "AMBROSIO"?? `<-- NEW!! HOT!! CLICK HERE!!`

```
   ___________________________________________________
  |  ______________________________________________   |
  | |                                              |  |
  | |        [>]  P L A Y   V I D E O              |  |
  | |                                              |  |
  | |     "Ambrosio, apetece-me tomar algo..."     |  |
  | |______________________________________________|  |
  |___________________________________________________|
         \_____________________________________/
```

### **>> [CLICK HERE TO WATCH THE 1995 AD](https://www.youtube.com/watch?v=Ck5ar-1e8NY) <<**

Ambrósio is the butler in the Ferrero Rocher advert that has run on Portuguese
television every Christmas since **1995**. (He keeps his accent on TV; the repo drops
it, because 1995 filenames did not do accents either.) The Lady in the yellow hat says
she would like *tomar algo*; Ambrósio has already anticipated it, and the tray is on
its way.
He does not ask her to approve each step. He handles the reception, and he comes to
her **once**, with the decision already framed and the gold foil already unwrapped.

That is the whole design brief of this repo, and the reason it has that name.

*(Portugal liked the ad's famous grammatical slip so much that when Ferrero corrected
it, consumers wrote in by the hundreds demanding the mistake back. They got it. This
codebase aspires to that level of user feedback.)*

---

## `[*]` WHY IT EXISTS

Across roughly sixty orchestration tools surveyed in [`docs/research/`](docs/research/),
none batches agent questions on a schedule with an urgent tier and routes the answers
back. Claude Code shipped the primitives to do it -- background sessions, scriptable
session state, hooks that can intercept a question, two-way chat channels -- so
Ambrosio is a thin layer over them rather than another control plane.

---

## `[*]` SITE MAP :: HOW IT IS PUT TOGETHER

| Piece | What it does |
|---|---|
| `AMBROSIO.md` | The charter. What the manager may decide alone, what it must ask, the hard rules. |
| `.claude/skills/` | `ambrosio-plan-day`, `ambrosio-tick`, `ambrosio-wrap-up` -- the manager's three routines. |
| `worker/prompt.md` | The contract every worker runs under: plan, implement, verify with evidence, hand over. Never merge, never close a ticket. |
| `worker/hooks/` | Guards that park questions instead of blocking, turn unattended permission prompts into queue items, and refuse pushes to main. |
| `bin/ambrosio` | The CLI: `status`, `dispatch`, `queue`, `answer`, `digest`, `tick`, `setup`. |
| `src/` | Tracker (Beads), sessions, question queue, digest renderer, reply grammar, per-ticket memory. |

Tickets live in [Beads](https://github.com/gastownhall/beads) per repo. Quality is
gated by [Verity](https://verity.md). Messages arrive over the official iMessage
channel plugin.

---

## `[*]` GETTING STARTED

[`docs/SETUP.md`](docs/SETUP.md) is the runbook. [`docs/SECOND-MACHINE.md`](docs/SECOND-MACHINE.md)
covers running it elsewhere. [`docs/STATUS.md`](docs/STATUS.md) says what is built and
what is not.

```sh
bin/ambrosio setup     # generates machine-local config, initializes Beads
bun test               # 64 tests
```

---

## `[*]` STATUS

v0, working and rehearsed end to end. Not published as a product, not packaged for
anyone else's setup yet.

```
    +----------------------------------------------------------+
    |   YOU ARE VISITOR NUMBER:  [0][0][0][0][0][0][4][2]      |
    +----------------------------------------------------------+
```

<pre>
 *~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*
</pre>

- `[@]` **SIGN THE GUESTBOOK** -> [open an issue](../../issues)
- `[#]` **LAST UPDATED** -> 07/09/2026
- `[&]` **THIS SITE IS PROUDLY POWERED BY** -> Bun, TypeScript, and one very patient butler

<pre>
                  Made with a text editor and no CSS.
 *~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*
</pre>
