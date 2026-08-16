---
date: 2026-08-16
area: trading
type: bugfix
---

## What Changed

Diagnosed the MT5 "order placement returns null" issue and fixed three code defects in the order path:
1. The bridge `/order` and `/orders/bulk` place paths never called `symbol_select()`, so `order_send` could return "No prices" even when the market was open.
2. The bridge margin check compared full-lot `margin_initial` against `margin_free` without scaling by `volume`, falsely rejecting small orders on small accounts.
3. The NestJS adapter swallowed the bridge's error and returned a generic "Bridge unreachable", hiding the real reason (e.g. "No prices", "Insufficient margin").

## Files Changed

- scripts/mt5-bridge/mt5_bridge_v2.py — `symbol_select()` before order_send in `/order` and `/orders/bulk`; margin check now `margin_initial * volume`
- nest/src/modules/providers/adapters/mt5.adapter.ts — `bridgePost` throws the bridge's parsed `error` field; `placeOrder` catches and returns it; added `extractBridgeErrorMessage()`

## Capability Map Entry

- **name:** MT5 order error surfacing + symbol/margin fixes
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete (live order round-trip pending market open)

## QA Test Entry

- **area:** Trading / MT5
- **name:** Order rejection surfaces the real error
- **procedure:** With the market closed, POST an order and confirm the error is "No prices" (not "Bridge unreachable"); POST volume 5.0 and confirm "exceeds max position size".
- **expected:** Errors are specific and actionable; risk limits reject oversized orders.

## Architecture Framework Entry

- **section:** trading
- **summary:** MT5 order path hardened — symbol selected before order_send, margin scaled by volume, and the adapter now surfaces the bridge's actual error instead of a generic "Bridge unreachable".
