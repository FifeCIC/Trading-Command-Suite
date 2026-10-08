## RESOLVED 2026-10-08 — the denominator question is settled, and the premise it rested on measured FALSE

### What was actually wrong — and what was not

Every headline shape in this issue is now measured false or superseded:

| claim | measured now (2026-10-08) |
|---|---|
| "8 of 11 gold directives permanently neutral" | **6 of 10 counted directives are neutral-only** (10-07 re-measurement; `rsi-oversold` and `support-resistance-levels` emit direction now — classes CHANGE over time) |
| "90% of the m15 denominator unreachable" | reachable ceiling **380 of 910 = 41.8%** (10-07 comment); the OBSERVED signal path peaked **signalPct 15.2%** in 7 days |
| "the bot cannot trade" | `Gold Day-Trade M15`'s signal **exceeded its 10% bar** on 2026-10-07 12:40→13:59 (compositePct 11-14, `decision_log`) and the dispatch was refused by the **account-wide daily-loss cap** — a correct guard, not a bar problem. The bot has **5 trades (last 2026-09-23)**; its 4H sibling traded **2026-10-08** |
| audit claimed "7 days" | `score` **rotates** — for m15 it held ~2 days, which is where the false "CANNOT FIRE achieved=8.5%" came from (see the fix below) |

### The denominator question — answered by decisions already standing

The question "should the denominator exclude permanently-neutral capacity" was **not re-opened**: it was answered on 2026-09-10 (register row 9) and the answer was **implemented and reverted in one day** — the declared-`directionBias` capacity test "massively understates what directives emit". The 10-07 re-measurement confirms exactly why: directive classes are not static (`rsi-oversold` was neutral 549/549 ticks in September, then emitted bullish 107 ticks in 24h on 10-07).

| register row | standing decision |
|---|---|
| 2, 3, 5 | ONE stable config-derived denominator (`configuredSignalMax`); eligibility from CONFIG; gate capacity excluded |
| 9 | `!isGateGroup` alone is correct for capacity — the `directionBias` test was tried and REVERTED |
| 10 | thresholds recalibrated only against the frozen configured denominator, from a measured distribution |

The remaining legitimate question — "should directive X emit a signalClass at all" — is a **per-directive** decision, and the policy already declares it: *"a neutral directive is a display metric, not a signal"* (`protocol-gating.service.ts` header). It is not a denominator problem, and the assembly gap is owned by **#915** (open sprint item). **No threshold, weight or denominator was changed here.**

### Fixed as part of this resolution — the audit that kept producing the false claim

`audit-data-health.cjs` [3/4] read only `score` (a ROTATING table) while claiming a 7-day window. Fix — the same two-source pattern this issue established on 09-27 for `protocol-health`:

- **`score` + `score_snapshot.signalPct`** (the number the bot's own gate compares);
- the snapshot can **VETO a failure but never pass** it (both sources below the bar = still `below`);
- the audit now **prints the coverage it actually read** ("score table actually covers … — the table ROTATES");
- a vetoed bot surfaces as a **WARNING with both numbers**, not a failure — *"cannot judge" stays distinct from "cannot fire"*.

**Canaried in both directions** (observed, not asserted):

| step | result |
|---|---|
| self-test | **16 canaries**, incl. the real `(score 8.5, signalPath 15.16, bar 10) → cleared-by-snapshot` case |
| M1 — remove the veto | 1 canary FAILS, exit 1 — observed |
| M2 — make `below` unreachable | 3 canaries FAIL, exit 1 — observed |
| restore | byte-for-byte verified (SHA256 unchanged) |
| live | `below in window: 0`; m15 reads `score=8.5% signalPath=15.2%`; **exit 0** |

### Pre-close checklist

| gate | observed |
|---|---|
| Structural | `node --check` OK; script runs |
| Contract | `--self-test` 16/16 green |
| State | live run reclassifies the exact false positive; no threshold/protocol/bar edited |
| Behaviour | the false `CANNOT FIRE` claim is gone from the audit output, replaced by a sourced warning |

### Deliberately unchanged / not done

- **No threshold, weight, denominator, protocol or bar was edited** — the maths gate stands (`.github/instructions/maths-change-requires-ab.instructions.md`).
- The per-directive signalClass design question (e.g. `gold-session-profile` scores 69/90 while neutral) is **not answered here** — the policy above and #915 own it.
- The historical basis change (max composite 638 mid-August vs today's scale) **was not re-investigated**: the gating header records it — the old formula (group-weighted, normalised) was replaced by directional-only evidence, so the pre-change series is not comparable.

**Closing rationale:** the question this issue asks is answered by the standing decisions above plus today's measurements, and the audit no longer reports the false positive. **REVERSE BY:** change register rows 2/3/5/9 and re-open.

🤖 Closed by primary — 2026-10-08. Handoff: `2026-10-08-999-data-health-two-source.md`
