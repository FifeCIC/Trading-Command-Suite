## Fix implemented (2026-08-16)

Enumerated **all** duplicate directive ids (not just the 3 named) and removed every dead copy so each id is defined by exactly one class.

### Enumeration result — 42 duplicates

**28 dead classes in `placeholder-directives.stub.ts`** (registered copy lives in a standalone file): `stochastic`, `cci`, `mfi`, `adx`, `rsi-overbought`, `momentum-continuation-combo`, `ma-crossover`, `bollinger-band-squeeze`, `obv`, `volume-surge`, `volume-rhythm`, `doji-pattern`, `hammer-pattern`, `engulfing-pattern`, `three-soldiers-pattern`, `cad-usd-oil-correlation`, `monday-effect`, `crypto-fear-greed`, `btc-halving-cycle`, `crypto-weekend-effect`, `earnings-proximity`, `confluence-reversal-combo`, `price-action`, `support-resistance-levels`, `overhead-supply-pressure`, `panic-exhaustion-absorption`, `bollinger-bands`, `vwap`.

**14 dead standalone files** (registered copy lives elsewhere):
- `analyst-adjustments.directive.ts` — the mock-first standalone was dead; the registered `ready` price-momentum proxy lives in the stub. (This is the near-wrong-delete case — now resolved correctly: the real one stays.)
- 13 MT5 duplicates whose registered copy lives in `mt5-indicators.directives.ts`: `williams-r`, `awesome-oscillator`, `force-index`, `chaikin-mf`, `donchian-breakout`, `keltner-channel`, `supertrend`, `parabolic-sar`, `atr-trailing-stop`, `momentum-roc`, `demarker`, `accumulation-dist`, `ease-of-movement`.

### Guard (proposed work item 1)

Added **MODE 6** to `nest/scripts/directive-guard.cjs`: duplicate-id detection, **ERROR** severity — the audit now fails (exit 1) if any id is defined by two classes.

### Verification

- `npm --prefix nest run build` — passes.
- `node nest/scripts/directive-guard.cjs --static-only` — **0 errors** (50 pre-existing MODE 4/5 direction-bias warnings, unrelated).
- Mechanical re-enumeration: **no duplicate directive ids remain**.

Runtime behaviour is unchanged — only dead code was removed. The cleanup script is kept at `nest/scripts/dedupe-directives.cjs` as an audit trail.
