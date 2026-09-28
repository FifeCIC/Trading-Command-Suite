## Fixed — and my original diagnosis named the wrong site

**Correction first.** This issue body said the cause was `resolveCadence()`. It was
**one of two** causes, and *not the one producing the observed symptom*. Fixing
`resolveCadence` alone changed nothing measurable — the ticks kept reporting
`have 20`. That was verified, not assumed, and it is why the fix took three rebuilds
instead of one.

### Cause 1 — the fall-through (real, but latent)

`required[tf] ?? required['1d'] ?? N` was open-coded in **four** places
(`resolveCadence`, `signal-envelope`, the batch handler, the readiness gate). `??`
is a fall-through; the documented intent is a **maximum**. 74 of 108 directives
declare their requirement under the generic `'1d'` key, so ONE directive declaring
a base cadence suppressed every larger generic requirement.

Now: `ProtocolDbService.getBaseBarCount()` — one home for the rule.

### Cause 2 — the literal (the actual symptom)

Two hardcoded numbers, exactly what `resolveCadence`'s docstring already warned against:

| Site | Was | Now |
|---|---|---|
| `signal-envelope.service.ts:431` | `requiredBars[baseTimeframe] \|\| 200` → **20** (truthy!) | `getBaseBarCount()` |
| `speed-scan.service.ts:188` | `bars = 20` default parameter | derived per protocol |
| `speed-scan.service.ts:224-226` | literal `30` × three timeframes | `loadHigherTfBundle()` |

The `|| 200` is the one that produced `have 20` on every tick — `20` is truthy, so
the fallback could never fire.

## Verification (observed, not asserted)

| | before | after |
|---|---|---|
| Starved ticks | 246 / 247 (**99.6%**) | **0** |
| `Opportunity` score | 427 | **490** (+63) |

The four unblocked directives land in **Opportunity**, not Signal — because
`bollinger-band-squeeze`, `volume-confirmation` and `session-open-effect` are
direction-**neutral** by design (fixed to always emit `neutral` in the 2026-08 audit).
That is correct, not a residual fault. **Signal stayed at 59**, which is the separate
finding below.

`136/136` suites · `1184` tests pass · `tsc` clean · `0.93.0 → 0.94.0`.

## Blast radius, measured before the change

`logs/probe-bar-window.cjs` → **2 of 48** protocols change
(`btc-speed-v1` 20→365, `mtf-conservative-v1` 30→200). The other 46 **cannot** change
by construction: when `base >= 1d` the max equals today's value, and when `base` is
absent the max equals `1d`.

## Not done — deliberately

- `loadHigherTfBundle()`'s 1d/1h/15m arrays still read the raw map. They are genuinely
  per-cadence, and folding the generic key into them would be the overloading bug,
  not the fix.
- **`btc-halving-cycle` over-declares `{'1d': 365}` while reading one bar**
  (`input.bars[last].timestamp`). It is why the window is 365 rather than the 72
  `bollinger-band-squeeze` actually needs. Changing a declaration changes the window,
  so it is a separate change with its own blast radius.
- **`required['1d']` is still overloaded** — for the 74 it means "bars of my cadence";
  for `btc-halving-cycle` it means 365 literal daily bars. One key, two units.
- **The Signal is still one directive.** `btc-halving-cycle` (a 4-year macro cycle)
  supplies all 59. This issue unblocked capacity; it did not give the protocol a
  directional voice. That is the directive-*choice* finding, tracked separately.
