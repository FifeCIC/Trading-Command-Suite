SELECT '== J1. the 09-30 AB pile totals ==' AS x;
SELECT COUNT(*) rowsN, ROUND(SUM(pnl),2) totalPnl, SUM(pnl = -32.267) AS atMinus32, SUM(pnl = -322.67) AS atMinus322
FROM trade WHERE brokerComment LIKE 'TCS AB-%' AND status='closed' AND openedAt BETWEEN '2026-09-30 00:00:00' AND '2026-10-01 00:00:00';
SELECT '== J2. gold bots activity since 09:40 today (the AB hold window) ==' AS x;
SELECT ts.name, dl.timestamp, dl.decision, LEFT(dl.reason,100) AS reason FROM decision_log dl JOIN trading_strategy ts ON ts.id=dl.strategyId WHERE ts.symbol='XAUUSD' AND dl.timestamp >= '2026-10-07 09:40:00' ORDER BY dl.timestamp DESC LIMIT 12;
SELECT '== J3. all XAUUSD trades today ==' AS x;
SELECT brokerTicket, LEFT(brokerComment,40) cmt, quantity, entryPrice, sl, tp, status, openedAt, LEFT(strategy,24) strat FROM trade WHERE symbol='XAUUSD' AND openedAt >= '2026-10-07 00:00:00' ORDER BY openedAt DESC LIMIT 8;
SELECT '== J4. gold bots: any trade in last 7 days ==' AS x;
SELECT ts.name, MAX(t.openedAt) AS lastTrade, COUNT(*) AS n FROM trade t JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE ts.symbol='XAUUSD' AND t.openedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY ts.id ORDER BY lastTrade DESC;
