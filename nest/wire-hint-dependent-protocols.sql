-- #764 — Wire the 10 hint-dependent ACTIVE protocols onto watchlist FKs.
--
-- WHY
-- ---
-- The hint-dependency audit (`scripts/audit-hint-dependency.cjs`) found that 10 of 18
-- ACTIVE protocols resolve their symbols through the NAME-GUESSING fallbacks only:
--
--   forex-session-v1  7 FX pairs
--   gold-macro-v1     XAUUSD
--   xau-speed-m5      XAUUSD
--   xau-speed-m15     XAUUSD
--   xau-speed-1h      XAUUSD
--   xau-speed-4h      XAUUSD
--   spy-day-v1        SPY
--   qqq-day-v1        QQQ
--   vix-spike-v1      VIX
--   vix-short-v1      VIX
--
-- `resolveSymbols()` returned an empty set for every one of them, so it fell through to
-- `deriveSymbolsFromId()`, which substring-matches the protocol SLUG against
-- `SINGLE_SYMBOL_HINTS` / `WATCHLIST_HINTS`. That guessed symbol is now logged as a warning
-- (#763) — which is how the dependence became visible in the first place.
--
-- A guess is not an onboarding: it breaks silently on a rename and cannot report that it
-- broke. This wires each protocol onto a real `watchlist.protocolId` FK, so it resolves via
-- Path 1 and never reaches the guess.
--
-- NAMING
-- ------
-- One watchlist per protocol, NOT per symbol. `watchlist.protocolId` is a SINGLE-valued
-- column, so a shared `xau-index` could only ever link to one of the four `xau-speed-*`
-- protocols — the other three would fall straight back to guessing. Per-protocol names keep
-- the FK unambiguous and make the link obvious from the name:
--
--   forex-session-v1 → forex-session-index
--   gold-macro-v1    → gold-macro-index
--   xau-speed-m5     → xau-speed-m5-index        (and m15 / 1h / 4h)
--   spy-day-v1       → spy-day-index
--   qqq-day-v1       → qqq-day-index
--   vix-spike-v1     → vix-spike-index
--   vix-short-v1     → vix-short-index
--
-- This matches the existing `ftse-index` / `dax-index` / `cac-index` / `china-index` shape:
-- `kind='system'`, symbols as bare ticker strings, linked by protocol UUID.
--
-- SYMBOL SETS ARE COPIED FROM WHAT EACH PROTOCOL ACTUALLY RESOLVED TO, so the wiring
-- changes the MECHANISM and not the BEHAVIOUR — verified against the audit output, which
-- derived the lists from the hint tables themselves.
--
-- Idempotent: the INSERT is guarded by NOT EXISTS on the watchlist name.

-- 1) Create one linked watchlist per protocol, with the symbol set it currently resolves to.
INSERT INTO watchlist (id, name, symbols, userId, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT UUID(), t.wl_name, CAST(t.symbols AS JSON), NULL, NOW(3), NOW(3), p.id, 'system', 0, 'system'
  FROM (
    SELECT 'forex-session-v1' AS slug, 'forex-session-index' AS wl_name,
           '["AUDUSD","EURUSD","GBPUSD","NZDUSD","USDCAD","USDCHF","USDJPY"]' AS symbols
    UNION ALL SELECT 'gold-macro-v1', 'gold-macro-index',    '["XAUUSD"]'
    UNION ALL SELECT 'xau-speed-m5',  'xau-speed-m5-index',  '["XAUUSD"]'
    UNION ALL SELECT 'xau-speed-m15', 'xau-speed-m15-index', '["XAUUSD"]'
    UNION ALL SELECT 'xau-speed-1h',  'xau-speed-1h-index',  '["XAUUSD"]'
    UNION ALL SELECT 'xau-speed-4h',  'xau-speed-4h-index',  '["XAUUSD"]'
    UNION ALL SELECT 'spy-day-v1',    'spy-day-index',       '["SPY"]'
    UNION ALL SELECT 'qqq-day-v1',    'qqq-day-index',       '["QQQ"]'
    UNION ALL SELECT 'vix-spike-v1',  'vix-spike-index',     '["VIX"]'
    UNION ALL SELECT 'vix-short-v1',  'vix-short-index',     '["VIX"]'
  ) t
  JOIN protocol p ON p.slug = t.slug
 WHERE NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = t.wl_name);

-- 2) Re-point any pre-existing unlinked watchlist of that name at the protocol, so a
--    manually-created row is adopted rather than duplicated.
UPDATE watchlist w
  JOIN protocol p ON p.slug = REPLACE(REPLACE(w.name, '-index', ''), ' ', '-')
   SET w.protocolId = p.id, w.updatedAt = NOW(3)
 WHERE w.name IN (
   'forex-session-index','gold-macro-index','xau-speed-m5-index','xau-speed-m15-index',
   'xau-speed-1h-index','xau-speed-4h-index','spy-day-index','qqq-day-index',
   'vix-spike-index','vix-short-index'
 )
   AND (w.protocolId IS NULL OR w.protocolId <> p.id);

-- 3) Verify: every one of the 10 must now show linked_by_fk = 1.
SELECT p.slug, p.active, w.name AS watchlist, w.symbols,
       (w.protocolId = p.id) AS linked_by_fk
  FROM protocol p
  LEFT JOIN watchlist w ON w.protocolId = p.id
 WHERE p.slug IN (
   'forex-session-v1','gold-macro-v1','xau-speed-m5','xau-speed-m15','xau-speed-1h',
   'xau-speed-4h','spy-day-v1','qqq-day-v1','vix-spike-v1','vix-short-v1'
 )
 ORDER BY p.slug;
