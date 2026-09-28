-- Is the score/signal actually recorded against a trade? The owner's instinct says it should be.
-- This checks rather than asserts.

-- (a) Where does a score reference live at all?
SELECT '=== (a) columns holding a score reference ===' AS section;
SELECT table_name, column_name, column_type
FROM information_schema.columns
WHERE table_schema = 'tradingcs' AND column_name LIKE '%scoreId%'
ORDER BY table_name;

-- (b) Are there tables that could join a trade to a decision?
SELECT '=== (b) decision / trail / evaluation tables ===' AS section;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'tradingcs'
  AND (table_name LIKE '%decision%' OR table_name LIKE '%evaluation%' OR table_name LIKE '%trail%')
ORDER BY table_name;

-- (c) The queue holds the score AND the protocol. How well populated is it?
SELECT '=== (c) strategy_signal_queue population ===' AS section;
SELECT COUNT(*) AS rows_total,
       SUM(scoreId IS NOT NULL) AS with_scoreId,
       SUM(compositePct IS NOT NULL) AS with_compositePct,
       SUM(protocolId IS NOT NULL) AS with_protocolId,
       MIN(createdAt) AS first_row,
       MAX(createdAt) AS last_row
FROM strategy_signal_queue;

-- (d) What statuses do queue rows carry? Only some of these became trades.
SELECT '=== (d) queue statuses ===' AS section;
SELECT status, COUNT(*) AS n, SUM(scoreId IS NOT NULL) AS with_score
FROM strategy_signal_queue GROUP BY status ORDER BY n DESC;

-- (e) Does scoreId actually resolve to a real score row? A populated-but-dangling FK would
--     look like a link and behave like one that does not exist.
SELECT '=== (e) does scoreId resolve? ===' AS section;
SELECT COUNT(*) AS queue_rows_with_scoreId,
       SUM(s.id IS NOT NULL) AS resolves_to_score
FROM strategy_signal_queue q
LEFT JOIN score s ON s.id = q.scoreId
WHERE q.scoreId IS NOT NULL;

-- (f) How many CLOSED trades carry a brokerComment / magic that could carry the tag?
SELECT '=== (f) closed-trade identification fields ===' AS section;
SELECT COUNT(*) AS closed_trades,
       SUM(brokerComment IS NOT NULL AND brokerComment <> '') AS with_brokerComment,
       SUM(magic IS NOT NULL) AS with_magic,
       SUM(scoringStrategyId IS NOT NULL) AS with_scoringStrategyId,
       SUM(signalAgeAtExecutionMinutes IS NOT NULL) AS with_signalAge
FROM trade
WHERE status = 'closed';

-- (g) THE REAL TEST: can a closed trade be joined to a queue row that holds its score?
--     Matched on bot subscription + symbol, within a 2-hour window around the open.
SELECT '=== (g) trade -> queue match rate (2h window) ===' AS section;
SELECT COUNT(*) AS closed_trades,
       SUM(q.id IS NOT NULL) AS matched_to_queue,
       SUM(q.compositePct IS NOT NULL) AS matched_with_score
FROM trade t
LEFT JOIN trading_strategy ts ON ts.name = t.strategy
LEFT JOIN strategy_signal_queue q
       ON q.strategyId = ts.id
      AND q.symbol = t.symbol
      AND q.createdAt BETWEEN t.openedAt - INTERVAL 2 HOUR AND t.openedAt + INTERVAL 2 HOUR
WHERE t.status = 'closed';
