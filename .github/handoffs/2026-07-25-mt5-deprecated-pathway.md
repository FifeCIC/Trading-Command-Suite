---
date: 2026-07-25
area: trading
type: refactor
---

## What Changed

Audited and marked deprecated MT5 order pathway (`POST /api/providers/mt5/order`, `POST /api/providers/mt5/close/:ticket`). Zero active callers found — frontend uses `POST /api/trading/mt5/order`, automation loop uses `mt5.adapter.ts` (calls bridge directly). Added `@deprecated` JSDoc, `_deprecated: true` in response, `_migrateTo` field pointing to new endpoint, and console warning. No log warnings in production — confirms nothing hits these endpoints.

## Files Changed

- `nest/src/modules/providers/mt5.controller.ts` — Added deprecation annotations to `placeOrder()` and `closePosition()`. Responses now include `_deprecated: true` and `_migrateTo` field. Console warning fires on call. Non-order endpoints (diagnostics, accounts, positions) unchanged.

## Caller Audit

- Frontend (React): Zero references to `providers/mt5/order` in any JSX/JS file
- Automation loop: Uses `broker.placeOrder()` → `mt5.adapter.ts` → bridge directly (never hits NestJS controller)
- Only references: architecture-reference.js (documentation), qa-checklist.js (QA procedure)
- NestJS log check: Zero "DEPRECATED" warnings in production logs

## QA Test Entry

- **area:** Trading / MT5
- **name:** Verify deprecated endpoints return migration notice
- **procedure:** `curl -X POST http://localhost:3201/api/providers/mt5/order -H "Content-Type: application/json" -d '{"symbol":"EURUSD","type":"buy","volume":0.01}'`
- **expected:** Response includes `_deprecated: true` and `_migrateTo: "POST /api/trading/mt5/order"`. NestJS logs warn "DEPRECATED — use POST /api/trading/mt5/order instead."

## Architecture Framework Entry

- **section:** trading
- **summary:** Deprecated MT5 order pathway (`/api/providers/mt5/order`) marked for removal in Phase 3 cleanup (Epic #510). Replacement: `POST /api/trading/mt5/order` with full validation + recording. Zero active callers confirmed via code audit + log analysis. Safe to delete in next cleanup pass.
