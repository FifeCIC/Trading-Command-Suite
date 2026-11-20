-- #1328 — the selection TEST as a named group (2026-11-20).
--
-- Applied by hand, not by `prisma db push` (which drops every unmodelled table here).
-- `createdAt` defaults to UTC_TIMESTAMP, not CURRENT_TIMESTAMP: MySQL evaluates the latter in the
-- SESSION timezone (SYSTEM = UTC+1 here), which writes an hour in the future with no error (#844).
-- `schema.prisma` carries both changes so `db:check` and `db:schema-drift` agree with the database.
--
-- WHY each column: see the model comment in `nest/prisma/schema.prisma`. In short — the per-symbol
-- engine runs already persist into `backtestrun`; what was missing is the GROUP (day + direction +
-- dataset + rank time + top-N) and the AGGREGATE the page's tiles show, which is computed over KEPT
-- trades after the selection filter and so cannot be read off any single per-symbol row.
--
-- `semanticsVersion` is the comparability gate: a delta is refused between two rows whose engine
-- semantics differ, because that difference measures the engine rather than the strategy.

CREATE TABLE IF NOT EXISTS `backtest_selection` (
  `id`            VARCHAR(36)  NOT NULL,
  `profileKey`    VARCHAR(64)  NOT NULL,
  `datasetName`   VARCHAR(120) NOT NULL,
  `answerDate`    DATE         NOT NULL,
  `side`          VARCHAR(10)  NOT NULL,
  `directionMode` VARCHAR(8)   NOT NULL,
  `protocolId`    VARCHAR(100) NOT NULL,
  `botId`         VARCHAR(36)  NULL,
  `botName`       VARCHAR(120) NULL,
  `topN`          INT          NOT NULL,
  `cutoffUtc`     VARCHAR(5)   NOT NULL,
  `symbolsJson`   LONGTEXT     NOT NULL,
  `configJson`    LONGTEXT     NULL,
  `trades`        INT          NOT NULL,
  `wins`          INT          NOT NULL,
  `winRate`       DOUBLE       NOT NULL,
  `netPnl`        DOUBLE       NOT NULL,
  `profitFactor`  DOUBLE       NULL,
  `engineTradesOutsideSelection` INT NOT NULL,
  `semanticsVersion` INT       NOT NULL,
  `engineVersion` VARCHAR(20)  NOT NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (`id`),
  KEY `backtest_selection_profileKey_createdAt_idx` (`profileKey`, `createdAt`),
  KEY `backtest_selection_answerDate_idx` (`answerDate`),
  KEY `backtest_selection_protocolId_createdAt_idx` (`protocolId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The link from each per-symbol run to the test it belonged to. NULLable: every plain `/run` and every
-- run stored before this column is not part of a selection test, and that is a fact, not a gap.
ALTER TABLE `backtestrun`
  ADD COLUMN `selectionId` VARCHAR(36) NULL,
  ADD KEY `backtestrun_selectionId_idx` (`selectionId`);
