---
description: "Write a handoff file when closing a GitHub issue, when a change alters a pipeline's data flow/behaviour/capability, or when adding a new feature. Skip cosmetic-only UI work. The Librarian batch-processes handoffs to update the QA Testing page, Capability Map, and Architecture Framework."
applyTo: "**"
---

# Agent Handoff Rule — WRITE WHEN IT MATTERS

> **2026-09-11 — two corrections to this rule, both from measured failures.**
>
> 1. **`applyTo` was `nest/src/**, src/pages/**, ...` — it did NOT include `docs/**`.** So this rule
>    never fired while an agent was editing documentation, and handoffs were written to the wrong
>    directory. **An instruction that does not fire is indistinguishable from one that does not
>    exist.** It is now `"**"` because a handoff is written about work that spans any file type.
> 2. **Handoffs do NOT live in the repo.** The canonical location is the central docs store,
>    **`G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\handoff\`** —
>    outside the app package, which becomes public. `.github/handoffs/` was removed 2026-09-11 and
>    `scripts/validate-agent-docs.cjs` still **fails the build** if it reappears.

Write a handoff file to **`G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\handoff\`** BEFORE calling `task_complete` **only** when the change is one of:

1. **Closing a GitHub issue** — work that resolves an issue gets a handoff so the Librarian records it in the QA page, Capability Map, and Architecture Framework.
2. **Pipeline / behaviour / capability change** — a change that alters a pipeline's data flow or behaviour: new or changed API endpoints, Prisma schema changes, scoring/gating/trading/automation logic, provider adapters, or data contracts.
3. **New feature** — a genuinely new capability the Capability Map or Architecture Framework should track.

**Skip the handoff** for cosmetic-only work: visual styling, layout, copy/label tweaks, badge/theme adjustments, and trivial refactors with no behavioural change.

Rule of thumb: if the change would not belong on the Capability Map or Architecture Framework, it does not need a handoff.

## ⚠️ Retention — GitHub Issues are the durable record (2026-09-13)

A handoff is **working material**, not a permanent local document. It carries reasoning from the
agent that did the work to the Librarian that records it.

- The **durable, searchable** record of *why* is the **closed GitHub issue** plus the docs the
  Librarian writes (QA page, Capability Map, Architecture Framework). Local files are **not**
  required long-term.
- Handoffs therefore live in the **central docs store**, never in the app package — they are **not**
  retained in the repo.
- **Never delete a handoff before it has been summarised.** That is the one rule that still matters;
  once recorded, the source may be archived in the central store.

⚠️ The 2026-09-11 loss was not "handoffs were deleted". It was that they were **written to a
directory nobody could find**. One canonical, discoverable location is the fix; permanence in the
repo is not required.

## ⚠️ A handoff must state what it did NOT do

**2026-09-11.** A handoff that reads as complete when the work was partial is the same defect as a
ticked checklist box that was never verified (#638). If you stopped short anywhere, say so
explicitly with the reason. Honest-partial is a pass; silent-partial is the failure.

## 🛑 If your change touched the database schema

Do this **before** writing the handoff — a schema change is the one class of change that can
destroy data, so it gets an explicit checkpoint:

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:check
```

It must print `✅ OK`. If it reports an undeclared non-empty table, either add the table to
`schema.prisma` or declare it in `nest/scripts/validate-schema-safety.cjs` with a reason and
an owning module — then re-run.

Also confirm in the handoff:

- **How** the schema changed (`ALTER TABLE` / targeted `CREATE TABLE` — **never** `db push`).
- Whether `schema.prisma` was updated **in the same commit** (it must be, or the model drifts
  from reality again).
- If you added a raw-managed table: that its DDL is in `nest/prisma/raw-managed/`.

**Never** run `prisma db push` or `db push --force-reset` to apply a schema change here. See
`.github/instructions/database-schema.instructions.md` and issue **#769**.

## ⚠️ Inline Documentation Comments — ALWAYS APPLY

When you edit code, you MUST add a documentation comment if you spent **3+ search/read operations** understanding the pattern before editing. These comments save future agents (and human developers) from re-discovering the same information.

### Comment format — system context blocks

Every function that is part of a larger pipeline should have a header comment showing its position:

```js
/**
 * closePosition() — STEP 5 of 6 in the trade lifecycle pipeline.
 * BEFORE: placeOrder() records the open trade with strategy tag.
 * AFTER:  tradeRecorder.record() persists the closed trade to DB.
 * NEXT:   Strategy Comparison page reads closed trades grouped by strategy.
 *
 * ⚠️ WARNING: MT5 position comments contain the strategy name.
 * The comment format is "Strategy Name | Score%". Do NOT change
 * the split logic without updating placeOrder()'s comment format.
 */
```

