/**
 * diagnose-collation-failure.cjs — why did `trading_strategy` and
 * `strategy_evaluation` refuse `CONVERT TO CHARACTER SET`?
 *
 * ⚠️ WHY THIS EXISTS AT ALL
 * -------------------------
 * `fix-collation-split.cjs` reported these two as FAILED **with an empty message**,
 * because it printed `String(e.message).split('\n')[0]` and Prisma's raw-error message
 * for this case begins with a newline — so `[0]` was the empty string. The reporting
 * destroyed the diagnosis, which is worse than a crash: a crash tells you something
 * happened, an empty error tells you nothing and invites you to move on.
 *
 * This prints the WHOLE error object (constructor, message, code, meta) and then, for
 * the most likely cause — a UNIQUE index whose rows collide under the new collation —
 * it looks for duplicate keys that exist under the NEW collation but not the old one.
 *
 * ⚠️ `utf8mb4_0900_ai_ci` and `utf8mb4_unicode_ci` differ in how they fold characters.
 * A row pair that is distinct under one can be EQUAL under the other, which makes a
 * UNIQUE index unsatisfiable. That is a real and expected failure mode, not a bug in
 * the ALTER — and the correct response is to inspect and decide, never to drop the
 * index to force the conversion through.
 *
 * Run: node nest/scripts/diagnose-collation-failure.cjs
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TABLES = ['trading_strategy', 'strategy_evaluation'];
const TARGET = 'utf8mb4_unicode_ci';

(async () => {
  console.log('Collation conversion failure diagnosis');
  console.log(`target collation: ${TARGET}`);
  console.log('');

  for (const table of TABLES) {
    console.log(`══ ${table} ═════════════════════════════════════════`);
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET}`,
      );
      console.log('   ✅ converted — the earlier failure was transient or ordering-related.');
      console.log('');
      continue;
    } catch (e) {
      console.log(`   constructor : ${e.constructor.name}`);
      console.log(`   code        : ${e.code ?? '(none)'}`);
      console.log(`   meta        : ${JSON.stringify(e.meta ?? null)}`);
      // ⚠️ Print the FULL message, JSON-escaped, so a leading newline is visible rather
      // than silently producing an empty first line — the bug that hid this.
      console.log(`   message     : ${JSON.stringify(String(e.message))}`);
    }

    // ── Look for UNIQUE indexes whose keys would collide under the new collation ────
    const uniques = await prisma.$queryRawUnsafe(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME`,
      table,
    );
    console.log('');
    console.log(`   unique indexes (${uniques.length}):`);
    for (const u of uniques) {
      console.log(`      ${u.INDEX_NAME}: (${u.cols})`);
      const cols = String(u.cols).split(',');
      const textCols = await prisma.$queryRawUnsafe(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            AND COLUMN_NAME IN (${cols.map(() => '?').join(',')})
            AND COLLATION_NAME IS NOT NULL`,
        table,
        ...cols,
      );
      if (textCols.length === 0) continue; // numeric-only key cannot collide on collation

      const colList = cols.map((c) => `\`${c}\``).join(', ');
      // Compare duplicate counts UNDER THE TARGET COLLATION, which is what matters.
      const dup = await prisma.$queryRawUnsafe(
        `SELECT ${colList}, COUNT(*) AS n
           FROM \`${table}\`
          GROUP BY ${colList} COLLATE ${TARGET}
         HAVING COUNT(*) > 1
          LIMIT 5`,
      );
      if (dup.length) {
        console.log(`      ⚠️ COLLIDES under ${TARGET} — ${dup.length} duplicate group(s) shown:`);
        for (const d of dup) console.log(`         ${JSON.stringify(d)}`);
        console.log(`      This is why the ALTER cannot complete: the UNIQUE key is unsatisfiable.`);
        console.log(`      Decide which row wins — do NOT drop the index to force it through.`);
      } else {
        console.log(`      no collisions under ${TARGET}`);
      }
    }
    console.log('');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
