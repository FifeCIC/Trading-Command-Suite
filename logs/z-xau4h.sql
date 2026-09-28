-- xau-speed-4h interrogation, 2026-09-28.
-- Three questions from the owner:
--   1. Is the protocol TRULY set up for 4 hours?
--   2. Is there a standard group of indicator settings for its directives?
--   3. Has the app been closing xau-speed-4h XAUUSD trades within 2-3 hours while IN PROFIT?

-- (1a) What the protocol DECLARES.
SELECT '=== (1a) xau protocols: declared config ===' AS section;
SELECT slug, active, recommendedTimeframe, directionMode, tradingStyle
FROM protocol
WHERE slug LIKE '%xau%' OR slug LIKE '%gold%'
ORDER BY slug;

-- (2a) The directives this protocol actually subscribes to, and their declared cadence floor.
--      `minTimeframe` is the directive's OWN statement of the finest cadence it may be run at.
SELECT '=== (2a) seeding intent: which group / which directives ===' AS section;
SELECT COUNT(*) AS protocol_directive_group_rows
FROM protocol_directive_group g
JOIN protocol p ON p.id = g.protocolId
WHERE p.slug LIKE '%xau-speed%';

-- (3a) Which BOTS are subscribed to an xau-speed protocol. This is the link that decides
--      whether a trade can be attributed to the protocol at all.
SELECT '=== (3a) bots subscribed to xau-speed* ===' AS section;
SELECT ts.name AS bot, ts.symbol, ts.active, ts.mode, ts.maxHoldHours, sp.protocolId
FROM strategy_protocol sp
JOIN trading_strategy ts ON ts.id = sp.strategyId
WHERE sp.protocolId LIKE '%xau-speed%'
ORDER BY ts.name;

-- (3b) THE QUESTION. Hold duration vs outcome for XAUUSD trades attributed to xau-speed-4h.
--      ⚠️ Attribution is by BOT NAME → strategy_protocol. If a trade's stored strategy name
--      matches no bot, it cannot be attributed at all — that is reported in (3c), not hidden.
SELECT '=== (3b) XAUUSD trades from xau-speed-4h bots ===' AS section;
SELECT ts.name AS bot, t.openedAt, t.closedAt,
       TIMESTAMPDIFF(MINUTE, t.openedAt, t.closedAt) AS holdMin,
       ROUND(t.pnl, 2) AS pnl, t.closeReason
FROM trade t
JOIN trading_strategy ts ON ts.name = t.strategy
JOIN strategy_protocol sp ON sp.strategyId = ts.id
WHERE t.symbol = 'XAUUSD' AND t.status = 'closed'
  AND sp.protocolId LIKE '%xau-speed-4h%'
ORDER BY t.closedAt DESC
LIMIT 40;

-- (3c) THE AGGREGATE. `closedUnder3hInProfit` is the owner's exact concern.
SELECT '=== (3c) summary ===' AS section;
SELECT COUNT(*) AS n,
       ROUND(AVG(holdMin), 0) AS avgHoldMin,
       SUM(pnl > 0) AS wins,
       SUM(pnl < 0) AS losses,
       ROUND(AVG(pnl), 2) AS avgPnl,
       SUM(holdMin <= 180 AND pnl > 0) AS closedUnder3hInProfit,
       SUM(holdMin <= 180) AS closedUnder3h
FROM (
  SELECT TIMESTAMPDIFF(MINUTE, t.openedAt, t.closedAt) AS holdMin, t.pnl
  FROM trade t
  JOIN trading_strategy ts ON ts.name = t.strategy
  JOIN strategy_protocol sp ON sp.strategyId = ts.id
  WHERE t.symbol = 'XAUUSD' AND t.status = 'closed'
    AND sp.protocolId LIKE '%xau-speed-4h%'
    AND t.closedAt IS NOT NULL
) z;

-- (3d) ATTRIBUTION COVERAGE — how much of the XAUUSD ledger can be tied to a protocol at all.
--      A low number here means question 3 can only be partly answered, and that must be visible.
SELECT '=== (3d) attribution coverage on XAUUSD closed trades ===' AS section;
SELECT COUNT(*) AS xauClosed,
       SUM(ts.id IS NOT NULL) AS botNameResolved,
       SUM(sp.id IS NOT NULL) AS hasProtocolSubscription,
       SUM(sp.protocolId LIKE '%xau-speed%') AS subscribedToXauSpeed
FROM trade t
LEFT JOIN trading_strategy ts ON ts.name = t.strategy
LEFT JOIN strategy_protocol sp ON sp.strategyId = ts.id
WHERE t.symbol = 'XAUUSD' AND t.status = 'closed';

-- (3e) All XAUUSD closed trades by hold duration — does the SHORT-hold pattern exist even where
--      attribution fails? This is the question without needing the protocol link.
SELECT '=== (3e) ALL XAUUSD: hold duration vs outcome ===' AS section;
SELECT CASE
         WHEN holdMin < 60 THEN 'a: <1h'
         WHEN holdMin < 180 THEN 'b: 1-3h'
         WHEN holdMin < 420 THEN 'c: 3-7h'
         ELSE 'd: 7h+' END AS holdBucket,
       COUNT(*) AS n,
       SUM(pnl > 0) AS wins,
       ROUND(AVG(pnl), 2) AS avgPnl,
       ROUND(100 * SUM(pnl > 0) / COUNT(*), 1) AS winRatePct
FROM (
  SELECT TIMESTAMPDIFF(MINUTE, openedAt, closedAt) AS holdMin, pnl
  FROM trade
  WHERE symbol = 'XAUUSD' AND status = 'closed' AND closedAt IS NOT NULL AND pnl IS NOT NULL
) z
GROUP BY holdBucket ORDER BY holdBucket;
