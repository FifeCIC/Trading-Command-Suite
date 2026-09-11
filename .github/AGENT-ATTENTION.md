# Agent Attention Board

Items needing human attention. Agents: read this at session start. Append confirmed blockers below.

---

## 2026-09-11

### ✅ NOT A BUG — bar gaps after a bridge restart are EXPECTED (do not re-investigate)

- **#795 was filed `priority-high` and closed as NOT-A-BUG within the same session.** A 15-minute bar
  gap across 29 of 30 `5m` symbols looked like a feed fault. **It was a bridge restart caused by
  development activity** (`build:api` cycles the bridges; both bridge logs end at `20:52:03`, and the
  gap starts `20:55`).
- **It self-heals.** Coverage refilled over successive refresh cycles (0 → 5 → 10 symbols). `1m`/`5m`
  refreshes fetch **200 bars**, i.e. **16.7h at 5m** — far more history than any development gap, so a
  normal re-fetch refills it. **Nothing needs building to obtain the data.**
- **Residual difference is per-broker catch-up rate**, not data loss: broker 2 (MetaQuotes) refilled
  4/4; broker 3 (Pepperstone) 0/5 at the same moment.
- ⚠️ **Before filing a data-gap issue, check the cheapest falsifier first:** the last lines of
  `scripts/mt5-bridge/bridge-broker*.log`. One file read. Do **not** infer from the pattern alone.
- **`INV-BAR-ORDER` now tells the two apart:** it fails only if bars **exist** between the arena's
  `asOf` and the newest bar (a real scoring defect, #751) and **passes with a note** when no bars exist
  (a data gap). Proven in both directions.
- **Agent:** Copilot (2026-09-11)

### 🚨 ~~NEW DEFECT~~ RESOLVED — bar gap was a bridge restart, not a defect

- **Superseded by the entry above.** Kept for one revision so anyone who read the original alert sees
  the correction rather than a silent disappearance.
- **Original claim:** *"15-minute gap across 29 of 30 `5m` symbols (NOT yet diagnosed, priority-high)."*
- **Actual cause:** a **bridge restart** at `20:52:03` from development activity. The gap **self-healed**.
- **#795 closed as NOT-A-BUG.** The over-filing is the lesson: I inferred from the *pattern* (many
  symbols, simultaneous) without checking the *cheapest available evidence* (the bridge log).
- ⚠️ The `INV-SINGLE-CADENCE` false positive found in the same run **was** real and is fixed — it
  flagged AUDUSD's 5 per-timeframe protocols as mixed-cadence, which is correct by design (#751).
- **Agent:** Copilot (2026-09-11)

### 🚧 GATE 3 IS NOW AUTOMATIC — `INV-SEED-DB-CONSISTENT` (state, not just code)

- **New check in** `nest/scripts/contract-probe.cjs`. Ask it before touching anything seed-related:
  **does the running database agree with the config that describes it?**
