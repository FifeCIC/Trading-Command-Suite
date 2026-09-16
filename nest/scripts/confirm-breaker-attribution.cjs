/**
 * confirm-breaker-attribution.cjs — which broker's errors tripped the shared breaker?
 *
 * The diagnosis so far:
 *   - VIX routes to brokerId=3 (:5001 Pepperstone, connected=TRUE)
 *   - every blocked request in bridge_event is against account 10011309743
 *   - broker 2 (:5000 MetaQuotes) is connected=FALSE
 *
 * If account 10011309743 is BROKER 2, then broker 3's healthy bridge was blocked by
 * broker 2's outage — which is the defect. If it is BROKER 3, the attribution is
 * different and I must not record the wrong cause (the exact error this session has
 * made four times).
 *
 * This resolves the account→broker mapping from the bridge env vars, and looks for the
 * TRIP event itself rather than only the subsequent skips.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Breaker attribution check');
  console.log('');

  // ── 1. account -> broker mapping, from the environment the adapter reads ─────────
  // `logBridgeDiag` stores `this.brokerEnv(brokerId, 'MT5_ACCOUNT')`, so the account in
  // bridge_event identifies the broker. Printed, not assumed.
  console.log('MT5_ACCOUNT* env vars in this process:');
  for (const [k, v] of Object.entries(process.env)) {
    if (/^MT5_(ACCOUNT|SERVER|BRIDGE)/.test(k)) console.log(`   ${k}=${v}`);
  }
  console.log('   (the API process has its own env; compare with nest/.env below)');
  console.log('');

  // ── 2. Distinct accounts seen in bridge_event ───────────────────────────────────
  const accounts = await prisma.$queryRawUnsafe(
    `SELECT account, server, COUNT(*) AS n,
            MIN(createdAt) AS firstSeen, MAX(createdAt) AS lastSeen
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 24 HOUR
      GROUP BY account, server
      ORDER BY n DESC`,
  );
  console.log('accounts in bridge_event (24h):');
  for (const a of accounts) {
    console.log(`   acct=${a.account ?? '(null)'} server=${a.server ?? '(null)'} n=${a.n}`);
    console.log(`        first=${new Date(a.firstSeen).toISOString()} last=${new Date(a.lastSeen).toISOString()}`);
  }
  console.log('');

  // ── 3. The TRIP event — the decisive row ────────────────────────────────────────
  // `tripBreaker` calls logBridgeEvent('disconnected', reason, brokerId). The SKIPS are
  // consequences; this is the cause. Look for it explicitly.
  const trips = await prisma.$queryRawUnsafe(
    `SELECT eventType, account, server, errorMessage, createdAt
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 24 HOUR
        AND (eventType = 'disconnected' OR errorMessage LIKE '%TRIPPED%' OR errorMessage LIKE '%Circuit breaker%')
      ORDER BY createdAt DESC LIMIT 12`,
  );
  console.log(`trip/release events (24h): ${trips.length}`);
  for (const t of trips) {
    console.log(`   ${new Date(t.createdAt).toISOString()} [${t.eventType}] acct=${t.account ?? '-'} — ${String(t.errorMessage ?? '').slice(0, 150)}`);
  }
  console.log('');

  // ── 4. Event-type distribution, so an empty filter is visibly empty ─────────────
  const mix = await prisma.$queryRawUnsafe(
    `SELECT eventType, COUNT(*) AS n FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 24 HOUR
      GROUP BY eventType ORDER BY n DESC`,
  );
  console.log('event-type mix (24h):');
  for (const m of mix) console.log(`   ${String(m.eventType).padEnd(14)} ${m.n}`);
  console.log('');

  // ── 5. Did the HEALTHY broker ever get an order through? ────────────────────────
  // If broker 3 orders succeeded in the same window, the block was selective-in-time
  // (cooldown) rather than a permanent per-broker refusal — which still means broker 2
  // blocked broker 3, but bounds the impact.
  const orders = await prisma.$queryRawUnsafe(
    `SELECT status, providerId, createdAt
       FROM \`order\`
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 24 HOUR
      ORDER BY createdAt DESC LIMIT 12`,
  ).catch(() => null);
  if (orders) {
    console.log(`recent order rows (24h): ${orders.length}`);
    for (const o of orders) {
      console.log(`   ${new Date(o.createdAt).toISOString()} status=${o.status} providerId=${o.providerId ?? '-'}`);
    }
  }
  console.log('');
  console.log('── READ THIS AGAINST THE HYPOTHESIS ─────────────────────────────────────');
  console.log('If the trip event names an account for broker 2 while VIX targets broker 3,');
  console.log('the shared-breaker defect is CONFIRMED with the cause named, not inferred.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
