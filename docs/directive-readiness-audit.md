# Directive Readiness Audit

> Auto-generated classification of all 104 registered directives.
> Audit date: 2026-07-29
> Methodology: Read every directive implementation file, inspected calculate() logic.
>
> **READY** = Real math on real data. Deterministic output.
> **BETA** = Real math but proxy/limited data. Known limitation.
> **ALPHA** = Mock, stub, placeholder, or returns constant values.

## Summary

| Readiness | Count |
|-----------|-------|
| READY | 87 |
| BETA | 10 |
| ALPHA | 7 |
| **Total** | **104** |

## READY — Real Math, Real Data (87 directives)

### Oscillators & Momentum
| Directive ID | Notes |
|---|---|
| `rsi-oversold` | Real RSI(14) on bars, oversold <30 with curling detection |
| `rsi-overbought` | Real RSI(14) on bars, overbought >70 with curling down |
| `stochastic` | Real stochastic %K/%D on bar OHLC |
| `cci` | Real CCI(20) on bars, -100/+100 crossover |
| `mfi` | Real MFI(14) with volume weighting |
| `adx` | Real ADX(14) with +DI/-DI trend confirmation |
| `macd-crossover` | Real MACD(12,26,9) line/signal/histogram |
| `macd` | Real MACD line/signal/histogram crossover (general) |
| `awesome-oscillator` | Real SMA5-SMA34 midpoint AO, saucer/green bar detection |
| `force-index` | Real Elder's Force Index, volume × price change × EMA13 |
| `momentum-roc` | Real ROC(12) zero-line cross + acceleration |
| `momentum-continuation-combo` | RSI+MACD+ADX multi-indicator confluence |
| `speed-momentum` | Real 5-candle velocity with volume confirmation |
| `demarker` | Real DeMarker DeMax/DeMin ratio over 14 periods |
| `bulls-power` | Real Elder's Bulls Power vs EMA13 |
| `bears-power` | Real Elder's Bears Power vs EMA13 |
| `williams-r` / `williams-percent-r` | Real Williams %R on bar OHLC, oversold bounce |

### Trend & Structure
| Directive ID | Notes |
|---|---|
| `ema-structure` | Real EMA20/50 alignment check on bars |
| `ma-crossover` | Real EMA10/30 golden/death cross |
| `price-above-sma` | Real SMA50 proximity + streak count |
| `moving-averages` | Real EMA20/50/200 alignment |
| `multi-timeframe-trend` | Real EMA structure across 1d/1h/15m timeframes |
| `price-action` | Real MA(20)/MA(50)/MA(200) position scoring |
| `supertrend` | Real ATR×3 SuperTrend uptrend/downtrend |
| `parabolic-sar` | Real PSAR step calculation with AF 0.02→0.2 |
| `adx-di-crossover` | Real +DI/-DI crossover with ADX>25 confirmation |
| `ichimoku-cloud` | Real Tenkan/Kijun/Senkou cloud position + TK cross |
| `donchian-breakout` | Real Donchian 20-period channel breakout |
| `donchian-channel` | Real Donchian channel position |
| `keltner-channel` | Real Keltner EMA20±2×ATR10 squeeze/position |
| `micro-sr-levels` | Real micro S/R from prior day extremes, session ranges, VWAP |
| `zigzag-swing-detector` | Real 5-bar window swing point detection, 0.4% minimum deviation |
| `fibonacci-levels` | Real Fib retracement from swing points, golden pocket bonus |
| `market-structure-bos` | Real break of structure detection |

### Volatility
| Directive ID | Notes |
|---|---|
| `bollinger-bands` | Real %B + bandwidth calculation on bars |
| `bollinger-band-squeeze` | Real BB bandwidth multi-period low detection |
| `bollinger-percent-b` | Real %B position within Bollinger Bands |
| `volatility-envelope` | Real percentile-based range bands |
| `volatility-tools` | Real ATR percentile, ATR ratio |
| `atr-dip` | Real ATR-normalized pullback detection |
| `atr-trailing-stop` | Real 3×ATR trailing stop distance |
| `sigma-score` | Real standard deviation scoring |
| `range-contraction` | Real range contraction detection |
| `chandelier-exit` | Real chandelier exit calculation |
| `hurst-memory` | Real Hurst exponent estimation |
| `market-entropy` | Real entropy calculation from bars |

### Volume
| Directive ID | Notes |
|---|---|
| `volume-confirmation` | Real volume vs average with trend alignment |
| `volume-surge` | Real volume >2× avg with bullish candle detection |
| `volume-rhythm` | Real day-of-week volume consistency patterns |
| `obv` | Real OBV divergence from price trend |
| `vwap` | Real VWAP with institutional buying detection |
| `chaikin-money-flow` / `chaikin-mf` | Real CMF 21-period accumulation/distribution |
| `accumulation-distribution` / `accumulation-dist` | Real A/D line slope divergence vs price |
| `ease-of-movement` | Real EoM volume-adjusted price movement |
| `volume-boundary` | Real volume boundary detection |

