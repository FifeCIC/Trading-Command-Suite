/**
 * introspect-columns.cjs — print the real columns of the tables under test.
 *
 * WHY THIS IS A FILE AND NOT `node -e`
 * ------------------------------------
 * PowerShell mangles `$queryRawUnsafe` / `$disconnect` inside an inline `node -e`
 * expression, and the failure is a `ParserError` that names a PowerShell token
 * rather than anything to do with the query. Repeatedly cost time this session.
 * Same reason as the header note in `measure-future-rows.cjs`: probe via files.
 *
 * WHY IT EXISTS AT ALL
 * --------------------
 * `Unknown column` has now been returned FIVE times in one session from writing
 * raw SQL against remembered column names. The rule from the development
 * philosophy file: **introspect before you query**. Run this first; do not recall.
 *
 * Usage: node nest/scripts/introspect-columns.cjs [table ...]
 *        (no args = the tables the future-lead checks touch)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_TABLES = ['position', 'trade', 'marketbar', 'directiveoutcome'];

(async () => {
  const tables = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TABLES;
  const placeholders = tables.map(() => '?').join(', ');
  const cols = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    ...tables,
  );

  const found = new Set(cols.map((c) => c.TABLE_NAME));
  for (const t of tables) {
    if (!found.has(t)) {
      console.log(`\n${t}  --  ⚠️ TABLE NOT FOUND in this schema`);
      continue;
    }
    console.log(`\n${t}`);
    for (const c of cols.filter((x) => x.TABLE_NAME === t)) {
      const def = c.COLUMN_DEFAULT === null ? '' : `  DEFAULT ${c.COLUMN_DEFAULT}`;
      const nul = c.IS_NULLABLE === 'YES' ? 'null' : 'NOT NULL';
      console.log(`   ${c.COLUMN_NAME.padEnd(24)} ${c.DATA_TYPE.padEnd(14)} ${nul}${def}`);
    }
  }
  console.log('');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
