-- XAUUSD give-back analysis, SECOND ATTEMPT.
--
-- ⚠️ WHY THERE IS A SECOND ATTEMPT. The first run asserted a +3h clock offset between
-- `trade` (UTC) and `marketbar`, on the reasoning that the terminal looked 3h ahead. It was not
-- verified, and it silently paired every trade with price action from 3 hours AFTER it closed —
-- producing believable averages (avgPeakPct 0.339, avgGiveBackPct 0.463). Plausible numbers, no
-- error. This run PROVES the offset before using it: for a real trade, the bar price at the
-- moment it opened must be close to its `entryPrice`. The wrong offset cannot pass that test.

SET @sid = (SELECT id FROM symbol WHERE ticker='XAUUSD');

-- (a) THE PROOF. `close_off0` / `close_off3` = the 5m bar price at the trade's open, under each
--     clock. The correct clock makes that price sit next to `entryPrice`. The other does not.
SELECT '=== (a) WHICH CLOCK? bar price at open vs real entryPrice ===' AS section;
SELECT t.side, t.entryPrice, t.openedAt,
       ROUND((SELECT b.close FROM marketbar b
              WHERE b.symbolId=@sid AND b.timeframe='5m' AND b.timestamp <= t.openedAt
              ORDER BY b.timestamp DESC LIMIT 1), 2) AS price_off0,
       ROUND((SELECT b.close FROM marketbar b
              WHERE b.symbolId=@sid AND b.timeframe='5m' AND b.timestamp <= t.openedAt + INTERVAL 3 HOUR
              ORDER BY b.timestamp DESC LIMIT 1), 2) AS price_off3
FROM trade t
WHERE t.symbol='XAUUSD' AND t.status='closed' AND t.abTestId IS NULL
  AND t.closedAt IS NOT NULL AND t.entryPrice > 0
ORDER BY t.openedAt DESC LIMIT 8;

-- (b) PEAK vs FINAL at the offset proven by (a). @off is left at 0 = both sides in UTC.
SELECT '=== (b) PEAK vs FINAL (offset 0) ===' AS section;
SELECT COUNT(*) AS n,
       ROUND(AVG(peakPct), 3) AS avgPeakPct,
       ROUND(AVG(finalPct), 3) AS avgFinalPct,
       ROUND(AVG(peakPct - finalPct), 3) AS avgGiveBackPct,
       SUM(peakPct > 0.05) AS reachedProfit,
       SUM(peakPct > 0.05 AND finalPct <= 0) AS peakedThenLost
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
    WHERE b.symbolId=@sid AND b.timeframe='5m'
      AND b.timestamp >= e.openedAt AND b.timestamp <= e.closedAt
  ) m ON m.hi IS NOT NULL
) q;

-- (c) The worst give-backs under the proven clock.
SELECT '=== (c) worst give-backs (offset 0) ===' AS section;
SELECT LEFT(COALESCE(e.strategy,'(none)'), 22) AS strategy, e.side, e.openedAt,
       ROUND(e.finalPct, 3) AS finalPct,
       ROUND((IF(e.side='buy', (m.hi - e.entryPrice), (e.entryPrice - m.lo)) / e.entryPrice) * 100, 3) AS peakPct,
       ROUND((IF(e.side='buy', (m.hi - e.entryPrice), (e.entryPrice - m.lo)) / e.entryPrice) * 100 - e.finalPct, 3) AS giveBackPct,
       ROUND(e.pnl, 2) AS pnl
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
  WHERE b.symbolId=@sid AND b.timeframe='5m'
    AND b.timestamp >= e.openedAt AND b.timestamp <= e.closedAt
) m ON m.hi IS NOT NULL
ORDER BY peakPct - finalPct DESC
LIMIT 12;

-- (d) How much of the trade ledger has NO usable P&L at all? (the attribution gap)
SELECT '=== (d) P&L coverage on closed XAUUSD trades ===' AS section;
SELECT COUNT(*) AS closedTrades,
       SUM(pnl IS NULL) AS pnlNull,
       SUM(pnl = 0) AS pnlZero,
       SUM(pnl <> 0) AS pnlUsable
FROM trade
WHERE symbol='XAUUSD' AND status='closed' AND abTestId IS NULL;
