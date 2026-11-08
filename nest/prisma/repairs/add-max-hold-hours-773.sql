-- #773 — add the position time-stop hold limit.
--
-- WHY A PLAIN ALTER AND NOT `prisma db push`:
-- this repo has NO migration history and 10+ tables that Prisma does not model. `db push`
-- treats schema.prisma as complete truth and DROPS every table with no model — including
-- `strategy_signal_queue` and the #750 timestamp-repair backups. It does not error; it
-- warns and waits for a `y`. See `.github/instructions/database-schema.instructions.md`.
--
-- WHY THE COLUMN IS NEEDED AT ALL:
-- `maxHoldDuration` was declared on the TradingStrategy *interface* (default '30d') but
-- was never persisted, so there was nothing to read and NO time-based exit existed. Slots
-- filled and stayed filled: 11 active auto bots shared 5 broker-wide slots, 633 decisions
-- in 24h produced 2 trades, and composites of 81/82 sat BLOCKED on the position cap.
--
-- NULL means NO LIMIT, so every existing strategy's behaviour is unchanged until it opts in.
--
-- Idempotent: safe to re-run.

-- 1. The enforcement source of truth.
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trading_strategy' AND COLUMN_NAME = 'maxHoldHours'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE trading_strategy ADD COLUMN maxHoldHours INT NULL COMMENT ''Position time-stop hours; NULL = no limit (#773)'' AFTER hotStockMaxHoldHours',
  'SELECT ''trading_strategy.maxHoldHours already present'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Mirror on scoring_strategy so the settings surface and the enforcement path cannot
--    disagree about what a strategy allows.
SET @exists2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scoring_strategy' AND COLUMN_NAME = 'maxHoldHours'
);
SET @sql2 := IF(@exists2 = 0,
  'ALTER TABLE scoring_strategy ADD COLUMN maxHoldHours INT NULL COMMENT ''Position time-stop hours; NULL = no limit (#773)'' AFTER hotStockMaxHoldHours',
  'SELECT ''scoring_strategy.maxHoldHours already present'' AS note');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- 3. Verify.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME = 'maxHoldHours'
 ORDER BY TABLE_NAME;

-- 4. Current state: how many strategies would have a limit, and what are they trading?
SELECT COUNT(*)                                            AS strategies_total,
       SUM(maxHoldHours IS NOT NULL)                       AS with_limit,
       SUM(maxHoldHours IS NULL)                           AS no_limit,
       SUM(active = 1)                                     AS active,
       SUM(active = 1 AND mode = 'auto')                   AS active_auto
  FROM trading_strategy;
