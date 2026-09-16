/**
 * verify-breaker-isolation-live.cjs — #846. Does the RUNNING system now isolate brokers?
 *
 * The unit spec proves the adapter's logic in isolation. This proves the DEPLOYED
 * behaviour against live traffic, which is a different claim: the spec cannot see whether
 * the restarted process actually carries the fix, nor whether real traffic paths (quotes,
 * positions, symbols) route with a brokerId at all.
 *
 * THE OBSERVATION THAT MATTERS
 * ----------------------------
 * Broker 2's terminal is still disconnected, so its breaker WILL trip. The question is
 * whether `circuit breaker active (skipped)` rows appear for BROKER 3's account.
 *
 *   - skips only for broker 2  -> isolation works
 *   - skips for broker 3 too   -> the fix is not in effect (check the process was rebuilt
 *                                 and restarted, not just that the source changed)
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BROKER_2_ACCOUNT = '10011309743'; // MT5_ACCOUNT_2 / MetaQuotes-Demo
const BROKER_3_ACCOUNT = '62135531';    // MT5_ACCOUNT_3 / PepperstoneUK-Demo

(async () => {
  const since = process.argv[2] ? parseInt(process.argv[2], 10) : 5;
  console.log(`bridge_event over the last ${since} minute(s), grouped by account`);
  console.log('');

  const mix = await prisma.$queryRawUnsafe(
    `SELECT account, eventType, COUNT(*) AS n
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL ? MINUTE
      GROUP BY account, eventType
      ORDER BY account, n DESC`,
    since,
  );
  if (mix.length === 0) {
    console.log('  (no events — is traffic flowing? the API may have just restarted)');
  }
  for (const m of mix) {
    console.log(`  acct=${m.account ?? '(null)'}  ${String(m.eventType).padEnd(13)} n=${m.n}`);
  }
  console.log('');

  const skips = await prisma.$queryRawUnsafe(
    `SELECT account, COUNT(*) AS n
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL ? MINUTE
        AND errorMessage LIKE '%circuit breaker active%'
      GROUP BY account`,
    since,
  );
  console.log('  circuit-breaker SKIPS by account:');
  if (skips.length === 0) {
    console.log('    (none in this window)');
  }
  for (const s of skips) {
    console.log(`    acct=${s.account ?? '(null)'} skipped=${s.n}`);
  }
  console.log('');

  const b2 = skips.find((s) => s.account === BROKER_2_ACCOUNT);
  const b3 = skips.find((s) => s.account === BROKER_3_ACCOUNT);

  console.log('── VERDICT ─────────────────────────────────────────────────────────────');
  if (b2 && !b3) {
    console.log('✅ ISOLATION CONFIRMED LIVE: broker 2 is being skipped (its terminal is down)');
    console.log('   and broker 3 is NOT. Before the fix, broker 3 was skipped too.');
  } else if (b2 && b3) {
    console.log('❌ STILL GLOBAL: broker 3 is ALSO being skipped. The fix is not in effect —');
    console.log('   confirm the process was rebuilt and restarted, not merely edited.');
  } else if (!b2 && !b3) {
    console.log('⚠️  NO SKIPS in this window. That is NOT the same as a pass: the breaker may');
    console.log('   not have tripped yet, or no traffic has reached it. Absence of evidence');
    console.log('   here, so re-run after a busier window before concluding anything.');
  } else {
    console.log('Only broker 3 skipped and broker 2 not — unexpected given broker 2 is down.');
    console.log('Investigate rather than assume the fix is wrong.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
