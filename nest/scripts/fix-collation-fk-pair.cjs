/**
 * fix-collation-fk-pair.cjs — finish #842 for the two tables an FK pins together.
 *
 * THE SITUATION
 * -------------
 * `fix-collation-split.cjs` converted 19 of 21 tables. The last two refused, both with
 * MySQL **3780**:
 *
 *     Referencing column 'strategyId' and referenced column 'id' in foreign key
 *     constraint 'strategy_evaluation_strategyId_fkey' are incompatible.
 *
 * `strategy_evaluation.strategyId` -> `trading_strategy.id`, ON DELETE CASCADE
 * ON UPDATE CASCADE. `ALTER TABLE ... CONVERT TO CHARACTER SET` requires BOTH sides of an
 * FK to share a collation, so converting either one alone leaves the pair incompatible
 * and MySQL refuses — meaning sequential conversion cannot work in ANY order.
 *
 * ⚠️ A CORRECTION WORTH KEEPING: the sibling script's header predicted this failure would
 * be "a UNIQUE index whose rows collide". Measurement showed it was a foreign key. The
 * prediction was plausible and wrong, and it was written down as though it were the
 * likely cause. `inspect-fk-graph.cjs` reads the real constraint definitions rather than
 * recalling them.
 *
 * THE PROCEDURE, AND WHY IT IS ORDERED THIS WAY
 * --------------------------------------------
 *   1. Drop the FK by its REAL name (read from information_schema, not assumed)
 *   2. Convert BOTH tables
 *   3. Re-add the FK with the EXACT original clause (name, columns, ON DELETE/UPDATE)
 *
 * ⚠️ Step 3 must not be hand-written from memory. `ON DELETE CASCADE` here means deleting
 * a strategy deletes its evaluations. Re-adding the constraint without it would silently
 * change referential integrity on a live trade relation — a behaviour change with no
 * error, on the exact class of defect this session has been chasing.
 *
 * ⚠️ FAILURE MODE TO WATCH: if the conversion succeeds but the FK re-add fails, the tables
 * are left WITHOUT the constraint — worse than where we started. So step 3 is verified by
 * re-reading information_schema, and a failure there is reported loudly rather than
 * counted as a partial success.
 *
 * Run: node nest/scripts/fix-collation-fk-pair.cjs --dry-run   (default: report)
 *      node nest/scripts/fix-collation-fk-pair.cjs --apply
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET = 'utf8mb4_unicode_ci';
const PAIR = ['trading_strategy', 'strategy_evaluation'];
const APPLY = process.argv.includes('--apply');
const IDENT = /^[A-Za-z0-9_]+$/;

function guard(name) {
  if (!IDENT.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}

(async () => {
  console.log(`FK-pair collation conversion -> ${TARGET}${APPLY ? '  [APPLY]' : '  [DRY RUN]'}`);
  console.log('');

  // ── Read the REAL constraint definition ──────────────────────────────────────────
  const fks = await prisma.$queryRawUnsafe(
    `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME AS child_table, k.COLUMN_NAME AS child_col,
            k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_COLUMN_NAME AS parent_col,
            r.DELETE_RULE, r.UPDATE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.TABLE_NAME IN (?, ?)
        AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
    ...PAIR,
  );

  if (fks.length === 0) {
    console.log('No FK between the pair — the plain converter can finish this instead.');
    await prisma.$disconnect();
    return;
  }
  for (const f of fks) {
    console.log(`constraint: ${f.CONSTRAINT_NAME}`);
    console.log(`   ${f.child_table}.${f.child_col} -> ${f.parent_table}.${f.parent_col}`);
    console.log(`   ON DELETE ${f.DELETE_RULE}  ON UPDATE ${f.UPDATE_RULE}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('DRY RUN — would execute, in this order:');
    for (const f of fks) {
      console.log(`   1. ALTER TABLE \`${f.child_table}\` DROP FOREIGN KEY \`${f.CONSTRAINT_NAME}\`;`);
    }
    for (const t of PAIR) {
      console.log(`   2. ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET};`);
    }
    for (const f of fks) {
      console.log(
        `   3. ALTER TABLE \`${f.child_table}\` ADD CONSTRAINT \`${f.CONSTRAINT_NAME}\`` +
          ` FOREIGN KEY (\`${f.child_col}\`) REFERENCES \`${f.parent_table}\` (\`${f.parent_col}\`)` +
          ` ON DELETE ${f.DELETE_RULE} ON UPDATE ${f.UPDATE_RULE};`,
      );
    }
    console.log('');
    console.log('Re-run with --apply to execute.');
    await prisma.$disconnect();
    return;
  }

  // ── 1. Drop ───────────────────────────────────────────────────────────────────────
  const dropped = [];
  for (const f of fks) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${guard(f.child_table)}\` DROP FOREIGN KEY \`${guard(f.CONSTRAINT_NAME)}\``,
      );
      dropped.push(f);
      console.log(`   dropped FK ${f.CONSTRAINT_NAME}`);
    } catch (e) {
      console.log(`   ❌ could not drop ${f.CONSTRAINT_NAME}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 140)}`);
      console.log('      Stopping — converting with the FK still in place cannot work.');
      await prisma.$disconnect();
      process.exit(1);
    }
  }
  console.log('');

  // ── 2. Convert both ───────────────────────────────────────────────────────────────
  const converted = [];
  for (const t of PAIR) {
    const started = Date.now();
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${guard(t)}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET}`,
      );
      converted.push(t);
      console.log(`   ✅ converted ${t} in ${Date.now() - started}ms`);
    } catch (e) {
      console.log(`   ❌ FAILED to convert ${t}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  console.log('');

  // ── 3. Re-add, with the exact original clause ─────────────────────────────────────
  console.log('=== re-adding foreign keys (must succeed — without them integrity is LOST) ===');
  let allRestored = true;
  for (const f of dropped) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${guard(f.child_table)}\` ADD CONSTRAINT \`${guard(f.CONSTRAINT_NAME)}\`` +
          ` FOREIGN KEY (\`${guard(f.child_col)}\`) REFERENCES \`${guard(f.parent_table)}\` (\`${guard(f.parent_col)}\`)` +
          ` ON DELETE ${f.DELETE_RULE} ON UPDATE ${f.UPDATE_RULE}`,
      );
      console.log(`   ✅ re-added ${f.CONSTRAINT_NAME}`);
    } catch (e) {
      allRestored = false;
      console.log(`   ❌❌ FAILED to re-add ${f.CONSTRAINT_NAME}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 160)}`);
      console.log(`      ⚠️ ${f.child_table} currently has NO foreign key to ${f.parent_table}.`);
      console.log('      This is WORSE than the collation split — restore it explicitly.');
    }
  }
  console.log('');

  // ── Verify by re-reading, not by trusting the statements that just ran ────────────
  const after = await prisma.$queryRawUnsafe(
    `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME AS child_table, k.COLUMN_NAME AS child_col,
            k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_COLUMN_NAME AS parent_col,
            r.DELETE_RULE, r.UPDATE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME IN (?, ?)
        AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
    ...PAIR,
  );
  console.log(`── VERIFY (re-read from information_schema) ────────────────────────────`);
  console.log(`   foreign keys present now: ${after.length} (expected ${fks.length})`);
  for (const f of after) {
    console.log(`      ${f.CONSTRAINT_NAME}: ${f.child_table}.${f.child_col} -> ${f.parent_table}.${f.parent_col} ON DELETE ${f.DELETE_RULE} ON UPDATE ${f.UPDATE_RULE}`);
  }

  const stillDivergent = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL
        AND COLLATION_NAME <> ?`,
    TARGET,
  );
  console.log(`   divergent string columns remaining: ${stillDivergent[0].n}`);
  console.log('');
  console.log(allRestored && after.length === fks.length
    ? '✅ FK integrity restored and collation normalised. Verify joins: node nest/scripts/measure-collation-split.cjs'
    : '⚠️ NOT fully successful — review the failures above before reporting anything as done.');

  await prisma.$disconnect();
  if (!allRestored || after.length !== fks.length) process.exit(1);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
