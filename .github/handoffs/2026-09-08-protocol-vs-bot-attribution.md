---
date: 2026-09-08
area: scoring
type: feature
---

## What Changed

Exposed the executing `TradingStrategy` bot name on each best-of `SignalEnvelope` and reworked the signals-overview card so the **Protocol** (signal thesis, shown by slug) and the **Bot** (execution policy, shown by name) are visually distinct — resolving a naming collision where a protocol and its bot shared the identical display name.

## Files Changed

- nest/src/modules/signals/signal-envelope.service.ts — added `botName?: string | null` to `SignalEnvelope`; resolved it in `buildBestLadder` via a batch `tradingStrategy.findMany` lookup keyed by `protocolId|symbol`
- src/pages/SignalsOverviewPage.jsx — header now renders `Protocol · {protocolId}` (slug) with a "signal thesis" tooltip plus a distinct `🤖 {botName}` chip; execution-blocker tooltips now prefix the bot name
- src/pages/signals-overview.css — added `.sig-opp-botname` styling (amber chip) distinct from `.sig-opp-proto`

## Why (theory)

The META.Stack pipeline separates **protocol** (the signal thesis: direction + scoring directives, identified by slug like `xau-speed-m15`) from **bot** (`TradingStrategy`: the execution policy — money-management, risk gates, SL/TP). Previously `SignalEnvelope` only carried `protocolName`/`protocolId`, so a protocol and its bot that happened to share a human-readable name (e.g. both "Gold Day-Trade M15") were indistinguishable in the UI. Surfacing the bot by name (distinct from the protocol's slug) gives users a clear answer to "what is the thesis vs. what is the policy" on every opportunity card. Bot lookup is best-effort — a signal with no matching active bot stays `null` and renders no chip.

## Capability Map Entry

- **name:** Protocol vs Bot Attribution
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Signals
- **name:** Opportunity card distinguishes protocol (slug) from bot (name)
- **procedure:** Open /signals/signals-overview and inspect a best-of card. Hover the protocol label and the 🤖 chip; also hover a ⛔ execution blocker.
- **expected:** The card shows "Protocol · {slug}" (tooltip explains "signal thesis") and a separate "🤖 {botName}" chip. The blocker tooltip prefixes the bot name ("{bot} bot · …"). Cards with no matching bot show no chip.

## Architecture Framework Entry

- **section:** directives
- **summary:** SignalEnvelope now carries `botName` (executing TradingStrategy name), resolved in buildBestLadder from `tradingStrategy.findMany` keyed by `protocolId|symbol`. Distinguishes the protocol (signal thesis, slug) from the bot (execution policy, name) in the signals-overview UI. Files: signal-envelope.service.ts, SignalsOverviewPage.jsx, signals-overview.css.
