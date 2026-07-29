SELECT p.slug, p.name, COUNT(pde.id) as directive_count 
FROM protocol p 
JOIN protocol_directive_group pdg ON pdg.protocolId = p.id 
JOIN protocol_directive_entry pde ON pde.groupId = pdg.id 
GROUP BY p.id, p.slug, p.name 
ORDER BY directive_count DESC 
LIMIT 10;
