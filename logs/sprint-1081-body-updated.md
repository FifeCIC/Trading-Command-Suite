# Sprint: Scoring & position-monitoring fault burndown

**Owner direction, 2026-10-07:** *"Check if there are any github issues related to fixing faults relating to scoring or monitoring existing positions and create a sprint. No limits on the size of the sprint. This might be the final burndown for these areas before we enter a more careful development... the app seems to open at the worst times and most positions go into the red then close. I'm hoping there is outstanding research results to be applied. After that it's going to be a case of examining strategies one at a time far more carefully."*

**This sprint exists so the strategy-by-strategy review starts from a system that is not known-broken.**

## The complaint, in numbers (baseline — measured 2026-10-07)

| Measure | Value | Source |
|---|---|---|
| Closed ledger | 268 trades · 124W / 144L · net **−£786.27** | `trade` (pnlInvalid=0) |
| Realised payoff | 0.448–0.54 against a declared 1.0–2.0 | #916 / #1059 |
| Take-profit closes | **ONE in 377** | #1059 |
| Gold family | 22 closed, mostly stop exits; net −£483 incl. one 10-row booking | audit, #1080 |
| Entry timing | gold LONG_ONLY through a 4291→4119 (−4%) slide; M5 held at "Signal below 9% (8.x%)" | audit 2026-10-07 |

## How this sprint is worked

- One fault per issue; each closes with the pre-close checklist plus a canary that fails without the fix.
- Maths changes carry an A/B copy (`maths-change-requires-ab`), never an in-place edit.
- ⚡ marks the strongest measured money-path impact.
- Done = the lists below are closed or explicitly deferred with a reason, and the baseline table above is re-measured.

## 1. Scoring faults — the number is wrong, starved, or fabricated

- [x] #758 ⚡ Signal denominator (rawMax) flips per tick and collapses to 0 — phantom HOLDs, protocols silently stop scoring
- [x] #761 ⚡ Conviction lost in composite assembly — percentages peak ~23% while ~44% is reachable
- [ ] #915 Signal strength measures breadth, not conviction (capped ~11–44% by construction)
- [ ] #766 Directives can fabricate scores (analyst-adjustments invented a floor) — build guard
- [ ] #999 ⚡ 8 of 11 gold directives permanently neutral — 90% of the m15 denominator unreachable
- [ ] #1013 btc-speed-v1: 4 of 13 directives starved to 0 on 99.6% of ticks
- [ ] #1077 supertrend does not compute SuperTrend — bands from one bar
- [ ] #1075 atr-trailing-stop is permanently inert — four branches unreachable
- [ ] #996 Index protocols score under 6×/hour on a declared 5s–30s cadence
- [ ] #879 12 calendar-effect directives assert unmeasured date biases
- [ ] #803 (+ #802 duplicate) Inactive protocols still score via SpeedScanService
- [ ] #775 BOTH protocols can only emit BUY — a boolean for a three-state direction
- [ ] #760 Index protocol ceilings — needs live verification
- [ ] #733 Directive outcome learning loop is dead code
- [ ] #735 / #736 META.Stack: HTF bundle at 12 remaining call sites; asOf clock plumbing
- [ ] #1069 Signed profit % exists 4 times, and two copies disagree

## 2. Entry, timing and dispatch faults — "opens at the worst times"

- [ ] #850 ⚡ Market-open gate uses the US calendar for EVERY symbol
- [ ] #1088 **NEW (2026-10-08)**: the FX venue has NO holidays — every index CFD, metal and FX pair reads as OPEN on Christmas Day (a Friday in 2026). Same family as #850
- [ ] #981 / #982 Session windows: audit every bot; make the slot declared (4 city twins measured 2026-10-06)
- [ ] #972 ⚡ Valid signals refused because a quote is missing — VIX 23/day, GER40 15/day
- [ ] #835 (+ #836) Trade size: one global number vs per-instrument floors; no seed path
- [ ] #725 Adaptive entry gate — per-protocol learned ceiling
- [ ] #943 Trader controls: notional cap, posture, pyramid, strict-SL override
- [ ] #956 The "no subscribed bot" half of untradeable scoring (market-closed half shipped)
- [ ] #1079 ⚡ NEW (audit 2026-10-07): the A/B path bypasses the duplicate guard / cooldowns / portfolio gate — and its positions cannot be time-stopped. **Live recurrence measured 2026-10-07** (B-leg destroyed as exit-unknown 1m53s after open; ~64 rejected rows in 50 min; gold bots duplicate-blocked) — see the issue's comment; **decision needed on the running pair**

## 3. Position monitoring and exits — "go into the red then close"

