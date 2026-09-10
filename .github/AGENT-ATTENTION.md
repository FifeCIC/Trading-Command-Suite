# Agent Attention Board

Items needing human attention. Agents: read this at session start. Append confirmed blockers below.

---

## 2026-09-10

### 🧹 Dead code removed + Capability Map now has a failure mode
- **Deleted:** `predictive-scoring.service.ts` (stub baseline returning 0, expired `SEED_CALENDAR`,
  nothing consumed it — `GET /api/scoring/predictive` is now **404**, do NOT restore it from git;
  if forward-looking scoring is wanted, build it on `earningsEvent` and the canonical score unit)
  and `multi-timeframe-scorer.ts` (zero references; its output was a **[-1,+1]** fold, not the
  platform `[0, maxScore]` unit — wiring it up would reintroduce score-unit confusion).
- **Contract gate whitelist is now EMPTY (0 deviations).** The list is debt and only shrinks.
- **Capability Map:** its `status` column was a **hardcoded `'ALPHA'` literal on every row**, so it
  could not express a deleted capability — that is how two dead services stayed listed as live. Now
  data-driven with a grey `UNASSESSED` fallback, and a new `checkCapabilityRegistry` gate fails the
  build on a capability marked `STUB`/`DEPRECATED`/`REMOVED`/`DELETED` while still registered.
- **Sector rotation labels corrected (#756):** `1 Day/1 Week/1 Month` → `Last hour/Last 5h/Last 21h`
  (they are positional offsets over 1h bars) plus a coverage caveat. JSON keys unchanged.
- **Agent:** Copilot (2026-09-10) — handoff: `2026-09-10-dead-code-removal-and-capability-integrity.md`

### ⚠️ Pre-existing broken typecheck (NOT mine, left alone)
`nest/src/modules/scoring/score-history.service.ts:267` references undefined `groupBy` — the local
is `groupMode` (set L209) → `TS2304`. File has uncommitted in-flight edits from another agent. Left
untouched deliberately; flagging so it is not lost.

### 🚧 BUILD GATE: pipeline contracts are now enforced — read before changing bars/time/scoring
- **New:** `nest/scripts/validate-pipeline-contracts.cjs` runs in `prebuild`, so it gates every
  backend build and every CI run. It is **zero-tolerance** — no warning budget. It checks that
  canonical mechanisms still exist, that no banned pattern has appeared, and that every invariant
  has a QA entry.
- **Canonical list:** `.github/instructions/meta-stack-contracts.instructions.md` — the ONE owner
  of the invariants (`INV-*`). Other files link to it; do not re-state invariants elsewhere.
- **Boundaries:** bars → `market-data.service.ts getBars()` · cadence →
  `common/utils/timeframe.ts selectBaseTimeframe()` · bar order →
  `directives.service.ts normalizeDirectiveBars()` · tradability → `directives/market-status.ts`
  · MT5 time → the bridge's `utc_iso()`.
- **Runtime probe:** `node nest/scripts/contract-probe.cjs` (live API + bridges + DB) —
  currently 6 passed, 0 failed, 0 skipped.
- **If the gate fails on your change:** you have either broken a mechanism or added a second way of
  doing a settled job. Fix it or raise the question — do **not** add your file to the `WHITELIST`.
  A stale whitelist entry fails the build on purpose, so the list can only shrink.
- **Debt it found on day one:** #754 (four more hand-rolled bar windows, two confirmed oldest-N
  bugs) · #755 (predictive scoring on a stub baseline + expired seed calendar).
- **Agent:** Copilot (2026-09-10) — handoff: `2026-09-10-contract-enforcement.md`

### ✅ #750 + #751 CLOSED — live-verified 2026-09-10 10:55–10:57Z
- Bridge clock fix deployed on **both** instances (`serverUtcOffsetSeconds: 10800`); 234,999 stored
  timestamps repaired DST-aware; 0 future-dated rows remain.
- Directive bar order enforced at the boundary, and **both** remaining hand-rolled
  `prisma.marketBar` queries replaced with the canonical `MarketDataService.getBars()` loader.
- Live proofs: stale `BTCUSD` now reads `open: false` (`last real bar 77516m old`) where it read
  `open: true` before; arena `marketStatus.asOf` matches `marketbar` exactly per cadence;
  arena/ladder parity `157 × 0.61 = 96`.
- **Do not revert any of it** — the two handoffs below explain why each "simplification" reintroduces
  silent mis-scoring. Guards live in `shared-core.instructions.md` and
  `development-status.instructions.md`.
