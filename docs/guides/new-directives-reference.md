# New Directives Reference — Sprint 2026-07-03/04

Seven new protocols added, bringing the total from 25 to 32.

---

## Divergence Suite (`divergence-suite-v1`)

**Style:** Contrarian / Reversal  
**Weight:** 0.85  
**Directives:** `rsi-divergence`, `macd-divergence`, `obv-divergence`

Spots hidden momentum shifts before price confirms them. Classic RSI divergence (price makes higher high, RSI makes lower high = bearish), MACD histogram divergence, and On-Balance Volume divergence.

**Best used:** Range-bound markets, potential reversals at support/resistance.  
**Signals:** Bullish divergence = BUY (price falling but momentum rising). Bearish divergence = SELL.

---

## MTF Conservative (`mtf-conservative-v1`)

**Style:** Multi-Timeframe Confirmation  
**Weight:** 0.90  
**Directives:** `mtf-trend-alignment`, `mtf-support-resistance`, `mtf-rsi-confirm`

Requires ALL three timeframes (1h, 4h, daily) to agree before producing a signal. This is the "wait for everyone to agree" protocol — fewer signals but higher conviction.

**Best used:** Swing trading where false signals are expensive.  
**Signals:** Only fires when trend, S/R, and RSI align across all timeframes.

---

## MTF Weighted (`mtf-weighted-v1`)

**Style:** Multi-Timeframe Weighted  
**Weight:** 0.85  
**Directives:** Same three MTF directives but with weighted scoring (daily = 50%, 4h = 30%, 1h = 20%)

More signals than Conservative, fewer than single-timeframe. The daily chart carries the most weight — good for catching macro-aligned entries.

**Best used:** Trend-following with higher timeframe confirmation.  
**Signals:** Weighted average across timeframes. Daily agreement strongly tilts the score.

---

## VWAP Simple (`vwap-simple-v1`)

**Style:** Institutional / Volume-Weighted  
**Weight:** 0.80  
**Directives:** `vwap-confluence`

Scores based on proximity to VWAP (Volume-Weighted Average Price). Price near VWAP = equilibrium. Price far above VWAP with declining volume = potential mean reversion.

**Best used:** Intraday trading, identifying overbought/oversold relative to fair value.  
**Signals:** Above VWAP + high volume = bullish continuation. Above VWAP + low volume = bearish reversal.

---

## VWAP Bands (`vwap-bands-v1`)

**Style:** VWAP Standard Deviation  
**Weight:** 0.80  
**Directives:** `vwap-confluence`, `liquidity-check`

Adds standard deviation bands (±1σ, ±2σ) around VWAP. Price at +2σ band = 95th percentile extension — statistically due for reversion.

**Best used:** Mean reversion at band extremes.  
**Signals:** Price at +2σ upper band = SELL. Price at -2σ lower band = BUY.

---

## Gap Scanner (`gap-scanner-v1`)

**Style:** Gap Trading  
**Weight:** 0.75  
**Directives:** `gap-scanner`

Classifies overnight gaps by type (breakaway, runaway, exhaustion, common) and size. Uses ratio-based volume scoring against 20-bar average (not binary). Gap size is measured against ATR for context — a 1% gap on a 0.3% ATR stock is significant; a 1% gap on a 3% ATR crypto is noise.

**Best used:** Pre-market gap scans, first-hour trading.  
**Signals:** Breakaway gap up + volume confirmation = BUY. Exhaustion gap up = SELL (fade).

---

## Earnings Momentum (`earnings-momentum-v1`)

**Style:** Event-Driven  
**Weight:** 0.70  
**Directives:** `earnings-momentum`

Captures pre-earnings announcement drift — the well-documented tendency for stocks with strong earnings momentum to drift higher in the 2-4 weeks before their next report. Auto-exits 1-2 days before earnings to avoid the binary event risk.

**Best used:** 5-14 days before known earnings dates.  
**Signals:** Strong surprise magnitude + positive QoQ growth + recent beat streak = BUY. Weak/negative momentum = avoid or SELL.

DB-backed — requires earnings data from Finnhub/Alpha Vantage to be imported first.

---

## Protocol Selection Quick Reference

| Market Condition | Recommended Protocol |
|------------------|---------------------|
| Strong trend, daily aligned | `mtf-conservative-v1` |
| Trend with intraday entries | `mtf-weighted-v1` |
| Range-bound / choppy | `divergence-suite-v1` |
| Intraday, VWAP respect | `vwap-simple-v1` |
| Mean reversion at extremes | `vwap-bands-v1` |
| Post-market / pre-open | `gap-scanner-v1` |
| Earnings season | `earnings-momentum-v1` |
| Unsure? Run all 32 | Protocol Consensus Engine |