- **Why it was needed:** the seeder is **UPSERT-ONLY**, so a removal/move in the seed is a **silent
  no-op** in the DB, and re-seeding **cannot** converge them. Measured: `seed 419 / database 449 /
  **30 ORPHAN**`. `rsi-overbought` was 28 of them — a `bearish`, 140-point directive left live in 28
  `LONG_ONLY` protocols, silently lowering the reachable ceiling by **3,920 points** (#792).
- ⚠️ **The diagnostic lies:** the seed endpoint returns `entries: N` counting rows **UPSERTED**, not
  rows that **EXIST**. It reads exactly like a successful removal. **Never trust it as proof.**
- **Proven to bite:** removing one seed placement makes the probe FAIL and name the protocol
  (`btc-speed-v1: seed 13 vs db 14`).
- **Current state:** `drift: 0` — 47 protocols, 419 placements both sides. Full comparison:
  `node scripts/diff-seed-vs-db.cjs` (repo root).
- **Never** `prisma db push` to "fix" drift — it drops 10 raw-managed tables incl. the trade
  execution queue (#769).
- **Agent:** Copilot (2026-09-11)

### 📌 Handoff location changed — `docs/handoff/` ONLY

- The canonical handoff directory is **`docs/handoff/`**. `.github/handoffs/` was **REMOVED** — handoffs
  had been split across both, and **four cited here became unfindable** (only one recoverable from git;
  three were never committed). `scripts/validate-agent-docs.cjs` now **fails the build** if it reappears.
- ⚠️ **Handoffs are NEVER deleted.** The old process said the Librarian deleted each one after
  processing — **that is what destroyed the project's memory of *why*.** The Librarian *summarises*
  into the QA page / Capability Map / Architecture Framework and **leaves the handoff in place**.
- **Agent:** Copilot (2026-09-11)

### 📋 Settled decisions now have a register — read before re-opening an area

- **`docs/SETTLED-DECISIONS.md`** — 10 settled decisions with guard status 🟢/🟡/🔴. The 🔴 rows are
  the ones that **will** be re-opened.
- **The measured problem it addresses:** #638 settled "separate gates from scores" on 2026-08-16 and
  was closed with a checklist ticking *"flat constants removed"* — yet `ENTRY_THRESHOLD = 40` is still
  live. **A checklist box is a claim; a build-time guard is a fact.** #789/#790 re-found the same class
  **26 days later**.
- **Check first:** `node scripts/detect-circular-work.cjs <topic>` — if it shows both CLOSED and OPEN
  issues, you are probably **re-opening** something.
- Row 9 (the `directionBias` capacity test) is now 🟢 — guarded by
  `directional-capacity-contract.spec.ts`, **proven to fail** (2/5) when the reverted bug is injected.
- **Agent:** Copilot (2026-09-11)


## 2026-09-10

### 🧹 Dead code removed + Capability Map now has a failure mode
- **Deleted:** `predictive-scoring.service.ts` (stub baseline returning 0, expired `SEED_CALENDAR`,
  nothing consumed it — `GET /api/scoring/predictive` is now **404**, do NOT restore it from git;
  if forward-looking scoring is wanted, build it on `earningsEvent` and the canonical score unit)
  and `multi-timeframe-scorer.ts` (zero references; its output was a **[-1,+1]** fold, not the
  platform `[0, maxScore]` unit — wiring it up would reintroduce score-unit confusion).
- **Contract gate whitelist is now EMPTY (0 deviations).** The list is debt and only shrinks.
- **Handoff location changed (2026-09-11):** the canonical directory is **`docs/handoff/`**. The old
  `.github/handoffs/` directory was REMOVED — handoffs had been split across both, and four cited
  here became unfindable. `scripts/validate-agent-docs.cjs` now fails the build if it reappears.
  **Handoffs are never deleted** (the old process said the Librarian deleted them after processing —
  that is what destroyed the record of *why*).
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
  data.
  ⚠️ **HANDOFF LOST** — written to `.github/handoffs/` but never committed, and that directory
  was removed 2026-09-11. The reasoning survives in the contracts doc instead: `INV-BAR-ORDER`
  and `INV-BAR-WINDOW` in `.github/instructions/meta-stack-contracts.instructions.md`.
- **MT5 server clock (#750):** bridge timestamps are broker SERVER time; `utc_iso()`
  subtracts a measured offset. Do not re-add `Z` to a raw epoch. Handoff:
  `docs/handoff/2026-09-10-mt5-server-clock-skew.md` (recovered from git 2026-09-11)

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
  protocol. ⚠️ **HANDOFF LOST** (never committed; `.github/handoffs/` removed 2026-09-11) —
  the reasoning survives as `INV-SINGLE-CADENCE` and `INV-CADENCE-COVERAGE` in
  `.github/instructions/meta-stack-contracts.instructions.md`.
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
