## Pre-close checklist — #1079

**This closes the issue.** Findings #2 and #5 are fixed TODAY; #4 is a named deferral to #1082 (extracted previously, and re-confirmed here); #1/#3 landed 2026-10-08. The pair itself remains PARKED (row 74) — this closes the safety gaps, it does not restart the pair.

### The five findings — status and evidence

- [x] **#1 — both arms resolved one account (the netting).** Fixed 2026-10-08 (`resolveAbArmAccounts()`): each arm resolves its own account and the pair REFUSES to place anything unless the two are present and different. Guard canaried 4 ways (`ab-arm-accounts.spec.ts`).
- [x] **#2 — the bot family locked out while the pair held the symbol.** **Fixed today.** Root cause measured precisely: one provider id (`mt5`) covers several accounts, and BOTH gates scoped wider than the account — `pyramid-policy.service.ts` matched positions by SYMBOL only; `duplicate-guard.service.ts` scoped by `provider` only. Now both accept the incoming order's `accountId` and exclude only positions/trades belonging to a DIFFERENT non-empty account:
  - `pyramid-policy.account-scope.spec.ts` — 4 cases (other account: allowed; same account: blocked; null accountId: still blocks; no argument: legacy behaviour).
  - `duplicate-guard.service.spec.ts` — 5 new cases incl. the cooldown query and the null-accountId conservative rule.
  - Wired at both decide sites: `execution-feasibility.service.ts` (routed account from `resolveForOrder()` — same route the order travels) and `automation-loop.service.ts` `dispatchTrade` (`getAccountIdForSymbol()`, same resolution the adapter's `placeOrder` uses).
  - **Canaried both directions:** disabling each filter → **1 failed** in its suite; restored, hashes matched.
- [ ] **#4 — orders bypass the safety chain (cooldowns / portfolio gate).** **Not done here — DEFERRED to #1082** (the app-level order choke point). That extraction was made deliberately on 2026-10-08: a choke point is the fix, not this call site. **Owner: #1082.**
- [x] **#5 — pair positions cannot be time-stopped.** **Fixed today.** `attributeToAbArm()` recognises `TCS AB-A|AB-B <test name>`, resolves the test by name (prefix-tolerant — the composer truncates the comment at 27 chars), and reads the hold policy from the ARM'S OWN STACK SNAPSHOT (`controlStackId`/`variantStackId` JSON). Three NAMED outcomes: `ok`, `ab_no_hold_declared` (attributed, nothing declared — visible, never silent), `ab_test_unresolved`. Specs: parser + all three outcomes (`position-time-stop.service.spec.ts`). Register **row 80** + `DECISION` marker at the method.

### Verification (literal)

- `npx jest src/modules/trading src/modules/automation src/modules/providers` → **61 suites / 639 tests passed**.
- Canary (`logs/canary-1079.ps1`): both filters disabled → 1 failure each; restores verified by SHA-256.
- `node scripts/validate-decisions.cjs` → **80 register rows all with guard status, 34 markers**.
- Build deployed: `build:api` → **Build succeeded**, API restarted, `/api/health` → `status ok, database: true`.

### What this does NOT claim

- **The pair is still PARKED** (row 74). The restart prerequisites now read: arms on two distinct accounts ✅, **time-stop attribution ✅ (this change)**, #2 guard interplay ✅ (this change), **#1082** ⛔ — one item left, already open.
- `ab_no_hold_declared` means a live pair would still not be time-stopped **unless its arm snapshots declare a policy** — that declaration is data, and nothing fails today if it is missing. Stated in row 80's guard status rather than implied.
