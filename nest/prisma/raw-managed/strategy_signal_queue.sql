# strategy_signal_queue — managed OUTSIDE Prisma (raw SQL).
# Captured from the live database 2026-09-10.
#
# WHY THIS FILE EXISTS: this table has no model in schema.prisma and, before this file,
# no CREATE TABLE anywhere in the repo — it existed only in the running database. That
# made it unreproducible AND invisible to Prisma, which meant prisma db push would
# silently DROP it. See docs/schema-drift-control.md.
#
# Restore on a fresh database:  mysql -u <user> -p <db> < strategy_signal_queue.sql
# Declared in:  nest/scripts/validate-schema-safety.cjs (RAW_MANAGED_TABLES)

DROP TABLE IF EXISTS `strategy_signal_queue`;
CREATE TABLE `strategy_signal_queue` (
  `id` varchar(36) NOT NULL,
  `strategyId` varchar(36) NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `protocolId` varchar(100) NOT NULL,
  `direction` varchar(10) NOT NULL,
  `signal` varchar(10) NOT NULL,
  `compositePct` int DEFAULT NULL,
  `signalPct` int DEFAULT NULL,
  `opportunityPct` int DEFAULT NULL,
  `combinedStrength` int DEFAULT NULL,
  `scoreId` varchar(36) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bot_signal` (`strategyId`,`protocolId`,`symbol`),
  KEY `idx_status` (`status`),
  KEY `idx_proto_sym` (`protocolId`,`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
