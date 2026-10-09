# #820 long-side study - measurement archive 2026-10-09

Same corpus as #817 (one ~21h session; snapshot while the queue resolves rows).

### A/B. Per-directive accuracy split by side, with pair-weighted base rates (Wilson 95%)

base = weighted over the same instrument/horizon pairs (symbol × timeframe), weighted by the directive’s own readings. ‡ = Wilson low < 50%.

**At 15m:**

| directive | style | bias | nL | accL | baseL | liftL | wL.low | nS | accS | baseS | liftS | wS.low |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| analyst-adjustments | other | neutral | 243 | 13.2% | 13.4% | -0.3pp | 9.5% ‡ | 0 | —% | 86.6% | — | — |
| btc-halving-cycle | other | neutral | 235 | 47.2% | 45.7% | +1.6pp | 40.9% ‡ | 0 | —% | 54.3% | — | — |
| ema-structure | trend | bullish | 1943 | 47.8% | 54.0% | -6.2pp | 45.5% ‡ | 0 | —% | 44.4% | — | — |
| gold-round-numbers | levels | neutral | 421 | 50.8% | 58.4% | -7.6pp | 46.1% ‡ | 1920 | 41.1% | 41.6% | -0.4pp | 39.0% ‡ |
| macd-crossover | trend | neutral | 375 | 24.0% | 44.1% | -20.1pp | 20.0% ‡ | 2495 | 51.5% | 54.8% | -3.3pp | 49.5% ‡ |
| micro-sr-levels | levels | neutral | 294 | 53.4% | 49.4% | +4.0pp | 47.7% ‡ | 526 | 45.8% | 50.3% | -4.5pp | 41.6% ‡ |
| multi-timeframe-trend | trend | neutral | 577 | 44.2% | 48.4% | -4.2pp | 40.2% ‡ | 54 | 87.0% | 51.3% | +35.8pp | 75.6% |
| rsi-overbought | mean-reversion | bearish | 0 | —% | 0.0% | — | — | 234 | 100.0% | 100.0% | +0.0pp | 98.4% |
| rsi-oversold | mean-reversion | bullish | 172 | 78.5% | 60.7% | +17.8pp | 71.8% | 0 | —% | 38.6% | — | — |
| session-open-effect | other | neutral | 9 | 22.2% | 59.0% | -36.8pp | 6.3% ‡ | 36 | 27.8% | 39.9% | -12.1pp | 15.8% ‡ |
| speed-momentum | momentum | neutral | 626 | 49.5% | 44.9% | +4.6pp | 45.6% ‡ | 621 | 53.5% | 55.0% | -1.6pp | 49.5% ‡ |
| stoch-rsi | mean-reversion | neutral | 160 | 85.0% | 87.3% | -2.3pp | 78.7% | 308 | 12.7% | 12.7% | -0.0pp | 9.4% ‡ |
| support-resistance-levels | levels | neutral | 0 | —% | 60.9% | — | — | 7535 | 37.5% | 38.5% | -1.0pp | 36.4% ‡ |

**At 1h:**

