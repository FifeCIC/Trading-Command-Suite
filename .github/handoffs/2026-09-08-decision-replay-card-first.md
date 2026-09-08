---
date: 2026-09-08
area: scoring
type: feature
---

## What Changed

Reworked the Snapshot Replay page from a chart-centric candle walk into a **card-first decision replay** that surfaces, per historical bar, which *protocol* (signal thesis) won and which *bot* (execution policy) is bound to it — closing #739.

## Files Changed

- `nest/src/modules/replay/replay.service.ts` — added `protocolId`/`protocolName`/`botName` to `ReplayStep`; `runReplay` now resolves protocol display names (via `protocol.slug`) and bot names (via `tradingStrategy` keyed `${protocolId}|${symbol.toUpperCase()}`) up-front, and tracks the winning protocol per-step (`selectedIdx`) instead of a `reduce`.
- `src/pages/SnapshotReplayPage.jsx` — added protocol-selection chips (multi-select, fetched from `/api/scoring/gated/protocols`), wired `protocolIds` into `handleRun` (dropped `relativeScoring`), and added the Decision Card (protocol 🧭 vs bot 🤖, score %, signal badge, forward returns Fwd1/Fwd5, correct/wrong badge, directive breakdown chips).
- `src/pages/snapshot-replay.css` — added `.sr-protocol-select`, `.sr-proto-chip`, `.sr-decision-card` and all `sr-dc-*` sub-styles using theme tokens.

## Capability Map Entry

- **name:** Card-First Decision Replay (protocol-vs-bot identity)
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Replay
- **name:** Replay decision card shows protocol vs bot identity
- **procedure:** Open the Snapshot Replay page, select `xau-speed-m15` and `gold-macro-v1`, run a replay over XAUUSD 5m. Step through bars.
- **expected:** The decision card shows the winning protocol name (e.g. "Gold Day-Trade M15" / "Gold Macro Correlation V1") via the 🧭 chip; the 🤖 bot chip appears only when an active `tradingStrategy` matches `${protocolId}|{symbol}` (empty for XAUUSD gold protocols since no active bot is bound). Forward returns and correct/wrong badge render.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Replay Decision Card — `ReplayService.runReplay` steps bars through canonical `ProtocolGatingService.scoreWithGating(symbol, windowBars, protocolSlug)` (protocol slug, not UUID), picks the winning protocol per-step by `signalPct`, and annotates each `ReplayStep` with `protocolId`/`protocolName`/`botName`. Bot resolution mirrors the signal-envelope key `${protocolId}|${symbol.toUpperCase()}` from `tradingStrategy`. Frontend renders a card-first view (decision card above the chart). Files: replay.service.ts, SnapshotReplayPage.jsx, snapshot-replay.css.
