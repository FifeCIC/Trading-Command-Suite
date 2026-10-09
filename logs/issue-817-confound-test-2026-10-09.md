# #817 confound test - measurement archive 2026-10-09

Corpus: directiveoutcome resolved rows 2026-10-05 19:44:09 -> 2026-10-06 16:47:16 (18,784 rows).
Regenerate: run temp-817-counts.sql against mysql, then the Wilson/report script (see SQL below).

### Mode-side result (own declared horizon)

| protocol | mode | declared tf | judged at | n(side) | acc | base | lift | Wilson low | verdict |
|---|---|---|---|---|---|---|---|---|---|
| btc-scalp-v1 | LONG | 5s–30s | 15m ⚠ | 721 | 54.2% | 50.2% | +4.1pp | 50.6% | above base rate |
| btc-speed-v1 | LONG | 15m–1d | 15m | 485 | 36.1% | 45.7% | -9.6pp | 31.9% ‡ | below base rate (anti-signal) |
| dow-speed-v1 | LONG | 5s–30s | 15m ⚠ | 0 | —% | 100.0% | —pp | —% | no mode-side observations (see bearish) |
| forex-session-v1 | LONG | 5m | 15m ⚠ | 1905 | 47.2% | 52.8% | -5.6pp | 45.0% ‡ | below base rate (anti-signal) |
| gold-macro-v1 | LONG | 1d–1w | 24h | 414 | 0.0% | 0.0% | +0.0pp | 0.0% ‡ | indistinguishable from drift |
| hourly-3dir-v1 | LONG | 1h | 1h | 46 | 95.7% | 95.7% | +0.0pp | 85.5% | indistinguishable from drift |
| momentum-stock-v1 | LONG | 5m–1d | 15m | 279 | 57.3% | 49.8% | +7.5pp | 51.5% | above base rate |
| qqq-day-v1 | LONG | 5m–1h | 15m | 39 | 53.8% | 50.0% | +3.8pp | 38.6% ‡ | indistinguishable from drift |
| qqq-speed-v1 | LONG | 5s–30s | 15m ⚠ | 15 | 100.0% | 82.4% | +17.6pp | 79.6% | insufficient |
| spy-day-v1 | LONG | 5m–1h | 15m | 36 | 66.7% | 59.1% | +7.6pp | 50.3% | indistinguishable from drift |
| spy-speed-v1 | LONG | 5s–30s | 15m ⚠ | 8 | 62.5% | 92.2% | -29.7pp | 30.6% ‡ | insufficient |
| vix-short-v1 | SHORT | 1m–5m | 15m ⚠ | 468 | 100.0% | 100.0% | +0.0pp | 99.2% | indistinguishable from drift |
| xau-speed-1h | LONG | 1h | 1h | 113 | 77.9% | 59.5% | +18.3pp | 69.4% | above base rate |
| xau-speed-1h-copy | LONG | 1h | 1h | 113 | 77.9% | 59.5% | +18.3pp | 69.4% | above base rate |
| xau-speed-4h | LONG | 4h | 4h | 168 | 52.4% | 78.6% | -26.3pp | 44.9% ‡ | below base rate (anti-signal) |
| xau-speed-4h-copy | LONG | 4h | 4h | 168 | 52.4% | 78.6% | -26.3pp | 44.9% ‡ | below base rate (anti-signal) |
| xau-speed-m15 | LONG | 15m | 15m | 54 | 70.4% | 57.8% | +12.6pp | 57.2% | indistinguishable from drift |
| xau-speed-m15-copy | LONG | 15m | 15m | 54 | 70.4% | 57.8% | +12.6pp | 57.2% | indistinguishable from drift |
| xau-speed-m5 | LONG | 5m | 15m ⚠ | 55 | 56.4% | 70.7% | -14.4pp | 43.3% ‡ | below base rate (anti-signal) |
| xau-speed-m5-copy | LONG | 5m | 15m ⚠ | 55 | 56.4% | 70.7% | -14.4pp | 43.3% ‡ | below base rate (anti-signal) |
| xau-speed-v1 | LONG | 5s–30s | 15m ⚠ | 56 | 51.8% | 83.4% | -31.6pp | 39.0% ‡ | below base rate (anti-signal) |
| xau-speed-v1-copy | LONG | 5s–30s | 15m ⚠ | 215 | 76.7% | 84.8% | -8.0pp | 70.7% | below base rate (anti-signal) |

⚠ = judged horizon is beyond the declared range (shortest observable). ‡ = Wilson 95% lower bound < 50% — **unproven as skill**, regardless of the comparison.

### Both observed sides at the same horizon (long / short split — never pooled)

