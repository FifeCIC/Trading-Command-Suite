# 7-Day Market Awareness Guide

**Type:** Operational Playbook  
**Last Updated:** 2026-07-01

## Overview

Every trading day carries different risks and opportunities. This guide documents what the Trading Command Suite knows about day-of-week context, what's automated, and what requires manual attention.

---

## Day-by-Day Context

| Day | Key Concern | Automation Status |
|-----|------------|-------------------|
| **Monday** | Weekend gap fill, session open | ⚠ Manual — gap detection not yet automated |
| **Tuesday** | Normal trading, midweek setup | ✅ Automated — scoring pipeline runs normally |
| **Wednesday** | Triple swap tonight (forex) | ⚠ Manual — swap calculator not yet built |
| **Thursday** | Rollover complete, Friday prep | ✅ Automated — scoring pipeline runs normally |
| **Friday AM** | Last full session | ✅ Automated — scoring pipeline runs normally |
| **Friday PM** | Weekend defense — CRITICAL | ⚠ Manual — full EOW checklist below |
| **Saturday** | Markets closed, crypto active | ℹ Crypto weekend volatility — no automation |
| **Sunday** | Pre-open prep, gap projections | ⚠ Manual — gap risk not yet automated |

---

## Automated Checks (Live Endpoints)

These are always available via the NestJS API:

```
# Provider health
GET /api/providers/health

# Portfolio summary
GET /api/portfolio/summary

# MT5 positions (requires MT5 bridge on :5000)
GET http://localhost:5000/positions
GET http://localhost:5000/accounts
```

The automation loop (`POST /api/automation/start`) handles:
- Scoring all tracked symbols every 5 minutes
- Strategy discovery and evaluation
- Decision logging to the Automation Dashboard

---

## Weekend Defense Checklist (Manual)

Run these checks Friday afternoon:

1. **All open positions** — `GET /api/portfolio/summary` + `GET http://localhost:5000/positions`
2. **Upcoming events** — Check the Timeline panel on the Automation Dashboard
3. **Market hours** — NYSE closes 16:00 ET, Forex closes 17:00 ET (Fri)
4. **Stop-loss audit** — Verify all held positions have stop-losses set

### Weekend Decision Rules

**Hold through weekend IF:**
- Position is profitable AND estimated swap cost < 20% of daily profit
- No earnings/events for that symbol before Monday open
- Estimated gap risk (historical max) < 2% of position value
- Position has a stop-loss set

**Close before weekend IF:**
- Estimated swap cost > 50% of current profit (swap is eating the trade)
- High-impact event for that symbol before Monday open
- Position is a loss and gap risk could make it worse
- No stop-loss set

---

## Missing Automation (Not Yet Built)

These services are planned but not yet implemented:

| Service | Purpose | Reference |
|---------|---------|-----------|
| Weekend Gap Risk Service | Detect Friday→Monday gap exposure | Issue #34 |
| Swap Cost Calculator | Forex triple-swap cost projection | Issue #33 |
| Market Calendar Service | Market open/close hours by exchange | Issue #39 |
| Live Economic Calendar | Events between now and Monday open | Issue #3 |

---

## Related Endpoints

- `GET /api/providers/health` — all provider statuses
- `GET /api/portfolio/summary` — portfolio overview
- `GET /api/providers/mt5/accounts` — MT5 account details
- `GET /api/automation/status` — loop state and recent decisions
- `GET /api/automation/timeline?lookahead=240` — upcoming events
