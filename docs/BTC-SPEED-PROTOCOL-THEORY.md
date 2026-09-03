# Bitcoin Speed Protocol — Theory & Design

**Document Type:** Training / Theory  
**Protocol:** `BTC-SPEED-V1`  
**Date:** 2026-06-23  
**Status:** Implemented — `btc-speed-v1` is registered in `protocols-seed-data.ts` and surfaced via the
BtcSpeedTradingPage (updated 2026-09-03; retained as the theory/rationale reference).  

---

## 1. Philosophy

### The Speed Trading Premise

Speed trading (as practiced on XTrend Speed) exploits a simple truth: **in highly volatile instruments, price moves far enough, fast enough, in both directions, that symmetric SL/TP bets can be consistently profitable IF the entry direction and timing are right.**

The mechanics:
- **Equal-distance SL/TP** from entry — a binary outcome per trade
- **Bet both directions** — long when bullish signals converge, short when bearish
- **Scale with conviction** — larger position when scoring is high
- **High frequency** — 1m to 15m timeframes, many small trades

The mathematical edge comes from getting direction right more than 50% of the time. At equal SL/TP distance, 51% accuracy = net profit (minus spread). At 60% accuracy, the edge is substantial.

### Why Bitcoin?

Bitcoin is the ideal speed-trading instrument:

| Property | Why it matters |
|----------|---------------|
| **24/7 trading** | No gap risk, continuous opportunity |
| **High volatility** | Price moves enough to hit SL or TP quickly |
| **Deep liquidity** | Tight spreads on major exchanges, minimal slippage |
| **Technical purity** | Less earnings/news disruption than equities — BTC moves on technicals, macro, and sentiment |
| **4-year halving cycle** | Creates rare, powerful macro opportunities that a scoring protocol can capture |
| **Round-number psychology** | BTC respects $10K increments — predictable S/R levels |

### The Protocol Weight Philosophy

This protocol is designed to demonstrate SEES's variable-weight architecture. Not all directives are equal:

| Directive | maxScore | Role |
|-----------|----------|------|
| `speed-momentum` | **120** | Primary — short-term velocity is the core signal |
| `btc-halving-cycle` | **200** | Macro bonus — fires rarely, but when it does, it's dominant |
| `bollinger-squeeze` | **100** | Expansion catalyst — squeeze precedes speed trade opportunities |
| `volume-confirmation` | **85** | Confirmation — volume must support the move |
| `crypto-fear-greed` | **60** | Contrarian — sentiment is informative but shouldn't dominate |
| `microstructure-spread` | **40** | Gatekeeper — only matters when spread is anomalous |

**Protocol ceiling:** 120 + 200 + 100 + 85 + 60 + 40 + ... = ~900 points.  
A 720/900 (80%) score = good, frequent opportunity.  
A 855/900 (95%) score = rare, extraordinary opportunity (requires halving cycle to fire).

This variable-weight design means:
1. The protocol's total possible score communicates its complexity
2. A high score in this protocol means something different from a high score in a simple 300-point equity protocol
3. The halving cycle directive can push an otherwise-good score into rare/extraordinary territory

---

## 2. The Rarity Gauge

### The Problem

A flat percentage (e.g., "≥ 65% = BUY") doesn't distinguish between:
- A score that's **80% of max** every week (common, reliable)
- A score that's **90% of max** once every 4 years (rare, extraordinary)

Both would trigger BUY, but they represent fundamentally different opportunities.

### The Solution: Percentile-Based Rarity Bands

Rather than absolute thresholds, the system should track the **historical distribution** of composite scores for each protocol and express the current score as a percentile:

```
Rarity = percentile(currentScore, historicalScores[])
```

| Band | Percentile | Meaning | Color |
|------|-----------|---------|-------|
| **Standard** | 0–70th | Common opportunity — trade with base size | Green |
| **Strong** | 70–85th | Above-average convergence — scale up 1.5× | Blue |
| **Exceptional** | 85–95th | Rare alignment — scale up 2× | Purple |
| **Cyclical** | 95–99th | Multi-year event (halving, macro shift) — maximum conviction | Gold |
| **Black Swan** | 99th+ | Never seen before — protocol is in uncharted territory | Red |

The rarity gauge is **protocol-specific**. 80% in the Bitcoin Speed Protocol (ceiling ~900) might be the 70th percentile. 80% in a simple equity protocol (ceiling 300) might be the 95th percentile. The gauge communicates this context.

### Implementation Requirement

The scoring pipeline must:
1. Store historical composite scores per protocol (at least 1 year of daily samples)
2. Compute the current score's percentile against the historical distribution
3. Return both the absolute percentage AND the rarity percentile in the `GatedScore` response
4. Display the rarity band in the UI with the appropriate color

---

## 3. Bitcoin-Specific Edge Factors

### The Halving Cycle (4-Year Macro Driver)

Bitcoin's programmed supply reduction creates a predictable 4-year rhythm:

| Phase | Months Post-Halving | Characteristic | Scoring Impact |
|-------|-------------------|----------------|----------------|
| **Post-Halving Rally** | 0–6 | Supply shock, institutional narrative, retail FOMO | +80 to +200 |
| **Mid-Cycle** | 6–18 | Consolidation, accumulation, range-bound | 0 to +40 |
| **Late-Cycle** | 18–30 | Euphoria, blow-off top potential, distribution | +20 to +60 |
| **Pre-Halving** | 30–48 | Bear market, accumulation, miner capitulation risk | -20 to +20 |
| **Halving Event Itself** | 0–7 days | Volatility spike, uncertainty | Neutral (0) |

