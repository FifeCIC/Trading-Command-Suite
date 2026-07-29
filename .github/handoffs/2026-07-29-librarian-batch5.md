# Librarian Handoff: Batch #5 — Readiness Tiers, Scoring Layers, Weekend Risk, IBKR, Phase Restructure

**Date:** 2026-07-29  
**Agent:** DeepSeek V4 Pro (Librarian)  
**Handoffs processed:** 4 files from 2026-07-28/29

## Handoffs Processed

| Handoff | Area | Type |
|---------|------|------|
| `2026-07-28-librarian-batch4.md` | docs | librarian |
| `2026-07-29-prep-issues-520-thru-524.md` | scoring | feature |
| `2026-07-29-sees-readiness-and-hybrid-scoring.md` | scoring | architecture |
| `2026-07-29-ui-readiness-and-build-fixes.md` | ui | feature |

## Additional Work This Session (Not in Handoffs)

- **Swap Cost Calculator (#33)** — SwapCostService, swap-forecast + swap-rates endpoints
- **Weekend Gap Risk Service (#34)** — WeekendGapRiskService, weekend-gap-stats + weekend-exposure endpoints
- **Weekend Defense Checklist (#35)** — WeekendDefenseService, weekend-checklist endpoint (chains #33+#34)
- **Interactive Brokers Mock Adapter (#8)** — Full adapter, 10th provider registered
- **Config Hot-Reload (#509)** — POST /api/system/reload-config, 20ms, no restart
- **Score Momentum Indicator (#519)** — Phase 5 experimental issue created with full design
- **Market Data Capabilities (#524)** — GET /api/market-data/capabilities endpoint
- **Phase Restructuring** — All 80 issues reclassified into new 5-phase system
- **Network Status Fix** — HEAD→GET health check, eliminated "API: Offline" false positive
- **META.Stack Status Page Hardening** — Retry logic, stale-while-revalidate, inline loading states
- **MetaStack Explorer Sticky Banner** — Strategy banner stays visible while scrolling pipeline

## Files Updated

### `src/core/architecture-reference.js`
- Added 14 CURRENT_SLICE entries (readiness tiers, ALPHA exclusion, hybrid scoring, swap/gap/defense, IBKR, config reload, score momentum, phase restructure, UI readiness, build status)
- Updated CONTRACT_REGISTER_LAST_UPDATED to 2026-07-29

### `src/pages/CapabilityMapPage.jsx`
- Added 11 new capability entries (Readiness Tier System, ALPHA Exclusion, IBKR Adapter, Swap Cost Calculator, Weekend Gap Risk, Weekend Defense, Config Hot-Reload, Score Momentum Indicator, Phase Restructuring, NestJS Zero-Error Build)

## Key Architecture State

- **Directives**: 104 total — 87 READY, 10 BRAVO, 7 ALPHA. DB-backed with readiness column.
- **Protocols**: 44 in DB, ALPHA directives excluded from scoring composite.
- **Providers**: 10 total (IBKR new, mock mode). MT5 healthy, Capital.com configured, T212 buggy.
- **Scoring**: ALPHA exclusion active. Readiness breakdown in every GatedScore response.
- **Risk Services**: Swap calculator, weekend gap stats (42 gaps for XAUUSD), weekend defense checklist.
- **Builds**: NestJS 100% clean (zero errors, zero excludes). Vite passes.
- **Issues**: 80 open, reclassified into 5-phase system.
- **Version**: 0.2.0 in both package.json files.

## Capability Map Entry

- **name:** Librarian Batch #5 — Readiness, Scoring, Risk, Phase Restructure
- **persistence:** stored
- **uiSurfaces:** 3 (Architecture Framework, Capability Map, META.Stack Status)
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Documentation / Architecture
- **name:** Verify architecture reference and capability map reflect readiness tiers and risk services
- **procedure:** (1) Open /status/architecture-framework — check CURRENT_SLICE has entries for readiness tiers, swap/gap/defense, IBKR. (2) Open /status/capability-map — verify 11 new capability entries appear. (3) Open /status/meta-stack-status — verify dashboard loads.
- **expected:** All three pages render. Architecture reference has 14 new SLICE entries. Capability map has 11 new entries. Build passes.
