## Pre-Close Verification

Mapped to the issue's 3 proposed-work items:

- [x] **1. Enumerate all duplicate `id`s across standalone + stub, with a guard check** — enumerated **42 duplicates** (not just the 3 named); added **MODE 6** to `nest/scripts/directive-guard.cjs` (duplicate-id detection, ERROR severity — audit fails on any duplicate).
- [x] **2. Keep the registered class, delete the dead copy** — removed 28 dead classes from `placeholder-directives.stub.ts` and 14 dead standalone files (13 MT5 duplicates whose registered copy is in `mt5-indicators.directives.ts`).
- [x] **3. Delete the dead `analyst-adjustments.directive.ts`** — deleted; the registered `ready` price-momentum proxy (in the stub) was kept. This is the near-wrong-delete case, now resolved correctly.

## Verification

- `npm --prefix nest run build` — passes.
- `node nest/scripts/directive-guard.cjs --static-only` — **0 errors** (50 pre-existing MODE 4/5 direction-bias warnings, unrelated).
- Mechanical re-enumeration — no duplicate directive ids remain.
- Runtime behaviour unchanged — only dead code removed; cleanup script kept at `nest/scripts/dedupe-directives.cjs`.
