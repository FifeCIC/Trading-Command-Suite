# SEES Strategy Architecture — Watchlist + Protocol Pairing

> Saved from architectural discussion on 2026-06-24.
> Content originally produced as a response to "what should a Watchlist + Protocol pair be called?"

> ⚠️ **Superseded (2026-09-03):** the conceptual model has moved on. A `TradingStrategy` row is now
> understood as a **Trading Bot** (an execution policy), not a "Watchlist + Protocol pairing".
> See the canonical model in `docs/trading-bot-model.md` (#674 / #624). This page is kept as the
> historical rationale for the earlier naming.

---

## The SEES Strategy

A **SEES Strategy** is the atomic unit of the Trading Command Suite. It pairs two things:

```
SEES Strategy  =  Watchlist  +  Protocol
                   (what)       (how)
```

| Component | What it defines | Example |
|-----------|----------------|---------|
| **Watchlist** | Which symbols to score | "Tech Earnings", "Forex Majors", "My ISA" |
| **Protocol** | Which directives, weights, and risk gates to apply | "momentum-short", "mean-reversion", "swing-long" |

## The Live Ordering Stack

When a SEES Strategy runs, it produces a **Live Ordering Stack** — every symbol in the watchlist, ranked by composite SEES score, updated in real time.

The stack is not a static report. It refreshes continuously as market data flows in from MT5, Yahoo, and other providers. Directives re-evaluate. Scores shift. The ordering surface updates.

## Why the Pairing Matters

Running every directive against every symbol produces noise — 4,000+ evaluations that blur into an unactionable soup. A SEES Strategy constrains the problem:

- **Fewer directives** — protocols use 15–25 directives, not all 87
- **Relevant symbols** — only the ones in your watchlist are scored
- **Purposeful weighting** — directives are grouped and weighted by role (Technical 40%, Sentiment 35%, Risk 25%)
- **Risk gating** — risk directives multiplicatively gate the final score

## The Default Strategy

One strategy can be starred as your **primary**. Once set, every part of the app that needs to answer "what should I score right now?" uses it:

| Area | Uses the primary strategy for |
|------|------------------------------|
| Live Ordering Stack | Default view on load |
| Speed Trading scanner | Best symbol selection |
| Backtest runner | Default symbol set and protocol |
| Portfolio monitor | Cross-reference holdings against strategy |

## Proposed Sidebar Architecture

```
Scoring
  ├─ Live Ordering Stack    ← NEW (primary working view, uses current pair)
  ├─ Strategies              ← NEW (create/manage Watchlist+Protocol pairs)
  ├─ Test Directives         ← replaces Scoring Overview (swipe through directives)
  ├─ Directives              ← stays as-is (registry)
  ├─ SEES Arena              ← stays as-is
  └─ ...
```

## Implementation Progress

- [x] SEES Strategy concept documentation + landing page
- [x] Live Ordering Stack page (Watchlist + Protocol selectors, ranked table)
- [ ] Strategies management page (create/manage pairs, star a default)
- [ ] "Test Directives" page (replaces Scoring Overview)
- [ ] Backend: strategy pair storage + default strategy API
- [ ] Score pipeline: run protocol against watchlist-specific symbols
