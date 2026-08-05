# Handoff — DB-Driven Protocol Builder & META.Stack Cleanup (2026-07-16)

## Agent
DeepSeek V4 Pro (primary agent)

## Summary
Closed remaining META.Stack findings (#392 weightStrategy enforcement, #396 fingerprint versioning) and built the DB-driven Protocol Builder UI page (`CreateProtocolsPage`), making the protocol system fully self-service.

## Changes Made

### 1. weightStrategy Persistence Fix (#392)
**File:** `nest/src/modules/automation/automation-loop.service.ts` — `saveScoringStrategy()`
**Problem:** `weightStrategy` field (group-weighted | maxscore-weighted) was flowing through the scoring pipeline but never persisted to DB because the upsert's create/update blocks omitted it.
**Fix:** Added `weightStrategy` to both the `create` and `update` blocks in the `saveScoringStrategy()` Prisma upsert.
**Impact:** New ScoringStrategies now correctly persist their weighting mode. Existing strategies default to 'group-weighted'.

### 2. StackPerformance Fingerprint Versioning (#396)
**File:** `nest/src/modules/scoring/stack-performance.service.ts`
**Problem:** The upsert never stored the `fingerprint` hash, and the comparison at line 258 was a placeholder (`fingerprintChanged = false` always).
**Fix:**
- Added `fingerprint` field to both `create` and `update` blocks in the upsert
- Changed the fingerprint query to `select: { fingerprint: true }` instead of `select: { rating: true }`
- Changed the comparison from `false : false` to `lastPersisted.fingerprint !== fingerprint`
**Impact:** FingerprintChanged now correctly detects when a MetaStack config has diverged from its last rated version. Callers can know whether re-rating is needed.

### 3. Protocol Builder UI (`CreateProtocolsPage`)
**Files created:**
- `src/pages/CreateProtocolsPage.jsx` — Full DB-driven protocol builder
- `src/pages/create-protocols.css` — Scoped styles

**Files modified:**
- `src/core/view-routes.jsx` — Added import + map entry for `CreateProtocolsPage`

**Features:**
- **Protocol Metadata**: Name, slug (auto-derived), description, directionMode (LONG_ONLY/SHORT_ONLY/BOTH), tradingStyle
- **Load Existing**: Dropdown to load any DB-stored protocol for editing
- **Directive Groups**: Add/remove groups with name, weight, isRiskGate, minMultiplier/maxMultiplier
- **Target Group Selector**: Click a group to make it the active target, then click directives in the palette to assign them
- **Directive Palette**: All registered directives grouped by category (Technical, Market Context, Sentiment, Risk). Used directives show as dimmed with a checkmark indicating which group they belong to
- **Save**: POST /api/scoring/protocols with full protocol payload including groups and directive assignments
- **Reset**: Clear form back to defaults

**CSS Design:**
- Uses shared `.ff-*` form design system
- Risk gate groups have amber left border for visual distinction
- Active target group highlighted with accent background
- Chip-based directive display in groups
- Collapsible directive categories (Technical Analysis open by default)

### 4. Frontend Build
**Result:** 2,884 modules transformed successfully. Vite build output in `dist/` with PWA service worker generated (93 precache entries, 6279 KB).

## Architecture Notes
- The protocol builder creates protocols via the DB-persisted endpoint (`POST /api/scoring/protocols`), not the old `/api/strategies` endpoint
- The `StrategyBuilderPage` still exists as the `/scoring/strategy-wizard` view — it builds via the old Strategy system
- The nav-tree entry `create-protocols` now points to `CreateProtocolsPage` instead of `StrategyBuilderPage`
- Protocol DB model (4 tables: Protocol, ProtocolDirectiveGroup, ProtocolDirectiveEntry, SymbolProtocolAssignment) already seeded with 37 protocols, 111 groups, 542 entries from `seed-protocols.ts`

## Deferred
- Frontend UI for `weightStrategy` dropdown (backend complete, value persists)
- Cross-module PROTOCOL_REGISTRY refs in seasonal-affinity, arena, sector-rotation, signal-envelope, symbols, backtest
- Protocol builder: edit existing protocols (load works, but the "Save" creates new via upsert — needs update flow distinction)
- Symbol table as central FK hub
- Live pipeline dashboard

## Verification
- NestJS build: clean (no TypeScript errors)
- Frontend build: 2,884 modules, no errors
- Issues closed: #392, #396
- Backend restart: in progress (NestJS slow to start, database connection recovery needed)
