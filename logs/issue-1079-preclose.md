## Pre-close check — the NETTING half is fixed and live; the issue STAYS OPEN

⚠️ **This issue is NOT being closed.** Two of its five findings are untouched, so the checklist rule
(*"if ANY `[ ]` remain, the issue stays OPEN"*) keeps it open. Recording what changed and what did
not, with the commands.

### The five findings in the issue body

- [x] **#1 — No duplicate guard / one account shared by both arms.** The runner resolved ONE account
      for both arms: `const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5')`.
      **Measured** against the live snapshots of `b50727ee`
      (`SELECT JSON_EXTRACT(snapshot,'$.brokerId') FROM metastack_snapshot WHERE id IN ('038d897c…','3c299cec…')`)
      → **both `'mt5'`**. That is *why* the broker nets them. Now fixed: each arm resolves its own
      account and the pair **refuses to place any order** unless the two are present and different.
- [x] **#3 — The path stacks orders into one position.** The same root cause as #1: one account can
      only ever hold one netted position. Not a separate defect, and not separately fixable.
- [ ] **#2 — The bot family is locked out while the pair holds the symbol.** ⚠️ **NOT DONE, and
      correctly so** — this is a property of `duplicate-guard.service.ts`, which counts any open
      position for `symbol + provider`. With the pair refusing to run under the shipped
      configuration the lockout cannot occur *yet*, but the guard is unchanged and would still fire
      the moment two real accounts exist. Left open deliberately.
- [ ] **#4 — The orders bypass the safety chain** (cooldowns, duplicate guard, diversification,
      portfolio-risk gate). ⚠️ **NOT DONE.** The fix is the app-level order choke point, not this
      call site. Extracted to **#1082**.
- [ ] **#5 — The positions cannot be time-stopped.** ⚠️ **NOT DONE.** `position-time-stop.service.ts`
      attributes by exact strategy-name match on the broker comment; `TCS AB-A …` matches no bot.
      The attribution key is its own decision. Still owned here.

### Evidence the fix is real

- [x] **Guard canaried in BOTH directions, 4 ways**, tree verified byte-for-byte on every restore
      (`logs/canary-1079-arm-accounts.ps1`): restoring the shared resolution fails the source guard ·
      deleting the same-account refusal fails 2 tests · dropping the trim fails 2 (so `' mt5 '`
      cannot pass as a distinct account) · handing both sides account A fails the source guard.
- [x] **8/8 tests pass**; `src/modules/automation` is **20 suites / 230 tests, all passing**.
- [x] **The guard was narrowed twice, and both times because it was observed firing on something it
      does not own** — first its own explanatory comment, then the BOT's unrelated
      `strategy.brokerId || 'mt5'`. Recorded because a guard that fires on unrelated code gets
      allowlisted, and an allowlisted guard is worse than none.
- [x] **Register row 67** written, citing **row 23** (the settled subjects guard requires the
      citation); `validate-decisions.cjs` → **67 rows, all with a guard status, 22 markers, no
      un-cited settled subject.**

### What this does NOT claim

⚠️ **It does not make the live pair measurable.** Row 26 stands: the measurement is the **BACKTEST**,
and the live pair keeps its LOCK as the final confirmation step. This is the precondition for that
confirmation to be *safe*, not a route back to measuring live.

⚠️ **It enforces the "distinct" half of the owner's wording, not the "viable" half.** The check
requires two present, different, non-blank account names. It does **not** verify that either can
trade the pair's symbol — that needs an account record (**#1078**), and the owner has already
measured that *"both current accounts … will not trade the same symbols on each"*, so it is a
per-symbol question rather than a name check.

⚠️ **A side-finding, measured but not filed.** The duplicate guard scopes its open-position check by
`provider` (`where: { symbol, provider: brokerId }`) but its recent-trade cooldown check by `symbol`
only — so two accounts do not fully isolate cooldowns. No new issue filed: the owner is holding the
backlog down, and #1079 already owns this guard's account behaviour.

### Build / environment gate

- [x] `validate-notices.cjs` — **OK**, and the ratchet went DOWN (10 raw renders in 5 files → **9 in
      4**). One standing blocker removed: `HealthDashboardPage.jsx`'s last raw error render migrated
      to `noticeFromError()`, which preserves the server's wording as `detail`.
- [x] `docs/PIPELINE-MAP.*` regenerated (a new `src/` file stales it, and it fails `prebuild`).
