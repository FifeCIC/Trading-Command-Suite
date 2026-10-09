## Pre-close checklist — #735 (higher-timeframe bundle at every scoreWithGating call site)

**The requirement, verified against today's tree rather than the issue's 2026-09-08 list.**

### 1. The bundle at every call site — DONE (and enforced)

Full inventory of `scoreWithGating(` call sites (non-comment lines), re-scanned 2026-10-09 — **17 real call sites, every one passing the full `{ dayBars, hourBars, min15Bars }` bundle**. The issue's original 12-site list is fully resolved; several sites finished it after the issue was written.

The enforcement is **build-time and already canaried in practice**: `validate-pipeline-contracts.cjs` → scan `no-bundle-less-scoring` (INV-MTF-BUNDLE) parses each call's balanced argument list and FAILS on fewer than 4 arguments (exemptions require an explicit marker). It is why the sites were fixed — it was observed failing until they were.

### 2. Incomplete MTF series fails readiness — DONE, and NOW pinned

The envelope builder already carried the rule (`signal-envelope.service.ts`): when a protocol contains an MTF directive and the bundle is short (`1d < 2 || 1h < 10 || 15m < 10`) it sets `preTradeReady = false`, pushes a **named blocker** with the actual counts (`Incomplete timeframe bundle (1d=…, 1h=…, 15m=…)`), and codes it `INCOMPLETE_MTF`.

⚠️ **It was pinned by NOTHING** — a grep for `INCOMPLETE_MTF` across every spec returned zero. That was the remaining gap, and it is closed:

- The rule is extracted to a **pure exported function** `evaluateMtfReadiness()` (one home for the directive list, thresholds and code).
- `signal-envelope.mtf-readiness.spec.ts` — **7/7 green**, pinning: short 1h / short 1d / short 15m each flagged with counts; the **exact boundary (2/10/10) passes**; one-below fails (inclusive boundary asserted, not assumed); a non-MTF protocol is NOT gated (the rule must not over-fire); array and Set inputs both accepted.

### Gates

- Typecheck clean; the spec set ran inside the full build gate (181 suites / 1,703 tests, all passing at build time).
- No behaviour change to production paths: the extraction is mechanical (same thresholds, same strings, same code), verified by the spec.

### What I did NOT do

- I did not add a new readiness BLOCKER elsewhere: `preTradeReady=false` + `INCOMPLETE_MTF` is the readiness failure the issue asked for, and the envelope is where readiness is computed. The loop does not consume `preTradeReady` for dispatch in any case — that observation is recorded here rather than silently fixed, because changing dispatch is a different decision (#1082's territory).
