#!/usr/bin/env node
/**
 * inspect-threshold-defaults.cjs — the LIVE column defaults, vs what schema.prisma claims.
 *
 * WHY: changing `@default(...)` in schema.prisma does NOT change the existing MySQL column
 * default. This repo has no migration history and `db push` is destructive, so the only
 * sanctioned way to align them is an explicit `ALTER TABLE ... SET DEFAULT`. Before writing that
 * DDL you have to know what the default currently IS — otherwise you are guessing at the thing
 * you are about to change.
 *
 * Also reports the actual value distribution, because a column default only matters if rows
 * exist that relied on it.
 *
 * Read-only.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGETS = [
  { table: 'trading_strategy', column: 'minComposite' },
  { table: 'scoring_strategy', column: 'tradeThreshold' },
  { table: 'automation_config', column: 'tradeThreshold' },
];

(async () => {
  console.log('\nLive column defaults vs schema.prisma\n');

  for (const { table, column } of TARGETS) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_DEFAULT, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      table, column,
    );
    const r = rows[0];
    console.log(`${table}.${column}`);
    if (!r) {
      console.log('   ⚠️  column not found (table may be raw-managed or renamed)\n');
      continue;
    }
    console.log(`   live default : ${r.COLUMN_DEFAULT ?? '(none)'}   type=${r.DATA_TYPE} nullable=${r.IS_NULLABLE}`);

    // Distribution — a default only bites when a write omits the column.
    try {
      const dist = await prisma.$queryRawUnsafe(
        `SELECT CAST(\`${column}\` AS CHAR) AS v, COUNT(*) AS n
           FROM \`${table}\` GROUP BY \`${column}\` ORDER BY COUNT(*) DESC LIMIT 12`,
      );
      const total = dist.reduce((a, d) => a + Number(d.n), 0);
      console.log(`   rows         : ${total}`);
      for (const d of dist) {
        const n = Number(d.n);
        const flag = Number(d.v) > 35 ? '  <-- ABOVE the new-scale ceiling (~33): cannot be cleared' : '';
        console.log(`      ${String(d.v).padStart(8)} -> ${String(n).padStart(4)} rows${flag}`);
      }
      const unusable = dist.filter((d) => Number(d.v) > 35).reduce((a, d) => a + Number(d.n), 0);
      if (unusable > 0) {
        console.log(`   ⚠️  ${unusable} row(s) hold an UNCLEARABLE bar — these bots cannot fire until corrected.`);
      }
    } catch (e) {
      console.log(`   (distribution unavailable: ${String(e.message).slice(0, 60)})`);
    }
    console.log('');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