| protocol | judged at | nL | accL | baseRise | liftL | wL.low | nS | accS | baseFall | liftS | wS.low |
|---|---|---|---|---|---|---|---|---|---|---|---|
| btc-scalp-v1 | 15m | 721 | 54.2% | 50.2% | +4.1pp | 50.6% | 926 | 52.7% | 49.5% | +3.2pp | 49.5% |
| btc-speed-v1 | 15m | 485 | 36.1% | 45.7% | -9.6pp | 31.9% | 321 | 39.9% | 54.3% | -14.5pp | 34.7% |
| dow-speed-v1 | 15m | 0 | — | 100.0% | — | — | 235 | 0.0% | 0.0% | +0.0pp | 0.0% |
| forex-session-v1 | 15m | 1905 | 47.2% | 52.8% | -5.6pp | 45.0% | 5018 | 43.6% | 45.6% | -2.0pp | 42.2% |
| gold-macro-v1 | 24h | 414 | 0.0% | 0.0% | +0.0pp | 0.0% | 0 | — | 100.0% | — | — |
| hourly-3dir-v1 | 1h | 46 | 95.7% | 95.7% | +0.0pp | 85.5% | 0 | — | 4.3% | — | — |
| momentum-stock-v1 | 15m | 279 | 57.3% | 49.8% | +7.5pp | 51.5% | 634 | 53.5% | 50.2% | +3.3pp | 49.6% |
| qqq-day-v1 | 15m | 39 | 53.8% | 50.0% | +3.8pp | 38.6% | 67 | 52.2% | 50.0% | +2.2pp | 40.5% |
| qqq-speed-v1 | 15m | 15 | 100.0% | 82.4% | +17.6pp | 79.6% | 337 | 18.1% | 17.3% | +0.8pp | 14.4% |
| spy-day-v1 | 15m | 36 | 66.7% | 59.1% | +7.6pp | 50.3% | 74 | 44.6% | 40.9% | +3.7pp | 33.8% |
| spy-speed-v1 | 15m | 8 | 62.5% | 92.2% | -29.7pp | 30.6% | 222 | 6.8% | 7.8% | -1.1pp | 4.1% |
| vix-short-v1 | 15m | 0 | — | 0.0% | — | — | 468 | 100.0% | 100.0% | +0.0pp | 99.2% |
| xau-speed-1h | 1h | 113 | 77.9% | 59.5% | +18.3pp | 69.4% | 532 | 44.4% | 40.5% | +3.9pp | 40.2% |
| xau-speed-1h-copy | 1h | 113 | 77.9% | 59.5% | +18.3pp | 69.4% | 532 | 44.4% | 40.5% | +3.9pp | 40.2% |
| xau-speed-4h | 4h | 168 | 52.4% | 78.6% | -26.3pp | 44.9% | 534 | 13.1% | 21.4% | -8.3pp | 10.5% |
| xau-speed-4h-copy | 4h | 168 | 52.4% | 78.6% | -26.3pp | 44.9% | 534 | 13.1% | 21.4% | -8.3pp | 10.5% |
| xau-speed-m15 | 15m | 54 | 70.4% | 57.8% | +12.6pp | 57.2% | 429 | 43.8% | 42.2% | +1.6pp | 39.2% |
| xau-speed-m15-copy | 15m | 54 | 70.4% | 57.8% | +12.6pp | 57.2% | 429 | 43.8% | 42.2% | +1.6pp | 39.2% |
| xau-speed-m5 | 15m | 55 | 56.4% | 70.7% | -14.4pp | 43.3% | 430 | 27.4% | 29.3% | -1.8pp | 23.4% |
| xau-speed-m5-copy | 15m | 55 | 56.4% | 70.7% | -14.4pp | 43.3% | 430 | 27.4% | 29.3% | -1.8pp | 23.4% |
| xau-speed-v1 | 15m | 56 | 51.8% | 83.4% | -31.6pp | 39.0% | 635 | 13.9% | 16.6% | -2.8pp | 11.4% |
| xau-speed-v1-copy | 15m | 215 | 76.7% | 84.8% | -8.0pp | 70.7% | 942 | 13.4% | 15.2% | -1.8pp | 11.4% |

### Mode-side lift at every observable horizon (pp vs base)

| protocol | 15m | 1h | 4h | 24h |
|---|---|---|---|---|
| btc-scalp-v1 | +4.1 | +6.4 | -6.7 | +5.4 |
| btc-speed-v1 | -9.6 | -18.7 | -9.4 | +0.0 |
| dow-speed-v1 | — | — | — | — |
| forex-session-v1 | -5.6 | -7.0 | -4.1 | -2.7 |
| gold-macro-v1 | +0.0 | +0.0 | +0.0 | +0.0 |
| hourly-3dir-v1 | +0.0 | +0.0 | +0.0 | +0.0 |
| momentum-stock-v1 | +7.5 | +3.6 | +2.7 | -6.3 |
| qqq-day-v1 | +3.8 | +0.3 | +6.2 | +8.1 |
| qqq-speed-v1 | +17.6 | +10.5 | -7.8 | +28.7 |
| spy-day-v1 | +7.6 | +4.6 | -1.4 | +7.5 |
| spy-speed-v1 | -29.7 | -29.7 | -28.4 | -25.3 |
| vix-short-v1 | +0.0 | +0.0 | +0.0 | +0.0 |
| xau-speed-1h | -15.7 | +18.3 | +29.0 | -36.9 |
| xau-speed-1h-copy | -15.7 | +18.3 | +29.0 | -36.9 |
| xau-speed-4h | +22.1 | +15.9 | -26.3 | -3.4 |
| xau-speed-4h-copy | +22.1 | +15.9 | -26.3 | -3.4 |
| xau-speed-m15 | +12.6 | -14.1 | +61.7 | -72.0 |
| xau-speed-m15-copy | +12.6 | -14.1 | +61.7 | -72.0 |
| xau-speed-m5 | -14.4 | -10.4 | +46.3 | -71.8 |
| xau-speed-m5-copy | -14.4 | -10.4 | +46.3 | -71.8 |
| xau-speed-v1 | -31.6 | -27.9 | -10.8 | -19.4 |
| xau-speed-v1-copy | -8.0 | -10.8 | -3.9 | -1.3 |

**Mode-side verdicts:** above 4 · indistinguishable 7 · below 8 · insufficient/no-obs 3 (of 22 protocols with resolved rows)

## Full SQL

`sql
-- #817 confound test — per-protocol counts at each observable horizon, split by observed class.
-- Universe: directiveoutcome rows with outcomeComputedAt NOT NULL (the matured corpus).
-- NOTE: resolved corpus window is 2026-10-05 19:44:09 -> 2026-10-06 16:47:16 (queue frontier).
SELECT strategyId,
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
GROUP BY strategyId
ORDER BY strategyId;
`
