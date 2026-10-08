SELECT '== G1. gold bots (active) ==' AS x;
SELECT name, protocolId, timeframe, minComposite, mode, slPct, tpPct, baseSize, cooldownMinutes, sessionWindow, maxHoldHours, maxPyramidTiers, magic, duplicatedFromId, version, createdAt, updatedAt
FROM trading_strategy WHERE symbol='XAUUSD' AND active=1 ORDER BY name;
SELECT '== G2. subscriptions ==' AS x;
SELECT ts.name, sp.protocolId, sp.role
FROM strategy_protocol sp JOIN trading_strategy ts ON ts.id=sp.strategyId
WHERE ts.symbol='XAUUSD' AND ts.active=1 ORDER BY ts.name;
SELECT '== G3. gold protocols ==' AS x;
SELECT slug, name, directionMode, tradingStyle, recommendedTimeframe, active, version, derivedFrom, highestScore
FROM protocol WHERE slug LIKE 'xau-speed%';
SELECT '== G4. ab_test columns ==' AS x;
SHOW COLUMNS FROM ab_test;
SELECT '== G5. ab_test rows ==' AS x;
SELECT id, name, symbol, status, createdAt, updatedAt FROM ab_test ORDER BY createdAt DESC LIMIT 6;
SELECT '== G6. gold trades per bot ==' AS x;
SELECT ts.name, COUNT(*) AS trades, SUM(t.status='open') AS openN, SUM(t.status='closed') AS closedN,
       SUM(CASE WHEN t.status='closed' AND t.pnl>0 THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN t.status='closed' AND t.pnl<0 THEN 1 ELSE 0 END) AS losses,
       ROUND(SUM(CASE WHEN t.status='closed' THEN t.pnl ELSE 0 END),2) AS netPnl,
       ROUND(AVG(CASE WHEN t.status='closed' THEN t.pnl END),2) AS avgPnl
FROM trade t JOIN trading_strategy ts ON ts.id=t.scoringStrategyId
WHERE ts.symbol='XAUUSD' GROUP BY ts.id ORDER BY netPnl;
SELECT '== G7. gold closes by reason/bot ==' AS x;
SELECT ts.name, t.closeReason, COUNT(*) c FROM trade t JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE ts.symbol='XAUUSD' AND t.status='closed' GROUP BY ts.name, t.closeReason ORDER BY ts.name, c DESC;
SELECT '== G8. recent gold trades (12) ==' AS x;
SELECT t.brokerTicket, ts.name, t.side, t.quantity, t.entryPrice, t.exitPrice, t.pnl, t.status, t.openedAt, t.closedAt, TIMESTAMPDIFF(MINUTE,t.openedAt,t.closedAt) AS holdMin, t.closeReason, t.magic, t.abTestId, t.abTestSide, LEFT(t.brokerComment,40) AS cmt, ROUND(t.peakProfitPct,2) AS peakPct, t.signalAgeAtExecutionMinutes
FROM trade t JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE ts.symbol='XAUUSD' ORDER BY t.openedAt DESC LIMIT 12;
SELECT '== G9. AB-tagged trades ==' AS x;
SELECT t.abTestId, t.abTestSide, COUNT(*) c, SUM(t.status='closed') closedN, ROUND(SUM(t.pnl),2) pnl FROM trade t WHERE t.abTestId IS NOT NULL GROUP BY t.abTestId, t.abTestSide;
SELECT '== G10. gold magics on trades ==' AS x;
SELECT t.magic, COUNT(*) c FROM trade t JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE ts.symbol='XAUUSD' GROUP BY t.magic;
SELECT '== G11. decision_log: Gold Scalp M5 copy, last 15 ==' AS x;
SELECT timestamp, decision, LEFT(reason,130) AS reason, compositePct FROM decision_log WHERE strategyId=(SELECT id FROM trading_strategy WHERE name='Gold Scalp M5 (copy)') ORDER BY timestamp DESC LIMIT 15;
SELECT '== G12. stop_adjustment: gold totals ==' AS x;
SELECT COUNT(*) AS goldAdjustments, COUNT(DISTINCT sa.tradeTicket) AS tickets FROM stop_adjustment sa JOIN trade t ON t.brokerTicket=sa.tradeTicket JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE ts.symbol='XAUUSD';
SELECT '== G13. signal_outcome_log XAUUSD recent ==' AS x;
SELECT createdAt, protocolId, preTradeReady, blockerCount FROM signal_outcome_log WHERE symbol='XAUUSD' ORDER BY createdAt DESC LIMIT 10;
SELECT '== G14. score_snapshot by gold protocol (7d) ==' AS x;
SELECT protocolId, COUNT(*) c, MAX(snappedAt) lastSnap FROM score_snapshot WHERE protocolId LIKE 'xau-speed%' AND snappedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY protocolId;
