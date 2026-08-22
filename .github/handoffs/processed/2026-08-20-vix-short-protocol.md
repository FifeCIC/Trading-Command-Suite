---
date: 2026-08-20
area: scoring
type: feature
---

# VIX SHORT protocol + signal vocabulary clarity

## What Changed

- **New protocol `vix-short-v1`** ("VIX Spike Short V1") in
  `protocols-seed-data.ts` — SHORT_ONLY, `derivedFrom: vix-spike-v1`,
  bearish directive groups (rsi-overbought, cci, macd-crossover,
  bollinger-band-squeeze, mean-reversion / volatility-tools,
  volume-confirmation, support-resistance-levels / risk gate:
  liquidity-check, sp500-regime). Passes the build-time direction contract
  (no bullish directives in a SHORT_ONLY protocol).
- **Seeded to DB** via `POST /api/scoring/gated/protocols/seed` — protocol
  active, 44 protocols total. Scoring live each tick (verified HOLD at
  composite 40 — below entry threshold, correct).
- **DB pairing relationship**: new `scoring_strategy` row
  `auto-vix-dual-v1` (`protocolId: vix-spike-v1`, `shortProtocolId:
  vix-short-v1`, tradingEnabled false) — the LONG↔SHORT relationship used
  for dual-direction validation.
- **Signal classification fix** (`protocol-gating.service.ts`): below entry
  threshold now emits HOLD for ALL direction modes. Previously
  SHORT_ONLY/BOTH emitted SELL below HOLD_FLOOR — "nothing firing" was
  mislabelled as a short signal. HOLD means "no directional edge / no trade
  right now", never position advice.
- **New diagram** on DiagramsPage: "Signal Vocabulary & Direction State
  Machine" — documents directionMode contract, percentage classification
  bands, dual-protocol pairing via shortProtocolId, and orthogonal UI
  states (LIVE/PAUSED/STALE/UNSCORED).

## GitHub Issues Created

- #669 — [Phase 4] QQQ SHORT protocol (qqq-short-v1)
- #670 — [Phase 4] SPY SHORT protocol (spy-short-v1)
- #671 — [Phase 4] XAUUSD SHORT protocol (xau-short-v1)
  Each references vix-short-v1/auto-vix-dual-v1 as the template, including
  the derivedFrom + shortProtocolId DB relationships.

## Notes

- The loop scores active protocols directly; the pairing strategy row is
  ready for when strategy-driven dual evaluation is used.
- Backend restart required after seeding so the preloaded protocol cache
  picks up new protocols.
