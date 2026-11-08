-- ============================================================================
-- #760 — consolidate crypto registry entries onto their provider's naming
-- ============================================================================
-- The registry held THREE crypto entries, all stale or empty, none matching what
-- binance (their real source) serves:
--
--   BTCUSD   177 bars, 54 days stale, 1 assignment   -> duplicate of BTC-USD
--   BTC-USD  200 bars, 16 days stale, 1 assignment   -> duplicate of BTCUSD
--   DOGEUSD  200 bars, 39 days stale, 0 assignments
--
-- Two registry rows existed for Bitcoin, neither live. Nothing could resolve them
-- because the refresh loop was MT5-only (#760 now routes by provider), and neither
-- ticker matches binance's symbol convention.
--
-- ── THE MERGE DECISION ───────────────────────────────────────────────────────
-- `BTC` becomes the live symbol because that is what binance serves. The dead rows
-- are NOT deleted: their bars are the only Bitcoin history in this system, and
-- discarding history to tidy a name is the wrong trade. They are deactivated in
-- place so they stop being resolved, scored and reported as starved, with `name`
-- recording what superseded them.
--
-- ⚠️ `symbol_protocol_assignment` is UNIQUE on (symbol, protocolId). BTCUSD and
-- BTC-USD were both assigned to the SAME protocol, so a naive double-UPDATE to
-- 'BTC' collides. The target row is therefore INSERTed once (deduped by protocol)
-- and the sources DELETEd — which is also the correct semantic: two rows describing
-- one instrument must become ONE assignment, not two.
-- ============================================================================

START TRANSACTION;

-- ── 1. Create the live symbols under the provider's own names ────────────────
INSERT INTO `symbol` (id, ticker, name, exchange, type, active, createdAt, updatedAt, tags, aliases)
VALUES
  (UUID(), 'BTC',  'Bitcoin',  'Binance', 'crypto', 1, NOW(), NOW(), '[]', '[]'),
  (UUID(), 'ETH',  'Ethereum', 'Binance', 'crypto', 1, NOW(), NOW(), '[]', '[]'),
  (UUID(), 'SOL',  'Solana',   'Binance', 'crypto', 1, NOW(), NOW(), '[]', '[]'),
  (UUID(), 'DOGE', 'Dogecoin', 'Binance', 'crypto', 1, NOW(), NOW(), '[]', '[]')
ON DUPLICATE KEY UPDATE active = 1, exchange = 'Binance', updatedAt = NOW();

-- ── 2. Carry assignments over as DEDUPED inserts (one row per protocol) ──────
INSERT IGNORE INTO symbol_protocol_assignment (id, symbol, protocolId, priority)
SELECT UUID(), 'BTC', protocolId, MIN(priority)
  FROM symbol_protocol_assignment WHERE symbol IN ('BTCUSD', 'BTC-USD') GROUP BY protocolId;
INSERT IGNORE INTO symbol_protocol_assignment (id, symbol, protocolId, priority)
SELECT UUID(), 'ETH', protocolId, MIN(priority)
  FROM symbol_protocol_assignment WHERE symbol IN ('ETHUSD', 'ETH-USD') GROUP BY protocolId;
INSERT IGNORE INTO symbol_protocol_assignment (id, symbol, protocolId, priority)
SELECT UUID(), 'SOL', protocolId, MIN(priority)
  FROM symbol_protocol_assignment WHERE symbol = 'SOLUSD' GROUP BY protocolId;
INSERT IGNORE INTO symbol_protocol_assignment (id, symbol, protocolId, priority)
SELECT UUID(), 'DOGE', protocolId, MIN(priority)
  FROM symbol_protocol_assignment WHERE symbol = 'DOGEUSD' GROUP BY protocolId;

-- ── 3. Remove the superseded assignment rows ─────────────────────────────────
DELETE FROM symbol_protocol_assignment
 WHERE symbol IN ('BTCUSD', 'BTC-USD', 'ETHUSD', 'ETH-USD', 'SOLUSD', 'DOGEUSD');

-- ── 4. Retire the superseded symbol rows IN PLACE (bar history is kept) ──────
UPDATE `symbol`
   SET active = 0, updatedAt = NOW(),
       name = CONCAT(name, ' [superseded by ',
              CASE ticker
                WHEN 'BTCUSD' THEN 'BTC' WHEN 'BTC-USD' THEN 'BTC'
                WHEN 'ETHUSD' THEN 'ETH' WHEN 'ETH-USD' THEN 'ETH'
                WHEN 'SOLUSD' THEN 'SOL' WHEN 'DOGEUSD' THEN 'DOGE'
              END, ' — #760]')
 WHERE ticker IN ('BTCUSD', 'BTC-USD', 'ETHUSD', 'ETH-USD', 'SOLUSD', 'DOGEUSD');

COMMIT;

-- ── 5. Verify ────────────────────────────────────────────────────────────────
SELECT '--- crypto registry after consolidation ---' AS phase;
SELECT ticker, name, exchange, active,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars_kept
FROM `symbol` s
WHERE ticker IN ('BTC','ETH','SOL','DOGE','BTCUSD','BTC-USD','DOGEUSD')
ORDER BY active DESC, ticker;

SELECT '--- assignments (one row per symbol/protocol) ---' AS phase;
SELECT a.symbol, COUNT(*) AS assignment_rows
FROM symbol_protocol_assignment a
WHERE a.symbol IN ('BTC','ETH','SOL','DOGE')
GROUP BY a.symbol;
