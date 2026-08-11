# Audit All Directives — `maxScore` vs Actual Ceiling

> **Status:** Epic  
> **Labels:** `scoring`, `directives`, `audit`, `data-integrity`  
> **Priority:** P1  

---

## Problem

Directive `maxScore` values don't always match the actual ceiling of `calculate()`. Example: `rsi-overbought` declares `maxScore=130` but can return up to 140 (50 base + 80 bonus + 10 curl). Protocol score totals regularly exceed the displayed "maximum."

---

## Design Principles

1. **Not all directives are equal.** Default `maxScore=100` is a starting point, not a rule. Strong indicators (RSI Divergence, MACD Divergence) → 150–200. Weak ones (calendar effects, session filters) → 10–60.

2. **Direction-aware scoring.** RSI at 77 (overbought) = bad for long, good for short. RSI at 5 (oversold) = good for long, bad for short. Each directive already has a `directionBias` (`bullish`/`bearish`/`neutral`) — protocols exclude opposite-bias directives. The audit must verify bias is set correctly.

3. **Data-driven.** Max score values, bracket thresholds, and indicator ceilings live in the DB. Directives read from the DB row at runtime — no hardcoded `maxScore` on the class. Changed by editing the seed file, not the `.directive.ts`.

4. **User-customizable.** Global defaults editable. Per-protocol overrides in Phase 2.

---

## Decisions Made

| # | Question | Decision |
|---|----------|----------|
| Q1 | Where do bracket thresholds live? | DB key-value table alongside `maxScore`. Number of brackets stays hardcoded per directive → Phase 6 explores making group count customizable. |
| Q2 | DB schema for per-directive config? | Key-value table: `{directive_id}:{value_name}` = global default, `{protocol_id}:{directive_id}:{value_name}` = protocol override. Flexible for any directive's unique config shape. |
| Q3 | Protocol override storage? | Same key-value pattern — protocol-scoped keys answer this. |
| Q4 | Self-measuring mechanism? | No test harness. DB stores the ceiling components (max base, max bonus, max indicator drift). `maxScore` = their sum. Developer responsible for updating DB values when changing `calculate()`. A documentation/enforcement concern, not a code problem. |

### Glossary

| Term | Feature | Meaning |
|------|---------|---------|
| **Weight** | Directives | The adjustable maximum score a directive can contribute. Synonymous with `maxScore`. Higher weight = more influence on protocol total. Default 100, but can range 10–200+. |
| **Scale** | Directives | The indicator's native value range (e.g., RSI 0–80, Volatility Index 0.5–1.5). Determines how raw indicator readings map into score brackets. |
| **Score** | Directives, Scoring | The value a directive returns for the current market state. Must be between 0 and the directive's Weight. |
| **Brackets** | Directives | The separated ranges within a directive's Scale that determine how much of the Weight is awarded (e.g., RSI [0–10] → 100% weight, [11–30] → 50%, [31–70] → 0%). Number of brackets is hardcoded per directive; bracket boundaries are DB-stored and user-adjustable. |
| **Branches** | Directives | The if/else code paths inside `calculate()` that determine which Bracket the current market reading falls into. |
| **Directive threshold** | Directives | A bracket boundary value (e.g., RSI > 70 triggers a bonus tier). Stored in DB, user-adjustable. |
| **Market data drift** | Scoring | The raw indicator reading (RSI 71, VI 1.23) — contributes to the score via the directive's internal math. Not a separate additive. |
| **Indicator ceiling** | Directives | The maximum value of the underlying indicator's Scale (RSI = 80, Volatility Index = 1.5000). Used to derive bracket thresholds. |
| **directionBias** | Directives, Protocols | Whether a directive is naturally bullish (signals buy), bearish (signals sell), or neutral. Protocols filter directives by bias — a LONG_ONLY protocol excludes bearish directives entirely. |

---

## `directionBias` — Current State

### Bug fixed

Frontend `DirectivesManagerPage.jsx` was reading `raw.bias` but the API returns `raw.directionBias`. The BIAS column was always empty regardless of the directive's actual value. Fixed 2026-08-10.

### Coverage

Only **6 of 116 directives** have `directionBias` explicitly set. The remaining 110 default to `neutral` via `directionBias || 'neutral'` in `directives.service.ts`.

| Directive | Bias | 
|-----------|------|
| `cci` | bearish |
| `momentum-exhaustion` | bullish |
| `target-achieved` | bullish |
| `volume-surge` | bullish |
| `vwap` | bullish |
| `williams-r` | bearish |

