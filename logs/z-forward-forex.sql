-- FORWARD-RETURN TEST — forex-session-v1.
--
-- Same method that produced the XAUUSD result on 2026-09-28, applied to the protocol that carries
-- the largest share of the book (209 of 251 attributable trades).
--
-- Why this matters: the XAUUSD test showed the % of profitable forward moves rising with the
-- composite band (31.0 -> 37.0 -> 49.0 at 4h). If forex-session-v1 shows the SAME shape, the thin
-- edge is a property of the scoring and the fix is the payoff side. If it shows FLAT or INVERSE,
-- the problem is specific to this protocol and the fix is the protocol.
--
-- Method: entry = close of first 5m bar at/after snappedAt; exit = close at/after snappedAt + horizon;
--         fwd = signed by the signal's own direction (BUY=+1, SELL=-1). Sampled every 10th minute.
--
-- ⚠️ Scalar subqueries only — a JOIN to marketbar fans out and inflates counts past the source.
-- ⚠️ Clock: `score_snapshot.snappedAt` and `marketbar.timestamp` are both UTC (price-alignment
--    verified 2026-09-28). The MT5 terminal is UTC+3; the stored tables are not.

SET @proto = 'forex-session-v1';

SELECT '=== (a) sample size by band ===' AS section;
SELECT CASE WHEN composite < 10 THEN 'a: <10' WHEN composite < 20 THEN 'b: 10-19'
            WHEN composite < 40 THEN 'c: 20-39' WHEN composite < 80 THEN 'd: 40-79'
            ELSE 'e: 80+' END AS bucket,
       COUNT(*) AS sampled_signals, COUNT(DISTINCT symbol) AS distinct_symbols
FROM score_snapshot
WHERE protocolId = @proto AND composite IS NOT NULL
  AND snappedAt >= '2026-09-01' AND MINUTE(snappedAt) % 10 = 0
GROUP BY bucket ORDER BY bucket;

SELECT '=== (b) FORWARD RETURN BY COMPOSITE — 4h ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(fwd), 4) AS avgFwdPct,
       ROUND(100 * SUM(fwd > 0) / COUNT(*), 1) AS pctPositive
FROM (
  SELECT z.composite,
         CASE WHEN z.composite < 10 THEN 'a: <10' WHEN z.composite < 20 THEN 'b: 10-19'
              WHEN z.composite < 40 THEN 'c: 20-39' WHEN z.composite < 80 THEN 'd: 40-79'
              ELSE 'e: 80+' END AS bucket,
         z.dir * ((z.exitpx - z.entrypx) / z.entrypx) * 100 AS fwd
  FROM (
    SELECT ss.composite,
           CASE WHEN ss.trading_signal = 'BUY' THEN 1 WHEN ss.trading_signal = 'SELL' THEN -1 ELSE 0 END AS dir,
           (SELECT b.close FROM marketbar b JOIN symbol sy ON sy.id = b.symbolId
             WHERE sy.ticker = ss.symbol AND b.timeframe = '5m' AND b.timestamp >= ss.snappedAt
             ORDER BY b.timestamp LIMIT 1) AS entrypx,
           (SELECT b.close FROM marketbar b JOIN symbol sy ON sy.id = b.symbolId
             WHERE sy.ticker = ss.symbol AND b.timeframe = '5m'
               AND b.timestamp >= ss.snappedAt + INTERVAL 4 HOUR
             ORDER BY b.timestamp LIMIT 1) AS exitpx
    FROM score_snapshot ss
    WHERE ss.protocolId = @proto AND ss.composite IS NOT NULL
      AND ss.snappedAt >= '2026-09-01' AND MINUTE(ss.snappedAt) % 10 = 0
  ) z
  WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
) x
GROUP BY bucket ORDER BY bucket;

SELECT '=== (c) FORWARD RETURN BY COMPOSITE — 24h ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(fwd), 4) AS avgFwdPct,
       ROUND(100 * SUM(fwd > 0) / COUNT(*), 1) AS pctPositive
FROM (
  SELECT z.composite,
         CASE WHEN z.composite < 10 THEN 'a: <10' WHEN z.composite < 20 THEN 'b: 10-19'
              WHEN z.composite < 40 THEN 'c: 20-39' WHEN z.composite < 80 THEN 'd: 40-79'
              ELSE 'e: 80+' END AS bucket,
         z.dir * ((z.exitpx - z.entrypx) / z.entrypx) * 100 AS fwd
  FROM (
    SELECT ss.composite,
           CASE WHEN ss.trading_signal = 'BUY' THEN 1 WHEN ss.trading_signal = 'SELL' THEN -1 ELSE 0 END AS dir,
           (SELECT b.close FROM marketbar b JOIN symbol sy ON sy.id = b.symbolId
             WHERE sy.ticker = ss.symbol AND b.timeframe = '5m' AND b.timestamp >= ss.snappedAt
             ORDER BY b.timestamp LIMIT 1) AS entrypx,
           (SELECT b.close FROM marketbar b JOIN symbol sy ON sy.id = b.symbolId
             WHERE sy.ticker = ss.symbol AND b.timeframe = '5m'
               AND b.timestamp >= ss.snappedAt + INTERVAL 24 HOUR
             ORDER BY b.timestamp LIMIT 1) AS exitpx
    FROM score_snapshot ss
    WHERE ss.protocolId = @proto AND ss.composite IS NOT NULL
      AND ss.snappedAt >= '2026-09-01' AND MINUTE(ss.snappedAt) % 10 = 0
  ) z
  WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
) x
GROUP BY bucket ORDER BY bucket;
