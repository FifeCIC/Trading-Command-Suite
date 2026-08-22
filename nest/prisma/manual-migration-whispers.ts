/**
 * Manual migration: create earnings_whisper_batch and earnings_whisper tables
 * for the Earnings Whispers feature.
 * Run with: npx ts-node prisma/manual-migration-whispers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Creating earnings_whisper_batch table...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS earnings_whisper_batch (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      source VARCHAR(40) NOT NULL DEFAULT 'earnings-whispers',
      raw_email LONGTEXT NOT NULL,
      entry_count INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'parsed',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ewb_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ earnings_whisper_batch table created');

  console.log('Creating earnings_whisper table...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS earnings_whisper (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      batch_id VARCHAR(36) NULL,
      symbol VARCHAR(20) NOT NULL,
      name VARCHAR(200) NULL,
      headline VARCHAR(255) NULL,
      report_date DATETIME NOT NULL,
      report_time VARCHAR(40) NULL,
      report_date_label VARCHAR(80) NULL,
      consensus_eps DOUBLE NULL,
      consensus_revenue DOUBLE NULL,
      consensus_revenue_label VARCHAR(60) NULL,
      whisper_eps DOUBLE NULL,
      guidance_eps_low DOUBLE NULL,
      guidance_eps_high DOUBLE NULL,
      guidance_rev_low DOUBLE NULL,
      guidance_rev_high DOUBLE NULL,
      beat_pct DOUBLE NULL,
      beat_side VARCHAR(10) NULL,
      short_interest_change_pct DOUBLE NULL,
      short_interest_direction VARCHAR(10) NULL,
      implied_move_pct DOUBLE NULL,
      recent_avg_move_pct DOUBLE NULL,
      stock_change_pct DOUBLE NULL,
      price_vs_200dma_pct DOUBLE NULL,
      dma_200_price DOUBLE NULL,
      meta JSON NULL,
      raw_text LONGTEXT NOT NULL,
      ai_summary TEXT NULL,
      parsed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ew_symbol_report (symbol, report_date),
      INDEX idx_ew_batch (batch_id),
      INDEX idx_ew_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ earnings_whisper table created');

  console.log('Migration complete.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
