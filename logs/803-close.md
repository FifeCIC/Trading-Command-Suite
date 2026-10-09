## Pre-close checklist — #803 (and its duplicate #802)

**The owner's rule, applied:** *one scoring path*. `active = 0` is a kill switch, enforced at the one place rows are written, so no future path can bypass it.

### Root cause (confirmed against the code, 2026-10-09)

1. `speed-scan.service.ts` fell back to a hardcoded `SYMBOL_PROTOCOL_MAP` and returned `{ slug, active: true }` with the comment *"all hardcoded protocols are active by default"* — a claim nobody verified.
2. Even the flag it **had** read was only used to label the result for the frontend (`protocolActive` destructured, passed into the response) — scoring and persistence continued regardless.
3. `protocol-gating.service.ts` `storeSnapshot()` persists `score` + `score_snapshot` for **any** caller.

### Measured live before the fix

- `usdcad-oil-v1` (active = 0, no bot, no assignment): 75 rows, newest **2026-10-09 22:10**.
- `oil-supply-v1` (active = 0): 75 rows, newest **2026-10-09 22:10** — both writing while retired.
- Phantom slugs: **1** (`hourly-3dir-v1-copy`).

### Acceptance — evidence per item

- [x] **Phantom `score.strategyId` values listed and counted** — query against `score ⨝ protocol` on slug **and** uuid returned exactly one: `hourly-3dir-v1-copy` (1 row). **Deleted.**
- [x] **Rule decided for the speed-scan path** — it may score only protocols that are ACTIVE in the database; the hardcoded map is now a *slug hint*, verified via `withDbActive()`; an unresolvable or unreadable slug is REFUSED (unknown ≠ active).
- [x] **`active = 0` genuinely prevents score writes on every path** — `storeSnapshot()` refuses before both writes, with a `REFUSED … (#803)` warn. Pinned by `single-scoring-path.spec.ts` (6/6, both directions) and canaried BOTH ways: guard disabled → 1 failure; the `active: true` lie restored → 1 failure; both restores hash-verified.
- [x] **Build-time guard added** — `nest/scripts/validate-single-scoring-path.cjs` (own `--self-test`, 6 fixtures, both directions proven) registered in `prebuild`. It fails if the write-guard or the honest fallback is removed.
- [x] **Rows written by the wrong path identified + remediation decision recorded** — deleted: the phantom row, plus `usdcad-oil-v1` and `oil-supply-v1` (150 `score` + 150 `score_snapshot` rows; their series began the very minute the issue's own evidence was captured and never stopped). **Left in place, deliberately:** 63,705 `score_snapshot` + 33 `score` rows belonging to OTHER inactive protocols (newest 2026-09-27) — legitimate history from when they were active; the kill switch makes new writes impossible, and deleting them would destroy rarity continuity for a resumption. Recorded rather than assumed.
- [x] **`usdcad-oil-v1` left `active = 0` and confirmed to stop writing** — post-deploy verification below.

### Post-deploy verification (observed, not asserted)

- API restarted on the new build (`0.124.0`, healthy at 23:09:37Z).
- `score` rows for `usdcad-oil-v1` / `oil-supply-v1` written after deploy: **0** (total for both: 0 — the remediation held).
- The scan was **triggered directly** (`POST /api/speed/scan` with `USDCAD`, `USOIL`) rather than waiting for its cadence: **no score was computed, no row was written**. `USOIL` skipped (`No market data configured`); `USDCAD` returned `signal: NO_DATA` with no protocol and no score — on a closed market the scan's market-status gate short-circuits BEFORE protocol resolution, so the resolve-level skip did not get to demonstrate its reason string live tonight. That half rests on the spec + canary (below); it will be observable end-to-end in the next open session.
- Zero `REFUSED` warnings — correct for tonight, because the scan attempted no write at all; the write-point refusal is pinned by spec + canary and would log loudly if any path tried.
