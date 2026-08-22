---
date: 2026-08-22
area: signals
type: fix
---

# Single-symbol envelope: no more default-protocol fallback scoring

## Problem

Opening `/research/symbol/NEE` (SymbolPage) showed "SCORE 127 BUY" with a
full directive drilldown, even though NEE belongs to no protocol and no
watchlist-linked protocol resolves it. Investigation found:

- `GET /api/signals/envelope/:symbol` → `SignalEnvelopeService.getDrilldown`
  → `buildEnvelope(ticker, undefined)` → `ProtocolGatingService.scoreWithGating`
  with NO protocol → falls back to the implicit 'default' protocol and
  PERSISTS a Score row (`strategyId='default'`) via storeSnapshot.
- So any page view of an arbitrary symbol computed real scores with the
  unscoped default protocol and wrote them into score history — looking
  like the system was "scoring" the symbol.

## Fix

- `getDrilldown()` now checks, when no protocol is requested, that at least
  one ACTIVE protocol resolves the ticker (`isCoveredByActiveProtocol`).
  If none covers it, it returns an empty envelope with the blocker
  "Not included in any active protocol — no score produced".
- Verified: NEE envelope now HOLD/confidence 0/no groups; XAUUSD (covered)
  still scores fully (341 BUY). No Score rows written for uncovered
  symbols.
- Removed the misleading `default` Score + score_snapshot rows for NEE.

## Notes

- The automation loop and protocol pipeline were never scoring NEE
  (decision_log had zero rows) — the only writer was the on-demand
  envelope path with the default fallback.
- Explicit-protocol envelope requests (`?protocol=...`) are unaffected.
