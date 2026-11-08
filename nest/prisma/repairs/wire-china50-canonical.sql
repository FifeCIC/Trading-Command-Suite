-- #763 — bring CHINA50 into the META.Stack pipeline THE CANONICAL WAY.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- `CHINA50` had bars written straight into `marketbar` by hand (a `/bars/record` call with an
-- explicit symbol list). That is a back door: it makes the bar count look healthy while the
-- symbol remains unwired, so the "fix" evaporates the moment the refresh loop next runs and
-- nobody can see it happened. `CHINA50` was being served ENTIRELY by the name-guessing hint
-- fallback, which is why it went stale in the first place.
--
-- This sets the symbol up the way the UI and the automation loop expect, following the exact
-- shape of `ftse-index` / `dax-index` / `cac-index`, which are the three index protocols that
-- DO work:
--
--     watchlist.name       = '<index>-index'
--     watchlist.kind       = 'system'
--     watchlist.symbols    = ["<TICKER>"]          (bare ticker strings)
--     watchlist.protocolId = <protocol UUID FK>    (a REAL foreign key, not a name match)
--
-- With that row present, `ProtocolDbService.resolveSymbols()` resolves via Path 2 (the FK)
-- and never reaches Path 3 (guess from slug). That is the whole point: an FK cannot go stale
-- on a rename, and it makes the guess-fallback warning stop firing for this protocol.
--
-- NOTE ON `active`: this file does NOT flip `china-speed-v1.active`. Whether the protocol
-- trades is a product decision. This file makes the SYMBOL properly wired so that the
-- decision, whenever it is taken, is not blocked by an absence of plumbing.

-- 1) Create the watchlist, linked by FK to the protocol.
INSERT INTO watchlist (id, name, symbols, userId, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT
  UUID(),
  'china-index',
  CAST('["CHINA50"]' AS JSON),
  NULL,
  NOW(3),
  NOW(3),
  p.id,
  'system',
  0,
  'system'
FROM protocol p
WHERE p.slug = 'china-speed-v1'
  AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = 'china-index');

-- 2) Re-point an existing china-index at the protocol if one already exists unlinked.
UPDATE watchlist w
  JOIN protocol p ON p.slug = 'china-speed-v1'
   SET w.protocolId = p.id,
       w.updatedAt  = NOW(3)
 WHERE w.name = 'china-index'
   AND (w.protocolId IS NULL OR w.protocolId <> p.id);

-- 3) Ensure the symbol is registered and active. `CHINA50` is the provider's own name
--    (verified against GET http://localhost:5000/symbols — the Indexes group lists it),
--    so the registry ticker and the broker ticker agree by construction.
UPDATE symbol SET active = 1, updatedAt = NOW(3) WHERE ticker = 'CHINA50' AND active = 0;

-- 4) Confirm the resolution path the service will now take.
SELECT
  w.name                AS watchlist,
  w.kind                AS watchlist_kind,
  w.symbols             AS symbols,
  p.slug                AS protocol,
  p.active              AS protocol_active,
  (w.protocolId = p.id) AS linked_by_fk
FROM watchlist w
JOIN protocol p ON p.id = w.protocolId
WHERE w.name = 'china-index';