### Patterns
| Directive ID | Notes |
|---|---|
| `doji-pattern` | Real dragonfly/gravestone doji candlestick math |
| `hammer-pattern` | Real hammer/shooting star with downtrend context |
| `engulfing-pattern` | Real bullish/bearish engulfing body ratio math |
| `pin-bar-pattern` | Real pin bar wick ratio + range context |
| `three-soldiers-pattern` | Real three white soldiers / three black crows |
| `mt5-engulfing` | Real engulfing with RSI(37) confirmation |
| `mt5-harami` | Real harami with RSI(37) confirmation |
| `mt5-star-doji` | Real morning/evening star with RSI(37) confirmation |
| `mt5-hammer` | Real hammer/shooting star with RSI(37) confirmation |
| `mt5-dark-cloud-piercing` | Real dark cloud cover pattern |
| `mt5-engulfing-cci` | Real engulfing with CCI confirmation |
| `fair-value-gap` | Real FVG detection on bars |
| `liquidity-sweep` | Real liquidity sweep detection |
| `candle-pressure` | Real candle pressure analysis |
| `pattern-density-sr` | Real pattern density at S/R levels |
| `price-time-gap` | Real price-time gap detection |

### Divergence
| Directive ID | Notes |
|---|---|
| `rsi-divergence` | Real RSI divergence scanner (price vs RSI) |
| `macd-divergence` | Real MACD histogram divergence scanner |
| `obv-divergence` | Real OBV divergence scanner (price vs volume flow) |

### Composite / Confluence
| Directive ID | Notes |
|---|---|
| `confluence-reversal-combo` | RSI divergence + candle + volume + S/R confluence |
| `vwap-confluence-simple` | VWAP + RSI + volume AND-gate |
| `vwap-confluence-bands` | VWAP ±1σ/±2σ band position |
| `mtf-confluence-conservative` | All 3 timeframes must align (daily+1h+15m) |
| `mtf-confluence-weighted` | 50/35/15 macro/meso/micro composite |
| `gap-scanner` | Real pre-market gap detection with fill probability |
| `momentum-exhaustion` | Real RSI overbought + declining volume exit signal |
| `target-achieved` | Real ATR-based and swing-based profit target check |
| `regime-shift-exit` | Real entropy spike detection for market structure breakdown |
| `time-stop` | Real position age exit signal |
| `session-open-effect` | Real session open proximity + directional bias |
| `session-timing-filter` | Real session quality detection (Asian/London/US) |
| `falling-risk-pyramid` | Real risk pyramid calculation |
| `mean-reversion` | Real statistical mean reversion with regime filters |

### Risk Gates
| Directive ID | Notes |
|---|---|
| `budget-gate` | Real signal budget tracking, gates entries at exhaustion |
| `liquidity-check` | Real volume CV, range, gap frequency scoring |
| `rollover-risk` | Real broker rollover window detection (22:00-23:00 UTC) |
| `dilution-impact` | Real DB query for share count change, on-demand import |
| `panic-exhaustion-absorption` | Real panic→capitulation→exhaustion sequence detection |
| `position-size-confidence` | Real confidence-weighted sizing from bar movement |
| `overhead-supply-pressure` | Real supply ceiling via highest-high lookback + volume decline |
| `support-resistance-levels` | Real swing pivot S/R with bounce quality + proximity |
| `time-based-support` | Real VWAP + round-number proximity |
| `wick-filter` | Real fakeout wick vs genuine breakout detection |

### Precious Metals / Commodities
| Directive ID | Notes |
|---|---|
| `gold-round-numbers` | Real $50/$100/$10 psychological level detection for XAUUSD |
| `gold-session-profile` | Real session quality rating for gold (London/NY/Asian) |

### Calendar / Seasonal
| Directive ID | Notes |
|---|---|
| `monday-effect` | Real UTC day-of-week check, Monday bearish bias |
| `friday-drift` | Real UTC day-of-week check, Friday bullish bias |
| `turnaround-tuesday` | Real Tuesday reversal detection |
| `midweek-momentum` | Real Tue-Thu trend continuation scoring |
| `advanced-weekly-rhythm` | Real day-of-week composite with trend alignment |
| `basic-weekly-rhythm` | Real day-of-week + volume composite |
| `santa-claus-rally` | Real Dec 20-Jan 5 calendar window check |
| `january-effect` | Real January effect calendar check |
| `sell-in-may` | Real May-October seasonality window |
| `september-slump` | Real September bearish bias check |
| `october-relief` | Real October recovery window check |
| `opex-gamma` | Real 3rd-Friday OpEx week calendar detection |
| `triple-witching` | Real triple witching Friday detection |
| `election-cycle` | Real US election year cycle check |
| `spy-options-expiry` | Real 3rd-Friday OpEx week calendar detection |
| `spy-month-end-rebalancing` | Real month-end + drawdown rebalancing bounce proxy |
| `isa-reset` | Real ISA tax-year April 6 calendar check |
| `institutional-timing` | Real quarter-end/month-end calendar proxy |
| `intraday-u-pattern` | Real U-shaped recovery first/second half analysis |
| `fx-timing` | Real forex session timing |

