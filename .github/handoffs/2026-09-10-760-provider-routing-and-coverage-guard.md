---
date: 2026-09-10
area: market-data
type: feature+bugfix
issues: [760]
invariants: [INV-PROVIDER-REACHABLE, INV-CADENCE-COVERAGE]
---

# #760 — provider routing, symbol reconciliation, and the anti-silent-empty guard

## What Changed

Acted on the four data decisions from the #758 follow-up, plus built the automated guard for
the failure pattern behind all of them.

| # | Decision | Result |
|---|---|---|
| 1 | `DJI30` vs `US30` | `US30` kept (has the history and the correct provider name); `DJI30` retired in place — **never received a single bar** |
| 2 | Route crypto properly | **Done** — binance now serves BTC/ETH/SOL/DOGE, live, 500 bars × 6 timeframes each |
| 3 | The stale `US30` | **Fixed** — backfilled from 47-day-stale to 4,400 bars, current |
| 4 | WTI explained | Clarified below; `oil-speed-v1` cleaned up |

System state: **0 stalled protocols**, 16 active (10 scoring, 6 honest `no-data`), probe 8/8.

## Answering "what is WTI and what's the issue?" — plainly

I explained this badly the first time. Simply:

`oil-speed-v1` is a protocol for **trading oil**. It was pointed at three symbols — `USOIL`,
`UKOIL`, `NATGAS` — and **none of the three exist on the price provider**. The provider calls
crude `WTI`; it has **no Brent contract and no natural-gas contract at all**.

So the protocol had zero usable data from the day it was created. It is also **inactive with no
bots attached**, so it was never going to trade — it was inert, not broken-and-losing-money. The
only thing wrong was that three phantom symbols sat in its assignment list making it *look*
configured.

`WTI` is now its one valid instrument (3,001 bars, live). `UKOIL` and `NATGAS` are retired in
place with a note, since no equivalent exists. **I did not activate the protocol** — whether oil
is worth trading is a strategy decision, not something the data layer should decide by quietly
enabling it.

## The anti-silent-empty guard — the answer to the pattern you asked about

You asked whether there's a solution worth building for *"an empty result is indistinguishable
from a correct result that happens to be empty."* There is, and it's now in place.

**The insight:** every one of these faults needed **two values compared that lived in different
files**. Both halves looked individually correct, so nothing ever flagged. Nobody was comparing
them because no single module owned both sides.

**The guard:** `contract-probe.cjs` now reconciles three pairs that were never reconciled:

| Check | Compares | Catches |
|---|---|---|
| `INV-CADENCE-COVERAGE` | Which cadences active protocols **resolve to** ↔ which the DB actually **holds fresh bars for** | Protocol asks for a cadence nobody fetches → empty array → no score, silently |
| `INV-PROVIDER-REACHABLE` | Which symbols are **assigned to protocols** ↔ which have **ever delivered a bar** | Wrong ticker for the provider, OR an adapter that exists but is never called |
| `starvedSymbols` (API) | Each symbol's **newest bar** ↔ its expected freshness window | A symbol that was working and silently stopped (the stale `US30`) |

**Both new checks found real faults on their first run** — `INV-PROVIDER-REACHABLE` reported the
symbols that had never delivered, and `INV-CADENCE-COVERAGE` would have caught the `1m` gap that
stalled seven protocols.

**The generalisable rule** (worth putting in the contracts doc as guidance):

> When a value is produced by one module and consumed by another, something must assert the two
> still agree. A list that is only ever *written* will drift from the list that is *read* — and an
> empty result hides the drift, because empty is a legitimate state.

This is the same shape as `INV-STABLE-DENOMINATOR` (configured vs observed), `INV-MTF-BUNDLE`
(declared vs supplied) and `INV-CADENCE-COVERAGE` (resolvable vs fetched). Four instances of one
pattern, which is why it is worth stating as a rule rather than fixing case by case.

## Provider routing (#760)

`BarRefreshService` hardcoded `adapterFactory.create('mt5')` and wrote `provider: 'mt5'` for every
row. `binance.adapter.ts` was implemented, correct, and **never called** — so crypto was fetched
once and aged out (BTCUSD 54 days, DOGEUSD 39, BTC-USD 16).

Fixed by reusing the **existing** `symbol_route` table rather than inventing a second routing
mechanism (shared-core rule: one mechanism per job). Added a `provider` column defaulting to
`mt5`, so **nothing that already worked changed**. The multi-broker MT5 fallback is now gated to
`providerName === 'mt5'` — a second MT5 bridge cannot serve a Binance symbol.

**Verified:** all four crypto symbols fetch 500 bars × 6 timeframes, live to 14:27.

## Data cleanups applied (all in-place, history preserved)

| Action | Rows | Rationale |
|---|---|---|
| Renamed to provider names | `SPX500→US500`, `TECH100→USTEC`, `USOIL→WTI` | Unblocked four active protocols |
| Retired dead duplicates | `DJI30`, `BTCUSD`, `BTC-USD`, `DOGEUSD` | Deactivated, **not deleted** — their bars are the only history that exists |
| Retired un-offerable | `UKOIL`, `NATGAS` | No contract exists on this provider |
| Consolidated crypto | `BTCUSD`+`BTC-USD` → `BTC` | Two rows for one instrument; assignments deduped (the table is UNIQUE on symbol+protocol) |

**A deliberate choice:** superseded rows are **deactivated in place, never deleted**. Their bar
history is real data, and discarding history to tidy a name is the wrong trade. Each carries
`[superseded by X]` in `name` so the trail survives.

## Files Changed

- `nest/src/modules/market-data/bar-refresh.service.ts` — provider routing per symbol; writes the
  true provider name; MT5-only fallback gated.
- `nest/scripts/contract-probe.cjs` — `INV-CADENCE-COVERAGE` + `INV-PROVIDER-REACHABLE`.
- `nest/scripts/validate-pipeline-contracts.cjs` — both wired as probe-enforced.
- `.github/instructions/meta-stack-contracts.instructions.md` — 16 invariants.
- `src/data/qa-checklist.js` — `qa-contract-017`.
- `nest/add-provider-routing.sql`, `nest/consolidate-crypto.sql`, `nest/resolve-us30.sql`,
  `nest/cleanup-oil.sql` — **NEW**, all recorded migrations.

## Verification

- **282 tests / 49 suites pass** (up from 262 — the other agent's `directive-dedupe` suite landed
  and passes). Builds clean. Contract gate green at **16 invariants**.
- Live probe: **8 passed, 0 failed, 0 skipped.**
- `INV-PROVIDER-REACHABLE`: all 14 assigned symbols have bars (was 4 that had none).
- `INV-CADENCE-COVERAGE`: all 6 wanted cadences have fresh bars.
- 0 stalled protocols; queue reads only `executed`/`pending`.

> ⚠️ **A stale-build trap worth knowing.** `tsc` reported `signalClass` errors in files that were
> correct — an incremental build artifact from an interface I had not touched. A clean rebuild
> cleared them. If TS errors name properties that plainly exist in the source, check for a stale
> `dist/` before editing anything.

## Still Needs a Decision

1. **Activate `btc-scalp-v1`?** The crypto data path is now fully working — BTC/ETH/SOL are live
   with 500 bars × 6 timeframes. The protocol is inactive, so they score nothing. It also owns a
   `5s–30s` timeframe, so it will need `1m` (now fetched).
2. **Activate `oil-speed-v1`?** `WTI` is live and is its only tradable instrument.
3. **`CHINA50`** is the last frozen active symbol (54 days). Not yet investigated.
4. **Activate `dow-speed-v1`?** `US30` is now live with 4,400 bars.
