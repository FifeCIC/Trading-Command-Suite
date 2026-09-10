# #764 — Retiring the symbol-guess tables (the WATCHLIST_HINTS audit)

**Date:** 2026-09-10
**Status:** Complete — guarded by `INV-NO-SYMBOL-GUESSING`
**Follows:** #761 (hint targets stale) → #763 (watchlist identity)

---

## The audit's answer

The question was: *can `SINGLE_SYMBOL_HINTS` and `WATCHLIST_HINTS` be removed?*

At the start: **no.** The audit found **20 of 46 protocols** — **10 of them ACTIVE** — resolved
their symbols through the guess tables and **nothing else**. They had no assignment and no linked
watchlist. Delete the tables and those 10 stop scoring.

| Verdict | ACTIVE | ALL |
|---|---|---|
| `HINT_ONLY` — no relationship at all | **10** | 20 |
| `HINT_ADDS` — relationship exists, hints add symbols | 0 | 0 |
| `RELATIONSHIP_ONLY` | 7 | 10 |
| `UNRESOLVED` | 1 | 16 |

The `HINT_ADDS = 0` result mattered: it ruled out the dangerous case where hints were *masking* a
partial wiring gap. Every affected protocol was either fully wired or not wired at all.

The 10 active ones were: `forex-session-v1`, `gold-macro-v1`, `xau-speed-m5`, `xau-speed-m15`,
`xau-speed-1h`, `xau-speed-4h`, `spy-day-v1`, `qqq-day-v1`, `vix-spike-v1`, `vix-short-v1`.

---

## What was done

### 1. Wired all 20 onto watchlist FKs

Ten active, then ten inactive — deliberately including the inactive set, because leaving them on
the guess path would reintroduce the exact bug for whoever activates one next.

**One watchlist per protocol, not per symbol.** `watchlist.protocolId` is single-valued, so a
shared `xau-index` could only link to one of the four `xau-speed-*` protocols; the other three
would fall straight back to guessing. Per-protocol names (`xau-speed-m5-index`) keep the FK
unambiguous and readable.

Symbol sets were copied **from the audit**, which derived them from the hint tables themselves —
so this changed the MECHANISM, not the BEHAVIOUR. Verified: `leverage-v2-index` came out at
exactly 79 symbols, `pandemic-index` at 14, `dxy-sensitivity-index` at 7.

### 2. Emptied the tables rather than deleting them

```ts
export const SINGLE_SYMBOL_HINTS: Array<{ match: string; symbol: string }> = [];
export const WATCHLIST_HINTS: Array<{ match: string; watchlist: string }> = [];
```

Kept as empty typed arrays, for one reason: the code path that reads them **also carries the
warning** that tells an operator a protocol is unwired. Deleting the arrays deletes the
diagnostic with them.

Resulting behaviour:
- a correctly wired protocol never reaches this path;
- an **unwired** protocol resolves to **nothing** and logs exactly how to fix it — a loud,
  actionable failure instead of a silent, plausible guess.

### 3. The invariant inverted

`INV-SYMBOL-HINTS-RESOLVE` → **`INV-NO-SYMBOL-GUESSING`**.

The old invariant asserted *the guesses are accurate*. That was the right guard in #761, when four
targets had gone stale. It is the wrong guard now: the property worth asserting is that **nothing
is guessed**. So the check became:

1. the hint tables are **empty**;
2. every ACTIVE protocol resolves through a declared relationship.

---

## Two real findings the work surfaced

### `signals-workbench` — a sandbox, not a fault

The new guard immediately failed with `WIRED TO NOTHING: signals-workbench`. Investigating rather
than suppressing:

> `note`: *"Sandbox protocol for signal testing — intentionally not wired to live symbols."*

So the guard was right that it has no symbols and **wrong to call it a fault**. A guard that cries
wolf gets suppressed, which loses the real detections. The check now honours an **explicit,
declared** opt-out — the protocol's own note must contain "sandbox" or "intentionally not wired" —
and it still *reports* the sandbox rather than passing silently.

