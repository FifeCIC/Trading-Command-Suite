-- THE FORWARD-RETURN TEST.
--
-- The trade ledger cannot answer "does scoring discriminate", because it contains only signals
-- that passed the gate — 42.8% of all signals score <10 and essentially none of them traded, so
-- there is no control group. This test removes that limitation entirely: it measures what the
-- MARKET did after EVERY signal, traded or not.
--
-- Method
--   entry  = close of the first 5m bar at/after the signal's snappedAt
--   exit   = close of the first 5m bar at/after snappedAt + 4 hours
--   fwd    = signed by the signal's OWN direction (BUY = +, SELL = -), as a percentage
--   then bucket by composite
--
-- If scoring discriminates, avg fwd should RISE with the composite bucket.
--
-- ⚠️ CLOCK. `score_snapshot.snappedAt` and `marketbar.timestamp` are BOTH UTC — verified
-- 2026-09-28 by price alignment (the MT5 terminal is UTC+3; the stored tables are not).
-- ⚠️ SCALAR SUBQUERIES ONLY. A JOIN to marketbar fans out and inflates counts past the
-- population. That mistake was made twice today; the tell is a count larger than its source.

SET @sid = (SELECT id FROM symbol WHERE ticker = 'XAUUSD');

SELECT '=== (a) what directions exist for XAUUSD? ===' AS section;
SELECT trading_signal, COUNT(*) AS n
FROM score_snapshot WHERE symbol = 'XAUUSD'
GROUP BY trading_signal ORDER BY n DESC;

SELECT '=== (b) population available ===' AS section;
SELECT COUNT(*) AS xau_signals_since_sep1, MIN(snappedAt) AS first, MAX(snappedAt) AS last
FROM score_snapshot
WHERE symbol = 'XAUUSD' AND composite IS NOT NULL AND snappedAt >= '2026-09-01';

SELECT '=== (c) FORWARD RETURN BY COMPOSITE — 4h horizon, all signals ===' AS section;
SELECT bucket, COUNT(*) AS n,
       ROUND(AVG(fwd), 4) AS avgFwdPct,
       ROUND(100 * SUM(fwd > 0) / COUNT(*), 1) AS pctPositive
FROM (
  SELECT composite, fwd,
         CASE
           WHEN composite <  10 THEN 'a: <10'
           WHEN composite <  20 THEN 'b: 10-19'
           WHEN composite <  40 THEN 'c: 20-39'
           WHEN composite <  80 THEN 'd: 40-79'
           ELSE 'e: 80+'
         END AS bucket
  FROM (
    SELECT z.composite,
           z.dir * ((z.exitpx - z.entrypx) / z.entrypx) * 100 AS fwd
    FROM (
      SELECT ss.composite,
             CASE WHEN ss.trading_signal = 'BUY'  THEN  1
                  WHEN ss.trading_signal = 'SELL' THEN -1
                  ELSE 0 END AS dir,
             (SELECT b.close FROM marketbar b
               WHERE b.symbolId = @sid AND b.timeframe = '5m' AND b.timestamp >= ss.snappedAt
               ORDER BY b.timestamp LIMIT 1) AS entrypx,
             (SELECT b.close FROM marketbar b
               WHERE b.symbolId = @sid AND b.timeframe = '5m'
                 AND b.timestamp >= ss.snappedAt + INTERVAL 4 HOUR
               ORDER BY b.timestamp LIMIT 1) AS exitpx
      FROM score_snapshot ss
      WHERE ss.symbol = 'XAUUSD' AND ss.composite IS NOT NULL AND ss.snappedAt >= '2026-09-01'
    ) z
    WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
  ) w
) x
GROUP BY bucket ORDER BY bucket;

SELECT '=== (d) same, 24h horizon ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(fwd), 4) AS avgFwdPct,
       ROUND(100 * SUM(fwd > 0) / COUNT(*), 1) AS pctPositive
FROM (
  SELECT composite, fwd,
         CASE WHEN composite < 10 THEN 'a: <10' WHEN composite < 20 THEN 'b: 10-19'
              WHEN composite < 40 THEN 'c: 20-39' WHEN composite < 80 THEN 'd: 40-79'
              ELSE 'e: 80+' END AS bucket
  FROM (
    SELECT z.composite, z.dir * ((z.exitpx - z.entrypx) / z.entrypx) * 100 AS fwd
    FROM (
      SELECT ss.composite,
             CASE WHEN ss.trading_signal = 'BUY'  THEN  1
                  WHEN ss.trading_signal = 'SELL' THEN -1
                  ELSE 0 END AS dir,
             (SELECT b.close FROM marketbar b
               WHERE b.symbolId = @sid AND b.timeframe = '5m' AND b.timestamp >= ss.snappedAt
               ORDER BY b.timestamp LIMIT 1) AS entrypx,
             (SELECT b.close FROM marketbar b
               WHERE b.symbolId = @sid AND b.timeframe = '5m'
                 AND b.timestamp >= ss.snappedAt + INTERVAL 24 HOUR
               ORDER BY b.timestamp LIMIT 1) AS exitpx
      FROM score_snapshot ss
      WHERE ss.symbol = 'XAUUSD' AND ss.composite IS NOT NULL AND ss.snappedAt >= '2026-09-01'
    ) z
    WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
  ) w
) x
GROUP BY bucket ORDER BY bucket;
