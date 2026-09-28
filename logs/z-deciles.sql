-- Score vs outcome, with buckets that match the ACTUAL scale.
--
-- ⚠️ The previous attempt bucketed on <10 / 10-19 / 20-39 / 40+. `score.value` is RAW 0-230
-- (measured: n=14,862, min 0, avg 57.97, max 230), so every attributed trade fell into the top
-- bucket and the test compared nothing. Buckets below are quartiles of the OBSERVED attributed
-- range (50-133), stated on the label so the reader can see the transform.
--
-- Attribution: protocol-aware. A signal counts only if its protocol is one the trade's bot is
-- subscribed to. Symbol+time alone picks the wrong protocol ~6 times in 10.

SELECT '=== score vs outcome, quartiles of the observed 50-133 range ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(score), 1) AS avgScore,
       ROUND(AVG(pnl), 2) AS avgPnl, SUM(pnl > 0) AS wins,
       ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT pnl, score,
         CASE
           WHEN score <  75 THEN 'q1: 50-74'
           WHEN score < 100 THEN 'q2: 75-99'
           WHEN score < 125 THEN 'q3: 100-124'
           ELSE 'q4: 125+'
         END AS bucket
  FROM (
    SELECT t.pnl,
           (SELECT s.value
              FROM signal_outcome_log sol
              JOIN score s ON s.id = sol.scoreId
             WHERE sol.symbol = t.symbol
               AND sol.protocolId = (SELECT sp.protocolId FROM strategy_protocol sp
                                      WHERE sp.strategyId = ts.id LIMIT 1)
               AND sol.createdAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             ORDER BY sol.createdAt DESC LIMIT 1) AS score
    FROM trade t
    JOIN trading_strategy ts ON ts.name = t.strategy
    WHERE t.status = 'closed' AND t.pnl IS NOT NULL AND t.closedAt IS NOT NULL
  ) s
  WHERE score IS NOT NULL
) b
GROUP BY bucket ORDER BY bucket;

-- Per-protocol outcome, now that attribution is trustworthy. This is the review the owner asked
-- for, in one table: which protocol's trades actually paid.
SELECT '=== per-protocol outcome (protocol-aware) ===' AS section;
SELECT protocolId, COUNT(*) AS n, ROUND(AVG(pnl), 2) AS avgPnl,
       SUM(pnl > 0) AS wins, ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct,
       ROUND(SUM(pnl), 2) AS totalPnl
FROM (
  SELECT t.pnl,
         (SELECT sp.protocolId FROM strategy_protocol sp WHERE sp.strategyId = ts.id LIMIT 1) AS protocolId
  FROM trade t
  JOIN trading_strategy ts ON ts.name = t.strategy
  JOIN signal_outcome_log sol
    ON sol.symbol = t.symbol
   AND sol.protocolId = (SELECT sp2.protocolId FROM strategy_protocol sp2 WHERE sp2.strategyId = ts.id LIMIT 1)
   AND sol.createdAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
  WHERE t.status = 'closed' AND t.pnl IS NOT NULL AND t.closedAt IS NOT NULL
) p
GROUP BY protocolId HAVING n >= 3 ORDER BY totalPnl ASC;