- **Follow-up closed (2026-09-10 11:02Z):** the recorded gap "no alerting hook on `/health`" is gone.
  `AlertTriggerService` now has a `bridge-clock-skew` trigger — a bridge `/health` without
  `serverUtcOffsetSeconds` (pre-#750 build) raises a **critical** alert, and an implausible
  offset (>±14h) raises **high**. Verified live: trigger ran, 0 clock alerts stored while an
  unrelated earnings alert was stored in the same cycle. A healthy `+3h` offset stays silent by
  design — do not "fix" that into an alert.

### 📄 Development status: PRE-RELEASE, NO USERS — read before planning work
- **New instruction file:** `.github/instructions/development-status.instructions.md` (`applyTo: "**"`).
- **Why it exists:** agents were about to spend time on before/after comparison work for a
  scoring change. There are **no users**, so there is nothing to be backwards-compatible
  with: no comparison harnesses, no compat shims, no migration scripts, no "preserve old
  behaviour" flags. Break freely, update callers in the same pass.
- **Exception:** anything that can move money or place/manage orders keeps production care.
- The file also holds the **scope rule** (find the planned series before implementing;
  raise it if the change is outside one) and the **do-not-revert invariant list**.
- **Agent:** Copilot (2026-09-10)

### ⚠️ Two verified fixes — do not revert or "simplify" without reading the handoffs
- **Bar order/window (#751):** bar arrays must reach directives **oldest → newest**. "Newest
  N bars" is `desc + take` **then reverse** — `asc + take` returns the OLDEST N. Two
  hand-rolled queries had bypassed `MarketDataService.getBars()` (the canonical loader) and
  both lost the `timeframe` filter; 34 data-rich symbols were being scored on ~4-month-old
  data. Handoff: `.github/handoffs/2026-09-10-bar-ordering-and-window.md`
- **MT5 server clock (#750):** bridge timestamps are broker SERVER time; `utc_iso()`
  subtracts a measured offset. Do not re-add `Z` to a raw epoch. Handoff:
  `.github/handoffs/2026-09-10-mt5-server-clock-skew.md`

### ✅ RESOLVED — arena cadence (#751, 2026-09-10)
- **Decision taken:** cadence resolves **per protocol** from `recommendedTimeframe`, via a
  shared `selectBaseTimeframe()` + the canonical `MarketDataService.getBars()` loader.
- **Why it was safe to decide:** the design already existed — 6 modules were already using
  it, and protocols are already per-timeframe by design (`xau-speed-m5` / `m15` / `1h` / `4h`).
  The Arena and `ScoringService` were the only two sites hand-rolling bar queries, and both
  had therefore lost the `timeframe` filter. Nothing new was invented; two duplicates were
  deleted.
- **Measured before/after:** 35 of 187 symbols were fed a mixed-cadence array (AUDUSD's
  window spliced `5m, 15m, 1h, 4h`). Now 100 × `5m` for a 5m protocol, 100 × `1d` for a 1d
  protocol. See `.github/handoffs/2026-09-10-bar-ordering-and-window.md`.
- **Verification:** 227/227 backend tests (43 suites), typecheck clean. Live re-check needs
  a rebuild (no restart forced — parallel agents share port 3201).
- **Agent:** Copilot (2026-09-10)

---

## 2026-07-22

### MT5 bridge order placement — diagnosed + code-fixed (2026-08-16)
- **Root cause of "POST /order returns null":** (1) the NestJS adapter swallowed the bridge's real error and returned a generic "Bridge unreachable"; (2) the bridge `/order` path never called `symbol_select()`, so `order_send` could fail with "No prices" even when the market was open; (3) the margin check compared full-lot `margin_initial` against `margin_free` without scaling by `volume`.
- **Fixed:** all three. Bridge now selects the symbol + scales margin by volume; the adapter now surfaces the bridge's error (e.g. "No prices", "Insufficient margin").
- **Current state:** risk limits verified live (volume 5.0 → rejected "exceeds max position size 1.0"). A real order still returns `{"error":"No prices"}` because the market is CLOSED (weekend). Re-verify a live round-trip after Sunday ~21:00 UTC open.
- **Affected issues:** #446 (Phase 5 E2E test), #470 (UI Verification), #471 (E2E Trade Test) — live order verification pending market open.
- **Agent:** DeepSeek (2026-08-16)

### Portfolio P&L mismatch: MT5 positions excluded — RESOLVED (2026-08-16)
- **What was wrong:** `PortfolioService.getPortfolio(source)` ignored the `source` param and always fetched Trading212 only.
- **Fix:** `getPortfolio()` is now source-aware. It resolves adapters via `AdapterFactory` (`source=all` → trading212 + mt5), fetches positions + accounts in parallel, merges and tags each position with `broker`, sums cash across accounts, and reports provider `"Trading212 + MT5"` for `all`.
- **Verified:** `source=all` → 13 positions (9 T212 + 4 MT5), provider `"Trading212 + MT5"`, P&L −61.09; `source=mt5` → 4 positions P&L −4.65; `source=trading212` → 9 positions P&L −56.48.
- **Affected issues:** #446 (Phase 4: portfolio P&L matching) — aggregation side done; end-to-end P&L sign/currency reconciliation still pending market open.

### directiveoutcome table: 2.59M rows, exceeds 3-day retention
- **What:** DB retention critical. 2.59M rows, oldest data older than 3-day target.
- **Verified:** `GET /api/system/health-summary` → "🔴 DB retention critical: directiveoutcome"
- **Affected:** Data retention cron should gradually prune. Monitor over next 24h.
- **Agent:** DeepSeek (2026-07-22)
