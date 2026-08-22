---
date: 2026-08-22
area: research
type: feature
---

# Research Notes: mass symbol import + register/import fixes

## What Changed

- **Mass import control** on the Notes page composer row (left of Add note,
  visible only while at least one note is expanded). Clicking opens an
  overlay showing how many unregistered tickers were detected across ALL
  notes, an optional "add to a new Watchlist" checkbox + name field, and an
  Import button. Import runs via the existing
  `POST /api/imports/batch` (auto-registers symbols + imports 1d bars) with
  live status polling of `GET /api/imports/batch/status` inside the modal.
- **Fixed single-symbol registration**: the popout's "Register + import"
  sent only `{ticker, name}` but `CreateSymbolDto` requires `exchange` +
  `type` — creation 400'd and nothing imported. Now sends
  `exchange: 'Unknown'`, `type: 'stock'`.
- **Fixed foreign-ticker imports**: Yahoo needs an exchange suffix
  (VWS → VWS.CO). `importRealBars` now retries common suffixes
  (`.CO .DE .PA .L .AS .MI .ST .TO .AX .SI .T .SW`) when the bare ticker
  returns nothing, for stock/etf symbols. Verified live: VWS → 99 real
  bars from Yahoo.

## Notes

- Provider chain for arbitrary stocks is effectively MT5 → Yahoo
  (alphavantage/alpaca adapters exist as files but are not registered in
  AdapterFactory — see #648 for the AV gap).
- Batch import is fire-and-forget with 500ms spacing between symbols.
