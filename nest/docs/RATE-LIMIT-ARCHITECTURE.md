# Rate-Limit Architecture & Refresh Policy

**Date:** 2026-06-22
**Status:** Active — governs all provider API usage
**Applies to:** All adapters, middleware, React pages, and scheduled jobs

---

## Core Principle

> **Trading actions ALWAYS take priority over data display.**

A rate limit exhausted by portfolio refreshing is a rate limit that cannot execute a trade. The system must reserve capacity for orders, position verification, and account queries — the data display gets whatever capacity is left after trading needs are met.

---

## Rate-Limit Budget Allocation

Every provider API has a finite number of requests per time window. This budget is split into tiers:

```
┌──────────────────────────────────────────────────┐
│              RATE LIMIT BUDGET                     │
│  (e.g., Trading212: ~12 req/min across endpoints) │
├──────────────────────────────────────────────────┤
│                                                    │
│  ████████████ Tier 1: TRADING (60%)               │
│  ████████████ - Place/cancel orders                │
│  ████████████ - Account verification               │
│  ████████████ - Position verification              │
│  ████████████ - Order status polling               │
│                                                    │
│  ██████ Tier 2: USER-INITIATED (30%)               │
│  ██████ - Manual Refresh button clicks              │
│  ██████ - Sell/Buy flow pre-trade checks            │
│  ██████ - Portfolio import (user-triggered)         │
│                                                    │
│  ██ Tier 3: BACKGROUND (10%)                       │
│  ██ - Scheduled portfolio sync (every 30min)       │
│  ██ - Data freshness card (every 2min)             │
│  ██ - Health checks                                │
│                                                    │
│  ❌ NEVER: Page auto-refresh on interval           │
│  ❌ NEVER: Refetch on window focus                  │
│  ❌ NEVER: Background polling for display data      │
└──────────────────────────────────────────────────┘
```

**Tier 1 requests always bypass rate-limit throttling.** If the rate limit is exhausted, Tier 1 requests are queued and executed as soon as capacity is available. Tier 2 and Tier 3 requests are rejected until capacity recovers.

---

## Refresh Policies Per Source

| Source | Policy | Auto-refresh | Max frequency | Rationale |
|--------|--------|-------------|---------------|-----------|
| **Trading212** | `manual-only` | ❌ Never | User-controlled | 1 req/2-5s per endpoint, shared with live trading |
| **Finnhub** | `manual-only` | ❌ Never | User-controlled | 60/min free tier |
| **Alpha Vantage** | `manual-only` | ❌ Never | User-controlled | 25/day free tier |
| **Polygon.io** | `manual-only` | ❌ Never | User-controlled | 5/min free tier |
| **MT5 Bridge** | `auto` | ✅ Allowed | Every 1s | Local, no rate limit |
| **Database queries** | `auto` | ✅ Allowed | Every 5s | Local MySQL |
| **Scoring pipeline** | `auto-on-data` | ✅ On new data only | Triggered by data import | Computed locally |

---

## How It Works

### Layer 1: Adapter (outbound throttling)

The `RateLimitTracker` in each adapter enforces per-endpoint minimum intervals. Before making any API call, the adapter waits if needed:

```
adapter.placeMarketOrder()
  → waitForRateLimit('orders/market')  // ensures 5.5s since last order call
  → fetch(API)
  → recordResponse(status, headers)
```

### Layer 2: Middleware (inbound throttling)

The `RateLimiterMiddleware` prevents the frontend from calling the NestJS API too rapidly. It matches route patterns to provider rate limits:

```
Browser → GET /api/portfolio
  → RateLimiterMiddleware checks: has /api/portfolio been called in last 5.5s?
  → If yes → HTTP 429 "slow down"
  → If no → pass through to controller
```

### Layer 3: Frontend (refresh discipline)

React pages MUST NOT auto-refetch data from rate-limited sources. Instead:

1. **Show "last updated" timestamp** prominently at the top of every data-dependent view
2. **Provide a Refresh button** that the user controls
3. **Auto-refresh ONLY for local sources** (MT5, database queries)
4. **Trigger refreshes on relevant actions** (after placing an order, after importing data)

---

## "Last Updated" Display Standard

Every data-dependent page must show:

```
┌─ Portfolio ──────────────────── Updated 2m ago ─ [↻ Refresh] ─┐
│  Source: Trading212 Demo    ● Connected                       │
│  Next allowed refresh: any time (manual)                      │
└───────────────────────────────────────────────────────────────┘
```

For auto-refresh sources (MT5):

```
┌─ MT5 Trading ──────────── ● Live ──── Updated 3s ago ────────┐
│  Source: MT5 Bridge    Auto-refreshing every 2s               │
└───────────────────────────────────────────────────────────────┘
```

The Refresh button:
- Is always visible
- Shows a brief spinner while fetching
- Is disabled during an active fetch
- Shows "Refresh in Xs" countdown if rate-limited
- Never triggers more than one concurrent fetch

---

## Implementation Checklist

- [x] `provider-rate-limits.ts` — shared rate config for all providers
- [x] `RateLimiterMiddleware` — inbound throttling on provider routes
- [x] `Trading212Adapter.waitForRateLimit()` — outbound per-endpoint throttling
- [ ] `RateLimitTracker` integrated into all adapters (MT5, Alpaca, Finnhub, etc.)
- [ ] Frontend: remove all `refetchInterval` on rate-limited sources
- [ ] Frontend: add "last updated" + Refresh button to all data pages
- [ ] Frontend: DataFreshnessCard respects per-source refresh policy
- [ ] Backend: Tier 1 priority bypass in rate limiter (trading endpoints skip queue)
- [ ] Backend: expose refresh policy in `/api/data/freshness` response
- [ ] Scheduled jobs: move to Tier 3 frequencies (portfolio sync every 30min, not 2min)

---

## Related Documents

- `provider-rate-limits.ts` — per-provider endpoint limits
- `rate-limiter.middleware.ts` — inbound HTTP throttling
- `rate-limit-tracker.ts` — outbound circuit breaker
- `trading212.adapter.ts` — Trading212 adapter implementation
- `DataFreshnessCard.jsx` — sidebar freshness display