- [x] #916 ⚡ **[RE-MEASURED 2026-10-08]** capture is **16.9%** of target (not a third); realised payoff **0.586**; of the 125 winners, 66 are `broker:terminal` at a 2.04 move (the owner's own bulk closes, R46 — **the actor IS named**) and 29 are `system:time-stop` at a 0.58 move. The remaining live gap is the broker-3 deal blindness → #1089
- [ ] #1089 ⚡ **NEW (2026-10-08)** Every close on a broker-3 symbol is `broker:unknown` — **48 of 48** (VIX/GER40/FRA40/US30/UK100/XAGUSD). `getDeals()` asks only the primary bridge (:5000), so the closing deal is never read and the row keeps the SNAPSHOT price/pnl (GER40: stored −7.19 vs real deal −8.18, reason 4 SL). **Code fix + 3 guarding tests + canary (2 failed mutated / 8 passed restored) landed 2026-10-08**; the repair of the 48 stored rows is the open part
- [x] #998 Durable peak + give-back (4 positions gave back profit and closed red)
- [ ] #1066 Time-decaying trail distance — the behaviour half
- [ ] #979 / #978 Give-back tracking tiers 1 & 2
- [ ] #995 Guardian detects exhaustion on the way DOWN but never on the way UP
- [ ] #1056 FRA40: zero stop_adjustment rows ever — no post-entry management recorded
- [ ] #1038 One notification per stop edit
- [ ] #871 Ticketed open trades unreachable by BOTH reconcilers
- [x] #1080 ✅ **FIXED 2026-10-07** — split forced for multi-order positions; live repair done (pile re-summed −322.67; backup `trade_repair_1080_backup`); canary observed both ways; register row 43 + audit note updated
- [ ] #1048 → runs under #1051: hold limits (entry timestamp as backup, dynamic hold for profitable positions)
- [ ] #1037 Position management interface — one screen for every open position
- [ ] #1015 Trade-outcome statistics — give-back distribution, score overlay (the measurement surface)
- [ ] #1008 / #963 / #952 A/B: stoch-rsi comparison not started; pair LOCK; runner reachable from the UI

## 4. Data and contract faults feeding the above

- [ ] #1068 ⚡ Bar refresh FABRICATES bars — 1,172 rows while the market was shut
- [ ] #1085 **NEW (2026-10-08)**: the bridge's quote carries no trade time — a STALE quote is indistinguishable from a live one (absent refuses, stale is silently used)
- [ ] #1070 Bar retention declared 60d, not applied; too shallow for btc-halving
- [ ] #1049 MT5 daily-bar import writes Friday repeating Thursday (166 rows, 29 symbols)
- [ ] #837 No invariant detects duplicate-bucket bars
- [ ] #976 A schema column is not live until prisma generate runs (bit #894)

## 5. Outstanding research results waiting to be applied

From the theory registry (`src/data/theories.js` — /development/theory-registry) and the docs-store theories:

- [ ] `most-scoring-is-on-untradeable-symbols` (testing) — the "no subscribed bot" half is NOT gated (#956); the 85% vs 33% disagreement must be re-measured before any quote
- [ ] `group-weights-weight-the-composite` (refuted) — "not applied" labels shipped; MAKING the weights real is #718, a maths change
- [ ] `weight-strategy-selects-denominator` (refuted) — declared inert; wiring it is a maths change
- [ ] #820 Is the LONG side unprofitable — direction problem or directive problem?
- [ ] #817 Per-protocol edge test vs base rate (CONFOUND TEST) — does any protocol beat drift?
- [ ] #685 Signal % ceilings — why composites rarely exceed ~40–50%
- [ ] #851 Session / market-hours consolidation — three files claim to be the source of truth
- [ ] Docs-store theory files (timeframe-directive-importance-matrix; speed-day-trading; PROTOCOL-THEORY) — turn each into registry entries with falsification tests where not already held

## 6. Consumed sprints — folded in 2026-10-07 (owner direction)

**Owner, 2026-10-07:** *"Did that new sprint consume the five sprints already open? I would like it to."* **Yes — as of this edit.** The five are closed as CONSUMED, not completed: every open item was carried into this issue (§7). Still separate: **#960** (Strategy establishment), **#930**, and the tracking/epic parents (**#816**, **#823**, **#910**, **#776**, **#779**, **#934**).

Consumed: **#1059** (Exit integrity) · **#1060** (Fault containment) · **#1051** (R29) · **#965** (A/B measurement) · **#1043** (S10 schema/seeds).

## 7. Carried from the consumed sprints

### 7.1 From #1059 — Exit integrity

- Its measured baseline is this sprint's exit baseline: payoff 0.54 · win rate 46.6% · net −663 (2026-10-01); closeReason since 09-18: 63 terminal / 72 unknown / 52 time-stop / 29 sl / 14 reconciled / **1 tp**.
- Items carried: **#916** (→§3) · **#998** (→§3) · **#1056** (→§3) · the 10 `#1058`-damaged rows (investigate/repair or state why not).
- Definition of done carried: the actor closing winners is **NAMED** with `closeReason`/`stop_adjustment`/log evidence; realised payoff is reported **per bot beside win rate** (#916 item 3 — a rating defect); every claim carries its command and output.
- **[2026-10-08 — correction]** The actor for the 93 `broker:terminal` rows **is named**: the owner's own manual bulk closes (R46), which stopped 2026-10-02; the deal-reason mapping now reports an unstamped CLIENT/MOBILE/WEB/EXPERT close as `user:manual` (`close-reason.ts`). The remainder is accounted for exactly: of the 50 `broker:unknown` rows with valid P&L, **34 are the broker-3 blindness (#1089)** and **16 are XAUUSD A/B rows** (#1079/#1080 threads).

### 7.2 From #1060 — Fault containment

- [ ] #1036 **A reconnect on ONE bridge can take down EVERY bridge** — and two watchdogs POST it unattended. Start here; #1046 is blocked on it
- [ ] #1035 `POST /reconnect` can bind a bridge to the **WRONG MT5 account** and still report success — **do with #1036, not separately**
- [ ] #1046 Unattended recovery stays OFF until the blast radius is isolated
- [ ] #972 (also §2) Valid signals refused because a quote is missing — VIX 23/day, GER40 15/day
- [ ] #1049 (also §4) Friday duplicate daily bars
- Note carried: taking a bridge down to reproduce #1036 is sanctioned (demo); say so in one line when you do.

### 7.3 From #1051 — R29: instrument form & advanced exit management

- [ ] `instrumentForm` exists on `symbol` (cfd | spot | cash | future | option); `symbol.type` documented as the *underlying*
- [ ] Directive `instrumentTypes` is **READ** by the activation gate (declared in 118 places, branched on ZERO) — canary proves it fires
- [ ] Protocol carries a real declared form; the `inferProtocolSymbolTypes()` guess is retired
- [ ] Bot carries a form; a protocol↔bot mismatch is a config warning **and** an execution refusal
- [ ] Exit path documented as a **chain of checks** with per-bot settings; risk management is a member of it; each stage logs its decision to the DB
- [ ] Every exit decision is visible on the bot detail view
- [ ] Session calendar resolves the correct market close per symbol, in the correct timezone
- #1048 runs here (hold limits + override + overnight prompt — R29.3); related #1047, #646

### 7.4 From #965 — A/B measurement (order preserved)

- **DIRECTIVE CARRIED: do NOT build a live-pair measurement.** Measured 2026-09-23: two bots on one symbol merge into ONE position (three XAUUSD orders → one vol 0.04 position; side rows left `exit-unknown`). ⚠️ This is the same netting measured again in #1080 (one position → 10 booked rows) and reported in #1079 (safety/management). The live pair keeps its LOCK (#963) and is **final confirmation only** — the measurement is the **BACKTEST**.
- Order of work (do not reorder): (1) **sample bar on `runs/compare`** — refuse `best` below a stated per-side count, `insufficient-data` with counts; canary both ways · (2) `compare` vs `run` disagreement — find which is right · (3) backtest a BOT (`botId`; read #843 first — 4 sizing models vs 1) · (4) pair comparison via the two protocols (`derivedFrom` already exists) · (5) **#819 replay view** (already requested — build it) · (6) #962 rename.
- Do NOT create another sprint/epic for this (#816 is the epic, #823 the workstream).

### 7.5 From #1043 — S10: schema, seeds & data hygiene (phases and hard edges preserved)

- Phase 0 instruments: **#961** (`db:check-tables` + status surface — live canary: `macrosnapshot` is corrupt; owner ruling: leave it crashed) · **#948** (column-level drift, both directions) · **#769** (DDL discipline + migration-baseline decision)
- Phase 1 seed contract: **#897 HARD GATE** (which seed file executes — measure, don't infer) → **#836** (`global_setting` seed path — decision) + **#1009** (broker-3 `brokerSymbol NULL` + guard; seed-first)
- Phase 2 config ownership: **#855** (old-scale threshold pair — retire-or-wire DECISION, not a value edit) · **#951** (terminology; must land before #1042)
- Phase 3 data correctness: **#880** (Sun–Thu bar labels) · **#939** (served set ↔ table reconcile; slug guard)
- Phase 4 structure: **#613** (MyISAM→InnoDB; crash-recovery observed) → **#1042** (reference-data layer) — hard edge: a MyISAM table SILENTLY discards a FK
- Traps carried: do NOT put `db:check` in `prebuild`; nothing in Phase 1+ before #897; #897 → seed items and #613 → #1042 are hard edges.

## First pass — proposed order

1. **#1080 + #1079** — the audits' own gaps; they corrupt the numbers everything else is judged by
2. **#758, #999, #761** — scores that cannot produce actionable output
3. **#1089, #1056** — exits and give-back (#916 re-measured 2026-10-08; #998 done)
4. **#850, #981/#982, #972** — entry timing
5. **#965 §7.4 item 1** (sample bar on `runs/compare`) — small, fully specified, unblocks trustworthy comparisons for the strategy reviews
6. Everything else in list order, ⚡ first

