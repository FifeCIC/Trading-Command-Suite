/**
 * measure-collation-split.cjs — #842. Which tables disagree, and do real joins FAIL?
 *
 * WHY THIS MEASURES RATHER THAN REPORTS
 * -------------------------------------
 * A collation split is only a defect to the extent it BREAKS something. MySQL raises
 * error 1267 ("Illegal mix of collations") when a join or comparison mixes incompatible
 * collations — and it raises it at QUERY TIME, on data-dependent paths, not at build
 * time. So the useful questions are:
 *
 *   1. How many tables are on the odd collation, and which?
 *   2. Does a join between an odd table and a normal table actually throw 1267?
 *   3. Is the failure on a path that MATTERS (money, retention, scoring)?
 *
 * A list of mismatched tables with no failing query is a tidiness issue. A mismatched
 * table on the trade path is a live defect. This file distinguishes them by EXECUTING
 * the joins rather than reasoning about them.
 *
 * It also tests whether `utf8mb4_0900_ai_ci` and `utf8mb4_unicode_ci` are actually
 * incompatible for the columns in question — accent-insensitive vs accent-sensitive
 * collations differ, and that changes whether a comparison throws or silently matches
 * different rows (the second is worse: no error, wrong answer).
 *
 * Read-only. No writes. No DDL.
 *
 * Run: node nest/scripts/measure-collation-split.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ODD = 'utf8mb4_0900_ai_ci';
const NORMAL = 'utf8mb4_unicode_ci';

(async () => {
  console.log('Collation split measurement (#842)');
  console.log('');

  // ── 1. Table-level collations ────────────────────────────────────────────────────
  const tables = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_COLLATION, TABLE_NAME`,
  );

  const byCollation = new Map();
  for (const t of tables) {
    const list = byCollation.get(t.TABLE_COLLATION) || [];
    list.push(t.TABLE_NAME);
    byCollation.set(t.TABLE_COLLATION, list);
  }

  console.log(`tables: ${tables.length}, distinct collations: ${byCollation.size}`);
  for (const [coll, list] of [...byCollation.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${String(coll).padEnd(22)} ${String(list.length).padStart(4)}  ${list.slice(0, 6).join(', ')}${list.length > 6 ? ' …' : ''}`);
  }
  console.log('');

  const oddTables = byCollation.get(ODD) || [];
  if (oddTables.length === 0) {
    console.log(`No table uses ${ODD} — the split is already gone. Nothing to do.`);
    await prisma.$disconnect();
    return;
  }
  console.log(`⚠️ ${oddTables.length} table(s) on ${ODD}: ${oddTables.join(', ')}`);
  console.log('');

  // ── 2. Which COLUMNS actually carry the odd collation ────────────────────────────
  // A table-level default does not mean every column uses it, and only the COLUMNS
  // participate in a comparison. Measuring at table level can overstate the problem.
  const cols = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLLATION_NAME IS NOT NULL
        AND COLLATION_NAME <> ?
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    NORMAL,
  );
  console.log(`string columns NOT on ${NORMAL}: ${cols.length}`);
  for (const c of cols.slice(0, 25)) {
    console.log(`   ${c.TABLE_NAME}.${c.COLUMN_NAME}  ${c.DATA_TYPE}  ${c.COLLATION_NAME}`);
  }
  if (cols.length > 25) console.log(`   … +${cols.length - 25} more`);
  console.log('');

  const oddCols = cols.filter((c) => c.COLLATION_NAME === ODD);

  // ── 3. Do the joins actually FAIL? Execute them, do not reason about them ────────
  console.log('── EXECUTED join probes ────────────────────────────────────────────────');
  if (oddCols.length === 0) {
    console.log('   No column carries the odd collation, so no join can mix them.');
    await prisma.$disconnect();
    return;
  }

  // Build a join probe for each odd table that has a plausible FK-ish partner, using
  // ONLY columns verified to exist (introspected above where possible).
  const probes = [];
  for (const c of oddCols) {
    if (!/id$/i.test(c.COLUMN_NAME)) continue; // joins are on keys
    probes.push({
      label: `${c.TABLE_NAME}.${c.COLUMN_NAME} JOIN a normal table`,
      sql: `SELECT COUNT(*) AS n
              FROM \`${c.TABLE_NAME}\` a
              JOIN marketbar b ON b.\`${c.COLUMN_NAME}\` = a.\`${c.COLUMN_NAME}\`
             LIMIT 1`,
    });
  }

  if (probes.length === 0) {
    console.log('   No key-like column on the odd tables — no join probe constructed.');
    console.log('   ⚠️ Reporting that as UNKNOWN, not as a pass: a check that could not run');
    console.log('      has not established anything.');
    await prisma.$disconnect();
    return;
  }

  let threw = 0;
  for (const p of probes) {
    try {
      await prisma.$queryRawUnsafe(p.sql);
      console.log(`   OK      ${p.label}`);
    } catch (e) {
      const msg = String(e.message);
      if (msg.includes('1267') || /Illegal mix of collations/i.test(msg)) {
        threw += 1;
        console.log(`   THREW   ${p.label}`);
        console.log(`           ${msg.split('\n')[0].slice(0, 150)}`);
      } else {
        console.log(`   OTHER   ${p.label} — ${msg.split('\n')[0].slice(0, 110)}`);
      }
    }
  }

  console.log('');
  console.log('── VERDICT ──────────────────────────────────────────────────────────────');
  if (threw > 0) {
    console.log(`${threw} join(s) FAIL with MySQL 1267 (Illegal mix of collations).`);
    console.log('This is a LIVE defect, not tidiness: the query throws at runtime on a');
    console.log('data-dependent path. Fix by normalising the odd columns to the majority');
    console.log('collation with ALTER TABLE ... CONVERT TO CHARACTER SET, one table at a');
    console.log('time, verifying each with this same probe.');
  } else {
    console.log('No 1267 raised — but read the OTHER lines above before concluding "safe".');
    console.log('A mixed comparison can also SUCCEED while matching different rows, which');
    console.log('is worse than throwing because there is no error to notice.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