| directive | style | bias | nL | accL | baseL | liftL | wL.low | nS | accS | baseS | liftS | wS.low |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| analyst-adjustments | other | neutral | 243 | 4.1% | 3.7% | +0.4pp | 2.3% ‡ | 0 | —% | 96.3% | — | — |
| btc-halving-cycle | other | neutral | 235 | 57.0% | 54.6% | +2.4pp | 50.6% | 0 | —% | 45.4% | — | — |
| ema-structure | trend | bullish | 1943 | 50.2% | 57.9% | -7.7pp | 48.0% ‡ | 0 | —% | 41.6% | — | — |
| gold-round-numbers | levels | neutral | 421 | 57.2% | 58.5% | -1.3pp | 52.5% | 1920 | 40.3% | 41.5% | -1.2pp | 38.1% ‡ |
| macd-crossover | trend | neutral | 375 | 14.9% | 44.4% | -29.5pp | 11.7% ‡ | 2495 | 47.1% | 55.1% | -8.0pp | 45.1% ‡ |
| micro-sr-levels | levels | neutral | 294 | 60.9% | 56.1% | +4.8pp | 55.2% | 526 | 42.6% | 43.8% | -1.2pp | 38.4% ‡ |
| multi-timeframe-trend | trend | neutral | 577 | 48.5% | 52.5% | -4.0pp | 44.5% ‡ | 54 | 75.9% | 47.4% | +28.5pp | 63.1% |
| rsi-overbought | mean-reversion | bearish | 0 | —% | 0.0% | — | — | 234 | 100.0% | 100.0% | +0.0pp | 98.4% |
| rsi-oversold | mean-reversion | bullish | 172 | 77.3% | 66.7% | +10.7pp | 70.5% | 0 | —% | 33.3% | — | — |
| session-open-effect | other | neutral | 9 | 22.2% | 57.1% | -34.9pp | 6.3% ‡ | 36 | 36.1% | 42.8% | -6.7pp | 22.5% ‡ |
| speed-momentum | momentum | neutral | 626 | 45.0% | 43.5% | +1.5pp | 41.2% ‡ | 621 | 66.8% | 56.5% | +10.4pp | 63.0% |
| stoch-rsi | mean-reversion | neutral | 160 | 86.9% | 92.7% | -5.8pp | 80.8% | 308 | 4.5% | 7.3% | -2.7pp | 2.7% ‡ |
| support-resistance-levels | levels | neutral | 0 | —% | 63.0% | — | — | 7535 | 35.6% | 36.8% | -1.2pp | 34.5% ‡ |

**Long-side lift (pp vs pair-weighted base) at every horizon** — horizon sensitivity check:

| directive | style | 15m | 1h | 4h | 24h |
|---|---|---|---|---|---|
| analyst-adjustments | other | -0.3 | +0.4 | +0.9 | +0.0 |
| btc-halving-cycle | other | +1.6 | +2.4 | +3.0 | +0.0 |
| ema-structure | trend | -6.2 | -7.7 | -4.1 | -0.6 |
| gold-round-numbers | levels | -7.6 | -1.3 | +15.1 | -48.8 |
| macd-crossover | trend | -20.1 | -29.5 | -24.3 | -24.2 |
| micro-sr-levels | levels | +4.0 | +4.8 | -3.5 | +7.5 |
| multi-timeframe-trend | trend | -4.2 | -4.0 | -8.2 | +2.1 |
| rsi-overbought | mean-reversion | — | — | — | — |
| rsi-oversold | mean-reversion | +17.8 | +10.7 | -6.1 | +9.8 |
| session-open-effect | other | — | — | — | — |
| speed-momentum | momentum | +4.6 | +1.5 | +2.3 | -16.3 |
| stoch-rsi | mean-reversion | -2.3 | -5.8 | -1.8 | +5.4 |
| support-resistance-levels | levels | — | — | — | — |

**Hypothesis — mean-reversion vs trend (long side, n≥30, lift vs pair-weighted base):**

- @15m — **other**: 2 directive(s), 1 positive lift, 0 clear the base on Wilson low. analyst-adjustments -0.3 · btc-halving-cycle +1.6
- @15m — **trend**: 3 directive(s), 0 positive lift, 0 clear the base on Wilson low. ema-structure -6.2 · macd-crossover -20.1 · multi-timeframe-trend -4.2
- @15m — **levels**: 2 directive(s), 1 positive lift, 0 clear the base on Wilson low. gold-round-numbers -7.6 · micro-sr-levels +4.0
- @15m — **mean-reversion**: 2 directive(s), 1 positive lift, 1 clear the base on Wilson low. rsi-oversold +17.8 · stoch-rsi -2.3
- @15m — **momentum**: 1 directive(s), 1 positive lift, 1 clear the base on Wilson low. speed-momentum +4.6

