/**
 * breaker-post-fix-check.cjs — #846. Is broker 3 skipped AFTER the fix landed?
 *
 * ⚠️ WHY THE FIRST ATTEMPT WAS INVALID — worth keeping
 * ---------------------------------------------------
 * `breaker-before-after.cjs` split its window at "30 minutes ago" and concluded broker 3
 * was still being skipped (190 times). That conclusion was WRONG, and the reason is a
 * timezone trap: `bridge_event.createdAt` is UTC while process start times are reported
 * local (UTC+1). The fix's process started 19:46 LOCAL = 18:46 UTC, and the newest event
 * bucket was 18:36 UTC — so BOTH sides of the "before/after" split predated the fix
 * entirely. It compared pre-fix data against pre-fix data and reported it as a regression
 * signal.
 *
 * The lesson is the one this repo keeps re-learning: check that the window you are
 * comparing actually straddles the change. A boundary that looks right by the wall clock
 * is not right if the column is stored in a different zone.
 *
 * This script takes the boundary from the ARGUMENT (or the adapter file's mtime), and
 * refuses to report a verdict when the post-fix window contains no data — because
 * "no evidence yet" and "the fix works" must never render the same.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const B2 = '10011309743'; // MetaQuotes-Demo  (the broken one)
const B3 = '62135531';    // PepperstoneUK-Demo (the collateral-damage one)

(async () => {
  // Take the fix boundary from the built artefact — the moment the new code existed.
  const builtPath = path.join(__dirname, '..', 'dist', 'src', 'modules', 'providers', 'adapters', 'mt5.adapter.js');
  let boundary;
  if (process.argv[2]) {
    boundary = new Date(process.argv[2]);
  } else {
    boundary = fs.statSync(builtPath).mtime;
  }

  const nowUtc = new Date();
  const minsSince = Math.round((nowUtc - boundary) / 60000);
  console.log('Circuit-breaker skips after the per-broker fix (#846)');
  console.log(`  fix boundary : ${boundary.toISOString()}  (${minsSince} min ago)`);
  console.log(`  now (UTC)    : ${nowUtc.toISOString()}`);
  console.log('  ⚠️ createdAt is UTC; process start times are LOCAL (UTC+1). Do not mix them.');
  console.log('');

  const rows = await prisma.$queryRawUnsafe(
    `SELECT account,
            SUM(CASE WHEN createdAt <= ? THEN 1 ELSE 0 END) AS pre,
            SUM(CASE WHEN createdAt >  ? THEN 1 ELSE 0 END) AS post
       FROM bridge_event
      WHERE errorMessage LIKE '%circuit breaker active%'
        AND createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR
      GROUP BY account`,
    boundary, boundary,
  );

  console.log('  circuit-breaker SKIPS by account:');
  if (rows.length === 0) {
    console.log('    (none in 6h)');
  }
  let b2 = { pre: 0, post: 0 };
  let b3 = { pre: 0, post: 0 };
  for (const r of rows) {
    const pre = Number(r.pre) || 0;
    const post = Number(r.post) || 0;
    console.log(`    acct=${r.account ?? '(null)'}  pre-fix=${String(pre).padStart(6)}  post-fix=${String(post).padStart(6)}`);
    if (r.account === B2) b2 = { pre, post };
    if (r.account === B3) b3 = { pre, post };
  }
  console.log('');

  // How much evidence is there post-fix at all? Zero post-fix rows anywhere means the
  // window proves nothing yet, and must not be read as success.
  const postTotal = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM bridge_event WHERE createdAt > ?`,
    boundary,
  );
  const postEvents = Number(postTotal[0].n) || 0;

  console.log(`  bridge_event rows of ANY kind since the fix: ${postEvents}`);
  console.log(`     (broker 2 flapping? ${b2.post} skips. broker 3 = ${b3.post} skips)`);
  console.log('');

  console.log('── VERDICT ─────────────────────────────────────────────────────────────');
  if (postEvents === 0) {
    console.log('⚠️ INCONCLUSIVE — NO post-fix data at all. Nothing has been tested.');
    console.log('   This is NOT a pass. Re-run once traffic has flowed.');
  } else if (b3.post === 0 && b2.post > 0) {
    console.log('✅ ISOLATION CONFIRMED: post-fix, broker 2 is still being skipped (so the');
    console.log('   conditions remained harsh) while broker 3 is NOT skipped at all.');
    console.log(`   Before the fix broker 3 had been skipped ${b3.pre} time(s).`);
  } else if (b3.post > 0) {
    console.log(`❌ STILL SHARED: broker 3 skipped ${b3.post} time(s) AFTER the fix.`);
    console.log('   Confirm the process carries the rebuild (dist mtime vs process start),');
    console.log('   then check whether the skip comes from a route-less call (key 0) rather');
    console.log("   than from broker 3's own route — brokerEnv(undefined) falls back to");
    console.log('   MT5_ACTIVE_ACCOUNT, so the ACCOUNT COLUMN alone does not identify the key.');
  } else {
    console.log('⚠️ INCONCLUSIVE — broker 3 had no post-fix skips, but neither did broker 2,');
    console.log('   so the fix was not exercised. Absence of evidence, not evidence of absence.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
