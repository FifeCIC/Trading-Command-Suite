# Ladder card uniformity — the double-write that stripped score denominators

**Date:** 2026-09-10
**Version:** 0.6.4 → 0.6.5
**Trigger:** User reported cards on `/scoring/live-ordering-stack` rendering in
inconsistent shapes, and six cards appearing at the top of the ladder in bulk.

## Symptom (as reported)

1. Some cards showed `Scored: 57s ago · xau-speed-4h`, others `Scored: 1m ago` —
   the protocol suffix was present on some cards and absent on others.
2. Six cards appeared at the top as
   `#1 QQQ … QQQ Day Trade V1 PAUSED Market closed Signal 30/80 38% Opp 2`.
3. Request: make the cards uniform so a fault is spottable by eye.

## Root cause — a double write per tick

Two services each `create` a `Score` row for the **same** (symbol, protocol,
minute). Nothing overwrites; both rows persist:

| Writer | Breakdown keys | `rawMax` | `marketStatus` |
|---|---|---|---|
| `protocol-gating` (the pipeline) | **21** — `rawMax`, `rawComposite`, `marketStatus`, `denominatorMode`, `readinessGate`, … | ✅ | ✅ |
| `signals-workbench` (`SignalEnvelopeService.persistScores`) | **8** — `rarity`, `signal`, `confidence`, `blockerCount`, … | ❌ | ❌ |

Measured over 30 minutes: **233 rich rows vs 208 thin rows — ~47% of all Score
rows were thin duplicates.** The thin row lands **0.2–4.5 s after** the rich one,
so it is *newer*.

`ScoreHistoryService.getRuns()` groups by `(minute, breakdown.protocolId || strategyId)`.
Because the pair share a minute and a protocol, the grouping **merges them**, then
reads the rows from a `timestamp desc` fetch — so the thin `signals-workbench` row
won. `buildScoreDisplay` then had no `rawMax` (→ no percentage) and no
`marketStatus` (→ a closed market read as live, and an open market read as `STALE`
because the missing `asOf` tripped the 30-minute freshness gate).

The same mechanism explains symptom 1: `scoreFrom` is only set when a score is
borrowed via the family map, so cards with an exact run showed no suffix and cards
without one did — a lane most cards could never have.

## Why the six cards appeared at the top

They were **not** filtered cards (`lad-card--filtered` was `false`). They were
`spy-day-v1` / `qqq-day-v1` rows whose market is shut but which *do* have runs.
`sort` put `hasScore` first, so a **frozen closed-market scan outranked a live
Gold BUY**. Switching the Market filter inserts them in bulk, which is what the
user saw appear at once.

## Fix

1. **`score-history.service.ts`** — new `collapseDuplicateWrites(entries)` collapses
   the pair within a run group to one row per ticker, choosing the row with the
   richest gating breakdown. `value` is identical across the pair, so this is
   presentation-only and never changes a score. If the duplicate write is ever
   removed, it degrades to a no-op.
2. **`signal-envelope.service.ts`** — `persistScores()` now **adopts an existing
   gating row** from the same minute instead of creating a shadow duplicate. It
   still returns `scoreId` (required by `GET /api/signals/:id/action` and
   `POST /api/signals/:id/trade`), so the caller contract is unchanged — the
   duplicate is stopped at the source as well as tolerated at the read.
3. **`LadderPage.jsx`** — one state chip on every card via `stateLabel`/`stateClass`
   (was: two different markup branches); `Opp` slot always renders; `runId` always
   named in the footer; `scoreFrom` suppressed when it would just restate the run.
4. **`LadderPage.jsx` sorter** — ranks *live-actionable* above *frozen* before
   comparing score size, so a closed-market scan can no longer outrank a live signal.
5. **`ladder.css`** — `.lad-time-borrow` chip, `.lad-card--closed` score dimming.

## Verification (live, real data)

Before: `SIGNAL —` / bare `SIGNAL 82` with no denominator, `rawMax=null`, `marketStatus=null`.
After: `SIGNAL 192 / 695 28%  OPP 530 / 1,010 52%` with `rawMax=695`,
`rawComposite=165`, `marketStatus.open=true`.

- `runs_with_duplicate_tickers = 0` across all 60 runs sampled.
- Ladder: 25 cards, **15 scored / 15 with a percentage / 15 naming their run id**.
- Closed-market cards now rank **below** all live cards (first closed at #10,
  first unscored at #16).
- `nest build` exit 0; contract gate ✅ OK (10 invariants, no deviations);
  Vite build exit 0; `eslint src/pages/LadderPage.jsx` clean.

## Theory worth keeping

**A row's identity is not its content.** Two writers independently deciding "this
is the score for XAUUSD/xau-speed-m5 right now" produced two rows that the reader
then had to disambiguate by *richness*, because nothing in the schema said which
one was authoritative. The grouping key `(minute, protocol)` assumed one row per
key; the double write broke that assumption silently — the failure was **plausible
numbers with no error**, the same shape as the invariants in
`meta-stack-contracts.instructions.md`.

**Corollary:** when a display degrades to "fewer fields than expected" rather than
erroring, check the *writer* as well as the *reader*. Here the reader was fixed
twice (fallback maps, honest `unscored` state) before the writer was found.

## Outstanding (not fixed here)

- `xau-speed-v1` (Gold Speed Scalp V1) has **never** produced a run of its own — it
  only ever borrows from `xau-speed-4h`. The protocol is configured and active but
  emits nothing. Worth a separate issue.
- Closed-market rows show `STALE` when their `marketStatus.asOf` is >30 min old and
  `MARKET CLOSED` when it is fresh `open:false`. Both are honest, but the two labels
  for "cannot trade this" may want to be one label.
- The thin `signals-workbench` write still exists for symbols with no gating row
  (correct — that is its purpose); only the shadowing duplicate is prevented.
