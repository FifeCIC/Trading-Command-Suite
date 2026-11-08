-- Prune orphan marketbar rows (#780).
--
-- An "orphan" is a row dated further ahead than its own timeframe length. A bar is
-- stamped by its OPEN time, so a currently-forming bar is legitimately ahead by up to
-- one bar length (a 15m bar can be 899s ahead). Anything BEYOND that cannot be a real
-- bar, and because the refresh only upserts timestamps it fetched (ON DUPLICATE KEY
-- UPDATE), the bridge never serves such a row again -> nothing can overwrite it.
--
-- SAFETY: this only deletes rows that are impossible by construction. It does not touch
-- forming bars, and it does not touch historical data.
--
-- BACKUP FIRST, then delete.

DROP TABLE IF EXISTS marketbar_future_orphan_backup_780;
CREATE TABLE marketbar_future_orphan_backup_780 AS
  SELECT * FROM marketbar
   WHERE timestamp > UTC_TIMESTAMP()
     AND TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), timestamp) > CASE timeframe
           WHEN '1m'  THEN 60
           WHEN '5m'  THEN 300
           WHEN '15m' THEN 900
           WHEN '1h'  THEN 3600
           WHEN '4h'  THEN 14400
           ELSE 86400 END;

SELECT COUNT(*) AS backed_up FROM marketbar_future_orphan_backup_780;

DELETE FROM marketbar
 WHERE timestamp > UTC_TIMESTAMP()
   AND TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), timestamp) > CASE timeframe
         WHEN '1m'  THEN 60
         WHEN '5m'  THEN 300
         WHEN '15m' THEN 900
         WHEN '1h'  THEN 3600
         WHEN '4h'  THEN 14400
         ELSE 86400 END;

SELECT ROW_COUNT() AS deleted;

-- Remaining "future" rows should now only be legitimate forming bars.
SELECT timeframe,
       COUNT(*) AS remaining_future,
       MAX(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), timestamp)) AS max_secs_ahead
  FROM marketbar
 WHERE timestamp > UTC_TIMESTAMP()
 GROUP BY timeframe;

-- The headline: symbols whose newest bar is stuck in the future.
WITH newest_per_symbol AS (
  SELECT symbolId, MAX(timestamp) AS newest FROM marketbar WHERE provider = 'mt5' GROUP BY symbolId
)
SELECT COUNT(*) AS symbols_total,
       SUM(newest > UTC_TIMESTAMP()) AS stuck_future
  FROM newest_per_symbol;
