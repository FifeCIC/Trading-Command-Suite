---
description: "Load day-of-week market context — session timing, upcoming events, swap risk, gap exposure, and market hours. Use when: starting any trading session, making Friday afternoon decisions, checking weekend readiness, or any time you need to know what the day means for trading."
argument-hint: "What are you trying to decide? (hold-through-close, pre-market-check, weekend-prep, monday-gap, midweek-swap)"
---

# 7-Day Market Awareness

Know what today means for trading. Every day has different risks and opportunities. This prompt gives the trading agent the context it needs to make swift decisions without re-discovering the wheel.

## Step 1: Determine the Day Context

| Day | Key Concern | What to Check |
|-----|------------|---------------|
| **Monday** | Weekend gap fill, session open | Gap magnitude from Fri close, gap-fill probability, events this week |
| **Tuesday** | Normal trading, midweek setup | Position sizing, upcoming Wed/Thu events |
| **Wednesday** | Triple swap tonight (forex) | All forex positions — swap cost 3× tonight |
| **Thursday** | Rollover complete, Friday prep | Positions to close or hold through Friday |
| **Friday AM** | Last full session | What to close before weekend, position sizing |
| **Friday PM** | Weekend defense — CRITICAL | Full EOW checklist (see below) |
| **Saturday** | Markets closed, crypto active | Crypto weekend volatility patterns |
| **Sunday** | Pre-open prep, gap projections | Events Mon AM, gap risk for held positions |

## Step 2: Load Day-Specific Data (parallel)

### Always Load (every day)
```bash
# Provider health
curl -s http://localhost:3201/api/providers/health

# MT5 account and positions
curl -s http://localhost:3201/api/providers/mt5/accounts

# Portfolio summary
curl -s http://localhost:3201/api/portfolio/summary
```

### Monday
```bash
# Weekend gap detection — check Fri close vs current for all positions
# (Requires: Weekend Gap Risk Service — issue #34)
```

### Wednesday
```bash
# Triple-swap flag — check all open forex positions
# Long positions held Wed→Thu pay 3× swap_long
# Short positions held Wed→Thu pay 3× swap_short
# (Requires: Swap Cost Calculator — issue #33)
# Manual check: MT5 symbol info for swapLong/swapShort
curl -s "http://localhost:5000/symbol/USDCAD/info" | grep swap
```

### Friday PM (Weekend Defense Checklist)
```bash
# 1. All open positions across all providers
curl -s http://localhost:5000/positions
curl -s http://localhost:3201/api/portfolio/summary

# 2. Events between now and Monday open
# (Requires: Live Economic Calendar — issue #3 in prior roadmap)
# Manual: check ForexFactory or MT5 calendar
curl -s "http://localhost:5000/calendar"

# 3. Market hours — when does each market close?
# (Requires: Market Calendar Service — issue #39)
# Manual: NYSE closes 16:00 ET, Forex closes 17:00 ET (Fri)

# 4. Weekend swap projection
# (Requires: Swap Cost Calculator — issue #33)

# 5. Weekend gap risk
# (Requires: Weekend Gap Risk Service — issue #34)
```

## Step 3: Decision Framework

### Quick Decision Rules

**Hold through weekend IF:**
- Position is profitable AND swap cost < 20% of daily profit
- No earnings/events for that symbol before Monday open
- Gap risk (historical max) < 2% of position value
- Position has a stop-loss set

**Close before weekend IF:**
- Swap cost > 50% of current profit (swap is eating the trade)
- High-impact event for that symbol before Monday open
- Position is a loss and gap risk could make it worse
- No stop-loss set

**Reduce before weekend IF:**
- Swap cost is 20-50% of profit
- Moderate gap risk
- Want to keep some exposure but reduce weekend carry

### Wednesday Triple-Swap Rules
- Close any short-term forex positions that are near break-even
- For positions you intend to hold long-term: triple swap is acceptable cost
- Never open a new forex position late Wednesday unless it is a swing trade that accounts for the swap

### Monday Gap-Fill Rules
- If Friday closed strong and Monday gaps down: high probability of gap fill (buy signal)
- If Friday closed weak and Monday gaps up: high probability of gap fill (sell signal)
- Gap > 1%: wait for confirmation before entering
- Gap < 0.3%: likely noise, trade normal signals

## Step 4: Escalation Triggers

Escalate to user immediately if:
- Friday after 15:00 ET and positions are still open without weekend defense review
- Wednesday 16:00 ET and unassessed forex positions with high swap rates
- Any provider is degraded when a decision needs to be made
- Weekend gap risk exceeds 5% of account equity
- Market holiday tomorrow that the app is not aware of

## Related Prompts
- `trading-session-init.prompt.md` — daily session loading (complementary)
- `wire-alpha-vantage-earnings.prompt.md` — earnings calendar integration
- `add-analyst-forecast-sources.prompt.md` — economic events
- `protocol-risk-gating.prompt.md` — position risk gating

## Related Issues
- #24 — Fix MT5 Bridge (required for all data)
- #26 — Chart & EA Awareness
- #33 — Swap Cost Calculator (triple swap, weekend swap)
- #34 — Weekend Gap Risk Service
- #35 — Weekend Defense Workflow
- #38 — Real Alert Triggers
- #39 — Market Calendar Service (holidays, DST, early close)
