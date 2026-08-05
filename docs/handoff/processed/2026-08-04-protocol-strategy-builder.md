# Handoff: Protocol Builder + Strategy Builder (#560)

**Date:** 2026-08-04
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Resolved the URL/identity swap between the two scoring builder pages. Created a clear separation: Protocol Builder builds protocols, Strategy Builder configures scoring strategies from protocols.

## Architecture Decision (from discussion)

**Protocol → ScoringStrategy → TradingStrategy chain reinforced:**
- Protocol: "what to score" — defines directive groups, weights, direction, timeframe
- Scoring Strategy: "how to use the score" — selects a protocol, configures which groups gate at what threshold
- Trading Strategy: "how to trade the signal" — connects to broker, sets position sizing

**Direction belongs on Protocol** — directives are direction-specific (some only apply to shorts, some to longs). "Both" is valid but requires careful directive selection.

**Timeframe belongs on Protocol** — protocols ARE timeframe-specific (scalp needs M1 bars, swing needs H1/D1).

**Directive Groups belong on Protocol** — they define the weight and composition. The Strategy Builder reads them as the basis for gate configuration.

## Changes

### Nav-tree (`src/core/nav-tree.js`)
- Renamed `create-protocols` → `protocol-builder` (label: "Protocol Builder", icon: 🧩)
- `strategy-builder` icon changed from 🧩 to ⚙ (to avoid conflict)

### View routes (`src/core/view-routes.jsx`)
- Added `protocol-builder` → `CreateProtocolsPage` (same component, new route)

### Protocol Builder (`src/pages/CreateProtocolsPage.jsx`)
- No changes needed — already had Direction, Timeframe, Groups, Directive selection
- Already saves to `POST /api/scoring/protocols`

### Strategy Builder (`src/pages/StrategyBuilderPage.jsx`) — **REWRITTEN**
- Replaced old Directive Palette view (which was actually a protocol builder)
- New flow: select protocol → groups appear → gate toggle + threshold % per group
- Gate toggle: 🔒 GATE ON / 🔓 GATE OFF button per group
- Threshold: range slider 10–95%, step 5%
- Saves to `POST /api/scoring/strategies`

### CSS (`src/pages/create-protocols.css`)
- Added gate toggle/configuration styles: `.cp-gate-toggle`, `.cp-gate-config`, `.cp-threshold-slider`, `.cp-threshold-hint`
- Gated group cards get accent border

## Verification
- ✅ Frontend build passes
- ✅ No backend changes needed
