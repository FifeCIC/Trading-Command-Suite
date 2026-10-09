## Pre-Close Verification — consolidated close (sprint #1102 item B3)

> ⚠️ This is a **sprint/epic close by consolidation**, per the owner's 2026-10-09 restructure. It has
> no acceptance checkboxes of its own; its done-rule is *"the lists below are closed or explicitly
> deferred with a reason, and the baseline table is re-measured."* Both are below.

- [x] **All five absorbed sprints are CLOSED.** #1059, #1060, #1051, #965, #1043 — states verified 2026-10-09.
- [x] **Direct items extracted — nothing lost.** The nine rows without an issue number:
  - **The seven R29 criteria** (§7.3, carried from #1051) → extracted VERBATIM into **#1103** (verified: one hop from #1051 → this issue → #1103; body updated with the carry reference).
  - `weight-strategy-selects-denominator` (refuted) → **ticked**: decided, declared INERT (SETTLED-DECISIONS row 30 + code DECISION marker). Wiring it is a maths change (#718-class), not a burndown item.
  - Docs-store theory files → **deferred with reason** (theory-registry workflow, docs store owned separately; not result-affecting).
- [x] **The remaining rows are open ISSUES — their own trackers, not this epic's deliverables.** The result-affecting subset is now sprint **#1102** (created by the owner 2026-10-09: #1099, #1100, #866, #1035, #1079, #837, #1087 + the B close-outs). Per-issue discipline continues in each issue; this epic does not hold a second checklist by design ("the sprint tracks reachability, not a second checklist").
- [x] **Baseline RE-MEASURED (2026-10-09, `trade` where `pnlInvalid=0`):**

  | Measure | 2026-10-07 baseline | 2026-10-09 |
  |---|---|---|
  | Closed ledger | 268 · 124W/144L | **313 · 137W/176L** |
  | Net P&L | −£786.27 | **−£1,144.63** |
  | TP closes | ONE in 377 | **still ONE** |

  The ledger grew and the net worsened — that is the honest reading of a period in which the faults
  under this epic were being found and fixed, not a pass/fail number. The **TP=1** figure remains the
  sharpest open signal and lives on inside #1102's scope (exit integrity continues there, e.g. #1066,
  #979/#978, #995).

## What closing this means / does NOT mean

- **Means:** the burndown epic has no un-owned work left on it; every carried item has a live container
  (#1103 for R29; #1102 for result integrity; the issues themselves for the rest).
- **Does NOT mean** the underlying faults are gone — the fix-rate simply moved to the containers above.
- **NOT done by this closure:** no item was executed by closing this container; every open item
  transfers unchanged (the #1051 precedent, same discipline).
- **REVERSE BY:** reopen this issue and delete the #1103 carry reference in §7.3 — the block is
  self-contained and removable, exactly as its own carry note describes.
