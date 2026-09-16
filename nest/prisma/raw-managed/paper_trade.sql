# paper_trade — managed OUTSIDE Prisma (raw SQL).
# Captured from the live database 2026-09-10.
#
# WHY THIS FILE EXISTS: this table has no model in schema.prisma and, before this file,
# no CREATE TABLE anywhere in the repo — it existed only in the running database. That
# made it unreproducible AND invisible to Prisma, which meant prisma db push would
# silently DROP it. See docs/schema-drift-control.md.
#
# Restore on a fresh database:  mysql -u <user> -p <db> < paper_trade.sql
# Declared in:  nest/scripts/validate-schema-safety.cjs (RAW_MANAGED_TABLES)

DROP TABLE IF EXISTS `paper_trade`;
CREATE TABLE `paper_trade` (
  `id` varchar(64) NOT NULL,
  `strategyId` varchar(64) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `side` varchar(8) NOT NULL,
  `composite` int NOT NULL DEFAULT '0',
  `entryPrice` decimal(12,5) DEFAULT NULL,
  `sl` decimal(12,5) DEFAULT NULL,
  `tp` decimal(12,5) DEFAULT NULL,
  `baseSize` decimal(12,5) NOT NULL DEFAULT '0.00000',
  `protocolId` varchar(64) DEFAULT NULL,
  `tickNumber` int DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (`id`),
  KEY `idx_paper_strategy` (`strategyId`),
  KEY `idx_paper_symbol` (`symbol`),
  KEY `idx_paper_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