Last halving: **2024-04-20**. Current date: June 2026 — we are ~26 months post-halving, in the **Late-Cycle** phase. The halving directive should be scoring meaningfully right now as we approach potential cycle top territory.

### Session Dynamics

Bitcoin trades 24/7 but has distinct session characteristics:

| Session | UTC | Characteristics |
|---------|-----|----------------|
| **Asian** | 00:00–08:00 | Often sets the daily trend; China policy news matters |
| **European** | 08:00–14:00 | Range development; institutional flow begins |
| **US Overlap** | 14:00–21:00 | Highest volume, largest moves; ETF flow data released |
| **Weekend** | Sat/Sun | Lower volume, potentially wider spreads, whale manipulation risk |

Speed trading is most effective during **US Overlap** (highest volume, tightest spreads). The `session-timing-filter` directive should favor this window.

### Macro Correlations

BTC's correlation regime shifts:

| Correlated With | When | Why |
|----------------|------|-----|
| **NASDAQ (QQQ)** | Risk-on periods | BTC treated as "tech proxy" |
| **Gold** | Inflation fears, USD weakness | "Digital gold" narrative active |
| **DXY (inverse)** | Strong dollar periods | Dollar strength suppresses BTC |
| **Nothing** | Decoupling events | BTC moves independently — these are the best speed trading opportunities |

A `btc-macro-correlation` directive (future) could identify decoupling events as extraordinary opportunities.

---

## 4. Trade Execution Model

For the speed trading use case, the app should support:

### Bracket Orders
```
Entry: Market buy 0.01 BTC at $105,000
SL: $104,900 (-$100, -0.095%)
TP: $105,100 (+$100, +0.095%)
Risk:Reward = 1:1
```

The equal distance means the trade is direction-agnostic in risk terms. The edge comes from getting direction right.

### Confidence-Based Position Sizing
```
baseSize = 0.01 BTC (or 1% of account)
confidenceMultiplier = compositeScore / 50  // 80% score = 1.6× = 0.016 BTC
positionSize = baseSize × confidenceMultiplier
```

At 95% (rare halving-cycle alignment): 1.9× base size.  
At 60% (weak signal): 1.2× base size — still trade, just smaller.

### Directional Consensus
```
bullishDirectives = count(breakouts[*].signalClass == 'bullish')
bearishDirectives = count(breakouts[*].signalClass == 'bearish')
direction = bullishDirectives > bearishDirectives ? 'LONG' : 'SHORT'
consensusStrength = abs(bullishDirectives - bearishDirectives) / totalDirectives
```

Strong bullish consensus + high composite = long entry with conviction sizing.  
Split consensus + high composite = reduced size or skip.

---

## 5. Protocol Score Card Example

What a "rare opportunity" looks like for BTC-SPEED-V1:

```
╔══════════════════════════════════════════════════════╗
║  BTC-SPEED-V1  |  Score: 855/900 (95%)  |  BUY ↑   ║
║  Rarity: 97th percentile (Cyclical)                 ║
╠══════════════════════════════════════════════════════╣
║  Technical (40%)                         365/400    ║
║    speed-momentum        110/120  ████████████      ║
║    bollinger-squeeze      90/100  ██████████        ║
║    volume-confirmation    75/85   ████████          ║
║    atr-expansion          90/100  ██████████        ║
║                                                      ║
║  Sentiment (35%)                         315/315    ║
║    crypto-fear-greed      55/60   ██████████        ║
║    social-buzz            80/100  ████████          ║
║                                                      ║
║  Risk Gates (25% × 1.08 multiplier)                  ║
║    btc-halving-cycle     175/200  ████████████████  ║ ← CYCLICAL BONUS
║    volatility-regime      80/100  ████████          ║
║    btc-dominance          55/60   ██████████        ║
╚══════════════════════════════════════════════════════╝
```

The halving cycle directive contributed 175/200 — the "cyclical bonus" that pushed this from a strong 80% to a rare 95%.

---

## 6. Backtesting Requirements

To validate this protocol, backtesting must support:

1. **Historical BTC data** — at least 4 years (one full halving cycle) at 5m/15m/1h resolution
2. **Bracket order simulation** — entry at bar close, check if SL or TP is hit first, record outcome
3. **Confidence-based sizing** — position size varies with score, affecting P&L
4. **Walk-forward optimization** — train weights on year 1-2, test on year 3-4
5. **News exclusion mode** ✅ `POST /api/backtest/run { newsExclusion: 'exclude'|'only'|'reduce' }` — Queries NewsArticle table, filters signals on news days. Completed #105.
6. **Equity curve** ✅ `GET /api/backtest/equity/:runId` — Cumulative P&L, max drawdown %, peak equity. Completed #103.
7. **Directive coverage** ✅ `POST /api/backtest/coverage` — Per-directive win rate and forward returns. Completed #106.

---

## References

- SEES Protocol Gating Architecture: `.github/prompts/DONE__protocol-risk-gating.prompt.md`
- Directive MaxScore Philosophy: `.github/prompts/fix-directive-maxscore-clamps.prompt.md`
- Backtest Enhancement: `.github/prompts/backtest-review-and-btc-testing.prompt.md`
