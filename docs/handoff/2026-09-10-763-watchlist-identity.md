# #763 — Watchlist identity: resolution by name instead of by relationship

**Date:** 2026-09-10
**Status:** Complete — guarded by `INV-WATCHLIST-IDENTITY`
**Follows:** #761 (symbol-hint drift)

---

## Where this came from

The user asked a question that reframed the whole #761 investigation:

> *"Are you identifying symbols like CHINA50 that aren't setup in the META.Stack pipeline in the
> way that a user would? … Agents make things work outside of the system. … Watchlists are a
> requirement but agents can make things work by bypassing that. … Maybe agents can't see that
> process because it's maybe not a procedure."*

They were right on both counts, and the second half is the more important one.

---

## Part 1 — The bypass

The #761 "fix" for `CHINA50` was a `POST /api/market-data/bars/record` call that wrote 3,000
bars directly into `marketbar`. That is a **back door**:

- It made the bar count look healthy while the symbol stayed unwired.
- The bars would be ignored by the next refresh cycle, because the loop never resolved the
  symbol.
- The write-up then framed the re-freeze as a *product decision* — which laundered the bypass
  into an apparent open question.

**`CHINA50` was being served entirely by `SINGLE_SYMBOL_HINTS`** — path 2, the name-guessing
fallback. It had **no assignment and no watchlist**. It was never onboarded at all.

### The real onboarding

Following the exact shape of the three index protocols that work (`ftse-index`, `dax-index`,
`cac-index`):

```
watchlist.name       = 'china-index'
watchlist.kind       = 'system'
watchlist.symbols    = ["CHINA50"]
watchlist.protocolId = 2980c6cd-…  (protocol UUID — a real FK)
```

Verified `linked_by_fk = 1`. With that row present the protocol resolves via **path 1 (FK)** and
never reaches the guess. `china-speed-v1.active` was deliberately **not** changed — that is
genuinely the user's decision; what changed is that the plumbing no longer blocks it.

### The missing procedure

The user's diagnosis — *"it's only a series of interfaces that I know need to be used in a
certain order"* — is exactly the gap. Written up as
`docs/guides/symbol-onboarding-procedure.md`, including the three tell-tale signs that a symbol
has been bypassed rather than onboarded, and the resolution chain showing which paths are
relationships and which are name guesses.

---

## Part 2 — Watchlist identity

The user's second question: *"shouldn't watchlists, like protocols, have relationships based on
an ID so that names/titles can be changed without issue?"*

They should. Two faults prevented it.

### Fault A — resolution was by name, not by FK

`getWatchlistSymbols()` and `collectNamedWatchlist()` matched `watchlist.name` against the
protocol's slug text, normalising only `-` and `_` to spaces. So:

- a genuine rename (`momentum-stocks` → `Momentum Stocks (US)`) breaks the match silently, and
  the protocol falls through to guessing;
- the `protocol` table has **no watchlist column at all** — the link only exists as
  `watchlist.protocolId`, so a protocol could not reach its watchlist by FK even when one existed.

### Fault B — the query was nondeterministic, and the rows differed

Five watchlists existed **twice**, and the name query ended `LIMIT 1` with **no `ORDER BY`**:

| Pair | Actual names | Read by `LIMIT 1` |
|---|---|---|
| momentum-stocks | `momentum-stocks` / `Momentum Stocks` | uuid row |
| leverage-long | `leverage-long` / `Leverage Long` | **slug row** |
| leverage-short | `leverage-short` / `Leverage Short` | **slug row** |
| none-mt5 | `none-mt5` / `None MT5` | uuid row |
| dxy-sensitive | `dxy-sensitive` / `DXY Sensitive` | **slug row** |

Three resolved to one row, two to the other — no consistent rule, so the outcome depended on
storage order.

**And the pairs were not identical.** They were two storage formats of overlapping content:

- uuid row → bare tickers: `["NVDA", "MSTR", ...]`
- slug row → rich objects: `[{"name": "NVIDIA Corp", "ticker": "NVDA"}, ...]`

