/**
 * fix-collation-split.cjs — #842. Normalise the divergent collation to the majority.
 *
 * THE DEFECT
 * ----------
 * `information_schema` showed 21 tables on `utf8mb4_0900_ai_ci` against 103 on
 * `utf8mb4_unicode_ci`, and joins between the two groups **actually throw MySQL 1267**
 * ("Illegal mix of collations"). Measured by EXECUTING the joins, not by reasoning:
 * `capability`, `decision_trail`, `paper_trade`, `planstep` and `score_snapshot` all
 * threw. Among the affected tables are live trade-path tables — `strategy_signal_queue`
 * (the execution queue), `trading_strategy`, `strategy_protocol`.
 *
 * ⚠️ IT THROWS AT QUERY TIME, ON DATA-DEPENDENT PATHS. Nothing fails at build time, so
 * every build stayed green while five joins were unusable.
 *
 * WHY `CONVERT TO` IS SAFE HERE
 * ----------------------------
 * `utf8mb4_XXX` -> `utf8mb4_YYY` is a LOSS FREE re-encode: the character set is
 * identical (4-byte UTF-8), only the comparison/sort rules change. No character can
 * become unrepresentable, so no value can be truncated or rewritten.
 *
 * ⚠️ WHAT IT DOES CHANGE — AND WHY THAT IS THE POINT
 * --------------------------------------------------
 * Collations differ in more than Unicode version:
 *   - `utf8mb4_0900_ai_ci` is ACCENT-INSENSITIVE and CASE-INSENSITIVE: 'e' = 'é', 'a' = 'A'
 *   - `utf8mb4_unicode_ci` is also ai_ci, but uses the older UCA 4.0.0 rules
 * So a query can currently match rows a `unicode_ci` database would not — or fail to
 * match ones it would. Normalising to the majority makes comparisons CONSISTENT with the
 * other 103 tables, which is the whole objective. It does not make them "better"; it
 * makes them the same.
 *
 * ⚠️ UNIQUE INDEXES: a conversion CAN fail if two rows that were distinct under
 * `0900_ai_ci` become equal under `unicode_ci`. `utf8mb4_0900_ai_ci` is generally the
 * MORE aggressive normaliser (it folds more), so the practical risk direction is the
 * opposite — but the script reports any failure per-table rather than assuming, and one
 * table failing does not stop the others.
 *
 * ⚠️ IT REWRITES TABLES. On a dev database of this size (largest 195k rows) that is
 * seconds. It is still a rebuild, so this is an explicit script and NOT part of
 * prebuild — a build must never rewrite user data.
 *
 * Run: node nest/scripts/fix-collation-split.cjs            (converts)
 *      node nest/scripts/fix-collation-split.cjs --dry-run  (reports only)
 *
 * Then verify with: node nest/scripts/measure-collation-split.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_COLLATION = 'utf8mb4_unicode_ci';
const TARGET_CHARSET = 'utf8mb4';
const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  console.log(`Collation normalisation -> ${TARGET_COLLATION}${DRY_RUN ? '  [DRY RUN]' : ''}`);
  console.log('');

  const divergent = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, TABLE_COLLATION,
            (SELECT COUNT(*) FROM information_schema.COLUMNS c
              WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                AND c.COLLATION_NAME IS NOT NULL AND c.COLLATION_NAME <> ?) AS stringCols
       FROM information_schema.TABLES t
      WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        AND t.TABLE_COLLATION <> ?
      ORDER BY stringCols DESC, TABLE_NAME`,
    TARGET_COLLATION,
    TARGET_COLLATION,
  );

  if (divergent.length === 0) {
    console.log(`✅ No table diverges from ${TARGET_COLLATION} — nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`${divergent.length} table(s) to convert:`);
  for (const t of divergent) {
    console.log(`   ${t.TABLE_NAME.padEnd(46)} ${t.TABLE_COLLATION.padEnd(22)} ${t.stringCols} string col(s)`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — no DDL executed. Re-run without --dry-run to convert.');
    await prisma.$disconnect();
    return;
  }

  // ⚠️ Table names come from information_schema, not from user input, but they are still
  // interpolated into DDL — which cannot be parameterised. Validated against a strict
  // identifier pattern so a malformed name can never carry SQL.
  const IDENT = /^[A-Za-z0-9_]+$/;

  let ok = 0;
  const failed = [];
  for (const t of divergent) {
    const name = t.TABLE_NAME;
    if (!IDENT.test(name)) {
      failed.push({ name, why: 'name failed identifier validation — refusing to interpolate' });
      console.log(`   ❌ ${name} — name is not a safe identifier, skipped`);
      continue;
    }
    const started = Date.now();
    try {
      // ⚠️ `CONVERT TO CHARACTER SET` (not `ALTER ... SET DEFAULT`) — the table DEFAULT is
      // not what participates in a comparison. Every string COLUMN must move, or the 1267
      // simply changes partner.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${name}\` CONVERT TO CHARACTER SET ${TARGET_CHARSET} COLLATE ${TARGET_COLLATION}`,
      );
      const ms = Date.now() - started;
      ok += 1;
      console.log(`   ✅ ${name.padEnd(46)} converted in ${ms}ms`);
    } catch (e) {
      const msg = String(e.message).split('\n')[0];
      failed.push({ name, why: msg });
      console.log(`   ❌ ${name.padEnd(46)} FAILED — ${msg.slice(0, 120)}`);
    }
  }

  console.log('');
  console.log('── SUMMARY ─────────────────────────────────────────────────────────────');
  console.log(`   converted: ${ok}`);
  console.log(`   failed:    ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`      - ${f.name}: ${f.why}`);
    console.log('');
    console.log('   ⚠️ A failure is usually a UNIQUE index whose rows collide under the new');
    console.log('      collation. Inspect the named table before retrying — do not assume,');
    console.log('      and do not drop an index to force it through.');
  } else {
    console.log('   ✅ all converted. Verify the joins now succeed:');
    console.log('      node nest/scripts/measure-collation-split.cjs');
  }

  await prisma.$disconnect();
  if (failed.length) process.exit(1);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
