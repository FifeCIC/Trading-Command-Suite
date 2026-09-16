# signal_outcome_log — managed OUTSIDE Prisma (raw SQL).
# Captured from the live database 2026-09-10.
#
# WHY THIS FILE EXISTS: this table has no model in schema.prisma and, before this file,
# no CREATE TABLE anywhere in the repo — it existed only in the running database. That
# made it unreproducible AND invisible to Prisma, which meant prisma db push would
# silently DROP it. See docs/schema-drift-control.md.
#
# Restore on a fresh database:  mysql -u <user> -p <db> < signal_outcome_log.sql
# Declared in:  nest/scripts/validate-schema-safety.cjs (RAW_MANAGED_TABLES)

DROP TABLE IF EXISTS `signal_outcome_log`;
CREATE TABLE `signal_outcome_log` (
  `id` varchar(64) NOT NULL,
  `scoreId` varchar(36) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `protocolId` varchar(100) DEFAULT NULL,
  `preTradeReady` tinyint(1) NOT NULL DEFAULT '0',
  `blockerCount` int NOT NULL DEFAULT '0',
  `conflictCount` int NOT NULL DEFAULT '0',
  `warningCount` int NOT NULL DEFAULT '0',
  `createdAt` datetime NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (`id`),
  KEY `idx_outcome_score` (`scoreId`),
  KEY `idx_outcome_proto_time` (`protocolId`,`createdAt`),
  KEY `idx_outcome_symbol` (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
