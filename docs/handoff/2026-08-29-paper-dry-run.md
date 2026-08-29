---
date: 2026-08-29
area: automation
type: feature
---

## What Changed

Dry-run capture for the FX go-live gate (#695): while trading is off, the automation loop now records what WOULD have traded.

- **`paper_trade` table** (raw SQL — prisma db push broken): id, strategyId, symbol, side, composite, entryPrice, sl, tp, baseSize, protocolId, tickNumber, createdAt.
- **Capture points**: both `auto` dispatch sites in `automation-loop.service.ts` — when `side !== 'HOLD'` but `bs.tradingEnabled` is false (or the Trading layer is off), `recordPaperTrade()` writes a row instead of letting the candidate vanish into suppressed SCORED rows.
- **Dedupe**: same write-on-change signature cache idea as #704 (`lastPaperSig`), so a persistent signal produces one row, not one per tick.
- **`GET /api/automation/paper`** — last 100 candidates + per-strategy/symbol/side summary (BigInt-safe casts).
- **UI**: Automation Overview gains a "Paper signals (dry-run)" section listing recent candidates with SL/TP.

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — recordPaperTrade + capture at both dispatch gates.
- `nest/src/modules/automation/automation.controller.ts` — GET /api/automation/paper.
- `src/pages/AutomationOverviewPage.jsx`, `src/pages/automation-overview.css` — paper section.

## Capability Map Entry

- **name:** Dry-run paper capture (would-have-traded record)
- **persistence:** stored
- **uiSurfaces:** 1 (Automation Overview)
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading / Automation
- **name:** Paper candidates recorded while trading is off
- **procedure:** With the Trading layer off, wait for a strategy to cross its entry threshold (or lower a test strategy's minComposite), then open Automation Overview → Paper signals.
- **expected:** A row per changed signal with side, composite, entry, SL/TP; no order placed; endpoint returns recent + summary.

## Architecture Framework Entry

- **section:** routes
- **summary:** New route `GET /api/automation/paper` and table `paper_trade` — dry-run capture of would-have-traded candidates while trading is off (#695 go-live gate). Dedupe by strategy|symbol signature.
