# Handoff — #789 `session-open-effect` risk-group placement + seeder drift

**Date:** 2026-09-11
**Issue:** #789 (filed as #788 in-session, GitHub assigned #789)
**Type:** Bug — wasted signal capacity, plus a data-store capability gap

---

## What changed

| Layer | Change |
|---|---|
| Seed data | `protocols-seed-data.ts`: removed 15 `session-open-effect` placements (14 in `risk` groups, 1 redundant `sentiment` copy in `forex-session-v1`). 39 → 24 placements |
| Database | Deleted 15 orphaned `protocol_directive_entry` rows via `nest/prisma/reconcile-session-open-effect-788.sql` |
| Tooling | 4 new reusable scripts under `nest/scripts/` (below) |
| Verification | Boot health warnings **24 issues / 15 protocols → 16 / 14**; duplicate-directive warning eliminated |

Every risk gate remains populated. No gate was emptied — only the misplaced *non-gate* directive was removed.

---

## The theory — why this mattered

### Directives are the trading decision. Placing one in the wrong group deletes it.

A **scoring group** ("technical", "sentiment", "Market Context") and a **risk gate** (`isRiskGate: true`)
are not interchangeable buckets that both feed the same sum. They are two different *kinds* of statement:

- A scoring group answers **"which way, and how strongly?"** Its directives feed the directional composite.
  Their `maxScore` values form the denominator the protocol is measured against.
- A risk gate answers **"should this signal be trusted at all?"** It does not vote on direction. It scales
  what the scoring groups produced.

`protocol-gating.service.ts` enforces that separation structurally:

```js
const inSignal = !isGateGroup && directional && directionAllowed;   // L689  — signal requires NOT a gate
if (!isGateGroup) { capacityMax += maxScore; }                      // L749  — capacity counted only outside gates
```

So a **directional predictor placed in a risk gate is not downgraded — it is erased**. It still executes,
still consumes its bars, still produces a confident `bullish`/`bearish` reading, and the scorer throws the
reading away. Nothing errors. Nothing warns about *that*. The protocol simply carries 60 points of capacity
that can never contribute.

`session-open-effect` is `category: 'pattern'`, `directionBias: 'neutral'`, `maxScore: 60` — a pure
directional predictor. It was in the `risk` group of 14 protocols.

### Why the dedupe masked it

In 10 of those 14, the directive *also* appeared in `technical` with a lower `sortOrder`. The scorer's
`seenDirectiveIds` set (L668) skips the second and later occurrences, so the signal survived — but only by
accident of ordering. The warning it produced on every boot read like a cosmetic config nit. It was in fact
the visible edge of a real, silent signal loss in the 4 protocols where no scoring-group copy existed.

**The general lesson:** a "double-counted directive" warning can mean either (a) genuine double-counting
that inflates a score, or (b) a correctly-placed copy duplicating a **functionally dead** one. They produce
the same warning. Only checking which *group kind* each placement lives in tells them apart.

---

## The bigger finding — the seeder cannot express a removal

`ProtocolDbService.seedProtocolsToDatabase()` **creates and updates but never deletes.**

Removing a directive from `protocols-seed-data.ts` therefore does **not** remove its DB row. This was
demonstrated, not inferred: after removing 15 placements and re-seeding, the API returned
`entries: 419` (down from 434) while the database still contained **all 14 risk-group rows**.

The `419` is the trap — it counts entries the seeder **upserted**, not rows that **exist**. It reads exactly
like a successful removal.

Consequences that outlive this fix:

- **Seed data and the database drift silently** in one direction (DB can hold more than the seed).
- **Re-seeding does not converge them.** The usual "just re-seed" recovery does not work for removals.
- **Every future seed edit that removes something is a no-op** unless paired with explicit SQL.

Conceptually: the seeder treats the seed file as a set of *facts to assert*, while the operations people
actually need are *additions and retractions*. A store that can only assert cannot retract — so the "source
of truth" is only a source of truth for additions.

