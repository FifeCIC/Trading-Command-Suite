-- Corrected attribution measurement.
--
-- ⚠️ WHY THE PREVIOUS (e) WAS WRONG. It used three LEFT JOINs to signal_outcome_log, each
-- matching MANY rows per trade. A LEFT JOIN fans out — so `matched_5min` came back as 74,557
-- against 75,016 trades. A count larger than the population is the tell. Nothing here joins
-- many-to-many; every measure uses a correlated subquery or EXISTS, which cannot fan out.

-- (a) TRUE match rate for a naive symbol+time join (correlated, so no fan-out).
SELECT '=== (a) TRUE match rate: symbol + time only ===' AS section;
SELECT COUNT(*) AS closed_trades,
       SUM((SELECT 1 FROM signal_outcome_log sol
             WHERE sol.symbol = t.symbol
               AND sol.createdAt BETWEEN t.openedAt - INTERVAL 5 MINUTE AND t.openedAt
             LIMIT 1) IS NOT NULL) AS matched_5min_before,
       SUM((SELECT 1 FROM signal_outcome_log sol
             WHERE sol.symbol = t.symbol
               AND sol.createdAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             LIMIT 1) IS NOT NULL) AS matched_30min_before
FROM trade t
WHERE t.status = 'closed' AND t.openedAt IS NOT NULL;

-- (b) PROTOCOL-AWARE match rate — the join that can actually be trusted.
--     A symbol can be scored by SEVERAL protocols at once (XAUUSD is scored by six xau-speed
--     variants), so "nearest signal" can easily be the WRONG protocol. Requiring the signal's
--     protocol to be one the bot is actually SUBSCRIBED to removes that ambiguity.
SELECT '=== (b) PROTOCOL-AWARE match rate ===' AS section;
SELECT COUNT(*) AS closed_trades,
       SUM((SELECT 1 FROM signal_outcome_log sol
              JOIN strategy_protocol sp2 ON sp2.protocolId = sol.protocolId
             WHERE sp2.strategyId = ts.id
               AND sol.symbol = t.symbol
               AND sol.createdAt BETWEEN t.openedAt - INTERVAL 30 MINUTE AND t.openedAt
             LIMIT 1) IS NOT NULL) AS matched_protocol_aware
FROM trade t
JOIN trading_strategy ts ON ts.name = t.strategy
WHERE t.status = 'closed' AND t.openedAt IS NOT NULL;

-- (c) Does nearest-signal agree with the bot's own subscription? Cases where they DISAGREE are
--     exactly the ones a naive join would attribute to the wrong protocol.
SELECT '=== (c) naive vs protocol-aware: do they agree? ===' AS section;
SELECT t.symbol, LEFT(t.strategy,20) AS bot,
       (SELECT sol.protocolId FROM signal_outcome_log sol
         WHERE sol.symbol = t.symbol AND sol.createdAt <= t.openedAt
         ORDER BY sol.createdAt DESC LIMIT 1) AS nearest_protocol,
       (SELECT sp.protocolId FROM strategy_protocol sp WHERE sp.strategyId = ts.id LIMIT 1) AS bot_protocol
FROM trade t
JOIN trading_strategy ts ON ts.name = t.strategy
WHERE t.status = 'closed' AND t.symbol = 'XAUUSD'
ORDER BY t.openedAt DESC LIMIT 10;

-- (d) The score table shape — needed to turn a scoreId into an actual score VALUE.
SELECT '=== (d) score table columns ===' AS section;
SELECT column_name, column_type FROM information_schema.columns
WHERE table_schema='tradingcs' AND table_name='score' ORDER BY ordinal_position;
