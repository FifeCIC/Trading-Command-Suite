-- Clean up Test/Cross trading strategies and default protocols
-- These were auto-trading with minComposite=3 (effectively "trade on any score")
-- All are now inactive but cluttering the DB

-- Step 1: Delete trading strategies using built-in-default/built-in-short (Test/Cross)
DELETE FROM trading_strategy 
WHERE protocolId IN ('built-in-default', 'built-in-short')
   OR shortProtocolId IN ('built-in-default', 'built-in-short');

-- Step 2: Delete scoring strategies using these protocols
DELETE FROM scoring_strategy 
WHERE protocolId IN ('built-in-default', 'built-in-short');

-- Step 3: Delete protocol directive entries
DELETE pde FROM protocol_directive_entry pde
JOIN protocol_directive_group pdg ON pdg.id = pde.groupId
WHERE pdg.protocolId IN (
  SELECT id FROM protocol WHERE slug IN ('built-in-default', 'built-in-short')
);

-- Step 4: Delete protocol directive groups
DELETE FROM protocol_directive_group 
WHERE protocolId IN (
  SELECT id FROM protocol WHERE slug IN ('built-in-default', 'built-in-short')
);

-- Step 5: Delete the protocols themselves
DELETE FROM protocol WHERE slug IN ('built-in-default', 'built-in-short');

-- Verify
SELECT COUNT(*) as trading_strategies_remaining FROM trading_strategy;
SELECT COUNT(*) as scoring_strategies_remaining FROM scoring_strategy;
SELECT COUNT(*) as protocols_remaining FROM protocol;
