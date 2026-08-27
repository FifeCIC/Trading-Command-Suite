---
date: 2026-08-27
area: signals
type: feature
---

## What Changed

Signals → Trading handover (#702): every Signals card now has a **Plan** action that queues the signal into the Trading area as a draft trading plan carrying the full signal context — direction, protocol, combined strength, signal/opportunity %, confidence, top drivers, and warnings. Trading Plans renders these as a distinct **Signal** type with a context block.

- New endpoint `POST /api/signals/:id/plan` (SignalsController → SignalActionsService.createSignalPlan).
- Plan `type = 'signal'`, `content.source = 'signals'` with the envelope snapshot; a first `PlanStep` (buy/sell) is created with the drivers as conditions.
- Dedupe is keyed on **symbol + protocolId + direction** (not the score id — score ids are per-run UUIDs, discovered during testing when a second click created a duplicate).
- TradingPlansPage: `Signal` type label, context block (direction chip, symbol, protocol, metrics, driver chips), raw JSON preserved below.
- SignalsOverviewPage: new `Plan` button between trade and Dismiss; success feedback links to `/trading/trading-plans`.

## Files Changed

- `nest/src/modules/signals/dto/signal-plan.dto.ts` (new) — body contract.
- `nest/src/modules/signals/signal-actions.service.ts` — `createSignalPlan()` with symbol+protocol+direction dedupe.
- `nest/src/modules/signals/signals.controller.ts` — `POST :id/plan` route.
- `src/core/api/signals.js` — `createSignalPlan()` client.
- `src/pages/SignalsOverviewPage.jsx` — Plan button + mutation + feedback link.
- `src/pages/TradingPlansPage.jsx` — Signal type + context block.
- `src/pages/signals-overview.css`, `src/pages/trading-plans-page.css` — button + context styles.

## Capability Map Entry

- **name:** Signals → Trading plan handover
- **persistence:** stored
- **uiSurfaces:** 2 (Signals overview, Trading Plans)
- **pipeline:** signals
- **completion:** complete

## QA Test Entry

- **area:** Signals / Trading
- **name:** Plan action creates a signal-context plan, deduped per symbol+protocol+direction
- **procedure:** On /signals click Plan on any card → "Plan created" feedback with link; open /trading/trading-plans → plan listed with Signal type, direction chip, metrics and driver chips; click Plan on the same symbol+protocol again (even after refresh with a new score run) → "already has a trading plan" error.
- **expected:** One plan per symbol+protocol+direction; plan carries signal context into the Trading area.

## Architecture Framework Entry

- **section:** routes
- **summary:** New route `POST /api/signals/:id/plan` — Signals→Trading handover creating a TradingPlan (type=signal) with signal context; dedupe on symbol+protocolId+direction via JSON_EXTRACT on content. No new Prisma models (tradingplan/planstep reused).