- @1h — **other**: 2 directive(s), 2 positive lift, 0 clear the base on Wilson low. analyst-adjustments +0.4 · btc-halving-cycle +2.4
- @1h — **trend**: 3 directive(s), 0 positive lift, 0 clear the base on Wilson low. ema-structure -7.7 · macd-crossover -29.5 · multi-timeframe-trend -4.0
- @1h — **levels**: 2 directive(s), 1 positive lift, 0 clear the base on Wilson low. gold-round-numbers -1.3 · micro-sr-levels +4.8
- @1h — **mean-reversion**: 2 directive(s), 1 positive lift, 1 clear the base on Wilson low. rsi-oversold +10.7 · stoch-rsi -5.8
- @1h — **momentum**: 1 directive(s), 1 positive lift, 0 clear the base on Wilson low. speed-momentum +1.5

### C. Per-symbol long-side base rate (share of readings where price ROSE)

| symbol | 15m rise% | 1h rise% | 4h rise% | 24h rise% | n(15m) | flag |
|---|---|---|---|---|---|---|
| XAUUSD | 53.2 | 52.6 | 51.6 | 42.9 | 6246 |  |
| BTC | 51.0 | 63.7 | 44.1 | 0.0 | 1330 |  |
| XAGUSD | 100.0 | 100.0 | 100.0 | 19.4 | 702 |  |
| NZDUSD | 53.8 | 62.4 | 60.6 | 76.8 | 591 |  |
| EURUSD | 51.9 | 51.7 | 46.2 | 72.2 | 580 |  |
| ETH | 49.8 | 39.9 | 6.4 | 0.0 | 576 | LONG structurally hard (≥2 horizons <45% rise) |
| SOL | 41.9 | 49.2 | 8.4 | 31.8 | 547 | LONG structurally hard (≥2 horizons <45% rise) |
| NZDJPY | 44.7 | 60.1 | 56.6 | 83.7 | 546 |  |
| GBPUSD | 40.7 | 41.5 | 44.4 | 75.9 | 540 | LONG structurally hard (≥2 horizons <45% rise) |
| AUDUSD | 44.2 | 48.1 | 39.9 | 75.9 | 514 | LONG structurally hard (≥2 horizons <45% rise) |
| EURCHF | 68.5 | 89.2 | 98.1 | 70.8 | 480 |  |
| GBPCAD | 60.5 | 63.6 | 60.9 | 64.5 | 473 |  |
| VIX | 0.0 | 0.0 | 0.0 | 4.3 | 468 | LONG structurally hard (≥2 horizons <45% rise) |
| EURGBP | 54.8 | 45.4 | 55.7 | 0.0 | 467 |  |
| EURCAD | 66.6 | 51.9 | 60.9 | 34.3 | 455 |  |
| EURJPY | 49.1 | 38.9 | 46.4 | 77.1 | 450 |  |
| AUDJPY | 41.9 | 49.2 | 37.5 | 82.6 | 437 | LONG structurally hard (≥2 horizons <45% rise) |
| GBPJPY | 48.6 | 60.8 | 58.0 | 76.9 | 424 |  |
| USDCAD | 52.2 | 64.3 | 71.9 | 25.9 | 370 |  |
| USDJPY | 64.9 | 50.0 | 54.3 | 92.1 | 368 |  |
| SPY | 81.5 | 78.8 | 69.1 | 61.5 | 340 |  |
| QQQ | 80.4 | 74.1 | 69.3 | 3.0 | 332 |  |
| USDCHF | 58.8 | 75.5 | 94.9 | 100.0 | 274 |  |
| US30 | 100.0 | 100.0 | 100.0 | 74.0 | 235 |  |
| MSTR | 45.2 | 25.3 | 8.9 | 0.0 | 146 | LONG structurally hard (≥2 horizons <45% rise) |
| AVGO | 63.0 | 100.0 | 47.1 | 21.0 | 138 |  |
| USTEC | 60.3 | 82.5 | 83.3 | 83.3 | 126 |  |
| NVDA | 12.9 | 12.9 | 12.9 | 0.0 | 116 | LONG structurally hard (≥2 horizons <45% rise) |
| TSLA | 63.5 | 49.6 | 27.8 | 20.9 | 115 |  |
| AMZN | 94.7 | 85.1 | 44.7 | 100.0 | 114 |  |
| GOOGL | 42.2 | 40.4 | 35.8 | 13.8 | 109 | LONG structurally hard (≥2 horizons <45% rise) |
| MSFT | 42.3 | 25.0 | 16.3 | 16.3 | 104 | LONG structurally hard (≥2 horizons <45% rise) |
| AAPL | 22.5 | 52.1 | 85.9 | 100.0 | 71 |  |