**Recommended follow-up (not done here):** have the seeder prune `protocol_directive_entry` rows for
directives absent from the seed for that protocol's groups, or at minimum log orphans as a warning.
`nest/scripts/prune-orphan-entries.cjs` already exists as a manual equivalent, which suggests the gap was
noticed before but never closed at the seeder.

---

## The mistake I made, and the guard that now exists

My first version of `remove-risk-group-directive.cjs` **wrote invalid TypeScript and reported success.**
In `forex-session-v1`'s risk array it produced two adjacent string literals:

```js
"directiveIds": [
  "liquidity-check"
  "spy-qqq-relative-strength"     // TS: L1621 ',' expected
]
```

Cause: the "removed the first entry" handler stripped the comma from the **following** line, but that line
was becoming the new first entry and needed its own comma.

**Engineering principle:** a script that **generates syntax must parse its own output before writing.**
Reading the diff is not validation — I read that diff and missed it. A generator with no parse gate is a
generator that can corrupt its input file while reporting clean success.

The script now runs `ts.createSourceFile` on the candidate text and aborts with exit 1 if diagnostics > 0.
`test-remove-risk-guard.cjs` demonstrates the guard rejecting that exact malformation. **A guard that has
never been observed to fail is a hope, not a guard** — so the test exists to make the guard fail on purpose.

---

## Tooling added

| Script | Purpose |
|---|---|
| `nest/scripts/find-risk-group-directives.cjs <id>` | Classifies a directive's placements as scoring vs RISK, reports duplicates per protocol |
| `nest/scripts/list-empty-groups.cjs` | Lists groups with zero directives, flags empty risk gates |
| `nest/scripts/remove-risk-group-directive.cjs <id>` | Removes risk-group seed entries; **parse-guards output**; `--dry-run` default |
| `nest/scripts/test-remove-risk-guard.cjs` | Proves the parse guard rejects invalid syntax |

Plus `nest/prisma/reconcile-session-open-effect-788.sql` — idempotent SELECT-then-DELETE for the DB side.

---

## Verification evidence

| Check | Result |
|---|---|
| `tsc -p tsconfig.build.json --noEmit` | exit 0 |
| Seed parse diagnostics | 0 |
| `find-risk-group-directives.cjs session-open-effect` | 0 in risk groups, 24 in scoring, 0 duplicates |
| DB `protocol_directive_entry` | risk placements 0, total 24, protocols with duplicates 0 — **matches seed** |
| Boot `ProtocolHealthService` | 16 issues / 14 protocols (from 24 / 15); **no duplicate-directive warning** |

---

## Still open (worth their own issues)

1. **`session-open-effect` fires directionally 24 times in 3,287 readings (0.7%).** `WINDOW_MINUTES = 30`
   means it is active only within ±30 min of three session opens — on hourly bars, **3 of 24 bars (12.5%)**.
   It claims 60 points of capacity in 24 protocols to deliver ~0.7% directional readings. This is #761's
   denominator problem inside a single directive and needs a decision: narrow the window, drop the
   directive from fast-timeframe protocols, or accept it as a session-only specialist.
2. **`vix-spike-v1` declares 0 of 480 points directional** — cannot emit a directional signal at all.
3. **5 `sentiment` groups were already empty before this change** (`spy-speed-v1`, `vix-spike-v1`,
   `dxy-sensitivity-v1`, `mtf-weighted-v1`, `gap-scanner-v1`), carrying weights of 0.25–0.35 that
   contribute nothing. Pre-existing drift, verified against a backup so I know I did not cause it.
4. **A build-time guard for the `inSignal`/group-kind mismatch.** A dedicated check would be cheap and
   general.
5. **The other 16 health warnings** are dominated by the "only 140 of 910 maxScore points DECLARE a
   direction (15%)" class. That is a systemic pattern, not 10 separate problems, and connects to #761.

---

## Related

- **#761** — directional capacity vs denominator; this is a concrete instance
- **#731** — session-timezone fix that stopped this directive scoring zero 6,308 times
- **#789** — this work
