---
date: 2026-08-13
area: scoring
type: bugfix
---

## What Changed

Removed the crypto-only `crypto-weekend-effect` directive from all five gold (XAU) protocols where it was incorrectly copy-pasted. It remains in the two BTC protocols where it belongs.

## Files Changed

- nest/src/modules/scoring/protocols-seed-data.ts — removed "crypto-weekend-effect" from the risk group directiveIds + directiveMaxScores of xau-speed-v1, xau-speed-m5, xau-speed-m15, xau-speed-1h, xau-speed-4h

## Database Change

Deleted the 5 orphaned `protocol_directive_entry` rows (directiveId='crypto-weekend-effect') belonging to the gold protocols' risk groups via raw SQL. Gold protocols' risk subMax dropped 340 → 290 (liquidity-check 100 + portfolio-performance 90 + vix-regime 100). API restarted to refresh the preloaded protocol cache.

## Root Cause / Rationale

`crypto-weekend-effect` is declared crypto-only in `directive-suitability.registry.ts` (`instrumentTypes: ['crypto']`) and belongs in the BTC protocols. It was mistakenly carried into the gold protocols (likely copy-paste when the xau-speed family was derived). Gold already has `gold-session-profile` for weekend/session risk. Additionally, the directive's "higher score = more caution" scale is now ADDED into the composite (pure additive sum), which is semantically inverted for a risk directive.

## Capability Map Entry

- **name:** Gold protocol directive cleanup (remove crypto-weekend-effect)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Gold protocols no longer score crypto-weekend-effect
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 and inspect the risk group breakouts. Confirm BTC protocols still include it via /api/scoring/breakdown/BTCUSD?protocol=btc-speed-v1.
- **expected:** Gold risk group contains only liquidity-check, portfolio-performance, vix-regime. BTC risk group still contains crypto-weekend-effect.

## Architecture Framework Entry

- **section:** scoring
- **summary:** crypto-weekend-effect removed from xau-speed-v1/m5/m15/1h/4h risk groups (crypto-only directive misapplied to gold). Gold weekend/session risk is handled by gold-session-profile. File: protocols-seed-data.ts. DB: protocol_directive_entry cleanup + API restart.
