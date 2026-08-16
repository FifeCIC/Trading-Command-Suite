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
