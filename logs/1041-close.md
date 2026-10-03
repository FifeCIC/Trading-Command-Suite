## Pre-Close Verification — the guardian half is built; live observation stated as outstanding

### What was wrong, and where it actually was

Detection and display shipped in #1037. **This issue was the acting half**, and the defect was one
line of conflation in `resolvePositionOwner()`: it returned `null` for BOTH

- **zero** candidates — nobody claims it, and
- **two or more** candidates — several do.

`tick()` then reported both as *"owner could not be established"*, so a contested position was
managed by **nothing**. `docs/change-guide-position-lifecycle.md` row 8 names the cost: a position
built from three bots' orders sat unmanaged for **2 h 20 m**, and ticket `152703882760` lost
**−322.67**.

### Acceptance

- [x] **A contested position is MANAGED, not refused.**
      `resolvePositionOwner()` takes an optional out-parameter and reports the **ambiguous set**
      instead of collapsing it; `tick()` resolves a contested position to its strictest claimant and
      puts it through the ordinary path — so the chosen bot's OWN rules apply, including its `slPct`
      as the #927 floor. Nothing new is invented; only **who governs** changes.
      ⚠️ **Canaried both directions:** planting the pre-#1041 condition (`contested.length > 99`)
      fails exactly the canary test (1 failed, 39 passed); restoring passes **40/40** with no marker
      left.

- [x] **The manager is the STRICTEST claimant, and "strictest" is a defined, tested rule.**
      `pickStrictestClaimant()` = the **smallest `slPct`** (the tightest stop ⇒ protected soonest).
      Asserted: the tightest wins; an **unknown `slPct` sorts LAST** and never outranks a
      known-tight stop; **ties break on name** so a position is not governed by a different bot each
      tick. The xau bots alone span 0.3 / 0.5 / 1.5 / 3.0, so the choice is not academic.

- [x] **The claimants are NAMED on the surface, so the choice is visible.**
      `GuardedPosition.claimants` carries the other bots and `ownerVia: 'comment:contested'` records
      why that bot governs — the guardian now acts on a position whose ownership it cannot pin to
      one bot, so *which rule acted* must be readable rather than inferred.

- [x] **"Nobody claims it" and "several do" stay distinguishable.**
      An unknown comment reports **no** claimants and still lands in `unresolved`; an ambiguous one
      reports the set. Asserted in both directions.

### Gates

| # | Gate | Observed |
|---|---|---|
| 1 | Structural | `tsc -p tsconfig.build.json --noEmit` **exit 0** |
| 2 | Contract | `stop-guardian.service.spec.ts` **40/40** (was 34; **6 new** for this issue) |
| 3 | State | — see below |
| 4 | Behaviour | the canary above, both directions |

### ⚠️ Not observed live — stated, not ticked

**No contested position has been seen by the new code.** The behaviour is proven at unit level with
the incident's own shape (`TCS A B` against names `A-B` / `AB` — not equal to either, not a prefix
of either, colliding only after punctuation is stripped), but the incident's *live* signature has not
recurred. To confirm:

```
GET /api/trading/mt5/positions/managed   → look for claimants.length > 1
GET /api/automation/stop-guardian/status → the same ticket in guardedPositions
  with ownerVia "comment:contested" and `claimants` populated
```

Until that is seen, the honest statement is **unit-proven, not live-verified**.

### Deliberately NOT done

- **The time-stop's matching refusal was not changed.** `position-time-stop.service.ts` still
  returns `comment_no_match_multi_strategy` / `ambiguous_multi_strategy` (L748/L762), so a contested
  position that the guardian now trails is still not time-stopped. The guardian half is what R31
  named for this issue; changing the time-stop as well would be a second behaviour change on the
  same ruling and is better done as its own decision. **Stated so it is not discovered as a gap.**
- **No maths change.** `slPct` values are untouched; this changes *which* existing rule governs, not
  what any rule computes.
