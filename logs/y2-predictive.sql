-- Does entry score predict outcome?
--
-- ⚠️ ORDER MATTERS. Section (a) VERIFIES the trade→queue join before (b)/(c) use it. The link is
-- inferred (trade.strategy holds a bot NAME; the queue holds a strategyId UUID), so it must be
-- proven by time proximity. A wrong join returns rows and no error — the exact shape that has
-- produced confident wrong answers in this repo.

-- (a) JOIN PROOF. `secsApart` = distance between the queue row and the trade's open.
--     A correct link is seconds-to-minutes. If this is large or the score is NULL, STOP:
--     the join is wrong and (b)/(c) mean nothing.
SELECT '=== (a) JOIN PROOF: queue row vs trade open ===' AS section;
SELECT t.symbol, LEFT(t.strategy,22) AS bot, t.openedAt, ROUND(t.pnl,2) AS pnl,
  (SELECT q.compositePct FROM strategy_signal_queue q
     JOIN trading_strategy ts ON ts.id = q.strategyId
    WHERE ts.name = t.strategy AND q.symbol = t.symbol
    ORDER BY ABS(TIMESTAMPDIFF(SECOND, q.createdAt, t.openedAt)) LIMIT 1) AS compositePct,
  (SELECT ABS(TIMESTAMPDIFF(SECOND, q.createdAt, t.openedAt)) FROM strategy_signal_queue q
     JOIN trading_strategy ts ON ts.id = q.strategyId
    WHERE ts.name = t.strategy AND q.symbol = t.symbol
    ORDER BY 1 LIMIT 1) AS secsApart
FROM trade t
WHERE t.symbol='XAUUSD' AND t.status='closed' AND t.abTestId IS NULL
ORDER BY t.openedAt DESC LIMIT 8;

-- (b) MATCH RATE across ALL closed trades. How much of the ledger can be linked at all?
SELECT '=== (b) MATCH RATE ===' AS section;
SELECT COUNT(*) AS closedTrades,
       SUM(ts.id IS NOT NULL) AS botResolved,
       SUM(q.id IS NOT NULL) AS queueMatched
FROM trade t
LEFT JOIN trading_strategy ts ON ts.name = t.strategy
LEFT JOIN strategy_signal_queue q ON q.strategyId = ts.id AND q.symbol = t.symbol
WHERE t.status='closed' AND t.abTestId IS NULL;

-- (c) THE PREDICTIVE TEST. Bucket linked trades by entry compositePct.
--     If scoring has predictive power, avg outcome should IMPROVE with the bucket.
SELECT '=== (c) OUTCOME BY ENTRY SCORE BUCKET ===' AS section;
SELECT bucket, COUNT(*) AS n,
       ROUND(AVG(pnl), 2) AS avgPnl,
       SUM(pnl > 0) AS wins,
       ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT t.pnl,
         CASE
           WHEN q.compositePct IS NULL THEN 'unlinked'
           WHEN q.compositePct <  10 THEN 'a: <10'
           WHEN q.compositePct <  20 THEN 'b: 10-19'
           WHEN q.compositePct <  30 THEN 'c: 20-29'
           WHEN q.compositePct <  50 THEN 'd: 30-49'
           ELSE 'e: 50+' END AS bucket
  FROM trade t
  LEFT JOIN trading_strategy ts ON ts.name = t.strategy
  LEFT JOIN strategy_signal_queue q
         ON q.strategyId = ts.id AND q.symbol = t.symbol
        AND ABS(TIMESTAMPDIFF(SECOND, q.createdAt, t.openedAt)) <= 3600
  WHERE t.status='closed' AND t.abTestId IS NULL AND t.pnl IS NOT NULL
) z
GROUP BY bucket ORDER BY bucket;

-- (d) IS ONE SYMBOL THE CULPRIT? Realised P&L by symbol, with a note on how much of each
--     symbol's ledger carries a usable number (a 0-heavy symbol is mostly unmeasured).
SELECT '=== (d) P&L BY SYMBOL ===' AS section;
SELECT symbol, COUNT(*) AS n,
       SUM(pnl <> 0) AS withUsefulPnl,
       ROUND(SUM(pnl), 2) AS totalPnl,
       ROUND(AVG(CASE WHEN pnl <> 0 THEN pnl END), 2) AS avgPnlWhenMeasured
FROM trade
WHERE status='closed' AND abTestId IS NULL
GROUP BY symbol ORDER BY totalPnl ASC LIMIT 20;
