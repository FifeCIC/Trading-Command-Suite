## Problem

EURCHF currently uses `forex-session-v1`. European crosses (EUR vs non-USD currencies) have distinct characteristics from USD-based pairs:
- **Tighter spreads, lower volatility** — EURCHF is one of the tightest spreads on MetaQuotes-Demo
- **Safe-haven dynamics** — CHF strengthens during risk-off, EUR more neutral
- **SNB/ECB policy divergence** — central bank rate differentials drive direction
- **DXY proxy works differently** — EUR is 57.6% of DXY; EURCHF has a different USD component

A European-cross protocol would also serve as a template for EURSEK, EURNOK, EURPLN later.

## Proposed protocol: `forex-european-v1`

Build from `eurusd-macro-v1` (10 dirs) and extend:
- DXY sensitivity adjusted for cross-pair dynamics (EUR component reduces USD impact)
- Safe-haven overlay (CHF demand during equity selloffs)
- European session weighting (London open 08:00-16:30 BST)
- Lower volatility → tighter SL/TP defaults (0.3-0.5% vs 1%)
- SNB/ECB policy divergence tracking

## Pairs covered (immediate)
- EURCHF (Tier 1 — already in auto)
- EURSEK, EURNOK, EURPLN, EURHUF (Tier 2 — Scandinavian/Eastern European crosses)
- EURDKK, EURCZK (pegged/near-pegged — lower priority)

## Tasks

- [ ] Review `eurusd-macro-v1` as starting template
- [ ] Adapt DXY sensitivity for cross-pair dynamics
- [ ] Add safe-haven/day-of-week weighting for CHF
- [ ] Build protocol, seed to DB
- [ ] Switch EURCHF strategy to new protocol
- [ ] Validate tighter SL/TP defaults work with lower volatility pairs

## Acceptance
- [ ] `forex-european-v1` protocol registered with 8+ directives
- [ ] EURCHF switched, scoring meaningfully different from generic forex-session-v1
- [ ] SL/TP calibrated to European-cross volatility (narrower spreads, smaller moves)
