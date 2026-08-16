---
date: 2026-08-13
area: scoring
type: bugfix
---

## What Changed

Fixed the `liquidity-check` directive displaying an impossible "96/80" score. The directive's own `maxScore` is 100 (formula: volume 0-40 + range 0-35 + gap 0-25), but a stale DB override in `global_setting` (`directive:liquidity-check:maxScore = 80`) was being applied at startup, capping the displayed max below what the directive actually produces.

## Files Changed

- (none) — database-only fix. `UPDATE global_setting SET value='100' WHERE key='directive:liquidity-check:maxScore'`. NestJS restarted to reload directive overrides.

## Root Cause

Directive-level config lives in `global_setting` (key `directive:{id}:{field}`) and is merged over class defaults by `DirectivesService.loadDbOverrides()` at module init. `seedFromDefaults()` only inserts missing keys and never overwrites, so a stale `maxScore=80` persisted even after the directive class was updated to 100. This is a second config-drift hazard alongside the crypto-weekend-effect misassignment.

## Capability Map Entry

- **name:** Liquidity Check maxScore correction
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** liquidity-check maxScore matches directive ceiling
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 and read the risk group liquidity-check breakout.
- **expected:** maxScore is 100 (not 80), and score never exceeds 100.

## Architecture Framework Entry

- **section:** scoring
- **summary:** liquidity-check directive-level maxScore corrected 80→100 in global_setting to match its formula (0-100). Two maxScore layers exist: directive-level (global_setting) used in scoring breakouts, and protocol-level (protocol_directive_entry) used in the Protocols Registry. They can drift — worth a future audit.
