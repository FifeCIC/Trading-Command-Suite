## Pre-close checklist — #1090 (ranked payload reported `maxPossibleScore: 100` for every row)

**The theme, applied:** the score display had **one denominator story** and it was fabricated. Every surface now either shows the API's OWN percentage (`normalizedScore`) or shows nothing — nothing divides by a made-up 100.

### Root cause (confirmed against code + live payloads, 2026-10-10)

`scoring.service.ts` `rankFromDb()` (the default DB-read path of `/api/scoring/ranked`) emitted a **flat `maxPossibleScore: 100`** in the strategy header and on every row. `rankAll()` (the `?fresh=true` path) had a real per-protocol figure — the DB-read path never did. Four consumers then did arithmetic with it, and one doc claimed a 0–100 clamp.

### The measured contract (why `100` could not simply be replaced by a capacity)

Measured against the live DB and bridge, not inferred:

| Fact | Measurement |
|---|---|
| `signalPct` = signalRaw ÷ **directional** capacity | xau-speed-v1: 10 ÷ 910 = **1.0989%** (stored value matches to 4 dp) |
| `composite` is NOT signalRaw | BTC btc-scalp-v1: composite **30**, but its signalPct 3.21951% implies signalRaw **33** over capacity **1025** (btc-speed-v1: signalRaw 31 / 1295) |
| Directional capacity ≠ total capacity | xau-speed-v1: directional **910**, total **1010** (risk-gate group = 100) |
| The number the SYSTEM compares to `ENTRY_THRESHOLD` | `normalizedScore` — `protocol-gating.service.ts` sets `compositePct: signalPct`; that is the classifier's percentage |

**Consequence:** no denominator on that payload pairs with `score` — so the fix is a **null**, not a substitute number. A capacity there would have disagreed with the row's own `normalizedScore` (BTC: 30/1025 = 2.93% vs the row's 3.22%), i.e. a second wrong percentage replacing the first.

### Acceptance — evidence per item (the issue asked for a measured fix, not a guessed one)

- [x] **`maxPossibleScore: 100` removed** — `rankFromDb()` now emits `null` in the header and both row branches (snapshot branch and the older `score`-table fallback). Pinned by `scoring.ranked-denominator.spec.ts` (4/4): null denominator, percentage passthrough, per-row distinctness, and the missing-`signalPct` boundary (0, still null — a missing datum does not become a fabricated base).
- [x] **Guard canaried BOTH directions** — re-introducing `100` (all 3 sites) → **4 failures**; zeroing the percentage passthrough → **2 failures**; restore hash-verified (`1B32C4…`). Log: `logs/canary-1090.ps1`.
- [x] **Every display consumer fixed** — `MetaStackStatusPage` (headline label fixed earlier on 10-08; the **Max** column now shows the row's real % as **Norm %**, coloured by the same percentage, not raw-vs-60/30 bands; the readiness checklist now compares **% vs `entryThreshold`** — it previously printed “score 106/6”), `MarketTape` (derives nothing; uses `normalizedScore`), `AnalyseSymbolPage` (“106 / 100 max” → “106 · 11.6% of capacity”), `MetaStackExplorerPage` (the “clamped 0–100” description corrected to the measured contract).
- [x] **Verified live on the deployed build** — `/api/scoring/ranked?limit=2` (0.125.0, 2026-10-09 23:40Z): header and row both `"maxPossibleScore":null`; row `{"score":37,"normalizedScore":3.902439,"maxPossibleScore":null}`.
- [x] **The doc contradiction resolved, by measurement** — the clamp does not exist on this path (composite 106 observed); the description now states the additive-raw-sum reality and points at `ScoringMechanicsPanel` for the live numbers.
- [x] **Gates run** — typecheck ✅ · jest (spec 4/4 + full suite in build) ✅ · notices ✅ · bot-rules ✅ · db:check ✅ · build succeeded ✅ · live payload observed ✅.

## Deliberately unchanged

- **`rankAll()` (`?fresh=true`) keeps its real per-protocol `maxPossibleScore`** — it has one protocol in scope, so the figure is honest there. Only the multi-protocol DB-read path goes null.
- **No new denominator invented for `composite`** — none exists on the payload; the four-way comparison above is the reason.
