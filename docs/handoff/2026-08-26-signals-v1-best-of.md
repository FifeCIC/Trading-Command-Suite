---
date: 2026-08-26
area: trading
type: feature
---

## What Changed

Signals v1 (#684) — the /signals area is now a live best-of opportunities ladder: every active protocol is scored, one actionable card survives per symbol per direction (best protocol wins), ranked by combined strength (0.5 × signal + 0.5 × opportunity), with manual CFD trade buttons through the bot's safety chain and per-signal dismissal.

## Files Changed

- `nest/src/modules/signals/signal-envelope.service.ts` — envelope gains protocolId/directionMode/scoreId/signalPct/opportunityPct/combinedStrength/marketStatus/holdsCfd; new `buildBestLadder()` (active-protocol scoring, one card per symbol+direction, action-only, dismissal filter); `persistScores` now returns symbol→Score-id map; new `dismissSignal()`/`getDismissals()`
- `nest/src/modules/signals/signals.controller.ts` — new endpoints `GET /api/signals/best`, `GET /api/signals/dismissals`, `POST /api/signals/dismiss`
- `nest/src/modules/signals/dto/dismiss-signal.dto.ts` — new DTO (symbol, protocolId?, hours? 1–168)
- `nest/src/modules/scoring/protocol-gating.service.ts` — `directionMode` added to GatedScore interface + return (was internal-only)
- `nest/prisma/schema.prisma` — new `SignalDismissal` model (symbol+protocolId unique, dismissedUntil index)
- `src/core/api/signals.js` — new frontend API module for the five signals endpoints
- `src/pages/SignalsOverviewPage.jsx` — static shell replaced with live card grid: SignalBadge, direction chip, combined-strength bar, metric blocks, directive chips, blockers/warnings, two-step trade confirm, dismiss, show-dismissed toggle
- `src/pages/signals-overview.css` — opportunity-card styles (theme-synced)
- `src/components/ScreenOptions.jsx` — `signals-overview` registry entry: Dismissal Window (1/2/4/8/24h)
- `src/App.jsx` — `signals-overview` added to VIEW_TO_OPTIONS map

## Capability Map Entry

- **name:** Signals Best-of Ladder (v1)
- **persistence:** stored
- **uiSurfaces:** 1
- **pipeline:** trading
- **completion:** partial (stock actions deferred to #686 Trading212 validation)

## QA Test Entry

- **area:** Signals
- **name:** Best-of ladder surfaces actionable opportunities and trades through the safety chain
- **procedure:** Open /signals; confirm cards show only BUY/SELL with direction chip + combined strength; click Buy CFD → confirm → verify MT5 demo position with SL/TP; click Dismiss → card hides for the Screen-Option horizon and reappears in "Show dismissed"
- **expected:** Cards ranked by combined strength; dismissal survives reloads; manual trade recorded as origin=manual/source=signals

## Architecture Framework Entry

- **section:** routes
- **summary:** Signals v1 best-of endpoints (GET /api/signals/best, GET/POST dismissals) — envelope carries protocolId/directionMode/scoreId so the UI can distinguish open-short vs close-long and drive /:id/trade. See Drive doc docs/systems/SIGNALS-BEST-OF-DESIGN.md for the theory.
