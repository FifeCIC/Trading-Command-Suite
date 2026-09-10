SELECT p.slug,
       p.recommendedTimeframe,
       p.directionMode,
       COUNT(DISTINCT g.id) AS grp_count,
       COUNT(e.id) AS directive_count
FROM protocol p
LEFT JOIN protocol_directive_group g ON g.protocolId = p.id
LEFT JOIN protocol_directive_entry e ON e.groupId = g.id
WHERE p.active = 1
GROUP BY p.slug, p.recommendedTimeframe, p.directionMode
ORDER BY directive_count DESC
LIMIT 20;
