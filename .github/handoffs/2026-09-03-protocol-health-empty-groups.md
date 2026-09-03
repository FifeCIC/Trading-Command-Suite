---
date: 2026-09-03
issues: [718]
area: scoring
type: bugfix + feature
---

## What Changed

**Inactive groups read as NEUTRAL, never zero (#716 follow-up / #718).**
- `protocol-gating`: groups producing no results (empty config, all-excluded directives) AND groups producing no directional contribution (all-neutral outcomes, insufficient data, gate groups) are now omitted from `subScores` and tracked in `GatedScore.inactiveGroupIds`. Data absence no longer manufactures divergence spreads or depresses composites.
- `signal-envelope`: divergence detection skips gate groups AND inactive groups (defence-in-depth).
- Fixed an illogical blocker: "Mixed signal — SELL but composite above midpoint" no longer fires for `SHORT_ONLY` protocols, where a strong SELL is the healthy outcome.

**ProtocolHealthService — static config validation (new, benefits all future protocols).**
- Validates every active protocol on boot + on demand: empty groups (weight > 0, zero directives), unknown directive ids, duplicates across groups, zero-weight groups, missing risk-gate group.
- `GET /api/scoring/gated/protocols/health` returns all issues.
- Protocols Registry (Page B) shows a ⚠ count chip per protocol with full issue text, plus a "Config issues" block in the detail panel.

## Live results

- 7 real config issues found across 5 protocols: vix-spike-v1 empty Sentiment group (0.35 weight), spy-speed-v1 empty Market Context (0.25), session-open-effect double-counted in spy-speed-v1 / qqq-speed-v1 / forex-session-v1, signals-workbench has no risk gate. **None were auto-fixed — they're surfaced for human config decisions.**
- Signals before/after: fake "technical vs sentiment (0)" divergences gone; vix-spike-v1 composite 36→58 (honest near-miss vs the 65 gate); vix-short-v1 SELL now ready; XAUUSD/USDJPY/AUDUSD ready. **4 of 5 signals trade-ready** (only VIX long blocked by the genuine 58<65 gate).

## Configuration safety (user requirement)

No protocol config was modified — all issues are flagged, not silently patched. Config remains in seed data (`protocols-seed-data.ts`) and backup-covered DB tables.

## Files Changed

- `nest/src/modules/scoring/protocol-gating.service.ts`
- `nest/src/modules/scoring/protocol-health.service.ts` (new)
- `nest/src/modules/scoring/scoring.module.ts`
- `nest/src/modules/scoring/protocol-gating.controller.ts`
- `nest/src/modules/signals/signal-envelope.service.ts`
- `src/pages/ProtocolsPageB.jsx`, `src/pages/protocols-page-b.css`

## Capability Map Entry

- **name:** Protocol config health validation + neutral inactive groups
- **persistence:** stored
- **uiSurfaces:** 1 (Protocols Registry health chips/issues)
- **pipeline:** scoring
- **completion:** complete (#718 partially — per-protocol entry gate remains)

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Empty groups neutral + registry flags config faults
- **procedure:** Open Protocols Registry → ⚠ chips on faulty protocols with issue text. Trigger /api/signals/best → no divergences reference groups with zero directives. GET /api/scoring/gated/protocols/health returns the issue list.
- **expected:** Faults surfaced at config level; scoring treats missing groups as non-participating.