### Impact

Protocols use `directionMode` (LONG_ONLY / SHORT_ONLY) and filter directives by bias at line ~316 of `protocol-gating.service.ts`:

```typescript
if (directionMode === 'LONG_ONLY' && bias === 'bearish') continue;
if (directionMode === 'SHORT_ONLY' && bias === 'bullish') continue;
```

A directive with missing or wrong `directionBias` means:
- **Neutral directives always pass through** — they score in both directions, potentially adding noise
- **A bullish directive without bias set** — would score in SHORT_ONLY protocols when it shouldn't
- **A bearish directive without bias set** — would score in LONG_ONLY protocols when it shouldn't

Setting `directionBias` correctly is now part of the audit procedure (step 4).

---

## Phases

### Phase 1: Audit & Seed (this epic)

- [ ] Audit every directive — verify `maxScore` equals actual ceiling of `calculate()`
- [ ] Set `directionBias` correctly per directive (bullish/bearish/neutral)
- [ ] Assign `maxScore` based on real-world indicator strength (break the 100 default)
- [ ] Define bracket thresholds per directive (e.g., RSI oversold has its own tiers)
- [ ] Move all config into the directive seed file → DB key-value rows
- [ ] Directives read their config from the DB at runtime

### Phase 2: Per-Protocol Customization

- [ ] Protocol profile stores its own copy of directive config via `{protocol_id}:{directive_id}:{value_name}` keys
- [ ] User can override a directive's global default within a specific protocol
- [ ] Protocol "Max Score" stat reflects the protocol's customized values

### Phase 3: Self-Measuring

- [ ] Document the contract: DB values = ceiling. Changing `calculate()` = must update DB.
- [ ] Optional: DB constraint or startup check that warns if `maxScore` < any observed score

### Phase 6: Customizable Bracket Count

- [ ] Explore allowing the user to change how many bracket groups a directive splits its weight into

---

## Directive Audit Checklist

> Each checkbox = one directive.  
> **Columns:** Declared `maxScore` → verify against `calculate()` ceiling → propose new value based on indicator strength.

Groups A through Z below — 116 directives total. Two already flagged ⚠️ as known mismatches.

### A

- [ ] `accumulation-dist` — `maxScore=100`
- [ ] `accumulation-distribution` — `maxScore=100`
- [ ] `adx` — `maxScore=100`
- [ ] `analyst-adjustments` — `maxScore=105`
- [ ] `atr-dip` — `maxScore=95`
- [ ] `atr-trailing-stop` — `maxScore=100`
- [ ] `awesome-oscillator` — `maxScore=100`

### B

- [ ] `bears-power` — `maxScore=100`
- [ ] `bollinger-bands` — `maxScore=100`
- [ ] `bollinger-percent-b` — `maxScore=100`
- [ ] `bollinger-squeeze` — `maxScore=90`
- [ ] `btc-halving-cycle` — `maxScore=200`
- [ ] `budget-gate` — `maxScore=100`
- [ ] `bulls-power` — `maxScore=100`

### C

- [ ] `cad-usd-oil-correlation` — `maxScore=125`
- [ ] `candle-pressure` — `maxScore=100`
- [ ] `cci` — `maxScore=100`
- [ ] `chaikin-mf` — `maxScore=100`
- [ ] `chaikin-money-flow` — `maxScore=100`
- [ ] `chandelier-exit` — `maxScore=100`
- [ ] `confluence-reversal` — `maxScore=100`
- [ ] `crypto-fear-greed` — `maxScore=60`
- [ ] `crypto-weekend-effect` — `maxScore=50`

### D

- [ ] `demarker` — `maxScore=100`
- [ ] `dilution-impact` — `maxScore=60`
- [ ] `doji-pattern` — `maxScore=100`
- [ ] `donchian-breakout` — `maxScore=100`
- [ ] `donchian-channel` — `maxScore=100`
- [ ] `dxy-regime` — `maxScore=125`

### E

- [ ] `earnings-momentum` — `maxScore=90`
- [ ] `earnings-proximity` — `maxScore=80`
- [ ] `ease-of-movement` — `maxScore=100`
- [ ] `election-cycle` — `maxScore=10`
- [ ] `ema-structure` — `maxScore=100`
- [ ] `engulfing-pattern` — `maxScore=100`

### F

- [ ] `fair-value-gap` — `maxScore=100`
- [ ] `falling-risk-pyramid` — `maxScore=100`
- [ ] `fibonacci-levels` — `maxScore=120`
- [ ] `force-index` — `maxScore=100`
- [ ] `friday-drift` — `maxScore=10`
- [ ] `fx-timing` — `maxScore=80`

