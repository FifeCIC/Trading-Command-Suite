"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Creating earnings_event table...');
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS earnings_event (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      symbol VARCHAR(20) NOT NULL,
      name VARCHAR(200) NULL,
      report_date DATETIME NOT NULL,
      fiscal_date_ending DATETIME NULL,
      eps_estimate DOUBLE NULL,
      eps_actual DOUBLE NULL,
      revenue_estimate DOUBLE NULL,
      revenue_actual DOUBLE NULL,
      surprise_percent DOUBLE NULL,
      time_of_day VARCHAR(20) NULL,
      currency VARCHAR(10) NULL,
      source VARCHAR(30) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_earnings_report_date (report_date),
      INDEX idx_earnings_symbol_report_date (symbol, report_date),
      INDEX idx_earnings_source_created (source, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    console.log('✓ earnings_event table created');
    console.log('Creating analyst_target table...');
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS analyst_target (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      symbol VARCHAR(20) NOT NULL,
      company_name VARCHAR(200) NULL,
      current_price DOUBLE NOT NULL DEFAULT 0,
      avg_target DOUBLE NOT NULL DEFAULT 0,
      high_target DOUBLE NOT NULL DEFAULT 0,
      low_target DOUBLE NOT NULL DEFAULT 0,
      consensus VARCHAR(50) NULL,
      analyst_count INT NULL,
      upside DOUBLE NULL,
      source VARCHAR(30) NOT NULL,
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_at_symbol (symbol),
      INDEX idx_at_source_fetched (source, fetched_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    console.log('✓ analyst_target table created');
    console.log('Migration complete.');
}
main()
    .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=manual-migration-earnings.js.map