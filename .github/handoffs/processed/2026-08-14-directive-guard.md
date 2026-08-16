---
date: 2026-08-14
area: scoring
type: feature
---

## What Changed

Built the mechanical directive-audit guard so "completeness theater" is caught by tooling instead of manual agent review. Also documented the six recurring failure modes discovered during the `xau-speed-v1` audit, and filed the architectural follow-up issue.

1. **`nest/scripts/directive-guard.cjs`** — new audit tool. Run `node nest/scripts/directive-guard.cjs` (from `nest/`).
   - Static checks over every `implementations/*.directive.ts` / `.stub.ts` / `*.directives.ts`:
     - mode 1 confession-lint: `readiness='ready'` + /mock|not connected|connect…feed/api|placeholder|stub/ → ERROR.
     - mode 4 producer-trace: reads of `input.<field>` outside the known-writer allowlist → WARN.
     - mode 5 signalClass vs `directionBias` mismatch → WARN.
     - mode 3 constant floor: "no signal" branch returning a literal non-zero score → WARN.
   - Runtime constant-output test over `dist`: instantiates every compiled directive, runs it on two different synthetic 120-bar inputs, flags identical non-zero score+reason → WARN.
   - First run: 0 errors, 112 warnings. Surfaces mock-first stubs (`earnings-proximity`, `analyst-adjustments`, `dxy-regime`, `cad-usd-oil-correlation`) alongside legit date-driven calendar directives for manual triage.
   - Exit code 1 on ERROR, 0 otherwise. `--static-only` skips the runtime pass.

2. **`nest/src/modules/directives/interfaces/directive.interface.ts`** — added the six-failure-mode checklist as a block comment so every directive author sees it.

## Files Changed

- nest/scripts/directive-guard.cjs (new)
- nest/src/modules/directives/interfaces/directive.interface.ts (doc comment only)
- docs/backlog/directive-audit-future-work.md (updated: guard built, xau-speed-v1 audit complete, added Phase-1 plan)

## Result

- The six recurring failure modes (completeness theater, phantom denominator, constant floor, direction-blind in LONG_ONLY, signalClass semantics, data-layer defects) are now codified and partially automated.
- GH #638 filed (urgent, tomorrow): separate gates from scores to fix the "42% BUY = noise floor" relaxed-scoring problem. Phase-1 siblings: GH #627 (readiness gate in code), GH #625 (MT5 timestamps).
- `xau-speed-v1` directive audit is complete — all 11 directives CLEAN/FIXED or DELETED.

## QA Test Entry

- **area:** Scoring
- **name:** directive guard run
- **procedure:** `node nest/scripts/directive-guard.cjs` → expect a report of `[ERROR]`/`[WARN]` findings and a summary line; `node nest/scripts/directive-guard.cjs --static-only` → expect the runtime pass skipped.
- **expected:** 0 errors (all ERROR-level confessions removed with the deleted vix-regime / news-sentiment stubs); warnings listed for triage.
