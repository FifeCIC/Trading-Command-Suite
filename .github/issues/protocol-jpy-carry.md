## Problem

EURJPY, GBPJPY, AUDJPY, NZDJPY are currently using `forex-session-v1` (14-dir session mean-reversion). While adequate as a baseline, this misses the key drivers of JPY crosses:

- **Carry trade dynamics** — interest rate differentials drive multi-day trends
- **Risk-on/risk-off** — JPY strengthens on equity selloffs, weakens on rallies (SPX/VIX correlation)
- **BOJ sensitivity** — intervention risk, yield curve control policy shifts
- **Asian session dominance** — AUDJPY/NZDJPY peak during Tokyo, not London/NY

## Proposed protocol: `jpy-carry-v1`

Build from existing DNA (`usdjpy-risk-v1`, 6 dirs) and extend with:
- Carry interest differential scoring (central bank rate comparison)
- Equity correlation overlay (SPX500/VIX as risk-proxy inputs)
- Session weight favoring Tokyo for AUD/NZD crosses, London for EUR/GBP crosses
- Volatility-adaptive SL/TP (GBPJPY needs ~1.5-2% SL vs generic 1%)

## Pairs covered
- EURJPY, GBPJPY, AUDJPY, NZDJPY (Tier 1 crosses already in auto)
- CHFJPY, CADJPY, SGDJPY, CNHJPY (Tier 2)
- All remaining JPY crosses on MetaQuotes-Demo (18 total)

## Tasks

- [ ] Review `usdjpy-risk-v1` as a starting template
- [ ] Design directive groups: carry, risk-sentiment, session-timing
- [ ] Build protocol, seed to DB
- [ ] Create/reuse scoring strategy for JPY crosses
- [ ] Update existing JPY cross trading strategies to use new protocol
- [ ] A/B compare against current `forex-session-v1` baseline

## Acceptance
- [ ] `jpy-carry-v1` protocol registered with 10+ directives
- [ ] EURJPY, GBPJPY, AUDJPY, NZDJPY switched to new protocol
- [ ] Composite scores meaningfully differentiated from `forex-session-v1` baseline
