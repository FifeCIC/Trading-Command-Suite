/**
 * inspect-fk-graph.cjs — what pins the last two `0900_ai_ci` tables together?
 *
 * WHY
 * ---
 * `fix-collation-split.cjs` converted 19 of 21 tables. The two that refused both failed
 * with MySQL **3780**:
 *
 *     Referencing column 'strategyId' and referenced column 'id' in foreign key
 *     constraint 'strategy_evaluation_strategyId_fkey' are incompatible.
 *
 * ⚠️ That is a FOREIGN KEY, not a UNIQUE index — and the comment in the fix script
 * predicted a unique index. The prediction was wrong and the measurement corrected it.
 * Worth recording: a plausible cause written into a comment is still a claim, and this
 * session has now produced four of them.
 *
 * The mechanism: `ALTER TABLE ... CONVERT TO CHARACTER SET` requires both sides of an FK
 * to share a collation. Converting one side leaves the pair incompatible, so MySQL
 * refuses the ALTER rather than letting the constraint break. Converting them in
 * sequence therefore fails on the first one, no matter which order.
 *
 * THE FIX, AND WHY THIS FILE MEASURES FIRST
 * -----------------------------------------
 * The constraint has to be dropped, both tables converted, and the constraint re-added.
 * That is DDL on a relation between two LIVE trade tables, so before doing it we need
 * the exact constraint definition and the exact column list to restore — re-adding an FK
 * with a guessed ON DELETE/ON UPDATE is a silent behaviour change to referential
 * integrity. This script reads the real definitions rather than assuming them.
 *
 * Read-only.
 * Run: node nest/scripts/inspect-fk-graph.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Remaining collation divergence and the FK graph that pins it');
  console.log('');

  const remaining = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
      ORDER BY TABLE_NAME`,
  );
  console.log(`tables still NOT on utf8mb4_unicode_ci: ${remaining.length}`);
  for (const t of remaining) console.log(`   ${t.TABLE_NAME}  ${t.TABLE_COLLATION}`);
  console.log('');

  // Column-level: which columns are still divergent? A table default with no divergent
  // COLUMN cannot throw 1267, so this is the number that actually matters.
  const remainingCols = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL
        AND COLLATION_NAME <> 'utf8mb4_unicode_ci'
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  );
  console.log(`string columns still divergent: ${remainingCols.length}`);
  for (const c of remainingCols) {
    console.log(`   ${c.TABLE_NAME}.${c.COLUMN_NAME}  ${c.COLLATION_NAME}`);
  }
  console.log('');

  // ── Every FK touching a still-divergent table, in EITHER direction ────────────────
  const fks = await prisma.$queryRawUnsafe(
    `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME AS child_table, k.COLUMN_NAME AS child_col,
            k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_COLUMN_NAME AS parent_col,
            r.DELETE_RULE, r.UPDATE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
        AND (k.TABLE_NAME IN (SELECT TABLE_NAME FROM information_schema.TABLES
                               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION <> 'utf8mb4_unicode_ci')
          OR k.REFERENCED_TABLE_NAME IN (SELECT TABLE_NAME FROM information_schema.TABLES
                                          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'))
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`,
  );

  console.log(`foreign keys touching a divergent table: ${fks.length}`);
  for (const f of fks) {
    console.log(
      `   ${f.CONSTRAINT_NAME}\n` +
        `      ${f.child_table}.${f.child_col} -> ${f.parent_table}.${f.parent_col}` +
        `  ON DELETE ${f.DELETE_RULE} ON UPDATE ${f.UPDATE_RULE}`,
    );
  }
  console.log('');

  console.log('── TO RE-ADD A CONSTRAINT FAITHFULLY, USE EXACTLY THIS ─────────────────');
  for (const f of fks) {
    console.log(
      `   ALTER TABLE \`${f.child_table}\` ADD CONSTRAINT \`${f.CONSTRAINT_NAME}\`\n` +
        `     FOREIGN KEY (\`${f.child_col}\`) REFERENCES \`${f.parent_table}\` (\`${f.parent_col}\`)\n` +
        `     ON DELETE ${f.DELETE_RULE} ON UPDATE ${f.UPDATE_RULE};`,
    );
  }
  console.log('');
  console.log('⚠️ Do not hand-write these from memory — a missed ON DELETE clause silently');
  console.log('   changes referential integrity on a money-path relation.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
