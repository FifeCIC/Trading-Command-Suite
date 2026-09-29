-- #986 — Backtest periods: a named, noted window you capture and reuse.
--
-- ⚠️ WHY A .sql FILE AND NOT `prisma db push`.
-- This repo has NO migration history and 13 tables managed outside Prisma. `db push` treats
-- schema.prisma as the complete truth and DROPS every table with no model — including the trade
-- execution queue. It warns and waits for a `y`. See database-schema.instructions.md and #769.
-- So the DDL is applied by hand and recorded here, because with no migrations this file IS the
-- migration history.
--
-- ⚠️ ENGINE=MyISAM is not a choice — every existing table here is MyISAM, which does NOT support
-- foreign keys. So there is NO FK from `backtest_period.symbolId` to `symbol.id`, exactly as there
-- is none between `marketbar` and `symbol` today. The relation is declared in schema.prisma and is
-- LOGICAL. A symbol deleted from `symbol` does NOT cascade to these rows; reconcile by query.
--
-- Applied: 2026-09-29

CREATE TABLE `backtest_period` (
  `id`         varchar(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  -- The owner's requirement verbatim: "name the request and add a note reminder of what the period
  -- involves i.e. the 300% surge of Greenland Mining when Trump signed a deal, over just 2 days."
  -- `name` is what a list shows; `note` is what makes the window memorable months later.
  `name`       varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note`       text         COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `symbolId`   varchar(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `timeframe`  varchar(10)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `fromDate`   datetime(3)  NOT NULL,
  `toDate`     datetime(3)  NOT NULL,
  -- Which provider actually supplied the bars for this window. NULL = never imported yet, which is
  -- deliberately distinct from any provider name: it says "this window is defined but empty".
  `provider`   varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- Bars present in `marketbar` for this window at the last import. NULL = never imported.
  -- ⚠️ NULL and 0 mean different things. 0 = an import ran and found nothing (a FINDING).
  -- NULL = nobody has looked yet. Collapsing them is how "no data" hides as "fine".
  `barCount`   int          DEFAULT NULL,
  `createdAt`  datetime(3)  NOT NULL DEFAULT (utc_timestamp(3)),
  `updatedAt`  datetime(3)  NOT NULL DEFAULT (utc_timestamp(3)),
  PRIMARY KEY (`id`),
  -- The lookup every consumer performs: "bars for this symbol/timeframe, from here".
  KEY `BacktestPeriod_symbolId_timeframe_fromDate_idx` (`symbolId`,`timeframe`,`fromDate`),
  KEY `BacktestPeriod_createdAt_idx` (`createdAt`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Which period a run measured ──────────────────────────────────────────────────────────────
-- Acceptance criterion: "A backtest can be run against a stored period, and the run records which
-- period it used." Without this column a period comparison and a protocol comparison look
-- identical in `backtestrun`, and a difference could be credited to the protocol when the WINDOW
-- differed. NULL = a run that was not period-scoped (every run before this, and any day-range run).
ALTER TABLE `backtestrun`
  ADD COLUMN `periodId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT 'BacktestPeriod this run measured (#986). NULL = not period-scoped; never read as a period.';

ALTER TABLE `backtestrun`
  ADD KEY `BacktestRun_periodId_idx` (`periodId`);
