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
complete truth and drops every table with no model — and there are **10** such tables,
including the trade execution queue (`strategy_signal_queue`) and the #750 timestamp-repair
backups. It does not error; it warns and waits for a `y`.

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:check   # ALWAYS run first
```

**Full rules:** `.github/instructions/database-schema.instructions.md` · **Issue:** #769

Quick form: add columns with `ALTER TABLE` + `npx prisma generate` (API stopped — it locks
the query-engine DLL). Never `db push`.

## Stack operations

```powershell
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-launch.ps1   # start all 3
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-stop.ps1     # stop all 3
```

⚠️ `tcs-stop.ps1` stops the **whole** stack (MT5 bridge, NestJS, Vite) — not just one service.
