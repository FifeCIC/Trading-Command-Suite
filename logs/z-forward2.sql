-- THE FORWARD-RETURN TEST — SAMPLED.
--
-- The trade ledger cannot answer "does scoring discriminate": it holds only signals that passed
-- the gate. 42.8% of all signals score <10 and essentially none traded, so there is no control
-- group. This measures what the MARKET did after EVERY signal, traded or not.
--
-- ⚠️ SAMPLED ON PURPOSE. The unrestricted version (every XAUUSD snapshot, two correlated price
-- lookups each) did not finish in several minutes. Sampling every 10th bar-boundary keeps every
-- composite band populated at a tenth of the cost. The sample is stated on the label so no reader
-- mistakes it for the full population.
--
-- Method
--   entry = close of the first 5m bar at/after snappedAt
--   exit  = close of the first 5m bar at/after snappedAt + horizon
--   fwd   = signed by the signal's OWN direction (BUY=+1, SELL=-1), in percent
--
-- ⚠️ Scalar subqueries only — a JOIN to marketbar fans out and inflates counts past the source
-- population. That mistake was made twice on 2026-09-28; the tell is a count larger than the source.
-- ⚠️ Clock: `score_snapshot.snappedAt` and `marketbar.timestamp` are BOTH UTC (verified by price
-- alignment). The MT5 terminal is UTC+3; the stored tables are not.

SET @sid = (SELECT id FROM symbol WHERE ticker = 'XAUUSD');

SELECT '=== (a) sample size and band coverage ===' AS section;
SELECT CASE WHEN composite < 10 THEN 'a: <10' WHEN composite < 20 THEN 'b: 10-19'
            WHEN composite < 40 THEN 'c: 20-39' WHEN composite < 80 THEN 'd: 40-79'
            ELSE 'e: 80+' END AS bucket,
       COUNT(*) AS sampled_signals
FROM score_snapshot
WHERE symbol = 'XAUUSD' AND composite IS NOT NULL
  AND snappedAt >= '2026-09-01' AND MINUTE(snappedAt) % 10 = 0
GROUP BY bucket ORDER BY bucket;

SELECT '=== (b) FORWARD RETURN BY COMPOSITE — 4h, all signals, sampled ===' AS section;
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
    WHERE ss.symbol = 'XAUUSD' AND ss.composite IS NOT NULL
      AND ss.snappedAt >= '2026-09-01' AND MINUTE(ss.snappedAt) % 10 = 0
  ) z
  WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
) x
GROUP BY bucket ORDER BY bucket;

SELECT '=== (c) same, 24h horizon ===' AS section;
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
    WHERE ss.symbol = 'XAUUSD' AND ss.composite IS NOT NULL
      AND ss.snappedAt >= '2026-09-01' AND MINUTE(ss.snappedAt) % 10 = 0
  ) z
  WHERE z.entrypx IS NOT NULL AND z.exitpx IS NOT NULL AND z.entrypx > 0 AND z.dir <> 0
) x
GROUP BY bucket ORDER BY bucket;
