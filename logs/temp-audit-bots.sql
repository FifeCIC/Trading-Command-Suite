SELECT '== A1. active bots: config + subscription matrix ==' AS x;
SELECT ts.name, ts.symbol, ts.protocolId AS botProtocol, GROUP_CONCAT(sp.protocolId) AS subs,
       ts.minComposite AS bar, ts.mode, ts.sessionWindow AS sess, ts.shortProtocolId AS shortP,
       ts.simTslEnabled AS simTsl, ts.exhaustionObserveEnabled AS exh, ts.hotStockEnabled AS hot,
       ts.exitBeforeUtc AS exitUtc
FROM trading_strategy ts LEFT JOIN strategy_protocol sp ON sp.strategyId = ts.id
WHERE ts.active = 1
GROUP BY ts.id
ORDER BY ts.protocolId, ts.name;
SELECT '== A2. mismatches: botProtocol vs subscription ==' AS x;
SELECT ts.name, ts.protocolId AS botProtocol, GROUP_CONCAT(sp.protocolId) AS subs
FROM trading_strategy ts LEFT JOIN strategy_protocol sp ON sp.strategyId = ts.id
WHERE ts.active = 1
GROUP BY ts.id
HAVING GROUP_CONCAT(sp.protocolId) IS NULL
    OR (ts.protocolId IS NOT NULL AND FIND_IN_SET(ts.protocolId, GROUP_CONCAT(sp.protocolId)) = 0)
    OR (ts.protocolId IS NULL AND GROUP_CONCAT(sp.protocolId) IS NOT NULL);
