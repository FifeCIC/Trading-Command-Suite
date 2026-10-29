-- ── #1144 — backtest provenance + per-protocol override history ────────────────────────────────
--
-- ⚠️ `prisma db push` is BANNED in this repo (#769): it treats schema.prisma as the complete truth and
-- DROPs every table that has no model, including the trade execution queue. These tables are therefore
-- created with explicit DDL and `schema.prisma` is updated in the SAME change, so the model and the
-- database cannot drift apart in silence.
--
-- Apply with:
--   & "C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe" -utradingcs -ptradingcs_dev_2026 -D tradingcs < nest\prisma\backtest-experiment-1144.sql
-- then, with the API stopped so the query-engine DLL is free:
--   npm --prefix nest run build:api
--
-- Collation matches every other table in this schema (`utf8mb4_unicode_ci`) — enforced by
-- `nest/scripts/validate-collation-consistency.cjs`, which fails the build on a mismatch.

CREATE TABLE IF NOT EXISTS `backtest_experiment` (
  `id`          varchar(36)  NOT NULL,
  `protocolId`  varchar(100) NOT NULL,
  `label`       varchar(200) NOT NULL,
  `goal`        text         NULL,
  `windowLabel` varchar(120) NULL,
  `status`      varchar(20)  NOT NULL DEFAULT 'running',
  `createdBy`   varchar(60)  NOT NULL DEFAULT 'owner',
  `createdAt`   datetime(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  `updatedAt`   datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `backtest_experiment_protocolId_createdAt_idx` (`protocolId`, `createdAt`),
  KEY `backtest_experiment_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `backtestrun`
  ADD COLUMN `experimentId`  varchar(36) NULL,
  ADD COLUMN `iteration`     int         NULL,
  ADD COLUMN `configVersion` int         NULL,
  ADD KEY `backtestrun_experimentId_iteration_idx` (`experimentId`, `iteration`),
  ADD CONSTRAINT `backtestrun_experimentId_fkey`
    FOREIGN KEY (`experimentId`) REFERENCES `backtest_experiment` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS `protocol_directive_change` (
  `id`            varchar(36)  NOT NULL,
  `protocolSlug`  varchar(100) NOT NULL,
  `directiveId`   varchar(100) NOT NULL,
  `field`         varchar(40)  NOT NULL,
  `oldValue`      varchar(200) NULL,
  `newValue`      varchar(200) NULL,
  `source`        varchar(60)  NOT NULL DEFAULT 'api',
  `configVersion` int          NOT NULL,
  `changedAt`     datetime(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (`id`),
  KEY `protocol_directive_change_protocolSlug_configVersion_idx` (`protocolSlug`, `configVersion`),
  KEY `protocol_directive_change_directiveId_changedAt_idx` (`directiveId`, `changedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