### The `INV-GATE-FAILS-CLOSED` fixture rotted again — from the other direction

That check defaults to discovering a symbol with a frozen feed. After #761/#763 repaired
`CHINA50` (and its feed), **no active protocol-assigned symbol is stale any more**, so the
premise cannot be exercised and it SKIPs — honestly, rather than passing a property it never
tested. Expected, and stated in its own detail line.

---

## Guard: `INV-NO-SYMBOL-GUESSING`

- **Unit** — `symbol-hint-validity.spec.ts` (7 tests): tables empty, no derivable targets,
  `deriveSingleSymbolFromSlug` returns null for every previously-matched slug, and the unwired
  warning still exists.
- **Probe** — reports repopulated tables and protocols wired to nothing, with a declared-sandbox
  exemption.
- **Audit** — `scripts/audit-hint-dependency.cjs` classifies every protocol and is the tool to
  re-run after any onboarding change.

**Guard proven to fail.** Injecting `{ match: 'btc', symbol: 'BTCUSD' }` into the compiled table
produced:

```
FAIL [INV-NO-SYMBOL-GUESSING] HINT TABLES REPOPULATED (1 target) — a protocol can be
handed a GUESSED symbol from its slug. Wire the protocol instead: ...
```

---

## Verification

| Check | Result |
|---|---|
| Backend build + gate | **18 invariants**, 0 violations |
| Full test suite | **321 tests / 54 suites pass** (was 297/51) |
| Contract probe | **7 passed, 0 failed, 3 skipped** |
| Audit — ACTIVE | **HINT_ONLY=0, HINT_ADDS=0** |
| Audit — ALL | **HINT_ONLY=0** (was 20) |
| Runtime | `18 of 18 active protocols ready for scoring`; refresh set **39 symbols** |
| Guessed-symbol warnings in live log | **0** |
| `CHINA50` via FK | bars growing past backfill (508/610/603) — proving live resolution |

---

## Engineering notes

1. **Fixing the data is not fixing the mechanism.** #761 corrected four stale hint targets. That
   was necessary and insufficient — the guessing *practice* was the defect, and it went unnoticed
   because a corrected guess still looks like a working relationship.
2. **The audit had to exist before the fix could be safe.** "Can we delete this?" was unanswerable
   without classifying all 46 protocols. Guessing at the answer would have silently broken 10
   active protocols.
3. **A guard that fires on intentional design will be suppressed.** `signals-workbench` forced the
   distinction between "broken" and "deliberately empty" — and the opt-out has to be *declared in
   data*, not inferred, or it becomes a hiding place.
4. **Emptying beats deleting when the array carries a diagnostic.** Removing the tables outright
   would have removed the warning that makes an unwired protocol visible.
5. **`protocolId` being single-valued shaped the whole migration.** A shared watchlist per symbol
   was the obvious design and simply does not work here; reading the column type first avoided
   building 20 rows that would half-resolve.

---

## Open items (recorded, not hidden)

- **`leverage-v2` resolves to 79 symbols including inverse/short ETFs** — `SOXS`, `SPXS`, `SQQQ`,
  `SRTY`, `TECS`, `YANG`, `FNGD`. That is what it resolved to *before* this change, so wiring
  preserved behaviour. Whether an inverse basket belongs in something called "leverage-v2" is a
  **product question** and was not silently altered.
- **`signals-workbench` remains active and unwired by design.** Its sandbox status is declared
  only in a free-text `note`; a structured column would be better, but that is a schema change.
- **4 slug-identified watchlists remain** (`primary`, `leverage`, `global-warming`,
  `trading212-portfolio`). Unambiguous today (no UUID twin); `INV-WATCHLIST-IDENTITY` fires if one
  is created.
- **`##` Migration flakiness observed:** `npm run build` runs `rimraf dist`, and a concurrent
  build wiped `dist/` between a build and a probe run, producing a spurious SKIP and then a
  spurious FAIL. Not a code fault — but the probe's `require` of `dist` means it must be run
  against a settled build.
