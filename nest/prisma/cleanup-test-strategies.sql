-- Delete all TEST and Cross trading strategies (inactive, minComposite=3, using built-in-default)
DELETE FROM trading_strategy WHERE name LIKE '%TEST%' OR name LIKE '%Cross%';

-- Delete scoring strategies that use built-in-default or built-in-short 
-- (only if they're the generic default ones, not protocol-specific ones)
DELETE FROM scoring_strategy WHERE protocolId IN ('built-in-default', 'built-in-short');

-- Verify
SELECT COUNT(*) as remaining_trading FROM trading_strategy;
SELECT COUNT(*) as remaining_scoring FROM scoring_strategy;
SELECT slug, name FROM protocol WHERE slug IN ('built-in-default', 'built-in-short');
