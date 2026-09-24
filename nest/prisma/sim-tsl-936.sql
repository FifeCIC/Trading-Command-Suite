-- sim-tsl-936.sql — the per-bot SIMULATED TSL and its decision-moment log (#936, R20=A)
-- ===================================================================================
-- ⚠️ APPLIED BY HAND, NEVER BY `prisma db push`. This repo has 13 tables managed outside
-- Prisma (including the trade execution queue), no migration history, and `db push` silently
-- DROPs every unmodelled table. Run `npm --prefix nest run db:check` BEFORE and AFTER.
--
-- R20 (owner decision, 2026-09-24): post-entry exit management becomes PER-BOT DATA. The
-- StopGuardianService was one hardcoded global mechanism shared by every bot, which is why the
-- thing that actually locks in profit appeared nowhere on the bot page.
--
-- WHY THREE COLUMNS AND NOT ONE FLAG:
--   simTslEnabled       — default 0. ⚠️ DEFAULT-OFF IS THE CONTRACT, not a convenience: no
--                         existing bot changes behaviour, so nothing needs an A/B copy to ship.
--   simTslActivationPct — profit % at which the SIMULATED threshold arms.
--   simTslDistancePct   — the tighter trail distance. ⚠️ NOT sent to the broker. The broker stop
--                         stays where it is; this is a DECISION POINT, not an exit order.
-- NULL on either number means "not configured", which the engine treats as not-armed. There is
-- deliberately no default: a guessed trail distance would trail real positions against a fiction.
--
-- The event table exists because #936's caveat is explicit — "its firings must be recorded so a
-- decision-moment close is distinguishable from the broker stop being hit". Without it, a close
-- at a decision point and a close at the broker stop are the same row.

ALTER TABLE trading_strategy
  ADD COLUMN simTslEnabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN simTslActivationPct DOUBLE NULL,
  ADD COLUMN simTslDistancePct DOUBLE NULL;

CREATE TABLE IF NOT EXISTS sim_tsl_event (
  id             VARCHAR(36)  NOT NULL,
  tradeTicket    VARCHAR(100) NOT NULL,
  strategyId     VARCHAR(36)  NULL,
  strategyName   VARCHAR(200) NULL,
  symbol         VARCHAR(20)  NOT NULL,
  -- 'armed' = the threshold became active; 'decision-point' = price touched it; 'cleared' = it
  -- went back outside the threshold. Only 'decision-point' is a decision moment.
  event          VARCHAR(30)  NOT NULL,
  entryPrice     DOUBLE       NULL,
  -- the level the simulated threshold sat at, and the price observed when it was touched
  triggerPrice   DOUBLE       NULL,
  price          DOUBLE       NULL,
  profitPct      DOUBLE       NULL,
  distancePct    DOUBLE       NULL,
  activationPct  DOUBLE       NULL,
  -- ⚠️ 'recorded' is the ONLY value the current engine writes. Nothing is sent to the broker from
  -- this table's code path — acting on a decision point is a MATHS change and needs an A/B copy.
  action         VARCHAR(30)  NOT NULL DEFAULT 'recorded',
  detail         JSON         NULL,
  -- ⚠️ `DEFAULT (UTC_TIMESTAMP(3))`, NOT `CURRENT_TIMESTAMP(3)`. MySQL evaluates
  -- NOW()/CURRENT_TIMESTAMP in the SESSION timezone (SYSTEM = UTC+1 on this machine), so the
  -- latter would write every row an HOUR IN THE FUTURE relative to the UTC the app stores — with
  -- no error, which is the "plausible timestamp nothing downstream can question" class this repo
  -- guards (validate-local-time-sources.cjs fails the build on it; #844). Matches the existing
  -- convention in raw-managed/paper_trade.sql.
  occurredAt     DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  INDEX sim_tsl_event_ticket_occurredAt_idx (tradeTicket, occurredAt),
  INDEX sim_tsl_event_symbol_occurredAt_idx (symbol, occurredAt),
  INDEX sim_tsl_event_strategyId_occurredAt_idx (strategyId, occurredAt),
  -- Retention column must LEAD an index (validate-retention-columns.cjs).
  INDEX sim_tsl_event_occurredAt_idx (occurredAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
