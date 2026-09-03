# The SEES Strategy

## One concept. Every decision.

---

### What is a SEES Strategy?

A **SEES Strategy** is the atomic unit of the Trading Command Suite. It pairs two things:

```
SEES Strategy  =  Watchlist  +  Protocol
                   (what)       (how)
```

| Component | What it defines | Example |
|-----------|----------------|---------|
| **Watchlist** | Which symbols to score | "Tech Earnings", "Forex Majors", "My ISA" |
| **Protocol** | Which directives, weights, and risk gates to apply | "momentum-short", "mean-reversion", "swing-long" |

The pairing is what makes it powerful. A momentum protocol against a crypto watchlist produces fundamentally different rankings than the same protocol against dividend stocks. The protocol defines *how* you think; the watchlist defines *what* you're thinking about.

---

### The Live Ordering Stack

When a SEES Strategy runs, it produces a **Live Ordering Stack** — every symbol in the watchlist, ranked by composite SEES score, updated in real time.

```
┌─────────────────────────────────────────┐
│  Strategy: Tech Earnings · momentum     │
├─────────────────────────────────────────┤
│  #1  NVDA     ████████████████  94.2   │  ← top entry signal
│  #2  MSTR     ██████████████    88.7   │
│  #3  TSLA     ████████████      76.1   │
│  #4  AAPL     ██████████        62.4   │
│  #5  AMZN     ████████          51.0   │
│  ...                                    │
│ #18  INTC     ██                14.3   │  ← gated: risk kill
└─────────────────────────────────────────┘
```

The stack is **not a static report**. It refreshes continuously as market data flows in from MT5, Yahoo, and other providers. Directives re-evaluate. Scores shift. The ordering surface updates.

---

### Why the Pairing Matters

Running every directive against every symbol produces noise — 4,000+ evaluations that blur into an unactionable soup. A SEES Strategy constrains the problem:

- **Fewer directives** — protocols use 15–25 directives, not all 100+ (104 as of 2026-08; see
  `docs/trading-bot-model.md` for the current Protocol + Bot model)
- **Relevant symbols** — only the ones in your watchlist are scored
- **Purposeful weighting** — directives are grouped and weighted by role (Technical 40%, Sentiment 35%, Risk 25%)
- **Risk gating** — risk directives multiplicatively gate the final score, so a symbol with perfect technicals but extreme volatility gets suppressed

The result is a **decision surface**, not a data dump.

---

### The Default Strategy

One strategy can be starred as your **primary**. Once set, every part of the app that needs to answer "what should I score right now?" uses it:

| Area | Uses the primary strategy for |
|------|------------------------------|
| Live Ordering Stack | Default view on load |
| Speed Trading scanner | Best symbol selection |
| Backtest runner | Default symbol set and protocol |
| Portfolio monitor | Cross-reference holdings against strategy |

You can switch strategies from any page without losing context. The primary is just the starting point.

---

### Creating Your First Strategy

1. **Go to Strategies** in the Scoring sidebar
2. **Pick a Watchlist** — any of your imported watchlists (Tech Earnings, Forex Majors, etc.)
3. **Pick a Protocol** — momentum-short for scalping, swing-long for position trades, mean-reversion for dip buying
4. **Name it** — "Tech Momentum", "Forex Session", "ISA Growth"
5. **Star it** — sets it as your default across the app
6. **Open the Live Ordering Stack** — see your symbols ranked in real time

---

### The Engine Under the Hood

The SEES engine doesn't average scores. It runs a **dominance-weighted voting system**:

- **Entry directives** vote for action (RSI oversold, MACD crossover, volume surge)
- **Exit directives** vote against entry (overbought, regime shift, time stop)
- **Risk directives** multiplicatively gate the result — a 90% technical score × 0.3 risk gate = 27% effective
- **High-priority directives** can suppress lower-priority ones via dominance rules
- **Cancellation pairs** (e.g., oversold vs overbought) use 2:1 weighted voting

The output is a single composite number per symbol: **the SEES score**. It represents the engine's conviction that this symbol, right now, at this price, with this data, is worth your attention.