**Symbols flagged:** ETH, SOL, GBPUSD, AUDUSD, VIX, AUDJPY, MSTR, NVDA, GOOGL, MSFT

## SQL: per (directive x symbol x timeframe)

`sql
-- #820 per (directiveId × symbol × timeframe) counts — for pair-weighted base rates.
SELECT directiveId, symbol, timeframe,
  SUM(signalClass='bullish' AND priceT15m IS NOT NULL)      b15,
  SUM(signalClass='bullish' AND priceT15m > priceAtPredict) br15,
  SUM(signalClass='bearish' AND priceT15m IS NOT NULL)      s15,
  SUM(signalClass='bearish' AND priceT15m < priceAtPredict) sf15,
  SUM(priceT15m IS NOT NULL) a15, SUM(priceT15m > priceAtPredict) ar15, SUM(priceT15m < priceAtPredict) af15,
  SUM(signalClass='bullish' AND priceT1h IS NOT NULL)       b1h,
  SUM(signalClass='bullish' AND priceT1h > priceAtPredict)  br1h,
  SUM(signalClass='bearish' AND priceT1h IS NOT NULL)       s1h,
  SUM(signalClass='bearish' AND priceT1h < priceAtPredict)  sf1h,
  SUM(priceT1h IS NOT NULL) a1h, SUM(priceT1h > priceAtPredict) ar1h, SUM(priceT1h < priceAtPredict) af1h,
  SUM(signalClass='bullish' AND priceT4h IS NOT NULL)       b4h,
  SUM(signalClass='bullish' AND priceT4h > priceAtPredict)  br4h,
  SUM(signalClass='bearish' AND priceT4h IS NOT NULL)       s4h,
  SUM(signalClass='bearish' AND priceT4h < priceAtPredict)  sf4h,
  SUM(priceT4h IS NOT NULL) a4h, SUM(priceT4h > priceAtPredict) ar4h, SUM(priceT4h < priceAtPredict) af4h,
  SUM(signalClass='bullish' AND priceT24h IS NOT NULL)      b24h,
  SUM(signalClass='bullish' AND priceT24h > priceAtPredict) br24h,
  SUM(signalClass='bearish' AND priceT24h IS NOT NULL)      s24h,
  SUM(signalClass='bearish' AND priceT24h < priceAtPredict) sf24h,
  SUM(priceT24h IS NOT NULL) a24h, SUM(priceT24h > priceAtPredict) ar24h, SUM(priceT24h < priceAtPredict) af24h
FROM directiveoutcome
WHERE outcomeComputedAt IS NOT NULL AND signalClass IN ('bullish','bearish')
GROUP BY directiveId, symbol, timeframe
ORDER BY directiveId, symbol, timeframe;
`

## SQL: base universe per (symbol x timeframe)

`sql
-- #820 base universe: per (symbol × timeframe) counts over ALL corpus rows (any directive).
SELECT symbol, timeframe,
  SUM(priceT15m IS NOT NULL) a15, SUM(priceT15m > priceAtPredict) ar15, SUM(priceT15m < priceAtPredict) af15,
  SUM(priceT1h IS NOT NULL) a1h, SUM(priceT1h > priceAtPredict) ar1h, SUM(priceT1h < priceAtPredict) af1h,
  SUM(priceT4h IS NOT NULL) a4h, SUM(priceT4h > priceAtPredict) ar4h, SUM(priceT4h < priceAtPredict) af4h,
  SUM(priceT24h IS NOT NULL) a24h, SUM(priceT24h > priceAtPredict) ar24h, SUM(priceT24h < priceAtPredict) af24h
FROM directiveoutcome
WHERE outcomeComputedAt IS NOT NULL AND signalClass IN ('bullish','bearish')
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
`
