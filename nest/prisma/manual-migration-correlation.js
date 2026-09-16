"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Creating correlation_pair table...');
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS correlation_pair (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      symbol_a VARCHAR(20) NOT NULL,
      symbol_b VARCHAR(20) NOT NULL,
      correlation DOUBLE NOT NULL,
      period_days INT NOT NULL DEFAULT 90,
      computed_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
      UNIQUE KEY uk_corr_pair (symbol_a, symbol_b, period_days),
      INDEX idx_corr_sym_a (symbol_a),
      INDEX idx_corr_computed (computed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    console.log('✓ correlation_pair table created');
}
main()
    .catch((e) => { console.error('Failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=manual-migration-correlation.js.map