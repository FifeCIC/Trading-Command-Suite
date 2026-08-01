# Handoff: Session Strategy Coverage + Protocol Variants

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-31
**Issues:** Session trading coverage expansion, A/B variant foundation

## What was built

### Protocol Variants (A/B foundation)
4 new XAUUSD protocol variants derived from `xau-speed-v1`, each at a different timeframe:

| Protocol | Timeframe | Style | derivedFrom |
|----------|-----------|-------|-------------|
| `xau-speed-m5` | 5m | Scalp | xau-speed-v1 |
| `xau-speed-m15` | 15m | Day Trade | xau-speed-v1 |
| `xau-speed-1h` | 1h | Swing | xau-speed-v1 |
| `xau-speed-4h` | 4h | Position | xau-speed-v1 |

All 4 share the same directive set (14 directives across technical/sentiment/risk groups) with progressively reduced speed-momentum and RSI weightings for longer timeframes.

### Session Coverage (3 new strategies)
Protocol → ScoringStrategy → TradingStrategy chain for all 3 market sessions:

| Session | Symbol | Protocol | Status |
|---------|--------|----------|--------|
| Tokyo | USDJPY | forex-session-v1 | ✅ Active, pending bars |
| London | EURUSD | eurusd-macro-v1 | ✅ Active, scoring live |
| US | SPX500 | spy-day-v1 | ✅ Active, pending bars |

### Seed Data
- `nest/src/modules/scoring/protocols-seed-data.ts` — 4 new protocol entries with `derivedFrom`
- `nest/src/modules/trading/strategy-seed-data.ts` — NEW: 7 default strategies (4 XAUUSD + 3 session)
- `POST /api/trading/strategies/seed` — idempotent seed endpoint

### Polish
- `derivedFrom` now surfaced in `GET /api/scoring/gated/protocols` response
- `StrategyMonitorPage` now uses `/with-ratios` endpoint (consistent with StrategiesListPage)

### DB Changes
- `protocol.derivedFrom` VARCHAR(100) — parent protocol slug for A/B variant tracking
- 4 new protocols, 4 new scoring strategies, 4 new trading strategies
- 3 new session scoring strategies, 3 new session trading strategies
- Total: 48 protocols, 7 active trading strategies in automation loop

## Files changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | derivedFrom column on Protocol |
| `protocols-seed-data.ts` | 4 new XAUUSD protocol variants |
| `protocol-db.service.ts` | ProtocolConfig.derivedFrom, DB read-through |
| `protocol-gating.controller.ts` | Surface derivedFrom in API response |
| `trading/strategy-seed-data.ts` | NEW — 7 default strategy definitions |
| `trading/trading-strategy.service.ts` | seedDefaults() method |
| `trading/trading-strategy.controller.ts` | POST /seed endpoint |
| `src/pages/StrategyMonitorPage.jsx` | Switched to /with-ratios |
