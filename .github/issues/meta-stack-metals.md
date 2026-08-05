## Problem

XAGUSD (Silver), XAUEUR, XAUAUD, XAGEUR are tradeable on MetaQuotes-Demo but have no META.Stack. Silver is the natural first metals expansion — it correlates with gold (~0.80) but has different volatility characteristics (higher beta, industrial demand exposure). Gold variants (XAUEUR/XAUAUD) are gold priced in non-USD terms — useful for macro plays when DXY is moving.

## Pairs

| Symbol | Metal | Volatility | Spread | Priority |
|---|---|---|---|---|
| **XAGUSD** | Silver | High (2-3× gold beta) | Moderate | High |
| **XAUEUR** | Gold in EUR | Same as gold in EUR terms | Moderate | Medium |
| **XAUAUD** | Gold in AUD | Same as gold in AUD terms | Higher | Medium |
| **XAGEUR** | Silver in EUR | Silver × EUR/USD | Higher | Low |
| XPDUSD | Palladium | Very high, industrial | Wide | Low |
| XPTUSD | Platinum | High, industrial | Wide | Low |

## Approach

### Phase 1 — Silver (XAGUSD)
- Reuse `xau-speed-*` directive DNA (gold-session-profile, gold-macro-correlation, gold-round-numbers are gold-only)
- Adapt to silver: replace gold-specific directives with silver-appropriate ones (industrial demand, gold-silver ratio)
- Create `xag-speed-m15` protocol + scoring strategy + trading strategy
- Silver has ~2× gold's beta — adjust `slPct`/`tpPct` accordingly (wider stops)

### Phase 2 — Gold variants (XAUEUR/XAUAUD)
- These are gold priced in EUR/AUD — same underlying, different quote currency
- Can reuse `xau-speed-*` protocols almost unchanged (DXY correlation works the same)
- Main difference: spread/volatility in non-USD terms

### Phase 3 — Palladium/Platinum (XPDUSD/XPTUSD)
- Industrial precious metals — very different drivers from gold
- Low priority due to wide spreads, low volume on MetaQuotes-Demo
- Would need dedicated protocols

## Tasks

- [ ] Create `xag-speed-m15` protocol (adapt from xau-speed-m15)
- [ ] Create scoring strategy + trading strategy for XAGUSD (auto mode, appropriate SL/TP)
- [ ] Create META.Stacks for XAUEUR + XAUAUD (reuse xau-speed-*)
- [ ] Defer XPDUSD/XPTUSD until a broker with better spreads is available

## Acceptance

- [ ] XAGUSD trading in auto mode with a silver-appropriate protocol
- [ ] XAUEUR, XAUAUD trading in auto mode reusing gold protocols
- [ ] Protocol naming follows `xag-speed-*` convention