### G

- [ ] `gap-scanner` — `maxScore=100`
- [ ] `gold-macro-correlation` — `maxScore=135`
- [ ] `gold-round-numbers` — `maxScore=100`
- [ ] `gold-session-profile` — `maxScore=100`

### H

- [ ] `hammer-pattern` — `maxScore=100`
- [ ] `hurst-memory` — `maxScore=100`

### I

- [ ] `insider-activity` — `maxScore=85`
- [ ] `institutional-footprint` — `maxScore=100`

### J

- [ ] `january-effect` — `maxScore=15`

### K

- [ ] `keltner-channel` — `maxScore=100`

### L

- [ ] `liquidity-check` — `maxScore=80`
- [ ] `liquidity-sweep` — `maxScore=100`

### M

- [ ] `ma-crossover` — `maxScore=100`
- [ ] `macd-crossover` — `maxScore=110`
- [ ] `macd-divergence` — `maxScore=115`
- [ ] `market-entropy` — `maxScore=100`
- [ ] `market-memory-zones` — `maxScore=100`
- [ ] `market-regime` — `maxScore=100`
- [ ] `market-structure-bos` — `maxScore=100`
- [ ] `mfi` — `maxScore=100`
- [ ] `micro-sr-levels` — `maxScore=100`
- [ ] `momentum-continuation` — `maxScore=100`
- [ ] `momentum-exhaustion` — `maxScore=100`
- [ ] `momentum-roc` — `maxScore=100`
- [ ] `monday-effect` — `maxScore=10`
- [ ] `mt5-dark-cloud-piercing` — `maxScore=100`
- [ ] `mt5-engulfing` — `maxScore=100`
- [ ] `mt5-engulfing-cci` — `maxScore=100`
- [ ] `mt5-hammer` — `maxScore=100`
- [ ] `mt5-harami` — `maxScore=100`
- [ ] `mt5-star-doji` — `maxScore=100`
- [ ] `mtf-confluence` — `maxScore=115`
- [ ] `multi-timeframe-trend` — `maxScore=120`

### N

- [ ] `news-sentiment` — `maxScore=100`

### O

- [ ] `obv` — `maxScore=100`
- [ ] `obv-divergence` — `maxScore=120`
- [ ] `october-relief` — `maxScore=15`
- [ ] `opex-gamma` — `maxScore=10`
- [ ] `overhead-supply` — `maxScore=100`

### P

- [ ] `panic-exhaustion` — `maxScore=100`
- [ ] `parabolic-sar` — `maxScore=100`
- [ ] `pattern-density-sr` — `maxScore=100`
- [ ] `position-size-confidence` — `maxScore=100`
- [ ] `position-size-kelly` — `maxScore=100`
- [ ] `price-above-sma` — `maxScore=100`
- [ ] `price-action` — `maxScore=100`
- [ ] `price-time-gap` — `maxScore=100`

### R

- [ ] `range-contraction` — `maxScore=100`
- [ ] `regime-shift-exit` — `maxScore=100`
- [ ] `rollover-risk` — `maxScore=100`
- [ ] `rsi-divergence` — `maxScore=115`
- [ ] `rsi-overbought` — `maxScore=130` ⚠️ Known: actual ceiling ~140
- [ ] `rsi-oversold` — `maxScore=130` ⚠️ Known: same pattern as overbought

### S

- [ ] `santa-claus-rally` — `maxScore=15`
- [ ] `sell-in-may` — `maxScore=15`
- [ ] `september-slump` — `maxScore=15`
- [ ] `session-open-effect` — `maxScore=100`
- [ ] `session-timing-filter` — `maxScore=100`
- [ ] `sigma-score` — `maxScore=100`
- [ ] `social-buzz` — `maxScore=100`
- [ ] `speed-momentum` — `maxScore=120`
- [ ] `stochastic` — `maxScore=100`
- [ ] `supertrend` — `maxScore=100`
- [ ] `support-resistance` — `maxScore=100`

### T

- [ ] `target-achieved` — `maxScore=100`
- [ ] `three-soldiers-pattern` — `maxScore=100`
- [ ] `time-stop` — `maxScore=100`
- [ ] `triple-witching` — `maxScore=10`
- [ ] `turnaround-tuesday` — `maxScore=10`

### V

