---
date: 2026-09-10
area: trading
type: bugfix
---

## What Changed

Closed **#744 — "Provider rate limiting is a no-op"**. `AdapterFactory.getActive()` reported
`Infinity remaining` for every provider, so the documented `<5 remaining` skip and provider
failover could never trigger and the metered keys had no back-off.

- **Root cause:** `getActive()` resolved `remaining` from the factory's own
  `RateLimitTracker`s and fell back to `Infinity` — but `setRateLimiter()` has **zero call
  sites**, so no tracker was ever registered. Meanwhile `RateLimitGovernor` already held a real
  per-provider limit table (finnhub 60/min, twelvedata 8/min, polygon 5/min …) and is fed live by
  `finnhub.adapter` (`governor.recordCall` after every response).
- **Fix:** the factory now takes an optional `RateLimitGovernor` and resolves remaining from
  tracker → governor → a **finite** default (50). The `<5` skip is implemented, a governor
  `canCall()` veto is honoured (429, 401/403 key expiry, 3-consecutive-error breaker), and when
  every provider is throttled it returns the least-exhausted one with a warning instead of
  falling through to "create anything from the registry" (the path that ignored limits).
- `onModuleInit()` now warns loudly if the governor is not injected — an optional dependency
  going missing is exactly how this bug hid for so long.
- Selection logs the chosen provider **and** its remaining count even for a single candidate.

## Files Changed

- nest/src/modules/providers/adapter-factory.ts — governor-backed remaining, `<5` skip, no-bypass fallback, `onModuleInit` guard, selection log always states the budget
- nest/src/modules/providers/adapter-factory.rate-limit.spec.ts — NEW (7 cases, drives the real governor)
- .github/AGENT-ATTENTION.md — (read only, no blockers relevant)

Extracted to **#749**: record usage in every adapter (fmp/yahoo self-pace; twelvedata/polygon
have no throttle at all) and retire the never-wired `RateLimitTracker` path plus the
permanently-empty `adapters: []` in `/api/providers/rate-limits`.

## Why (theory)

Rate limiting fails in two ways: **not enforcing** a limit, and **enforcing it in a place nobody
reads**. This was the second — three mechanisms existed (governor with correct config + live
usage, a tracker path with no registration, an adapter-local counter that only warned), and the
one consumer (`getActive`) consulted the only one that was empty. The fix is not "add a limiter"
but "declare which mechanism is authoritative and make the consumer read that one".

A related trap: an unknown limit must resolve **finite**. `Infinity` wins every "highest
remaining" comparison, so a provider we know nothing about silently outranks a provider we
carefully metered. Unknown → conservative finite sentinel, and metered providers are *skipped*
rather than merely out-ranked.

Also: an optional injection that fails silently converts a working mechanism into a no-op. The
`onModuleInit` warning is the cheap insurance.

## Capability Map Entry

- **name:** Rate-limit aware provider selection (governor-backed)
- **persistence:** in-memory governor usage map (per process)
- **uiSurfaces:** `/api/providers/governor`, `/api/providers/rate-limits`, Provider health report `activeProvider`
- **pipeline:** providers / market data
- **completion:** complete (follow-up #749 covers per-adapter recording)

## QA Test Entry

- **area:** Providers / Rate limits
- **name:** Factory respects live limits and fails over
- **procedure:** `npm --prefix nest test -- --testPathPatterns=adapter-factory`, then `curl -s http://localhost:3201/api/providers/governor`
- **expected:** 7 tests pass; governor shows a finite `remainingEstimate` per provider (finnhub e.g. 53 of 60) and `GET /api/providers/rate-limits` returns an `activeAdapter`

## Architecture Framework Entry

- **section:** providers
- **summary:** `RateLimitGovernor` is the single authoritative rate-limit source; `AdapterFactory.getActive()` resolves remaining from it (never `Infinity`), skips providers below 5 remaining or vetoed by the governor, and refuses to bypass limits when all are throttled. Adapters without usage recording are tracked in #749.
