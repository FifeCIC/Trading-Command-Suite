## Problem

The automation loop scores 12+ strategies per tick in fixed order. All strategies are treated equally regardless of their market conditions — a thinly-traded exotic pair gets the same evaluation slot as EURUSD during peak liquidity.

## Idea

Introduce a **liquidity/volume priority weight** that slightly biases the evaluation order within a tick. Not a hard gate — just a nudge so that liquid symbols get scored earlier in the cycle when data is freshest.

This would use data already available:
- MetaQuotes-Demo provides `tradeMode=4` (tradeable) vs `tradeMode=0` (disabled)
- Bridge candles provide volume data per symbol
- Protocol configurations declare `recommendedTimeframe` and `tradingStyle`

### Possible implementation

- [ ] Compute a **liquidity score** (0–5 ⭐) per symbol from: spread, average volume, session overlap
- [ ] Store as a `liquidityRating` field on `Symbol` or `SymbolProtocolAssignment`
- [ ] Sort active strategies by liquidity score within each tick (descending)
- [ ] Expose in UI: strategy cards, symbol focus page, MetaStack Explorer

## Why this matters

At scale (30+ auto strategies), the 120s tick window becomes crowded. If a symbol with bad data or low liquidity is eating evaluation time, higher-quality symbols get scored later in the cycle with older quote data. Prioritization ensures EURUSD gets evaluated before USDTRY.

## Acceptance

- [ ] Liquidity rating mechanism designed (automated from bridge data or manual config)
- [ ] Strategy evaluation order within a tick optionally sorted by liquidity
- [ ] UI surfaces reflect the rating (even if just a star count on strategy cards)
