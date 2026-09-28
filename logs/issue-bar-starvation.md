# `btc-speed-v1`: 4 of 13 directives starved to 0 on 99.6% of ticks

Found 2026-09-27 during a "why is Pepperstone not trading?" investigation. The
protocol was processing ~316 scores/day while four of its directives could never
contribute a single point to any of them.

## Symptom (measured)

`btc-speed-v1` over 24h, from `tradingcs.score.breakdown`:

| Directive | Declares | Window it got | Starved |
|---|---|---|---|
| `bollinger-band-squeeze` | 72 bars | 20 | 246 / 247 ticks (100%) |
| `support-resistance-levels` | 35 bars | 20 | 246 / 247 (100%) |
| `session-open-effect` | 30 bars | 20 | 246 / 247 (100%) |
| `volume-confirmation` | 21 bars | 20 | 246 / 247 (100%) |

Each returns `0` with the reason `Insufficient data: need N bars, have 20`. Nothing
throws, no log line appears, and a `0` folds silently into an additive composite —
the repo's signature defect (*plausible number, no error*).

**The data was never the problem.** `marketbar` holds **3,504 fresh 5m bars for BTC**
(binance, current to the minute) while this was happening.

## Root cause — isolated

`nest/src/modules/automation/protocol-runner.service.ts` → `resolveCadence()`:

```ts
const required = this.protocolDb.getRequiredBars(protocolId);
const barCount = required[timeframe] ?? required['1d'] ?? 100;
```

`??` is a **fall-through**, but the function's own docstring means a **maximum**:

> ⚠️ Bar COUNT comes from `getRequiredBars()`, not a literal. Directives declare their
> own `minBars` per timeframe; a fixed 60 starves long-window directives (e.g. a
> 200-bar daily regime filter would silently evaluate on 60 bars and still return a
> plausible number — INV-BAR-WINDOW's failure mode).

The docstring describes **this exact failure** while the operator reintroduces it.

The chain, verified end to end:

```
protocol.recommendedTimeframe = '15m–1d'
  → selectBaseTimeframe('15m–1d') = '15m'      (finest cadence mentioned wins — by design, pinned by timeframe.spec.ts)
  → getRequiredBars('btc-speed-v1') = { '15m': 20, '1h': 20, '1d': 365, ... }
       '15m': 20  ← multi-timeframe-trend declares { '1d': 20, '1h': 20, '15m': 20 }
       '1d' : 365 ← btc-halving-cycle declares { '1d': 365 }
  → barCount = required['15m'] ?? required['1d'] ?? 100 = 20
  → getBars(symbolId, '15m', 20) → base array of 20 bars
  → bollinger-band-squeeze: closes.length(20) < MIN_BARS(72) → 0
```

**The collision:** `74 of 108` directives in `implementations/` read `input.bars` but
declare their real requirement under the **generic key `'1d'`**. Only 3 declare a
base-cadence key. So `required['1d']` is the de-facto requirement, and it is only
consulted when `required[timeframe]` is **absent** — which it is not, because one
directive declared `'15m'`.

A second, compounding problem: `required['1d']` is **overloaded**. For the 74 it means
"bars of whatever cadence I read"; for `btc-halving-cycle` it means 365 *literal daily*
bars. One key, two units.

## Blast radius — currently one protocol

The mechanism is systemic (74/108), but the *manifestation* needs both a base-cadence
declaration and a larger competing requirement. A live sweep of **1,057 breakdowns /
201 protocol-directive pairs over 24h** found **4 chronic, all in `btc-speed-v1`**.

## Why this was NOT fixed in place

Restoring the window changes **what a scored symbol scores**, which is the maths rule's
territory (`maths-change-requires-ab.instructions.md`) — a copied configuration and a
monitored comparison, not an in-place edit. `btc-speed-v1`'s only bot
(`BTC Investment Monitor`) is `mode: manual`, so nothing trades on this today; the
urgency is that a repair must not be made blind.

## Guard shipped

`nest/scripts/directive-guard.cjs` **MODE 8** (`--db`) — reads the starvation reason the
*directive* recorded, so it is **cause-agnostic**: it would still fire if the cause were a
wrong cadence, a mis-declared `minBars`, or a truncated fetch. It reimplements neither
`getRequiredBars()` nor `selectBaseTimeframe()`.

- `--self-test` — 7 cases, both directions (chronic fires; transient gap, sub-sample, and
  healthy do **not**; boundary at exactly the ratio floor fires; ordering worst-first).
- Canaried: guard made blind → self-test exit 1; made over-fire → exit 1; restore verified
  byte-for-byte by SHA256.
- Live: 4 chronic, no false positives — narrow, which is what stops it being allowlisted.

## Recommended fix (needs owner decision)

1. `resolveCadence()`: the base window should be the **maximum** of the declared
   requirement for the base cadence **and** the generic `'1d'` declaration, not a
   fall-through. Cheapest correct change, one line, restores the window the docstring
   intends.
2. Follow-up, separate: 74 directives declare `minBars` on a cadence they do not read.
   That is a declaration defect, not a sizing defect, and fixing it properly means the
   generic `'1d'` key stops being overloaded.

## Not done

- `resolveCadence()` unchanged (maths rule).
- No A/B copy created.
- The overloaded `'1d'` key not split.
