-- #764 (part 2) — Wire the 10 INACTIVE hint-dependent protocols onto watchlist FKs.
--
-- WHY THIS IS PART OF THE SAME JOB
-- --------------------------------
-- After part 1, no ACTIVE protocol depends on the hint tables. But 10 INACTIVE protocols
-- still resolve only by guessing:
--
--   btc-speed-v1          BTC
--   doge-speed-v1         DOGE
--   tsla-speed-v1         TSLA
--   oil-supply-v1         WTI
--   usdcad-oil-v1         WTI
--   dxy-sensitivity-v1    7 FX pairs
--   earnings-momentum-v1  12 momentum stocks
--   momentum-stock-v1     12 momentum stocks
--   pandemic-v1           14 pandemic stocks
--   leverage-v2           79 leveraged / inverse ETFs
--
-- Leaving them on the guess path means the next person to activate one gets a protocol that
-- resolves to nothing the moment the hints are removed — silently, which is the entire bug
-- class this work exists to eliminate. Wiring them now makes removal safe and permanent.
--
-- `active` is NOT touched. Whether any of these trades remains a product decision; this file
-- only ensures the symbol plumbing is already correct if it is ever taken.
--
-- ONE WATCHLIST PER PROTOCOL, because `watchlist.protocolId` is single-valued. Note
-- `earnings-momentum-v1` and `momentum-stock-v1` resolve to the SAME 12 symbols but get
-- separate watchlists — a shared one could only link to one of them.
--
-- The `leverage-v2` symbol list is the existing `leverage` watchlist content. It includes
-- inverse/short ETFs (SOXS, SPXS, SQQQ, SRTY, TECS, YANG, FNGD). That is what the protocol
-- resolves to TODAY via the hint, so wiring it is behaviour-preserving; whether an inverse
-- basket belongs in a protocol named "leverage-v2" is a separate question flagged in the
-- handoff, not silently changed here.
--
-- Idempotent: each INSERT is guarded by NOT EXISTS on the watchlist name.

-- 1) Single-symbol protocols.
INSERT INTO watchlist (id, name, symbols, userId, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT UUID(), t.wl_name, CAST(t.symbols AS JSON), NULL, NOW(3), NOW(3), p.id, 'system', 0, 'system'
  FROM (
    SELECT 'btc-speed-v1'  AS slug, 'btc-speed-index'  AS wl_name, '["BTC"]'  AS symbols
    UNION ALL SELECT 'doge-speed-v1',  'doge-speed-index',  '["DOGE"]'
    UNION ALL SELECT 'tsla-speed-v1',  'tsla-speed-index',  '["TSLA"]'
    UNION ALL SELECT 'oil-supply-v1',  'oil-supply-index',  '["WTI"]'
    UNION ALL SELECT 'usdcad-oil-v1',  'usdcad-oil-index',  '["WTI"]'
  ) t
  JOIN protocol p ON p.slug = t.slug
 WHERE NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = t.wl_name);

-- 2) Multi-symbol protocols. Symbol sets are copied from the audit, which derived them from
--    the hint tables themselves, so the wiring preserves the resolved set exactly.
INSERT INTO watchlist (id, name, symbols, userId, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT UUID(), t.wl_name, CAST(t.symbols AS JSON), NULL, NOW(3), NOW(3), p.id, 'system', 0, 'system'
  FROM (
    SELECT 'dxy-sensitivity-v1' AS slug, 'dxy-sensitivity-index' AS wl_name,
           '["AUDUSD","EURUSD","GBPUSD","NZDUSD","USDCAD","USDCHF","USDJPY"]' AS symbols
    UNION ALL SELECT 'earnings-momentum-v1', 'earnings-momentum-index',
           '["ASTS","AVGO","COIN","HOOD","MARA","MSTR","NVDA","PLTR","RIOT","RKLB","SOFI","TSLA"]'
    UNION ALL SELECT 'momentum-stock-v1', 'momentum-stock-index',
           '["ASTS","AVGO","COIN","HOOD","MARA","MSTR","NVDA","PLTR","RIOT","RKLB","SOFI","TSLA"]'
    UNION ALL SELECT 'pandemic-v1', 'pandemic-index',
           '["BAH","BNTX","CODX","CVS","DHR","EBS","ECL","HOLX","MRK","MRNA","PFE","SNGX","TDOC","UNH"]'
  ) t
  JOIN protocol p ON p.slug = t.slug
 WHERE NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = t.wl_name);

-- 3) leverage-v2 — copy the resolved set from the `leverage` watchlist the hint points at.
--    Copied rather than linked, because `protocolId` is single-valued and `leverage` may
--    already be referenced elsewhere.
INSERT INTO watchlist (id, name, symbols, userId, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT UUID(), 'leverage-v2-index', lv.symbols, NULL, NOW(3), NOW(3), p.id, 'system', 0, 'system'
  FROM protocol p
  JOIN watchlist lv ON LOWER(REPLACE(REPLACE(lv.name, '-', ' '), '_', ' ')) = 'leverage'
 WHERE p.slug = 'leverage-v2'
   AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = 'leverage-v2-index')
 LIMIT 1;

-- 4) Verify: all 10 must show linked_by_fk = 1.
SELECT p.slug, p.active, w.name AS watchlist, JSON_LENGTH(w.symbols) AS n_symbols,
       (w.protocolId = p.id) AS linked_by_fk
  FROM protocol p
  LEFT JOIN watchlist w ON w.protocolId = p.id
 WHERE p.slug IN (
   'btc-speed-v1','doge-speed-v1','tsla-speed-v1','oil-supply-v1','usdcad-oil-v1',
   'dxy-sensitivity-v1','earnings-momentum-v1','momentum-stock-v1','pandemic-v1','leverage-v2'
 )
   AND w.name IS NOT NULL
 ORDER BY p.slug;
