# Handoff — 2026-07-29 — Layer B Foundation: requiredDataFeeds + DB Nature Fix

## Summary

Built the foundation for Layer B (Capability Contracts) by adding `requiredDataFeeds` to the IDirective interface. Also applied the fixed `seed_nature.sql` to the live DB, correcting nature classifications that had been silently broken since the file was created.

## Completed

### DB Nature Fix
- Ran fixed `seed_nature.sql` against live DB (changed `WHERE type` → `WHERE id`)
- Previously non-functional — `type` column stores categories not directive IDs
- Natures now correct: `dxy-regime`→regime, `gold-macro-correlation`→symbol-specific, `rsi-oversold`→predictive, etc.

### requiredDataFeeds — IDirective Interface
- Added `readonly requiredDataFeeds?: string[]` to IDirective
- Documents external data dependencies (dxy, vix, treasury10y, oil, news, earnings, social, insider, fear-greed, halving)
- Populated on 10 directives that need external data
- Surfaced in API: list endpoint (`GET /api/directives`) and getOne (`GET /api/directives/:id`)
- Directives without external deps return `requiredDataFeeds: []`

### Directives With External Dependencies
| Directive | Feeds |
|-----------|-------|
| dxy-regime | ['dxy'] |
| gold-macro-correlation | ['dxy', 'treasury10y', 'vix'] |
| cad-usd-oil-correlation | ['oil'] |
| news-sentiment-positive | ['news'] |
| earnings-proximity | ['earnings'] |
| earnings-momentum | ['earnings'] |
| social-buzz | ['social'] |
| insider-activity | ['insider'] |
| crypto-fear-greed | ['fear-greed'] |
| btc-halving-cycle | ['halving'] |

## Files Changed
| File | Change |
|------|--------|
| `nest/src/modules/directives/interfaces/directive.interface.ts` | Added `requiredDataFeeds` property |
| `nest/src/modules/directives/directives.controller.ts` | Added requiredDataFeeds to list and getOne responses |
| `nest/src/modules/directives/implementations/*.ts` (10 files) | Added requiredDataFeeds declarations |
| `nest/prisma/seed_nature.sql` | (previous session) Fixed WHERE type→id |

## Build Status
- NestJS: ✅ clean
- Vite: ✅ passes
- All services running
