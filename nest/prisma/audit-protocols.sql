-- Find scoring strategies and their protocols
SELECT ss.id, ss.name, ss.protocolId, p.slug as protocol_slug, ss.watchlistId
FROM scoring_strategy ss
LEFT JOIN protocol p ON p.id = ss.protocolId
ORDER BY ss.name;

-- Find trading strategies with Test in name
SELECT ts.id, ts.name, ts.symbol, ts.mode, ts.active, ts.protocolId, ss.name as scoringName
FROM trading_strategy ts
LEFT JOIN scoring_strategy ss ON ss.id = ts.scoringStrategyId
WHERE ts.name LIKE '%Test%' OR ts.name LIKE '%test%'
ORDER BY ts.name;

-- Count directive entries per protocol
SELECT p.slug, COUNT(pde.id) as directive_count
FROM protocol p
JOIN protocol_directive_group pdg ON pdg.protocolId = p.id
JOIN protocol_directive_entry pde ON pde.groupId = pdg.id
GROUP BY p.slug
ORDER BY directive_count DESC
LIMIT 5;
