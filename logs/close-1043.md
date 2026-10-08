**Consumed into #1081 — closed as CONSUMED, not completed (owner direction, 2026-10-07).**

Pre-close checklist (adapted for a consolidation close):

- **What closing means:** one burndown (#1081). The S10 plan continues under #1081 §7.5 with its plan-only status preserved (nothing was executed).
- **Carry verified — nothing lost:** the 12-item batch and its phase order (0: #961, #948, #769 → 1: #897 gate → #836, #1009 → 2: #855, #951 → 3: #880, #939 → 4: #613 → #1042), both hard edges (#897 → seed items; #613 → #1042), and the traps (no `db:check` in `prebuild`; `macrosnapshot` stays crashed as the detector's live canary per the owner's 2026-10-01 ruling) carried into #1081 §7.5.
- **Not done by this closure:** no item was executed by closing this container; every open item transfers unchanged.
- **REVERSE BY:** reopen this issue and point back — the carrying block in #1081 §7.5 is self-contained and removable.
