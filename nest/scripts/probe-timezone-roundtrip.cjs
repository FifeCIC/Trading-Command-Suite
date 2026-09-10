/**
 * Isolate why marketbar rows land in the future (#750 symptom, 2026-09-10).
 *
 * The bridge returns CORRECT UTC timestamps (verified: 18:55:00 while true UTC
 * was 18:55:23). The DB has rows stamped ~20+ minutes ahead of true UTC. So the
 * corruption is between the NestJS insert and the stored value.
 *
 * `marketbar.timestamp` is a `datetime(3)` — NO timezone. That makes it a
 * timezone TRAP: the same instant can be written or read back differently
 * depending on the session time_zone, and a `datetime` never reveals that.
 *
 * This script round-trips a KNOWN instant to find which side shifts.
 * Read-only (SELECT only).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // A known instant, deliberately on a 5-minute boundary, in UTC.
  const known = new Date('2026-09-10T18:45:00.000Z');

  console.log('=== what we send ===');
  console.log('  JS Date           :', known.toISOString());

  const r = await prisma.$queryRawUnsafe(
    'SELECT ? AS echoed, UTC_TIMESTAMP() AS utc_now, NOW() AS local_now, ' +
    '@@global.time_zone AS gtz, @@session.time_zone AS stz',
    known,
  );
  const row = r[0];

  console.log('\n=== what the DB returns ===');
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
  console.log('  echoed back       :', iso(row.echoed));
  console.log('  DB UTC_TIMESTAMP  :', iso(row.utc_now));
  console.log('  DB NOW()          :', iso(row.local_now));
  console.log('  global time_zone  :', row.gtz);
  console.log('  session time_zone :', row.stz);

  console.log('\n=== verdict ===');
  const echoedMs = row.echoed instanceof Date ? row.echoed.getTime() : Date.parse(String(row.echoed));
  const driftMin = (echoedMs - known.getTime()) / 60000;
  if (Math.abs(driftMin) < 0.001) {
    console.log('  parameter round-trip is EXACT — the driver is not shifting on write.');
    console.log('  Therefore the shift is in the VALUE being inserted, or in `datetime` column semantics.');
  } else {
    console.log(`  ⚠️ parameter round-trip DRIFTS by ${driftMin.toFixed(1)} minutes.`);
    console.log('  That is the defect: the driver/timezone is shifting the instant on write.');
  }

  // Now the decisive test: what does an INSERTED datetime read back as?
  // Use a scratch table so nothing real is touched.
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS _tz_probe (id INT PRIMARY KEY, ts DATETIME(3) NOT NULL)',
  );
  await prisma.$executeRawUnsafe('DELETE FROM _tz_probe');
  await prisma.$executeRawUnsafe('INSERT INTO _tz_probe (id, ts) VALUES (1, ?)', known);
  const back = await prisma.$queryRawUnsafe('SELECT ts, UTC_TIMESTAMP() AS utc_now FROM _tz_probe WHERE id = 1');
  const stored = back[0].ts;
  const storedMs = stored instanceof Date ? stored.getTime() : Date.parse(String(stored));
  console.log('\n=== after a real INSERT into a datetime(3) column ===');
  console.log('  sent              :', known.toISOString());
  console.log('  read back         :', iso(stored));
  console.log(`  drift             : ${((storedMs - known.getTime()) / 60000).toFixed(1)} min`);

  const nowMs = back[0].utc_now instanceof Date ? back[0].utc_now.getTime() : Date.parse(String(back[0].utc_now));
  console.log('  vs DB UTC now     :', ((storedMs - nowMs) / 60000).toFixed(0), 'min  (negative = in the past, good)');

  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS _tz_probe');
  console.log('\n(scratch table dropped)');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  try { await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS _tz_probe'); } catch {}
  await prisma.$disconnect();
  process.exit(1);
});
