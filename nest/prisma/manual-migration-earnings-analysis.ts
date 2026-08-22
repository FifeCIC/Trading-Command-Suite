/**
 * Manual migration: generalise the earnings-whispers tables into multi-source
 * earnings analysis storage.
 *   - Creates the `sources` table and seeds the Earnings Whispers source.
 *   - Renames earnings_whisper_batch → earnings_analysis_batch and
 *     earnings_whisper → earnings_analysis.
 *   - Adds + backfills `source_id` FKs, renames raw_email → raw_text.
 *   - Drops the old hardcoded `source` string column.
 * Run with: npx ts-node prisma/manual-migration-earnings-analysis.ts
 *
 * WHY MANUAL (not `prisma migrate`): this project ships schema changes as
 * idempotent raw-SQL scripts (see manual-migration-earnings.ts etc.) so they
 * can be re-run safely against an already-migrated database. `prisma migrate`
 * would diff against a migration-history table these scripts bypass. Every
 * step below is guarded by tableExists()/columnExists() checks and the seed
 * uses INSERT IGNORE — re-running is a no-op on completed work.
 *
 * ⚠️ After this script: run `npx prisma generate` and rebuild the backend —
 * the new model names only exist in the generated Prisma client.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Deterministic UUID (not uuid()) so re-runs INSERT the same row and the
// backfill UPDATEs below point at the same identity every time. The service's
// resolveSourceId() finds this row via the slug, not the id — the id is fixed
// mainly so DB dumps and cross-table joins stay readable.
const EW_SOURCE_ID = '11111111-1111-4111-8111-111111111111';

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    table,
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    table,
    column,
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function main() {
  // 1. sources table + seed
  console.log('Creating sources table...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sources (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(50) NOT NULL,
      kind VARCHAR(30) NOT NULL DEFAULT 'earnings',
      url VARCHAR(500) NULL,
      description VARCHAR(500) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sources_name (name),
      UNIQUE KEY uq_sources_slug (slug),
      INDEX idx_sources_kind (kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO sources (id, name, slug, kind, url, description, active)
     VALUES (?, 'Earnings Whispers', 'earnings-whispers', 'earnings',
             'https://www.earningswhispers.com/',
             'Earnings Whispers email: consensus vs whisper EPS, guidance, beat %, implied move per symbol.',
             1)`,
    EW_SOURCE_ID,
  );
  console.log('✓ sources table created + Earnings Whispers seeded');

  // 2. rename batch table
  const oldBatch = await tableExists('earnings_whisper_batch');
  if (oldBatch) {
    console.log('Renaming earnings_whisper_batch → earnings_analysis_batch...');
    await prisma.$executeRawUnsafe('RENAME TABLE earnings_whisper_batch TO earnings_analysis_batch');
  }
  if (await columnExists('earnings_analysis_batch', 'raw_email')) {
    await prisma.$executeRawUnsafe('ALTER TABLE earnings_analysis_batch RENAME COLUMN raw_email TO raw_text');
  }
  if (await columnExists('earnings_analysis_batch', 'source')) {
    await prisma.$executeRawUnsafe('ALTER TABLE earnings_analysis_batch DROP COLUMN source');
  }
  if (!(await columnExists('earnings_analysis_batch', 'source_id'))) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE earnings_analysis_batch ADD COLUMN source_id VARCHAR(36) NULL AFTER id, ADD INDEX idx_eab_source (source_id)',
    );
  }
  // Backfill provenance: every pre-migration row came from Earnings Whispers
  // (no other source existed before the `sources` table), so NULL source_ids
  // get the EW source rather than a generic "unknown".
  await prisma.$executeRawUnsafe(
    'UPDATE earnings_analysis_batch SET source_id = ? WHERE source_id IS NULL',
    EW_SOURCE_ID,
  );
  console.log('✓ earnings_analysis_batch ready (source_id backfilled)');

  // 3. rename entries table
  const oldEntries = await tableExists('earnings_whisper');
  if (oldEntries) {
    console.log('Renaming earnings_whisper → earnings_analysis...');
    await prisma.$executeRawUnsafe('RENAME TABLE earnings_whisper TO earnings_analysis');
  }
  if (!(await columnExists('earnings_analysis', 'source_id'))) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE earnings_analysis ADD COLUMN source_id VARCHAR(36) NULL AFTER batch_id, ADD INDEX idx_ea_source_created (source_id, created_at)',
    );
  }
  // Same provenance backfill as the batch table above.
  await prisma.$executeRawUnsafe(
    'UPDATE earnings_analysis SET source_id = ? WHERE source_id IS NULL',
    EW_SOURCE_ID,
  );
  console.log('✓ earnings_analysis ready (source_id backfilled)');

  console.log('Migration complete.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
