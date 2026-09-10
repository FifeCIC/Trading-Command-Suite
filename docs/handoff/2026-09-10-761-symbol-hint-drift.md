# #761 — Symbol-derivation hints drift from the symbol registry

**Date:** 2026-09-10
**Status:** Complete — guarded by `INV-SYMBOL-HINTS-RESOLVE`
**Follows:** #760 (provider routing + coverage guard)

---

## The failure, in one sentence

`SINGLE_SYMBOL_HINTS` maps a protocol-name fragment to a symbol ticker (`'china' → 'CHINA50'`).
It is a hardcoded table with **no runtime validation**, so when a ticker is renamed or retired
the hint keeps resolving — happily, with no error — to a symbol that no longer exists, and the
protocol stalls with no symptom beyond a score that never appears.

That is indistinguishable from a quiet market. It is the same class as every other invariant in
`meta-stack-contracts.instructions.md`: **an empty result looks exactly like a correct result
that happens to be empty.**

---

## How it was found

Investigating why `CHINA50` — an active index with a working feed — held 101 bars frozen on
2026-07-17 with zero assignments and zero bots.

The investigation first tried the MT5 bridge and read `CHINA50 not offered`. That reading was
**wrong, and the error was instructive**: the stack was actually down (3201/5000/5001 not
listening), so the connection was refused and the negative result was recorded as if it were a
fact about the symbol. Once the stack was restarted, the bridge happily served `CHINA50` candles
at every cadence.

> **Lessons:** a failed connection is not evidence of absence. Neither is a 404. The same
> mistake had already been made once this session with `/quote?symbol=VIX` (which 404s for
> symbols that fetch fine via `/candles`).

---

## The four defects

### 1. Four hints pointed at tickers that no longer exist

After the #760 consolidation, `SINGLE_SYMBOL_HINTS` still held:

| Hint | Pointed at | Actual state |
|---|---|---|
| `btc` | `BTCUSD` | retired (#760, superseded by `BTC`) |
| `doge` | `DOGEUSD` | retired (#760, superseded by `DOGE`) |
| `oil` | `USOIL` | renamed to `WTI` (#760) |
| `china` | `CHN50` | **never existed** — the symbol is `CHINA50` |

So **every slug-derived crypto protocol was aimed at a dead symbol**. `ETH` and `SOL` had no
hint at all. Fixed to `BTC`/`ETH`/`SOL`/`DOGE`/`WTI`/`CHINA50`, and `spx` corrected from `SPY`
to `US500` (the SPX index is `US500`; `SPY` is the ETF).

### 2. The starvation diagnostic could not see the symbols it existed to find

`getStarvedSymbols()` used a `JOIN symbol_protocol_assignment` to pick its candidates. That
restricts the report to symbols that **already have an assignment row** — the one population
guaranteed to be in the refresh set. It could therefore never report a symbol *excluded* from
the refresh set, which is the interesting case.

Changed to `EXISTS` predicates over assignments, active strategies, and positions.

### 3. That fix silently broke on a collation mismatch — and the catch hid it

`symbol` and the referencing tables were created with different collations
(`utf8mb4_0900_ai_ci` vs `utf8mb4_unicode_ci`). A bare `=` raises
`ER_CANT_AGGREGATE_2COLLATIONS`.

The surrounding `catch {}` swallowed it and returned `[]`, so the report said **"nothing is
starved"** when in fact **the query never ran**. The bug being fixed was reproducing itself
inside the fix.

Two changes:
- `COLLATE utf8mb4_unicode_ci` on every comparison (commented as load-bearing so it is not
  "tidied" away).
- The catch now records `staleError`, surfaced as `starvedSymbolsError` on the status payload.
  **An empty report and a broken report must not look the same.**

### 4. The probe's own gate check rotted the moment the fix landed

`INV-GATE-FAILS-CLOSED` defaulted to `--stale CHINA50`, chosen *because* `CHINA50`'s feed was
frozen. Repairing `CHINA50` invalidated the fixture, and the probe began failing with
`30/30 protocols report open=true` — a **probe fault, not a regression**.

Replaced the named symbol with **discovery**: find the oldest active assigned symbol with a feed
>24h old. If none exists, **skip and say so** rather than pass — a pass would claim a property it
never exercised.

---

## What the corrected diagnostic now reports

```
XIACY  RTP  PTGEF  R3NK  8XP  3NVD  ECAR  DMYI  BRWM
```

All nine confirmed absent from the bridge's own symbol list (`/symbols`). These are honest
`no-data` — genuine broker unavailability, now **visible** instead of silent. Before the fix
this list was empty and the distinction was unknowable.

---

## The guard

**`INV-SYMBOL-HINTS-RESOLVE`** — every target `SINGLE_SYMBOL_HINTS` can produce must be an
**active** symbol that a provider actually delivers bars for.

- **Unit** — `nest/src/modules/symbols/symbol-hint-validity.spec.ts` (10 tests): every target is
  in a known-good ticker set, none is in a retired set, no duplicate match fragments (which would
  shadow a later hint), plus ordering/casing/null semantics.
- **Probe** — `INV-SYMBOL-HINTS-RESOLVE` in `contract-probe.cjs`: reconciles all 14 derived
  targets against the live registry and delivered bars, distinguishing `NOT A SYMBOL` /
  `RETIRED (active=0)` / `NO BARS DELIVERED`.

**Both guards were proven to fail.** Reverting `'btc' → 'BTC'` back to `'BTCUSD'` failed 4 unit
tests *and* the probe. A guard that cannot fail is a comment.

---

## Verification

| Check | Result |
|---|---|
| Backend build + contract gate | 17 invariants, 0 violations |
| Full test suite | 292 tests / 50 suites pass (was 282/49) |
| Contract probe | 8 passed, 0 failed, 1 skipped |
| `CHINA50` | 101 → 3,000 bars, all 6 timeframes, current |
| `starvedSymbolsError` | null (query healthy) |
| Starved symbols | 9 reported, all confirmed not offered by the broker |

---

## Engineering notes worth keeping

1. **A list that is only ever written will drift from the list that is read.** `SINGLE_SYMBOL_HINTS`
   was written once and read forever; nothing compared it to the registry.
2. **`catch {}` around a diagnostic converts a bug into a green light.** The error field
   (`starvedSymbolsError`) exists so that "nothing to report" and "could not report" are
   distinguishable.
3. **Do not build a test fixture on an incident.** `--stale CHINA50` encoded a *state* that the
   fix was going to change. Discover the condition, or skip honestly.
4. **A negative result from a dead service is not a measurement.** Restart, then re-probe.
5. **[matters] `CHINA50` freeze resolved as a side effect.** `china-speed-v1` remains inactive
   and `CHINA50` still has no assignment, so it is still outside the refresh set by design —
   the bars were backfilled so it is ready if reactivated. This is a deliberate product state,
   not a defect, but it means `CHINA50` will re-freeze if left inactive. Reactivating
   `china-speed-v1` (or assigning `CHINA50` to an active protocol) is a **product decision**
   that has not been made.

---

## Future improvement notes

- `SINGLE_SYMBOL_HINTS` and `WATCHLIST_HINTS` are both hardcoded tables mapping names to
  entities. Both have the same drift risk. `WATCHLIST_HINTS` is currently **unguarded** — if a
  watchlist is renamed, those hints resolve to nothing and the affected protocols silently fall
  back. Worth a sibling invariant.
- The 9 broker-unavailable symbols are reported but not acted on. Consider marking a symbol
  inactive (or a `provider_unavailable` state) once it has never delivered bars after N refresh
  cycles, so it stops consuming refresh budget.
