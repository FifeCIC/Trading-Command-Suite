## Sprint #1102 complete — Result integrity: the pre-slowdown clear-out

Every box is ticked. Sections A, B and C closed as follows.

### A — fixes (7 items + 1 extra)

| # | Outcome | Evidence |
|---|---|---|
| **#1099** | Maturation queue drains: 5-min tick, bounded multi-pass (1500 rows/tick, batch size unchanged for pool health) | Live: `visited 1500, filled 1500, finalised 1500 in 6 pass(es) — backlog 90011 -> 88511`; frontier moved; 14/14 specs |
| **#1100** | Journal stats fabrication DELETED (not re-derived; canonical = `/api/scoring/edge/pnl`) | Live: `/api/journal/stats` → 404, entries `[]`, edge/pnl 200 |
| **#866** | Bridge wedge containment + supervision; timeout = TCS-TRADE-022 "outcome unknown" | Canary: busy health → `WEDGE … run 23s` → exit 75 → relaunch → healthy ~30s. Live kill: recovery in 12s. Breaker spec + canary. TWO extra defects found by the canary (/health blind to the monitor; `self.path` AttributeError) fixed too |
| **#1035** | Wrong-account binding — verified live (code landed 2026-10-02) | Canary: mismatch named on /health (`orderReady:false`), `/reconnect` → `account-mismatch`, order → TCS-TRADE-021 refusal before `order_send` |
| **#1079** | Account-scoped gates + AB time-stop attribution | 61 suites/639 tests green; both filters canaried (1 failure each when disabled); register row 80 |
| **#837** | Proposed invariant REFUTED by measurement; informational counter shipped; `LEAD_FOR` reconciled | Canary 589→590→589; 1,797 false pairs/3d for the proposed rule |
| **#1087** | Full-suite build gate | `prebuild` runs 180 suites/1,697 tests/23.8s; visible inside a real build; build succeeds |

### B — close-outs

- **#1089** — 6/6 real close reasons live, canaried (2/10 fail → restore).
- **#871** — ticketed orphan reconciled (~2 min), 154 tests.
- **#1081** — closed by consolidation (R29 → #1103); baseline re-measured: 313 closed trades, −£1,144.63.

### C — build gate

- **#1087** — decided and implemented: FULL suite (the cheaper named subset would NOT have caught `import-bars-alignment`, which is not a trading module).

### Verification totals

- Full jest suite: **180 suites / 1,697 tests / 23.8s — green**, now blocking builds.
- Three canary scripts (`logs/canary-866.ps1`, `canary-1079.ps1`, `canary-837.ps1`) — each mutates, observes the failure, restores, hash-verifies.
- Decision register: **80 rows**, all with guard status; 34 DECISION markers; validator green.
- Builds deployed: `0.123.0` throughout the sprint; the version bump for the batch rides the commit.

### Honest notes

- #1079's #4 (A/B orders bypassing the app-level choke point) remains **deferred to #1082** by explicit extraction — named, not dropped.
- `ab_no_hold_declared` means a future live pair is time-stoppable only if its arm snapshots declare a policy — the declaration is data; this is recorded as row 80's 🟡 status.
- #1035 was a verification close: no code changed today (everything it asked for landed 2026-10-02).
