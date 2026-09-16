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
