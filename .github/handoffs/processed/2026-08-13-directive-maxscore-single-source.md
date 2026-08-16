---
date: 2026-08-13
area: scoring
type: refactor
---

## What Changed

Made the directive class `maxScore` the SINGLE source of truth for scoring. Previously maxScore could be overridden by two DB layers (`directive.weight` and `global_setting` `directive:{id}:maxScore`), causing drift (e.g. liquidity-check showing 96/80). Now the class value wins, and the DB layers are synced to it on every boot.

## Files Changed

- nest/src/modules/directives/directives.service.ts — removed the `db.weight → maxScore` override in `loadDirectiveMetadata()` and the `global_setting → maxScore` override in `loadDbOverrides()`. Class maxScore is now authoritative at runtime.
- nest/src/modules/scoring/directive-config.service.ts — `seedFromDefaults()` now UPSERTS (overwrites) global_setting from class defaults instead of INSERT IGNORE, so the DB mirrors the class on every boot.
- nest/src/modules/scoring/protocol-gating.controller.ts — protocol registry `maxScore` now computed from directive class maxScore (`directivesService.get(did)?.maxScore`) instead of per-protocol `directiveMaxScores`.
- nest/src/modules/scoring/protocol-db.service.ts — `seedProtocolsToDatabase()` seeds `protocol_directive_entry.maxScore` from the directive class, falling back to the protocol override.

## Result

- xau-speed-v1 now shows varied maxScores: 90 (bollinger-band-squeeze, gold-round-numbers, portfolio-performance, volatility-tools), 95 (gold-session-profile), 100, 110 (session-open-effect), 120 (speed-momentum), 135 (gold-macro-correlation), 140 (rsi-oversold/overbought). Total 1600.
- `directive.weight` and `global_setting` are now identical for all 104 registered directives (verified 0 mismatches).
- Side effect: `rsi-overbought` (directionBias=bearish) is now correctly excluded from the LONG_ONLY xau-speed protocols because its DB directionBias is no longer stale.

## Notes

- The per-protocol `directiveMaxScores` in `protocols-seed-data.ts` are now ignored at runtime (all consumers use the class). They remain as dead data — candidate for a future seed-file regeneration via `scripts/dump-protocol-seed.cjs`.

## Capability Map Entry

- **name:** Directive maxScore single source of truth
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** maxScore consistent across scoring + registry + DB
- **procedure:** Compare a Protocol Trail directive row's maxScore against /api/scoring/gated/protocols and the global_setting table.
- **expected:** All three match the directive class maxScore. No directive ever shows score > maxScore.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Directive maxScore is now single-sourced from the directive class. Removed the two DB override paths (directive.weight and global_setting directive:{id}:maxScore). seedFromDefaults upserts global_setting on boot; protocol registry and protocol_directive_entry derive from the class. Files: directives.service.ts, directive-config.service.ts, protocol-gating.controller.ts, protocol-db.service.ts.
