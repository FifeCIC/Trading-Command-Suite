---
date: 2026-08-16
area: scoring
type: refactor
---

## What Changed

Resolved duplicate directive definitions (issue #641). Enumerated every directive `id` defined by more than one class and removed the dead copy, so each id is now defined by exactly one class — the one the module actually registers. Also added a MODE 6 check to the directive guard so future duplicate-id registrations fail the audit.

The enumeration found **42 duplicate ids** (more than the 3 named in the issue):

- **28** dead classes in `placeholder-directives.stub.ts` whose `id` was also defined by a registered standalone `*.directive.ts` (e.g. `stochastic`, `cci`, `mfi`, `adx`, `rsi-overbought`, `momentum-continuation-combo`, `ma-crossover`, `bollinger-band-squeeze`, `obv`, `volume-surge`, `volume-rhythm`, `doji-pattern`, `hammer-pattern`, `engulfing-pattern`, `three-soldiers-pattern`, `cad-usd-oil-correlation`, `monday-effect`, `crypto-fear-greed`, `btc-halving-cycle`, `crypto-weekend-effect`, `earnings-proximity`, `confluence-reversal-combo`, `price-action`, `support-resistance-levels`, `overhead-supply-pressure`, `panic-exhaustion-absorption`, `bollinger-bands`, `vwap`).
- **14** dead standalone files whose `id` was also defined by a registered class: `analyst-adjustments.directive.ts` (registered copy lives in the stub — the mock-first standalone was dead) plus 13 MT5 duplicates (`williams-r`, `awesome-oscillator`, `force-index`, `chaikin-mf`, `donchian-breakout`, `keltner-channel`, `supertrend`, `parabolic-sar`, `atr-trailing-stop`, `momentum-roc`, `demarker`, `accumulation-dist`, `ease-of-movement`) whose registered copy lives in `mt5-indicators.directives.ts`.

## Files Changed

- nest/scripts/directive-guard.cjs — added MODE 6: duplicate `id` detection (ERROR severity, fails the audit on any duplicate).
- nest/src/modules/directives/implementations/placeholder-directives.stub.ts — removed 28 dead duplicate classes; trimmed now-unused indicator imports (`stochastic`, `cci`, `mfi`, `adx`, `obv`).
- Deleted 14 dead standalone directive files (listed above).
- nest/scripts/dedupe-directives.cjs — one-off mechanical cleanup script (kept as audit trail).

## Result

No duplicate directive ids remain. `tsc` build passes; `directive-guard.cjs --static-only` reports **0 errors** (50 pre-existing MODE 4/5 warnings, unrelated). Runtime behaviour is unchanged — only dead code was removed.

## Capability Map Entry

- **name:** Directive duplicate-id elimination + guard
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** No duplicate directive ids
- **procedure:** Run `node nest/scripts/directive-guard.cjs --static-only`; confirm zero ERROR findings and no "duplicate directive id" messages. Confirm `npm --prefix nest run build` compiles.
- **expected:** 0 errors, build succeeds.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Directive registry is now duplicate-free: each directive id maps to exactly one class. The directive guard gained a MODE 6 check that fails on any duplicate id registration.
