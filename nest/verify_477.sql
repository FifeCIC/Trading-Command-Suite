SELECT 'order_table' as item, COUNT(*) as cnt FROM tradingcs.order
UNION ALL
SELECT 'portfolio_snapshot', COUNT(*) FROM tradingcs.portfolio_snapshot
UNION ALL
SELECT 'decision_trail', COUNT(*) FROM tradingcs.decision_trail
UNION ALL
SELECT 'stop_adjustment', COUNT(*) FROM tradingcs.stop_adjustment;
