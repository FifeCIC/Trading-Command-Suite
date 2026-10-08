SELECT '== H1. b50727ee tagged trades since its start ==' AS x;
SELECT abTestSide, COUNT(*) c, SUM(status='closed') closedN, SUM(status='open') openN, ROUND(SUM(pnl),2) pnl, MAX(openedAt) lastOpen
FROM trade WHERE abTestId='b50727ee-b721-47b4-b056-506e56844d42' AND openedAt >= '2026-10-06 20:36:00' GROUP BY abTestSide;
SELECT '== H2. AB-comment rows since the restart (tagged or not) ==' AS x;
SELECT abTestId IS NOT NULL AS tagged, status, COUNT(*) c, MIN(openedAt) firstAt, MAX(openedAt) lastAt
FROM trade WHERE brokerComment LIKE 'TCS AB-%' AND openedAt >= '2026-10-06 20:36:00' GROUP BY tagged, status;
SELECT '== H3. gold stop_adjustment sample ==' AS x;
SELECT sa.tradeTicket, sa.oldSl, sa.newSl, LEFT(sa.reason,95) AS reason, sa.adjustedAt FROM stop_adjustment sa JOIN trade t ON t.brokerTicket=sa.tradeTicket WHERE t.symbol='XAUUSD' ORDER BY sa.adjustedAt DESC LIMIT 6;
SELECT '== H4. open gold positions now ==' AS x;
SELECT t.brokerTicket, ts.name, t.quantity, t.entryPrice, t.sl, t.tp, t.openedAt, LEFT(t.brokerComment,42) cmt, t.magic FROM trade t LEFT JOIN trading_strategy ts ON ts.id=t.scoringStrategyId WHERE t.symbol='XAUUSD' AND t.status='open' ORDER BY t.openedAt DESC;
SELECT '== H5. the -322 trade detail ==' AS x;
SELECT id, provider, origin, source, scoringStrategyId, strategy, brokerComment, magic, swap, commission, fee, pnlRaw, exitPriceRaw, pnlInvalid, pnlInvalidReason FROM trade WHERE brokerTicket='152703882760';
SELECT '== H6. all XAUUSD orders 2026-09-30 ==' AS x;
SELECT brokerTicket, LEFT(scoringStrategyId,8) AS bot8, LEFT(strategy,22) AS strat, LEFT(brokerComment,40) cmt, quantity, entryPrice, pnl, status, openedAt, closedAt FROM trade WHERE symbol='XAUUSD' AND openedAt BETWEEN '2026-09-30 00:00:00' AND '2026-10-01 00:00:00' ORDER BY openedAt;
SELECT '== H7. rejected AB rows still tagged ==' AS x;
SELECT COUNT(*) rejectedTagged FROM trade WHERE status='rejected' AND abTestId IS NOT NULL;
SELECT '== H8. open positions by symbol ==' AS x;
SELECT symbol, COUNT(*) c FROM trade WHERE status='open' GROUP BY symbol ORDER BY c DESC LIMIT 12;
