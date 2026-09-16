/**
 * breaker-before-after.cjs — #846. Did broker 3 stop being skipped after the fix?
 *
 * ⚠️ WHY A BEFORE/AFTER AND NOT JUST "no skips now"
 * ------------------------------------------------
 * `verify-breaker-isolation-live.cjs` reports "no skips in this window" — which is NOT a
 * pass, because the breaker may simply not have tripped yet. Absence of evidence.
 *
 * The decisive comparison uses data that ALREADY EXISTED before the fix: if broker 3 was
 * being skipped while broker 2 was down, and stops being skipped after the new process
 * started, that is a before/after on the same system under the same conditions — a far
 * stronger claim than a quiet window.
 *
 * ⚠️ The honest limitation, stated up front: this is NOT an isolated experiment. The
 * restart is the only intentional change, but broker 2's connectivity also flaps (167
 * disconnected / 130 reconnected in 24h), so a drop in broker-3 skips could in principle
 * reflect broker 2 happening to be healthy rather than the fix. The script therefore also
 * reports broker 2's health in each window, so the reader can see whether the comparison
 * is like-for-like. If broker 2 was UP after the restart, this proves nothing.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const B2 = '10011309743'; // MetaQuotes-Demo  (the broken one)
const B3 = '62135531';    // PepperstoneUK-Demo (the healthy one that was collateral damage)

(async () => {
  console.log('Circuit-breaker skips per account, by 15-minute bucket (last 6h)');
  console.log('');

  const buckets = await prisma.$queryRawUnsafe(
    `SELECT
        DATE_FORMAT(createdAt, '%H:%i') AS bucket,
        account,
        SUM(CASE WHEN errorMessage LIKE '%circuit breaker active%' THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN eventType = 'disconnected' THEN 1 ELSE 0 END) AS disconnects,
        SUM(CASE WHEN eventType = 'connected' THEN 1 ELSE 0 END) AS connected,
        COUNT(*) AS total
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR
      GROUP BY bucket, account
      ORDER BY bucket DESC, account`,
  );

  if (buckets.length === 0) {
    console.log('  (no events in 6h)');
    await prisma.$disconnect();
    return;
  }

  // Show the most recent 12 buckets, newest first, so the restart boundary is visible.
  const seen = [];
  let current = null;
  for (const b of buckets) {
    if (b.bucket !== current) {
      if (current !== null) seen.push('');
      current = b.bucket;
      seen.push(`  ${b.bucket}  (UTC)`);
    }
    seen.push(
      `      acct=${b.account} skips=${String(b.skips).padStart(3)}  ` +
        `disconnects=${String(b.disconnects).padStart(3)} connected=${String(b.connected).padStart(3)} total=${b.total}`,
    );
  }
  console.log(seen.slice(0, 40).join('\n'));
  console.log('');

  // ── The specific question: were broker-3 skips happening, and did they stop? ──────
  const b3Skips = await prisma.$queryRawUnsafe(
    `SELECT
        SUM(CASE WHEN createdAt <= UTC_TIMESTAMP() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) AS older,
        SUM(CASE WHEN createdAt >  UTC_TIMESTAMP() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) AS recent
       FROM bridge_event
      WHERE account = ? AND errorMessage LIKE '%circuit breaker active%'
        AND createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR`,
    B3,
  );

  const b2Skips = await prisma.$queryRawUnsafe(
    `SELECT
        SUM(CASE WHEN createdAt <= UTC_TIMESTAMP() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) AS older,
        SUM(CASE WHEN createdAt >  UTC_TIMESTAMP() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) AS recent
       FROM bridge_event
      WHERE account = ? AND errorMessage LIKE '%circuit breaker active%'
        AND createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR`,
    B2,
  );

  console.log('── SKIPS: older (>30m ago) vs recent (<=30m ago) ───────────────────────');
  console.log(`  broker 2 (${B2}): older=${b2Skips[0].older} recent=${b2Skips[0].recent}`);
  console.log(`  broker 3 (${B3}): older=${b3Skips[0].older} recent=${b3Skips[0].recent}`);
  console.log('');

  // Broker 2's health in each window, so the comparison can be judged like-for-like.
  const b2Health = await prisma.$queryRawUnsafe(
    `SELECT
        SUM(CASE WHEN createdAt <= UTC_TIMESTAMP() - INTERVAL 30 MINUTE AND eventType = 'connected' THEN 1 ELSE 0 END) AS older_conn,
        SUM(CASE WHEN createdAt >  UTC_TIMESTAMP() - INTERVAL 30 MINUTE AND eventType = 'connected' THEN 1 ELSE 0 END) AS recent_conn,
        SUM(CASE WHEN createdAt <= UTC_TIMESTAMP() - INTERVAL 30 MINUTE AND eventType = 'disconnected' THEN 1 ELSE 0 END) AS older_disc,
        SUM(CASE WHEN createdAt >  UTC_TIMESTAMP() - INTERVAL 30 MINUTE AND eventType = 'disconnected' THEN 1 ELSE 0 END) AS recent_disc
       FROM bridge_event
      WHERE account = ? AND createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR`,
    B2,
  );
  console.log('  broker 2 health in each window (the comparison must be like-for-like):');
  console.log(`     older : connected=${b2Health[0].older_conn} disconnected=${b2Health[0].older_disc}`);
  console.log(`     recent: connected=${b2Health[0].recent_conn} disconnected=${b2Health[0].recent_disc}`);
  console.log('');

  console.log('── HOW TO READ THIS ────────────────────────────────────────────────────');
  console.log('  Evidence FOR the fix: broker 3 had skips before and none after, WHILE broker 2');
  console.log('    was still flapping in the recent window (so the conditions stayed harsh).');
  console.log('  Evidence AGAINST:  broker 3 skipped recently.');
  console.log('  INCONCLUSIVE:      broker 3 had no skips in EITHER window (nothing was tested),');
  console.log('    or broker 2 went quiet in the recent window (the comparison is not like-for-like).');
  console.log('  ⚠️ Do not record a cause this data cannot isolate.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