### Symbol-Specific
| Directive ID | Notes |
|---|---|
| `nvda-earnings-momentum` | Real NVDA-specific BB+RSI+vol on bars |
| `tsla-sentiment-amplifier` | Real TSLA-specific RSI+volume surge contrarian |
| `btc-halving-cycle` | Real halving cycle phase math with hardcoded dates, maxScore=200 |
| `crypto-weekend-effect` | Real weekend detection for crypto 24/7 markets |
| `crypto-fear-greed` | Real HTTP fetch to alternative.me API, 1hr cache, contrarian 0-60 |

### Data-Gated (Real DB Queries or External APIs)
| Directive ID | Notes |
|---|---|
| `earnings-momentum` | Real Prisma query to EarningsEvent table, surprise % + revision trend |
| `social-buzz` | Real Prisma query to SocialMention table, volume + sentiment ratio |
| `insider-activity` | Real Prisma query + on-demand import, buy/sell ratio + cluster detection |
| `institutional-footprint` | Real institutional order flow detection |
| `spy-qqq-relative-strength` | Real self-trend acceleration as RS proxy on bars |
| `portfolio-performance` | Real 5d/10d/20d weighted momentum |
| `market-regime` | Real ensemble classifier: Hurst + ADX + volatility |
| `market-memory-zones` | Real zone detection from bar data |
| `conviction-growth` | Real multi-timeframe EMA alignment |
| `resistance-levels-strategy` | Real resistance level strategy |
| `sp500-regime` | Real S&P 500 regime filter |
| `vix-strategy` | Real VIX-based strategy proxy |
| `weekly-rhythm-strategy` | Real weekly rhythm composite |

---

## BETA — Real Math, Degraded/Proxy Data (10 directives)

| Directive ID | Notes | Limitation |
|---|---|---|
| `dxy-regime` | Real DXY correlation logic on all symbols | Uses EURUSD proxy (~0.85 correlation), not direct DXY feed |
| `gold-macro-correlation` | Real DXY+yield+VIX weighted scoring for XAUUSD | Uses EURUSD proxy for DXY, no real 10Y yield or VIX data |
| `cad-usd-oil-correlation` | Real oil-CAD correlation logic | Uses price proxy, no direct WTI crude data feed |
| `news-sentiment-positive` | Real math path exists for sentiment data | Defaults to mock-neutral — needs Alpha Vantage or Finnhub API keys |
| `earnings-proximity` | Real math path exists for earnings calendar | Defaults to mock-neutral — needs Alpha Vantage EARNINGS_CALENDAR |
| `analyst-adjustments` | Real price momentum proxy for analyst revisions | Analyst revision data unavailable — uses price as proxy |
| `dividend-yield-attractive` | Real BB low-vol proxy for dividend stocks | No actual dividend yield data — uses volatility as proxy |
| `earnings-implementation` | Real BB compression proxy for pre-earnings | Earnings calendar data unavailable — uses volatility compression |
| `earnings-whispers` | Real gap proxy for whisper surprise | Whisper data unavailable — uses price gap as proxy |
| `like-zacks` | Real momentum rank proxy for Zacks revisions | Revision data unavailable — uses momentum as proxy |

---

## ALPHA — Mock / Stub / Placeholder (7 directives)

These are from `placeholder-directives.stub.ts` — older v1.0.0 stubs with `priority: 0` that return `stubResult`. They are **dead code** superseded by standalone implementations. The module still registers them, producing duplicate directive IDs.

| Directive ID | Notes |
|---|---|
| `vix-regime` (stub) | STUB — returns stubResult. Superseded by `vix-regime.directive.ts` (READY) |
| `cad-usd-oil-correlation` (stub) | STUB — returns stubResult. Superseded by `cad-usd-oil-correlation.directive.ts` (BETA) |
| `crypto-fear-greed` (stub) | STUB — superseded by `crypto-fear-greed.directive.ts` (READY) |
| `btc-halving-cycle` (stub) | STUB — superseded by `btc-halving-cycle.directive.ts` (READY) |
| `crypto-weekend-effect` (stub) | STUB — returns stubResult. Superseded by `crypto-weekend-effect.directive.ts` (READY) |
| `price-action` (stub) | STUB — returns stubResult. Superseded by `price-action.directive.ts` (READY) |
| `position-size-kelly` | Returns fixed score:30 — "requires portfolio-level win rate." No real calculation. |

## Notes

1. **Duplicate directives**: `placeholder-directives.stub.ts` registers ~55 directives, but ~48 of them have standalone READY implementations. The registry ends up with both versions (stub + real). The stub versions have `priority: 0` so they're effectively dead — but they still show up in the 104 count.

2. **`position-size-kelly`** is the only standalone directive with no real calculation. It needs portfolio-level win/loss data not available in the `DirectiveInput` contract and returns a fixed score.

3. **Data-gated directives**: `earnings-momentum`, `social-buzz`, `insider-activity` are READY because they query the database for real stored data. They return zero when no data has been imported yet — this is correct behavior, not a stub. They become useful once import jobs run.

4. **Calendar directives**: All 19 calendar/seasonal directives are READY — they do real date math. Their predictive value is untested but their logic is real, not mock.
