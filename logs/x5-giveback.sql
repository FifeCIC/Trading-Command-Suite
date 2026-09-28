-- XAUUSD give-back analysis.
--
-- ⚠️ CLOCK. `trade.openedAt/closedAt` are UTC; `marketbar.timestamp` LOOKS like broker time
-- (UTC+3), because its latest 5m bar is 16:20 while UTC is ~13:45. Sections (a) and (b) below
-- PROVE or refute that before the join is trusted, because a wrong offset silently pairs each
-- trade with price action that never happened — plausible numbers, no error.

SET @sid = (SELECT id FROM symbol WHERE ticker='XAUUSD');
SET @off = 3;   -- hours added to a UTC trade time to reach a marketbar timestamp

SELECT '=== (a) CLOCK CHECK: latest 5m bar vs UTC now ===' AS section;
SELECT UTC_TIMESTAMP() AS utcNow,
       (SELECT MAX(timestamp) FROM marketbar WHERE symbolId=@sid AND timeframe='5m') AS latest5m,
       (SELECT MAX(timestamp) FROM marketbar WHERE symbolId=@sid AND timeframe='1m') AS latest1m;

-- The XAUUSD trade closed 13:29:26 UTC at 4141.75 by broker:sl.
-- If marketbar is broker time, a 5m bar near 16:25-16:30 must have a low close to 4141.75.
SELECT '=== (b) CLOCK CHECK: bars where the known 13:29:26Z close should be ===' AS section;
SELECT timestamp, open, high, low, close
FROM marketbar
WHERE symbolId=@sid AND timeframe='5m'
  AND timestamp BETWEEN '2026-09-28 16:10:00' AND '2026-09-28 16:40:00'
ORDER BY timestamp;

SELECT '=== (c) XAUUSD closed trades (A/B excluded) ===' AS section;
SELECT COUNT(*) AS trades,
       SUM(pnl > 0) AS wins,
       SUM(pnl < 0) AS losses,
       ROUND(AVG(pnl), 2) AS avgPnl,
       ROUND(SUM(pnl), 2) AS totalPnl,
       ROUND(AVG(IF(side='buy',1,0)) * 100, 1) AS pctLong
FROM trade
WHERE symbol = 'XAUUSD' AND status = 'closed' AND abTestId IS NULL;

-- THE PATTERN TEST.
-- peakPct  = best unrealised excursion during the trade, in % of entry (MFE)
-- finalPct = realised result, in % of entry
-- giveBack = peakPct - finalPct  (how much of the high-water mark was handed back)
SELECT '=== (d) PEAK vs FINAL ===' AS section;
SELECT COUNT(*) AS n,
       ROUND(AVG(peakPct), 3) AS avgPeakPct,
       ROUND(AVG(finalPct), 3) AS avgFinalPct,
       ROUND(AVG(peakPct - finalPct), 3) AS avgGiveBackPct,
       ROUND(AVG(GREATEST(peakPct, 0)), 3) AS avgPeakWhenPositive,
       SUM(peakPct > 0.05) AS reachedMeaningfulProfit,
       SUM(peakPct > 0.05 AND finalPct <= 0) AS peakedThenEndedFlatOrLoss,
       ROUND(100 * SUM(peakPct > 0.05 AND finalPct <= 0) / NULLIF(SUM(peakPct > 0.05), 0), 1) AS pctOfPeakersThatLost
FROM (
  SELECT e.finalPct,
         (IF(e.side='buy', (m.hi - e.entryPrice), (e.entryPrice - m.lo)) / e.entryPrice) * 100 AS peakPct
  FROM (
    SELECT t.id, t.side, t.entryPrice, t.openedAt, t.closedAt,
           (IF(t.side='buy', t.exitPrice - t.entryPrice, t.entryPrice - t.exitPrice) / t.entryPrice) * 100 AS finalPct
    FROM trade t
    WHERE t.symbol='XAUUSD' AND t.status='closed' AND t.abTestId IS NULL
      AND t.closedAt IS NOT NULL AND t.exitPrice IS NOT NULL AND t.entryPrice > 0
  ) e
  JOIN LATERAL (
    SELECT MAX(b.high) AS hi, MIN(b.low) AS lo
    FROM marketbar b
    WHERE b.symbolId = @sid AND b.timeframe = '5m'
      AND b.timestamp >= e.openedAt + INTERVAL @off HOUR
      AND b.timestamp <= e.closedAt + INTERVAL @off HOUR
  ) m ON m.hi IS NOT NULL
) q;

SELECT '=== (e) worst give-backs ===' AS section;
SELECT LEFT(e.strategy, 24) AS strategy, e.side, e.openedAt,
       ROUND(e.finalPct, 3) AS finalPct,
       ROUND((IF(e.side='buy', (m.hi - e.entryPrice), (e.entryPrice - m.lo)) / e.entryPrice) * 100, 3) AS peakPct,
       ROUND((IF(e.side='buy', (m.hi - e.entryPrice), (e.entryPrice - m.lo)) / e.entryPrice) * 100 - e.finalPct, 3) AS giveBackPct,
       ROUND(e.pnl, 2) AS pnl, e.closeReason
FROM (
  SELECT t.id, t.side, t.strategy, t.closeReason, t.entryPrice, t.pnl, t.openedAt, t.closedAt,
         (IF(t.side='buy', t.exitPrice - t.entryPrice, t.entryPrice - t.exitPrice) / t.entryPrice) * 100 AS finalPct
  FROM trade t
  WHERE t.symbol='XAUUSD' AND t.status='closed' AND t.abTestId IS NULL
    AND t.closedAt IS NOT NULL AND t.exitPrice IS NOT NULL AND t.entryPrice > 0
) e
JOIN LATERAL (
  SELECT MAX(b.high) AS hi, MIN(b.low) AS lo
  FROM marketbar b
  WHERE b.symbolId = @sid AND b.timeframe = '5m'
    AND b.timestamp >= e.openedAt + INTERVAL @off HOUR
    AND b.timestamp <= e.closedAt + INTERVAL @off HOUR
) m ON m.hi IS NOT NULL
ORDER BY peakPct - finalPct DESC
LIMIT 15;