- [ ] `vix-regime` — `maxScore=100`
- [ ] `volatility-envelope` — `maxScore=100`
- [ ] `volume-boundary` — `maxScore=100`
- [ ] `volume-confirmation` — `maxScore=100`
- [ ] `volume-rhythm` — `maxScore=100`
- [ ] `volume-surge` — `maxScore=100`
- [ ] `vwap` — `maxScore=100`
- [ ] `vwap-confluence` — `maxScore=100`

### W

- [ ] `wick-filter` — `maxScore=100`
- [ ] `williams-percent-r` — `maxScore=100`
- [ ] `williams-r` — `maxScore=100`

### Z

- [ ] `zigzag-swing-detector` — `maxScore=100`

---

## Open Questions

1. **Bracket config format** — where does the "50% at 75–80, 25% below" bracket definition live? In the seed file alongside `maxScore`? Or inside each directive's `calculate()` method?

2. **DB migration** — what table stores per-directive config? Extend the existing `Directive` table or a new `directive_config` table?

3. **Protocol override storage** — how does a protocol store its customized copy? JSON column on the protocol row? Junction table?

4. **Self-measuring design** — should `IDirective` have a `computeMaxScore(): number` method that runs boundary inputs, or should the ceiling be explicitly declared and the audit just verifies it?

### A

- [ ] `accumulation-dist` — `maxScore=100`
- [ ] `accumulation-distribution` — `maxScore=100`
- [ ] `adx` — `maxScore=100`
- [ ] `analyst-adjustments` — `maxScore=105`
- [ ] `atr-dip` — `maxScore=95`
- [ ] `atr-trailing-stop` — `maxScore=100`
- [ ] `awesome-oscillator` — `maxScore=100`

### B

- [ ] `bears-power` — `maxScore=100`
- [ ] `bollinger-bands` — `maxScore=100`
- [ ] `bollinger-percent-b` — `maxScore=100`
- [ ] `bollinger-squeeze` — `maxScore=90`
- [ ] `btc-halving-cycle` — `maxScore=200`
- [ ] `budget-gate` — `maxScore=100`
- [ ] `bulls-power` — `maxScore=100`

### C

- [ ] `cad-usd-oil-correlation` — `maxScore=125`
- [ ] `candle-pressure` — `maxScore=100`
- [ ] `cci` — `maxScore=100`
- [ ] `chaikin-mf` — `maxScore=100`
- [ ] `chaikin-money-flow` — `maxScore=100`
- [ ] `chandelier-exit` — `maxScore=100`
- [ ] `confluence-reversal` — `maxScore=100`
- [ ] `crypto-fear-greed` — `maxScore=60`
- [ ] `crypto-weekend-effect` — `maxScore=50`

### D

- [ ] `demarker` — `maxScore=100`
- [ ] `dilution-impact` — `maxScore=60`
- [ ] `doji-pattern` — `maxScore=100`
- [ ] `donchian-breakout` — `maxScore=100`
- [ ] `donchian-channel` — `maxScore=100`
- [ ] `dxy-regime` — `maxScore=125`

### E

- [ ] `earnings-momentum` — `maxScore=90`
- [ ] `earnings-proximity` — `maxScore=80`
- [ ] `ease-of-movement` — `maxScore=100`
- [ ] `election-cycle` — `maxScore=10`
- [ ] `ema-structure` — `maxScore=100`
- [ ] `engulfing-pattern` — `maxScore=100`

### F

- [ ] `fair-value-gap` — `maxScore=100`
- [ ] `falling-risk-pyramid` — `maxScore=100`
- [ ] `fibonacci-levels` — `maxScore=120`
- [ ] `force-index` — `maxScore=100`
- [ ] `friday-drift` — `maxScore=10`
- [ ] `fx-timing` — `maxScore=80`

### G

- [ ] `gap-scanner` — `maxScore=100`
- [ ] `gold-macro-correlation` — `maxScore=135`
- [ ] `gold-round-numbers` — `maxScore=100`
- [ ] `gold-session-profile` — `maxScore=100`

### H

- [ ] `hammer-pattern` — `maxScore=100`
- [ ] `hurst-memory` — `maxScore=100`

### I

- [ ] `insider-activity` — `maxScore=85`
- [ ] `institutional-footprint` — `maxScore=100`

### J

- [ ] `january-effect` — `maxScore=15`

### K

- [ ] `keltner-channel` — `maxScore=100`

### L

- [ ] `liquidity-check` — `maxScore=80`
- [ ] `liquidity-sweep` — `maxScore=100`

### M

