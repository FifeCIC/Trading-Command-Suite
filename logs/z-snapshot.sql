-- Which table actually holds the score a trade can be joined to?
--
-- Established so far: `signal_outcome_log.scoreId` does NOT reference `score.id` — 75% of its
-- 6,822 ids dangle, and the newest rows of each table share a timestamp but no ids at all.
-- `score_snapshot` also fails (0 matches).
--
-- ⚠️ `score.strategyId` holds a PROTOCOL SLUG (e.g. 'xau-speed-m15'), not a strategy UUID.
--    `score_snapshot.protocolId` also holds a slug. Read the value, not the column name.

SELECT '=== retention: how far back does each table go? ===' AS section;
SELECT 'score' AS tbl, COUNT(*) AS n, MIN(timestamp) AS first_row, MAX(timestamp) AS last_row FROM score
UNION ALL
SELECT 'score_snapshot', COUNT(*), MIN(snappedAt), MAX(snappedAt) FROM score_snapshot
UNION ALL
SELECT 'signal_outcome_log', COUNT(*), MIN(createdAt), MAX(createdAt) FROM signal_outcome_log;

-- Does a scoreSnapshot row exist near a trade's open, on the trade's own protocol?
-- Joining on symbol + protocol SLUG + time avoids the ambiguity of several protocols
-- scoring one symbol at once.
SELECT '=== can a trade be matched to a score_snapshot? ===' AS section;
SELECT COUNT(*) AS closed_trades_resolved_bot,
       SUM((SELECT 1 FROM score_snapshot ss
             WHERE ss.symbol = t.symbol
               AND ss.protocolId = (SELECT sp.protocolId FROM strategy_protocol sp
                                     WHERE sp.strategyId = ts.id LIMIT 1)
               AND ss.snappedAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             LIMIT 1) IS NOT NULL) AS matched_to_snapshot
FROM trade t
JOIN trading_strategy ts ON ts.name = t.strategy
WHERE t.status = 'closed' AND t.openedAt IS NOT NULL;

-- ⚠️ The same, but NOT protocol-restricted, to show how many EXTRA hits a naive join would take —
--    i.e. how much of the naive match is a different protocol scoring the same symbol.
SELECT '=== same, ignoring protocol (the inflated number) ===' AS section;
SELECT COUNT(*) AS closed_trades_resolved_bot,
       SUM((SELECT 1 FROM score_snapshot ss
             WHERE ss.symbol = t.symbol
               AND ss.snappedAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             LIMIT 1) IS NOT NULL) AS matched_any_protocol
FROM trade t
JOIN trading_strategy ts ON ts.name = t.strategy
WHERE t.status = 'closed' AND t.openedAt IS NOT NULL;

-- The payoff: score (composite) vs outcome, now sourced from score_snapshot and protocol-matched.
SELECT '=== composite vs outcome (score_snapshot, protocol-matched) ===' AS section;
SELECT bucket, COUNT(*) AS n, ROUND(AVG(composite), 1) AS avgComposite,
       ROUND(AVG(pnl), 2) AS avgPnl, SUM(pnl > 0) AS wins,
       ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT pnl, composite,
         CASE
           WHEN composite <  10 THEN 'a: <10'
           WHEN composite <  20 THEN 'b: 10-19'
           WHEN composite <  40 THEN 'c: 20-39'
           WHEN composite <  80 THEN 'd: 40-79'
           ELSE 'e: 80+'
         END AS bucket
  FROM (
    SELECT t.pnl,
           (SELECT ss.composite FROM score_snapshot ss
             WHERE ss.symbol = t.symbol
               AND ss.protocolId = (SELECT sp.protocolId FROM strategy_protocol sp
                                     WHERE sp.strategyId = ts.id LIMIT 1)
               AND ss.snappedAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             ORDER BY ss.snappedAt DESC LIMIT 1) AS composite
    FROM trade t
    JOIN trading_strategy ts ON ts.name = t.strategy
    WHERE t.status = 'closed' AND t.pnl IS NOT NULL AND t.closedAt IS NOT NULL
  ) s
) b
GROUP BY bucket ORDER BY bucket;
