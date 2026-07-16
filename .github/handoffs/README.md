# Handoff Files

Agent-to-Librarian handoff files. Each file is a completed unit of work that needs documentation updates (QA Testing, Capability Map, Architecture Framework).

## How It Works

1. **Every agent** writes a handoff file when completing work (mandatory via `agent-handoff.instructions.md`)
2. **The Librarian** reads all unprocessed handoffs and batch-updates the three documentation pages
3. **After processing**, the Librarian moves files to `processed/`

## Format

See `.github/instructions/agent-handoff.instructions.md` for the full template.

Quick reference:
```markdown
---
date: 2026-07-15
area: scoring
type: feature
---

## What Changed
{one sentence}

## Files Changed
- {path} — {reason}

## Capability Map Entry
- **name:** {Feature name}

## QA Test Entry
- **area:** {System Area}
- **name:** {Test name}
- **procedure:** {How to test}
- **expected:** {What result proves it works}

## Architecture Framework Entry
- **section:** {status|routes|data|directives|protocols}
- **summary:** {One-line SLICE entry}
```

## Token Economics

| Approach | Cost per feature |
|----------|-----------------|
| Agent self-updates 3 pages | ~65K tokens |
| Agent writes handoff + Librarian processes 5 batched | ~14K tokens per feature |

At 5 features per Librarian run: **78% token savings**.