### What to document

| Situation | Minimum comment |
|-----------|----------------|
| Function is part of a pipeline | Which step, what comes before/after |
| Complex non-obvious logic | Why it works this way, not what it does |
| Data format contract | The exact format of data crossing a boundary |
| Known gotcha or fragile point | ⚠️ WARNING with the specific risk |
| Integration with another system | Which system, which endpoint/file |

### Concept comments — explain the REASONING, not just the mechanics

When a decision was made that isn't obvious from the code alone, add a sentence explaining the concept or theory behind it. These are the comments a human developer needs to understand WHY something was done a certain way — without having to reverse-engineer the git history and GitHub issues.

Examples of good reasoning comments:

```js
// IMPORTANT: Uses `include` (not `select`) to join the Protocol table.
// `select: { protocolId: true }` returns the UUID foreign key, not the
// human-readable slug. This caused #459. Always use `include` with
// relations when you need fields from the related table, not just the FK.
```

```js
/**
 * These thresholds are the single most impactful constants in the trading
 * pipeline. The original HOLD_FLOOR of 35 mapped nearly all composites
 * (typically 7-20 after risk multiplier ~0.5) to SELL. Result: 100% SELL
 * bias. Fix: shifted to 20 — typical composites now map to HOLD.
 */
```

### Signal: don't comment the obvious

If the code reads clearly on its own, don't add a comment. Comments are for **non-obvious** system context, not for paraphrasing code.

### After writing the comment

Mention it in your handoff file so the Librarian notes it in the Architecture Framework.

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
G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\handoff\YYYY-MM-DD-{slug}.md
```

Include the issue number in the slug where one exists so the handoff is greppable from the issue —
`2026-09-11-789-session-open-effect-placement.md`.

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

## Project Version — BUMP ON EVERY HANDOFF

The UI shows a **stale version forever** if you only bump one file. There are TWO
`package.json` files and they MUST stay in sync:

- `package.json` (repo root) — frontend build
- `nest/package.json` — backend. **This is the runtime source of truth**: the backend
  reads it at boot (`nest/src/version.ts` → `APP_VERSION`) and serves it at `GET /`,
  `GET /api/version`, and in Swagger. The UI footer/dev-stat reads `/api/version`.

**Every handoff bumps the version** (semver), so a handoff that changes behaviour or
adds capability is never silent:
- **patch** (0.3.0 → 0.3.1): bugfix, small cleanup, docs
- **minor** (0.3.0 → 0.4.0): new feature / subsystem / capability, behaviour change
- **major** (0.3.0 → 1.0.0): breaking change or phase milestone

Steps:
1. Decide patch vs minor vs major from the change above (default: minor for features,
   patch for fixes).
2. Bump `nest/package.json` `version` **and** root `package.json` `version` to the SAME
   value — never bump one without the other.
3. Rebuild the backend so the running `dist/` picks it up:
   `npm --prefix nest run build`.
4. Verify: `curl http://localhost:3201/api/version` returns the new version.

⚠️ Never hardcode a version literal in a controller or `main.ts` — import `APP_VERSION`
from `nest/src/version.ts`. (The old `'0.1.0'` / `'nest-0.1.0'` literals are why the
version never appeared to increase.)

## Why This Exists

This file costs ~200-400 tokens to write. If the agent self-updated the QA page, Capability Map, and Architecture Framework directly, it would cost ~60K tokens (reading 3 large files). When 5 features are batched, the Librarian processes all handoffs in one run — 66K tokens vs 325K (78% savings).

## What the Librarian Does

> ⚠️ **Handoffs are read from the central store, summarised into the docs, and then archived there —
> never in the app package.** The Librarian reads
> `…\Trading-Command-Suite-Documentation\handoff\*.md`, writes the summary into the QA page /
> Capability Map / Architecture Framework, and leaves the source in the central store.
> `.github/handoffs/` must **not** be recreated (`validate-agent-docs.cjs` fails the build if it
> reappears).

When processing handoffs, the Librarian invokes the `update-architecture-framework` skill (`.github/skills/update-architecture-framework/SKILL.md`) which handles:
- Updating `src/core/architecture-reference.js` (AI-readable system map)
- Updating `src/pages/architecture-framework.data.js` (human-facing UI page)
- Adding route contracts, SLICE entries, and database schema changes
- **Skipping** handoffs whose entries are already recorded — re-running the batch must be idempotent, so detect-and-skip rather than adding duplicates

**The handoff files STAY.** Git history is not a substitute for a file that is still there.
