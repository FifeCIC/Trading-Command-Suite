-- Why don't the numbers match up? Full diagnostic, 2026-09-28.
--
-- 285 closed trades. 32 queue rows. 6,806 signal_outcome_log rows. 21 executed queue rows.
-- This works out where trades actually come from, and tests whether attribution is ALREADY
-- possible by join — which would mean no schema change is needed.

-- (a) WHERE DO CLOSED TRADES COME FROM? `origin` / `source` / `provider` decide the path.
SELECT '=== (a) closed-trade provenance ===' AS section;
SELECT origin, provider, COALESCE(source, '(null)') AS source, COUNT(*) AS n
FROM trade WHERE status = 'closed'
GROUP BY origin, provider, source ORDER BY n DESC;

-- (b) HOW MANY ARE A/B EXPERIMENTS? They must be excluded from any performance claim.
SELECT '=== (b) experiment share ===' AS section;
SELECT COUNT(*) AS closed_total,
       SUM(abTestId IS NOT NULL) AS in_ab_test,
       SUM(strategy IS NULL OR strategy = '') AS no_strategy_name,
       MIN(closedAt) AS first_close, MAX(closedAt) AS last_close
FROM trade WHERE status = 'closed';

-- (c) TRADE VOLUME OVER TIME vs the queue's lifetime. The queue only starts 2026-09-10 —
--     if most trades predate it, the queue is not the path they took.
SELECT '=== (c) closed trades per week ===' AS section;
SELECT DATE_FORMAT(closedAt, '%Y-%W') AS week, COUNT(*) AS n
FROM trade WHERE status = 'closed' AND closedAt IS NOT NULL
GROUP BY week ORDER BY week;

-- (d) The queue's own lifetime and how many trades fall inside it.
SELECT '=== (d) queue lifetime vs trades in that window ===' AS section;
SELECT (SELECT MIN(createdAt) FROM strategy_signal_queue) AS queue_first,
       (SELECT MAX(createdAt) FROM strategy_signal_queue) AS queue_last,
       (SELECT COUNT(*) FROM trade WHERE status='closed'
          AND closedAt >= (SELECT MIN(createdAt) FROM strategy_signal_queue)) AS trades_since_queue_started;

-- (e) THE KEY EXPERIMENT. Can a closed trade be linked to a signal_outcome_log row by
--     symbol + time? If yes, attribution needs NO schema change — the score and the protocol
--     are already reachable. Three windows, to see how tight the link really is.
SELECT '=== (e) trade -> signal_outcome_log match rate ===' AS section;
SELECT
  SUM(sol5.id IS NOT NULL)  AS matched_5min,
  SUM(sol15.id IS NOT NULL) AS matched_15min,
  SUM(sol60.id IS NOT NULL) AS matched_60min,
  COUNT(*) AS closed_trades
FROM trade t
LEFT JOIN signal_outcome_log sol5  ON sol5.symbol  = t.symbol AND sol5.createdAt  BETWEEN t.openedAt - INTERVAL 5 MINUTE  AND t.openedAt + INTERVAL 5 MINUTE
LEFT JOIN signal_outcome_log sol15 ON sol15.symbol = t.symbol AND sol15.createdAt BETWEEN t.openedAt - INTERVAL 15 MINUTE AND t.openedAt + INTERVAL 15 MINUTE
LEFT JOIN signal_outcome_log sol60 ON sol60.symbol = t.symbol AND sol60.createdAt BETWEEN t.openedAt - INTERVAL 60 MINUTE AND t.openedAt + INTERVAL 60 MINUTE
WHERE t.status = 'closed' AND t.openedAt IS NOT NULL;

-- (f) A WORKED SAMPLE. If (e) is promising, this shows what the attribution would actually say:
--     the trade, the score that preceded it, and the protocol that produced it.
SELECT '=== (f) worked sample: trade + nearest preceding signal ===' AS section;
SELECT t.symbol, LEFT(COALESCE(t.strategy,'(none)'),22) AS bot,
       t.openedAt, ROUND(t.pnl,2) AS pnl,
       (SELECT sol.scoreId FROM signal_outcome_log sol
         WHERE sol.symbol = t.symbol AND sol.createdAt <= t.openedAt
         ORDER BY sol.createdAt DESC LIMIT 1) AS scoreId,
       (SELECT sol.protocolId FROM signal_outcome_log sol
         WHERE sol.symbol = t.symbol AND sol.createdAt <= t.openedAt
         ORDER BY sol.createdAt DESC LIMIT 1) AS protocolId,
       (SELECT TIMESTAMPDIFF(MINUTE, sol.createdAt, t.openedAt) FROM signal_outcome_log sol
         WHERE sol.symbol = t.symbol AND sol.createdAt <= t.openedAt
         ORDER BY sol.createdAt DESC LIMIT 1) AS minsBeforeOpen
FROM trade t
WHERE t.status='closed' AND t.symbol='XAUUSD'
ORDER BY t.openedAt DESC LIMIT 12;
