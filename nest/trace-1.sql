-- ============================================================
-- META.Stack FULL TRACE — a symbol that registers but never trades
-- ============================================================

SELECT '=== STAGE 1: REGISTRY (MT5-tradeable types) ===' AS step;
SELECT s.type,
       COUNT(*) AS registered,
       SUM(CASE WHEN b.n > 0 THEN 1 ELSE 0 END) AS has_bars
FROM symbol s
LEFT JOIN (SELECT symbolId, COUNT(*) AS n FROM marketbar GROUP BY symbolId) b
       ON b.symbolId = s.id
WHERE s.active = 1 AND s.type IN ('forex', 'commodity', 'index', 'crypto')
GROUP BY s.type
ORDER BY registered DESC;

SELECT '=== STAGE 1b: bar coverage per MT5-tradeable symbol ===' AS step;
SELECT s.ticker,
       s.type,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id AND b.timeframe = '1d')  AS b_1d,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id AND b.timeframe = '1h')  AS b_1h,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id AND b.timeframe = '15m') AS b_15m,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id AND b.timeframe = '5m')  AS b_5m,
       (SELECT MAX(b.timestamp) FROM marketbar b WHERE b.symbolId = s.id) AS newest_bar
FROM symbol s
WHERE s.active = 1 AND s.type IN ('forex', 'commodity', 'index', 'crypto')
ORDER BY s.type, s.ticker;
