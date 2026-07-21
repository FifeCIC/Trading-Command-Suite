---
description: "MANDATORY — Every agent MUST write a handoff file when completing work. The Librarian agent batch-processes these to update the QA Testing page, Capability Map, and Architecture Framework. No agent discretion required — always write the file."
applyTo: "nest/src/**, src/pages/**, src/components/**, src/data/**, src/core/**, scripts/**"
---

# Agent Handoff Rule — ALWAYS APPLY

When you complete ANY code change (feature, bug fix, refactor, test, documentation), you MUST write a handoff file to `.github/handoffs/` BEFORE calling `task_complete`.

**Do not make decisions about whether the change is "big enough."** Every change gets a handoff. The Librarian decides what to batch and when.

## ⚠️ GitHub CLI — Use the wrapper script

Running `gh` directly in PowerShell produces hundreds of lines of cosmetic parser errors (harmless but noisy). **Use the wrapper script instead** — it filters out the noise:

```powershell
pwsh -File scripts\gh-wrapper.ps1 <gh args>
```

Use the wrapper for ALL gh operations: issue create, issue close, issue comment, issue view, etc.

### Claiming an Issue (preventing duplicate work)

Before starting work on a GitHub issue, you MUST check if another agent has already claimed it:

```powershell
pwsh -File scripts\gh-wrapper.ps1 issue view {number} --repo FifeCIC/Trading-Command-Suite --json comments --jq '[.comments[].body] | any(contains("🤖 Claimed by"))'
```

- If the output is `true`, **pick a different issue** — that one is already being worked on.
- If the output is `false`, **claim it immediately** by commenting on the issue:

```powershell
pwsh -File scripts\gh-wrapper.ps1 issue comment {number} --repo FifeCIC/Trading-Command-Suite --body "🤖 Claimed by {agent-name} — started work on {date} {time} UTC"
```

Replace `{agent-name}` with the name of the current agent (e.g. `TCS-Dev`, `Librarian`, `Ivy`).

When you close the issue, the closing comment replaces the claim. No cleanup needed.

## File Location

```
.github/handoffs/YYYY-MM-DD-{slug}.md
```

Example: `.github/handoffs/2026-07-15-metastack-fingerprint.md`

## Required Format

Write exactly this structure. Keep it terse — the Librarian only needs the facts:

```markdown
---
date: {ISO date}
area: {scoring|trading|automation|ui|data|risk|infra|docs}
type: {feature|bugfix|refactor|test|docs}
---

## What Changed

{One sentence describing the change.}

## Files Changed

- {path/to/file.ts} — {brief reason}
- {path/to/file.jsx} — {brief reason}

## Capability Map Entry

- **name:** {Feature name for Capability Map}
- **persistence:** {ephemeral|stored|config|cached|localStorage}
- **uiSurfaces:** {number}
- **pipeline:** {scoring|trading|both|none}
- **completion:** {complete|partial}

## QA Test Entry

- **area:** {System Area}
- **name:** {Test name}
- **procedure:** {How to test — 1-2 sentences}
- **expected:** {What result proves it works}

## Architecture Framework Entry

- **section:** {status|routes|data|directives|protocols}
- **summary:** {One-line SLICE entry — what exists, why, key files}
```

## Example (filled)

```markdown
---
date: 2026-07-15
area: scoring
type: feature
---

## What Changed

Added SHA-256 fingerprint tracking to MetaStack ratings so users can detect when their stack configuration has drifted from what produced the performance history.

## Files Changed

- nest/src/modules/scoring/stack-performance.service.ts — fingerprint computation + change detection
- nest/src/modules/scoring/scoring.controller.ts — GET /api/scoring/metastacks/:id/fingerprint endpoint
- nest/prisma/schema.prisma — fingerprint column on StackPerformance

## Capability Map Entry

- **name:** MetaStack Fingerprint Tracking
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** MetaStack fingerprint changes on config drift
- **procedure:** GET /api/scoring/metastacks/{id}/fingerprint, then change a parameter on the scoring strategy, GET again
- **expected:** First call returns fingerprintChanged=false, second returns fingerprintChanged=true with different fingerprint

## Architecture Framework Entry

- **section:** scoring
- **summary:** MetaStack Fingerprint — SHA-256 hash of component state (protocol, watchlist symbols, broker, thresholds, SL/TP). Detects configuration drift so UI can warn when performance history is stale. Files: stack-performance.service.ts, scoring.controller.ts. Endpoint: GET /api/scoring/metastacks/:id/fingerprint.
```

## Why This Exists

This file costs ~200-400 tokens to write. If the agent self-updated the QA page, Capability Map, and Architecture Framework directly, it would cost ~60K tokens (reading 3 large files). When 5 features are batched, the Librarian processes all handoffs in one run — 66K tokens vs 325K (78% savings).

## What the Librarian Does

When processing handoffs, the Librarian invokes the `update-architecture-framework` skill (`.github/skills/update-architecture-framework/SKILL.md`) which handles:
- Updating `src/core/architecture-reference.js` (AI-readable system map)
- Updating `src/pages/architecture-framework.data.js` (human-facing UI page)
- Adding route contracts, SLICE entries, and database schema changes
- Deleting processed handoff files (git history preserves them if ever needed)

The `processed/` subdirectory is **not used** — the Librarian deletes handoffs after processing. Git history is the permanent record.
