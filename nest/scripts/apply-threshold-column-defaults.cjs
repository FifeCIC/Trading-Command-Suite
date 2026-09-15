#!/usr/bin/env node
/**
 * apply-threshold-column-defaults.cjs — align live column defaults with schema.prisma.
 *
 * ⚠️ WHY THIS EXISTS INSTEAD OF `prisma db push`
 *
 * This repo has NO migration history and **10 tables managed outside Prisma** — including the
 * trade execution queue (`strategy_signal_queue`) and several #750 timestamp-repair backups.
 * `prisma db push` treats schema.prisma as the complete truth and would DROP every table with no
 * model. It warns, waits for a `y`, and destroys live data. It is blocked by an npm script for
 * exactly this reason.
 *
 * Changing `@default(...)` in schema.prisma ALSO does not change the existing MySQL column
 * default. Source and database would silently disagree: Prisma would believe the default is 10
 * while MySQL kept stamping 65. So the two are aligned explicitly, here, and the result is
 * verified rather than assumed.
 *
 * SAFETY:
 *   - Only `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT` — metadata only. No rows are read,
 *     written, or deleted. Pass `--apply` to run; without it this is a dry run.
 *   - Every statement is re-read from information_schema afterwards to prove it took effect.
 *   - `npm run db:check` must pass BEFORE and AFTER (run it; this script does not).
 *
 * USAGE (from nest/):
 *   node scripts/apply-threshold-column-defaults.cjs            # dry run
 *   node scripts/apply-threshold-column-defaults.cjs --apply    # apply
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

/** Canonical value — must equal BOT_BAR_DEFAULT in common/utils/style-thresholds.ts. */
const TARGET_DEFAULT = 10;

/** table, column, prior default (for the report). */
const COLUMNS = [
  { table: 'trading_strategy', column: 'minComposite', was: 65, gated: true },
  { table: 'scoring_strategy', column: 'tradeThreshold', was: 60, gated: false },
  { table: 'automationconfig', column: 'tradeThreshold', was: 65, gated: false },
];

(async () => {
  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — pass --apply to execute'}\n`);
  console.log(`target default: ${TARGET_DEFAULT}  (BOT_BAR_DEFAULT)\n`);

  for (const { table, column, was, gated } of COLUMNS) {
    // Confirm the table/column exists before issuing DDL — a typo must fail loudly, not silently
    // "succeed" against nothing.
    const meta = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      table, column,
    );
    if (!meta.length) {
      console.log(`⚠️  ${table}.${column} NOT FOUND — skipped (check the table name)`);
      continue;
    }

    const current = meta[0].COLUMN_DEFAULT;
    console.log(`${table}.${column}`);
    console.log(`   current default : ${current}   ${gated ? '(GATED — a stale default makes bots unable to fire)' : '(display/lineage only)'}`);
    console.log(`   target default  : ${TARGET_DEFAULT}`);

    if (String(current) === String(TARGET_DEFAULT)) {
      console.log('   → already correct, no action\n');
      continue;
    }

    if (!APPLY) {
      console.log(`   → would run: ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${TARGET_DEFAULT}\n`);
      continue;
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${TARGET_DEFAULT}`,
    );

    // ⚠️ VERIFY — do not assume the DDL took. A default that silently stayed put would leave
    // Prisma and MySQL disagreeing, which is the drift this whole script exists to remove.
    const after = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      table, column,
    );
    const now = after[0]?.COLUMN_DEFAULT;
    const ok = String(now) === String(TARGET_DEFAULT);
    console.log(`   → ${ok ? '✅' : '✖'} default is now ${now}${ok ? '' : ` (expected ${TARGET_DEFAULT})`}`);
    console.log(`   (was ${was}; ${ok ? 'rows unchanged — this is a metadata change only' : 'INVESTIGATE'})\n`);
  }

  await prisma.$disconnect();
  if (APPLY) {
    console.log('Next: npm run db:check   (must print ✅ OK)\n');
  }
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