- [ ] `ma-crossover` — `maxScore=100`
- [ ] `macd-crossover` — `maxScore=110`
- [ ] `macd-divergence` — `maxScore=115`
- [ ] `market-entropy` — `maxScore=100`
- [ ] `market-memory-zones` — `maxScore=100`
- [ ] `market-regime` — `maxScore=100`
- [ ] `market-structure-bos` — `maxScore=100`
- [ ] `mfi` — `maxScore=100`
- [ ] `micro-sr-levels` — `maxScore=100`
- [ ] `momentum-continuation` — `maxScore=100`
- [ ] `momentum-exhaustion` — `maxScore=100`
- [ ] `momentum-roc` — `maxScore=100`
- [ ] `monday-effect` — `maxScore=10`
- [ ] `mt5-dark-cloud-piercing` — `maxScore=100`
- [ ] `mt5-engulfing` — `maxScore=100`
- [ ] `mt5-engulfing-cci` — `maxScore=100`
- [ ] `mt5-hammer` — `maxScore=100`
- [ ] `mt5-harami` — `maxScore=100`
- [ ] `mt5-star-doji` — `maxScore=100`
- [ ] `mtf-confluence` — `maxScore=115`
- [ ] `multi-timeframe-trend` — `maxScore=120`

### N

- [ ] `news-sentiment` — `maxScore=100`

### O

- [ ] `obv` — `maxScore=100`
- [ ] `obv-divergence` — `maxScore=120`
- [ ] `october-relief` — `maxScore=15`
- [ ] `opex-gamma` — `maxScore=10`
- [ ] `overhead-supply` — `maxScore=100`

### P

- [ ] `panic-exhaustion` — `maxScore=100`
- [ ] `parabolic-sar` — `maxScore=100`
- [ ] `pattern-density-sr` — `maxScore=100`
- [ ] `position-size-confidence` — `maxScore=100`
- [ ] `position-size-kelly` — `maxScore=100`
- [ ] `price-above-sma` — `maxScore=100`
- [ ] `price-action` — `maxScore=100`
- [ ] `price-time-gap` — `maxScore=100`

### R

- [ ] `range-contraction` — `maxScore=100`
- [ ] `regime-shift-exit` — `maxScore=100`
- [ ] `rollover-risk` — `maxScore=100`
- [ ] `rsi-divergence` — `maxScore=115`
- [ ] `rsi-overbought` — `maxScore=130` ⚠️ KNOWN: actual ceiling ~140
- [ ] `rsi-oversold` — `maxScore=130` ⚠️ needs same check

### S

- [ ] `santa-claus-rally` — `maxScore=15`
- [ ] `sell-in-may` — `maxScore=15`
- [ ] `september-slump` — `maxScore=15`
- [ ] `session-open-effect` — `maxScore=100`
- [ ] `session-timing-filter` — `maxScore=100`
- [ ] `sigma-score` — `maxScore=100`
- [ ] `social-buzz` — `maxScore=100`
- [ ] `speed-momentum` — `maxScore=120`
- [ ] `stochastic` — `maxScore=100`
- [ ] `supertrend` — `maxScore=100`
- [ ] `support-resistance` — `maxScore=100`

### T

- [ ] `target-achieved` — `maxScore=100`
- [ ] `three-soldiers-pattern` — `maxScore=100`
- [ ] `time-stop` — `maxScore=100`
- [ ] `triple-witching` — `maxScore=10`
- [ ] `turnaround-tuesday` — `maxScore=10`

### V

- [ ] `vix-regime` — `maxScore=100`
- [ ] `volatility-envelope` — `maxScore=100`
- [ ] `volume-boundary` — `maxScore=100`
- [ ] `volume-confirmation` — `maxScore=100`
- [ ] `volume-rhythm` — `maxScore=100`
- [ ] `volume-surge` — `maxScore=100`
- [ ] `vwap` — `maxScore=100`
- [ ] `vwap-confluence` — `maxScore=100`

### W

- [ ] `wick-filter` — `maxScore=100`
- [ ] `williams-percent-r` — `maxScore=100`
- [ ] `williams-r` — `maxScore=100`

### Z

- [ ] `zigzag-swing-detector` — `maxScore=100`

---

## Audit Procedure

Per directive:
1. Read `calculate()` — trace all branches, bonuses, tiers
2. Find the maximum possible `score` return value
3. Compare to declared `maxScore` — fix if mismatched
4. Verify `directionBias` is correct (bullish/bearish/neutral) for the indicator's natural interpretation
5. Set `maxScore` based on real-world indicator strength (not default 100)
6. Define bracket thresholds for weight distribution within the directive's scale
