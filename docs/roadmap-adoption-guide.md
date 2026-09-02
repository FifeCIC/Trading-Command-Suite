# Roadmap Core — Adoption Guide

**Epic:** #681 Dynamic Roadmap — reusable planning core (kanban × gantt hybrid)
**Phase:** E — adoption story (copy-paste module + docs; npm package deferred until ≥2 consumers)
**Date:** 2026-08-31

This guide takes the roadmap from "TCS feature" to "drop-in planning system".
The contract it implements lives in `docs/roadmap-core-spec.md` — read that first.

---

## 1. What you get

| Layer | Location | Portable? |
|---|---|---|
| Pure planning logic | `src/core/roadmap/roadmap-core.js` | ✅ copy as-is (fractional positions, rebalance, dependency validation) |
| Board UI | `src/components/roadmap/RoadmapBoard.jsx` + `roadmap-board.css` | ✅ copy as-is (theme tokens only) |
| GitHub sync | `scripts/roadmap-sync.cjs` | ✅ copy as-is (takes `--repo owner/name`) |
| Config (your taxonomy) | `roadmap-config.json` | 🔧 **the only thing you write** |
| Persistence | NestJS `roadmap` module + Prisma models | 📋 copy + rename (or reimplement in your stack) |
| Page adapter | thin page component | 🔧 write your own (~120 lines) |

## 2. Prerequisites

- `gh` CLI, authenticated against your repo
- A theme system exposing `--panel`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--bg-elev`
  (any project can define these; the board never references concrete colors)
- Any persistence stack that can serve the `GET /api/roadmap` contract in
  `docs/roadmap-core-spec.md` §5 (TCS uses NestJS + Prisma)

## 3. Onboarding steps

### Step 1 — copy the portable layers
```
your-project/
  src/core/roadmap/roadmap-core.js          ← copy (and its test file)
  src/components/roadmap/RoadmapBoard.jsx   ← copy
  src/components/roadmap/roadmap-board.css  ← copy
  scripts/roadmap-sync.cjs                  ← copy
```

### Step 2 — write your config
`src/core/roadmap/roadmap-config.json` — the entire taxonomy surface:

```json
{
  "repo": "your-org/your-project",
  "defaultColumns": [
    { "id": "backlog", "title": "Backlog", "kind": "phase" },
    { "id": "in-progress", "title": "In Progress", "kind": "phase" },
    { "id": "shipped", "title": "Shipped", "kind": "phase" },
    { "id": "triage", "title": "Triage", "kind": "triage" }
  ],
  "labelToColumn": {
    "priority:high": "in-progress",
    "shipped": "shipped"
  }
}
```

Rules:
- `labelToColumn` maps YOUR GitHub labels to column ids; unmatched issues
  fall into `triage`. (TCS example: `"phase-2": "phase-2"`, `"Roadmap": "roadmap"`.)
- Columns are editable at runtime; sprint columns are created in the UI and
  persisted by the backend — they don't need to exist in the config.

### Step 3 — run the sync
```bash
node scripts/roadmap-sync.cjs
```
Produces `src/core/roadmap/roadmap-data.json` (the build-time snapshot).
Commit it; re-run when your issue triage changes.

### Step 4 — persistence
Copy `nest/src/modules/roadmap/` and the `RoadmapCard` + `RoadmapColumn`
Prisma models into your backend. If you're not on NestJS, implement the same
five endpoints against your own store — the contract (spec §5) is the
portability boundary.

### Step 5 — the page adapter
~120 lines: TanStack Query `GET /api/roadmap`, optimistic moves via
`applyMove`, rename/sprint mutations, and `onOpenCard` → your issue URL.
See `src/pages/RoadmapPage.jsx` as the reference implementation
(TCS mounts it at `/development/roadmap`).

### Step 6 — verify (checklist)
- [ ] sync run produces cards in every configured column
- [ ] board renders, theme switches cleanly
- [ ] drag a card: neighbours keep their positions; the moved card gets a
      fractional `position`
- [ ] dependency refusal: set `blockedBy`, try dropping above the blocker —
      the board must refuse with an explanation

## 4. Customisation cheat-sheet

| Want to… | Touch |
|---|---|
| Different columns | `roadmap-config.json` → `defaultColumns` |
| Different label → column rules | `roadmap-config.json` → `labelToColumn` |
| Different card fields in the sync | `scripts/roadmap-sync.cjs` JSON_FIELDS |
| Different owner source | snapshot `assignee` field (or backend merge logic) |
| Different issue URL | page adapter `onOpenCard` |
| Different board styling | nothing — theme tokens; or override `roadmap-board.css` locally |

## 5. Non-goals (deliberate)

- No calendar dates, no team swimlanes, no deadlines — order IS the plan.
- No GitHub API at runtime — the snapshot is a build artifact.
- No cross-project shared package yet — copy-paste keeps each consumer free
  to diverge until a second adoption proves what's truly common.
