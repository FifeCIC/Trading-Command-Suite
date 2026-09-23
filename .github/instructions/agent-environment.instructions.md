---
description: "Environment tooling available to agents. Use these before asking the user to provide information manually."
applyTo: "**"
---

# Agent Environment — Available Tooling

## GitHub CLI (`gh`)

GitHub issues, PRs, and labels are accessible via the `gh` CLI. Always use it rather than asking the user to paste issue content.

```bash
gh issue list --limit 50                  # list open issues
gh issue view <number>                    # full issue detail
gh issue create --title "..." --body "..." --label "..."
gh issue close <number> --comment "..."
gh pr list
gh pr view <number>
```

Never ask the user to manually copy/paste GitHub issue content — fetch it directly.

## 🛑 Committing — the git index is SHARED between agents

**All agents run in ONE working tree.** When another agent runs `git add`, their files sit in the
same index you are about to commit, and `git commit -m "..."` with no pathspec commits **the whole
index**.

Measured 2026-09-23: an agent ran `git add` for one file, printed `git diff --cached --name-status`
— which showed **15 files, 14 of them not theirs** — and committed anyway. The commit carried
another agent's editions work *including their `0.71.0 → 0.72.0` version bump* under a
`docs(handoff)` message. **The check worked and its output was ignored.**

**Use the wrapper instead of a bare `git commit`:**

```powershell
node scripts/commit-only.cjs -m "subject" -m "body para" -- <file> [<file>...]
node scripts/commit-only.cjs --check -- <file>        # report only, commit nothing
```

It (1) commits by explicit pathspec so only your files go in, (2) **reads the commit back** and
asserts the file set matches — because a command reporting success is a claim, and the commit's own
file list is the evidence, and (3) reports anything staged that it is deliberately skipping. A named
file with **no changes is refused**: naming a file claims it changed.

### Commit cadence — one commit per logical change, and do not narrate it

**Measured 2026-09-23:** 41 commits in 4.5 hours across all agents; **18** of them ≤2 minutes
apart; 10 touched a single file. That is not agent indiscipline — three instruction files each
*independently* force a commit (`change-completion` says land the code; the handoff rule said bump
the version on every handoff; the close checklist says comment). One logical change therefore
emitted six artefacts.

**The cost is the owner's attention, and attention is the safety net here.** Every rule in this repo
rests on a human reading the evidence. A commit every 3 minutes trains that reader to skim — and a
skimmed evidence trail is the same as no evidence trail. **Noise is a correctness problem here, not
a cosmetic one.**

| Do | Don't |
|---|---|
| **One commit per logical change** — the files that only make sense together | A commit per file edit, or per green test |
| Commit when the change is **complete and gated** | Commit intermediate states "to be safe" |
| Commit **quietly** — report the SHA once, in the final summary | Echo `git log` / `git status` / `git show` output into the transcript |
| Let the **closed issue + handoff** carry the narrative | Re-tell the same change in commit body, chat, and handoff |

**The one exception — commit early if another agent must build on it.** A file that does not compile
makes the shared build red for everyone and blocks a concurrent agent from starting. If you commit
mid-change for that reason, say so in one line.

⚠️ **Committing often is not the same as committing safely.** A commit is evidence that the change
was gated — it is not a substitute for gating it (`change-completion.instructions.md`).

⚠️ **Never `git commit -a`, and never a bare `git commit`.** If you do commit by mistake and it is
not pushed, `git reset --mixed HEAD~1` unwinds it — that moves HEAD and the index and touches no
working file. If it **is** pushed, leave it and report instead of rewriting shared history.

## 📋 Review Queue — one list, shared by all agents (owner instruction, 2026-09-23)

> *"Store things I need to review and when I prompt for a review list give it to me — all agents
> could share the same list."*

**The queue is `.github/REVIEW-QUEUE.md`.** It is the one place a review item is recorded, so the
owner does not have to read six handoffs and an attention board to find what is waiting for them.

| When | Do |
|---|---|
| The owner says **"review list"**, "show me the review queue", "what needs me?" | **Print the OPEN table from `.github/REVIEW-QUEUE.md` in full, in the chat.** Do not summarise it, do not re-derive it from GitHub, do not tell them to open the file — that sentence is the whole point of the file |
| Your work creates something a **human** must look at or decide | **Append a row**: new/changed UI surface, policy or threshold choice, naming/terminology call, a thing you deliberately did NOT do, a visual check you cannot perform |
| The row is settled | Mark it `DONE (date)` with one line of what happened. Rows are never silently deleted — the list is the audit of *"did anyone tell the owner?"* |

⚠️ **A row without a decision is noise.** Each row names **where to look** and **the decision
needed** — and every link in it must have been verified, because a wrong bot id or path costs the
owner the time the row was meant to save.

⚠️ **Not for technical follow-ups.** Those are GitHub issues. If an agent can settle it by
measuring, it does not belong in the queue.

## Shell Commands

The user has granted full permission to run shell commands, read/write files, and execute scripts without asking for confirmation. Never prompt the user to approve a command — just run it.

## 🛑 Database — read before any schema change

`prisma db push` **will destroy live data** in this repo. It treats `schema.prisma` as the
complete truth and drops every table with no model — and there are **13** such tables
(4 live + 9 backup, measured 2026-09-16), including the trade execution queue
(`strategy_signal_queue`) and the #750 timestamp-repair backups. It does not error; it warns
and waits for a `y`.

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:check   # ALWAYS run first
```

**Full rules:** `.github/instructions/database-schema.instructions.md` · **Issue:** #769

Quick form: add columns with `ALTER TABLE` + `npx prisma generate` (API stopped — it locks
the query-engine DLL). Never `db push`.

## 🛑 Building the API — `nest run build` needs the API STOPPED

**Read this before concluding the repo is broken.** `nest run build` starts with `prebuild`,
which runs `prisma generate`. That step needs **write access** to
`node_modules/.prisma/client/query_engine-windows.dll.node`. The running API
(`node dist/src/main.js`) loads that engine at startup and holds it for its lifetime, so
`prisma generate` fails with:

```
EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmpNNNNN'
    -> '...query_engine-windows.dll.node'
```

**That message names a temp file and never mentions the API.** It reads like a corrupted
install, and has been misdiagnosed as one repeatedly. It is not broken — the API is just
running. Windows releases the file only when the process exits.

**Use this instead:**

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run build:api
```

Stop API → build → restart API → verify health. This is the normal way to build the API now.

Other useful forms:

```powershell
# Check first, build nothing
npm --prefix C:\wamp64\www\trading-command-suite\nest run build:preflight
#   exit 0 = engine free      exit 1 = blocked, names the holding PID

# Build with the API deliberately left down (e.g. before a manual launch)
npm --prefix C:\wamp64\www\trading-command-suite\nest run build -SkipRestart   # via build-api.ps1
```

`build-preflight.cjs` runs FIRST in `prebuild`, so a plain `npm run build` now **refuses to
start** rather than emitting the confusing EPERM — you get the PID, the command line, and the
fix.

**TypeScript only, no Prisma?** `npx tsc -p tsconfig.build.json --noEmit` works with the API
running and is enough to verify a `.ts` change type-checks.

⚠️ Don't confuse this with the frontend — `npm run build` **from the repo root** is Vite and
involves no Prisma, so it works with everything running.

## Stack operations

```powershell
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-launch.ps1   # start all 3
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-stop.ps1     # stop all 3
```

⚠️ `tcs-stop.ps1` stops the **whole** stack (MT5 bridge, NestJS, Vite) — not just one service.
