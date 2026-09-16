# signal_outcome_meta — managed OUTSIDE Prisma (raw SQL).
# Captured from the live database 2026-09-10.
#
# WHY THIS FILE EXISTS: this table has no model in schema.prisma and, before this file,
# no CREATE TABLE anywhere in the repo — it existed only in the running database. That
# made it unreproducible AND invisible to Prisma, which meant prisma db push would
# silently DROP it. See docs/schema-drift-control.md.
#
# Restore on a fresh database:  mysql -u <user> -p <db> < signal_outcome_meta.sql
# Declared in:  nest/scripts/validate-schema-safety.cjs (RAW_MANAGED_TABLES)

DROP TABLE IF EXISTS `signal_outcome_meta`;
CREATE TABLE `signal_outcome_meta` (
  `id` varchar(36) NOT NULL,
  `logId` varchar(64) NOT NULL,
  `entryType` varchar(12) NOT NULL,
  `entryKey` varchar(100) NOT NULL,
  `severity` varchar(10) DEFAULT NULL,
  `message` text,
  `directiveIds` text,
  `hint` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (`id`),
  KEY `idx_outmeta_log` (`logId`),
  KEY `idx_outmeta_key` (`entryKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