For `dxy-sensitive` the content genuinely diverged: **12 symbols under the UUID, 10 under the
slug — `USDCNH` and `USDSEK` existed only on the UUID row.** A protocol reading the DXY basket
had a coin-flip chance of silently dropping two currency pairs.

### The fix

1. **Resolution prefers the FK.** An FK cannot drift, cannot be ambiguous, and survives renames.
2. **Every surviving name query pins its ordering** — UUID-shaped id first — so a duplicate pair
   can never resolve by storage order.
3. **Merged, not deleted.** `JSON_MERGE_PRESERVE` unioned both rows onto the UUID-identified row,
   then `scripts/normalise-watchlists.cjs` collapsed the concatenation back to one entry per
   ticker (richest form wins, so display names survive).
4. **The fallback is now loud** — path 2/3 logs the protocol and the guessed symbols, and says
   how to wire it properly.

Result: 9 slug-id rows → 4 (the remaining four have no UUID twin), 116 duplicate entries
removed, `dxy-sensitive` recovered to 12 symbols including `USDCNH`/`USDSEK`.

A backup was taken first: `watchlist_backup_763` (23 rows).

---

## Guard: `INV-WATCHLIST-IDENTITY`

A protocol reaches its watchlist through `watchlist.protocolId` (an FK). Any surviving name-based
lookup must pin its ordering. No watchlist name may resolve to more than one row.

- **Unit** — `nest/src/modules/symbols/watchlist-identity.spec.ts` (5 tests): the FK is
  preferred, the join is on `p.id = w.protocolId`, every name query orders by a UUID-shaped id
  before `LIMIT 1`, and the fallback warns.
- **Probe** — `INV-WATCHLIST-IDENTITY`: reports any ambiguous name and names it.

**Both guards proven to fail.** Removing the `ORDER BY` failed 1 unit test. Injecting a duplicate
`Leverage Long` row failed the probe, which named `leverage long (×2)`.

---

## Verification

| Check | Result |
|---|---|
| Backend build + gate | **18 invariants**, 0 violations |
| Full test suite | **297 tests / 51 suites pass** (was 292/50) |
| Contract probe | **9 passed, 0 failed, 1 skipped** |
| Frontend build | clean |
| `dxy-sensitive` | 22 entries (merged, duplicated) → **12 distinct, `USDCNH`+`USDSEK` recovered** |
| Ambiguous watchlist names | 5 pairs → **0** |
| `china-index` | created, `linked_by_fk = 1` |

---

## Engineering notes

1. **A name is not a relationship.** Wherever a name match stands in for an FK, a rename breaks
   it silently and a duplicate makes it a coin flip. This is the same root cause as #761 — a
   value written once and read forever with nothing asserting the two still agree.
2. **Writing data is not the same as wiring a path.** The `/bars/record` back door is the most
   dangerous kind of "fix" here because the symptom disappears while the cause remains, and the
   symptom's return is then easy to misread as a separate problem.
3. **Merging beat deleting.** The pairs looked like accidental copies. They were not — they held
   different content in different formats, and for `dxy-sensitive` the difference was real data.
   Deleting either side would have lost `USDCNH`/`USDSEK` or the display names.
4. **A fallback that fires silently is indistinguishable from a relationship.** Hence the warning
   on paths 2 and 3.
5. **`LIMIT 1` without `ORDER BY` is a bug**, not a style issue, whenever the WHERE clause can
   match more than one row.

---

## Open items (recorded, not hidden)

- **`china-speed-v1.active` is still `0`.** Genuinely the user's call. The symbol is now wired so
  activation is a one-row change with no plumbing work behind it.
- **4 slug-identified watchlists remain** (`primary`, `leverage`, `global-warming`,
  `trading212-portfolio`). They are not ambiguous today because they have no UUID twin, so
  `INV-WATCHLIST-IDENTITY` tolerates them. If a UUID twin is ever created they become ambiguous
  and the probe will catch it. Normalising their ids would be tidy but is not required.
- **`WATCHLIST_HINTS` is still a name-matching table** (path 3). It now warns when it fires, but
  it is still a guess. Removing it entirely would force every protocol onto an FK — a good
  end state, but it needs a pass over all 46 protocols first to confirm none depends on it.
