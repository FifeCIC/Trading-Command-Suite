"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Creating api_trace table...');
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS api_trace (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      cache_key VARCHAR(64) NOT NULL,
      url VARCHAR(500) NOT NULL,
      method VARCHAR(10) NOT NULL,
      request_body TEXT NULL,
      status_code INT NOT NULL DEFAULT 0,
      duration_ms INT NOT NULL DEFAULT 0,
      response_body TEXT NULL,
      preview VARCHAR(1000) NULL,
      error TEXT NULL,
      cached BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
      expires_at DATETIME NOT NULL,
      INDEX idx_api_trace_cache_key (cache_key, created_at),
      INDEX idx_api_trace_created (created_at),
      INDEX idx_api_trace_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    console.log('✓ api_trace table created');
}
main()
    .catch((e) => { console.error('Failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=manual-migration-traces.js.map