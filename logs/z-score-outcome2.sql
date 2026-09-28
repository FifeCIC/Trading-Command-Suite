-- THE PAYOFF: does a higher score produce a better outcome?
--
-- Attribution method, and why it is this one:
--   A symbol is scored by MANY protocols at the same instant (XAUUSD by six xau-speed variants).
--   Matching on symbol+time alone picks the wrong protocol ~6 times in 10 (measured 2026-09-28).
--   So a signal counts only if its protocol is one the trade's BOT is actually SUBSCRIBED to.
--
-- ⚠️ Scalar subqueries, never JOINs. A JOIN to signal_outcome_log fans out — an earlier attempt
-- returned 74,557 matches against 75,016 trades, i.e. a count LARGER than the population.

SELECT '=== score vs outcome (protocol-aware attribution) ===' AS section;
SELECT bucket, COUNT(*) AS n,
       ROUND(AVG(pnl), 2) AS avgPnl,
       SUM(pnl > 0) AS wins,
       ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT pnl,
         CASE
           WHEN score IS NULL  THEN 'z: unattributed'
           WHEN score <  10    THEN 'a: <10'
           WHEN score <  20    THEN 'b: 10-19'
           WHEN score <  40    THEN 'c: 20-39'
           ELSE 'd: 40+'
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
  ) scored
) bucketed
GROUP BY bucket ORDER BY bucket;

-- Same population, but split by HOLD TIME as well. The 7h+ bucket carried a 6.5% win rate across
-- all XAUUSD; this asks whether that is a score problem or purely a holding problem.
SELECT '=== score vs outcome, 7h+ holds only ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(pnl), 2) AS avgPnl,
       SUM(pnl > 0) AS wins, ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT pnl,
         CASE
           WHEN score IS NULL THEN 'z: unattributed'
           WHEN score <  10   THEN 'a: <10'
           WHEN score <  20   THEN 'b: 10-19'
           ELSE 'c: 20+'
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
      AND TIMESTAMPDIFF(MINUTE, t.openedAt, t.closedAt) >= 420
  ) scored
) bucketed
GROUP BY bucket ORDER BY bucket;
