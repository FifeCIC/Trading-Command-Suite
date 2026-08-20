---
date: 2026-08-20
area: infrastructure
type: fix
---

## What Changed

Three structural fixes from a cross-codebase audit:

1. **Single MT5 bridge config** — new `providers/mt5/mt5-bridge.config.ts`
   (`resolveMt5BridgeUrl()` + injectable `Mt5BridgeConfig` with `candlesUrl()`).
   All 10 call sites now resolve the bridge URL from one place (mixed
   5000/5001 defaults unified to `MT5_BRIDGE_URL || localhost:5000`); the three
   hardcoded `localhost:5000/candles` paths (market-data controller, replay
   service, snapshots module) now go through the config.
2. **Capability API hygiene** — `POST /api/capabilities` now takes a
   class-validator body DTO (`CreateCapabilityDto`) and uses typed
   `prisma.capability` (upsert by name) instead of query-string mutations and
   string-built raw SQL.
3. **Capability Map single source of truth** — the giant `KNOWN_FEATURES`
   literal moved from `CapabilityMapPage.jsx` to `src/data/known-features.js`
   (seed source only); seeded into the `capability` table via
   `nest/scripts/seed-capabilities.cjs` (216 rows). The page now overlays DB
   metadata first, literal only as fallback. Librarian workflow updated:
   capability updates = POST /api/capabilities, no JSX edits.

## Capability Map Entry

- **name:** MT5 bridge config unification
- **persistence:** config (env)
- **uiSurfaces:** 0

## QA

- Backend + frontend builds clean.
- `GET /api/capabilities` returns 216 seeded rows; category filter works.
- `POST /api/capabilities` with a JSON body upserts (created → updated on
  repeat) — verified with a probe entry.
- No `localhost:5000/5001` hardcodes remain outside the config layer and
  the multi-broker connection manager (intentional).
- Automation loop healthy after restart (13/13 protocols scoring).

## Architecture Entries

- Provider: `Mt5BridgeConfig` (ProvidersModule export) — single bridge URL source.
- Route contract: `POST /api/capabilities` — body DTO, upsert by name.
