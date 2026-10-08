# #1085 — a frozen quote sized silently — CLOSE (2026-10-08)

## Pre-close checklist — evidence per acceptance point

**1. The bridge carries the broker's own last-tick time, distinct from the response time** — ✅

```json
GET :5001/quote?symbol=VIX
{"symbol":"VIX","bid":16.89,"ask":17.06,"last":16.89,
 "timestamp":"2026-10-08T13:42:44.779952Z",   ← response time (machine clock), unchanged
 "tickTime":"2026-10-08T13:42:01Z"}            ← the BROKER's last tick — 44s older
```

`tickTime` goes through the bridge's existing rule (`utc_iso()` — MT5 epochs are server-time and are
offset-corrected; the returned age of seconds confirms the correction is exact on both brokers).
Feature flag `quoteTickTime: true` on `/broker`. Nothing that reads `timestamp` breaks (additive).

**2. The sizing path refuses a quote older than the allowance — distinctly** — ✅

`checkQuoteFreshness()` refuses `stale` (age named + allowance named), `no-quote`, `no-tick-time`
(undefined = old bridge; null = terminal has no tick — both NAMED, not collapsed), and `future`
(tick time far ahead = the offset conversion is suspect — the #625/#845 class). Run against the
**real live payload** with the **compiled** function (`node logs/quote-check-demo.cjs`):

```
allowance 300 (default) : {"ok":true,"kind":"fresh","ageSeconds":44}
allowance 1   (probe)   : {"ok":false,"kind":"stale","reason":"VIX: last broker tick … is 44s old — over the 1s allowance"}
allowance 0   (disabled): {"ok":true,"kind":"disabled"}
frozen (2h old)         : {"ok":false,"kind":"stale","reason":"… is 7200s old — over the 300s allowance"}
```

⚠️ **The frozen case is the one that used to size silently** — it now refuses. And the WIRING is
live: at the 1s probe the dispatch path kept admitting **sub-second FX ticks with no false
refusals** (GBPUSD during the London/NY overlap), i.e. the check executes on the real path and
passes fresh quotes. Gate outcomes for those candidates were unchanged (the usual portfolio-cap
reason).

**3. The threshold is a DECLARED allowance** — ✅ `trading.maxQuoteAgeSeconds` (default 300, 0
disables, bounds 0–86400) in `settings-registry.ts`, carrying the server-offset interaction warning:
the rounded offset correction can over-state age by ~7.5 min in its worst case — check the bridge
probe logs BEFORE raising the allowance. Canary, both directions: disabling the comparison fails 2
of the 8 spec tests; restore → 8/8. Spec is **in the prebuild jest list**.

## Gates

- **Structural** — `npm run typecheck` clean; `build:api` full prebuild + build green; bridges
  restarted (tcs-launch) so the Python contract is live.
- **Contract** — prebuild validators green; `validate-decisions.cjs` — 71 rows, all with guard status.
- **State** — the probe setting row was created for the live test and **deleted** (absent = declared
  default). `db:check` clean (earlier this session).
- **Behaviour** — evidence above; live VIX payload + compiled check + dispatch-path pass-through.

## Deferred / Deliberately unchanged

- **Deferred — the call site is not build-gated** (register row 71 🟡): the spec gates the CHECK;
  un-wiring it from the sizing path would not fail the build. Wiring guards belong with #796.
- **Deliberately unchanged — conversion-pair quotes** (`quotes` in the margin estimate): a stale FX
  conversion rate changes the margin by a tiny fraction, unlike the traded symbol's own price. Not
  covered, stated.
- **Deliberately unchanged — other quote consumers** (scoring gate, tick recorder, portfolio
  pricing): they do not SIZE orders; the issue's scope was the sizing path.
