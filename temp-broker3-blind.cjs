/**
 * temp-broker3-blind.cjs — why is the duplicate guard blind to broker 3?
 *
 * duplicate-guard.service.ts:69
 *     where: { symbol: ticker, provider: brokerId }     // the POSITION TABLE
 *
 * Measured: position has ZERO rows for account 62135531 (Pepperstone).
 * So the guard cannot see any broker-3 position, and every symbol routed to
 * broker 3 has NO duplicate protection.
 *
 * This checks the two candidate explanations:
 *   A. broker 3 is not in the automation loop's broker set, so it is never synced
 *   B. it is synced, but the rows are written under a provider/accountId the guard
 *      does not match
 */
const { PrismaClient } = require('./nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('=== position rows: which broker has a mirror at all? ===');
  const g = await prisma.$queryRawUnsafe(
    'SELECT provider, accountId, COUNT(*) AS n, MAX(updatedAt) AS last FROM position GROUP BY provider, accountId ORDER BY n DESC'
  );
  for (const r of g) {
    console.log(`  provider=${String(r.provider).padEnd(12)} accountId=${String(r.accountId ?? '-').padEnd(16)} n=${String(r.n).padStart(3)} lastUpdated=${r.last ? new Date(r.last).toISOString() : '-'}`);
  }

  console.log('\n=== broker config: how many brokers does automation know? ===');
  const gs = await prisma.$queryRawUnsafe(
    "SELECT `key`, `value` FROM global_setting WHERE `key` LIKE '%broker%' OR `key` LIKE '%mt5%' ORDER BY `key`"
  );
  if (gs.length === 0) console.log('  (no broker settings found)');
  for (const r of gs) console.log(`  ${String(r.key).padEnd(42)} = ${String(r.value).slice(0, 60)}`);

  console.log('\n=== symbol_route: which broker serves VIX? ===');
  const sr = await prisma.$queryRawUnsafe(
    "SELECT symbol, provider, brokerSymbol, brokerId, enabled FROM symbol_route WHERE symbol IN ('VIX','GER40','UK100','XAGUSD','US500','FRA40','US30','EURUSD') ORDER BY symbol"
  );
  for (const r of sr) {
    console.log(`  ${String(r.symbol).padEnd(8)} provider=${String(r.provider).padEnd(10)} brokerSymbol=${String(r.brokerSymbol ?? '-').padEnd(10)} brokerId=${String(r.brokerId ?? '-').padEnd(4)} enabled=${r.enabled}`);
  }

  console.log('\n=== bridge_event: is broker 3 being polled at all? ===');
  const be = await prisma.$queryRawUnsafe(
    "SELECT account, server, eventType, COUNT(*) AS n, MAX(createdAt) AS last FROM bridge_event " +
    "WHERE createdAt >= (NOW() - INTERVAL 6 HOUR) GROUP BY account, server, eventType ORDER BY n DESC LIMIT 12"
  );
  for (const r of be) {
    console.log(`  ${String(r.account ?? '-').padEnd(14)} ${String(r.server ?? '-').padEnd(22)} ${String(r.eventType).padEnd(14)} n=${String(r.n).padStart(5)} last=${new Date(r.last).toISOString().slice(11, 19)}`);
  }

  console.log('\n=== account table: are both broker accounts known? ===');
  const acct = await prisma.$queryRawUnsafe(
    'SELECT id, provider, accountId, name, currency, isActive FROM account ORDER BY provider, accountId'
  ).catch(() => null);
  if (!acct) console.log('  (account table not queryable)');
  else for (const a of acct) {
    console.log(`  provider=${String(a.provider).padEnd(12)} accountId=${String(a.accountId).padEnd(16)} name=${String(a.name ?? '-').padEnd(24)} active=${a.isActive}`);
  }
})().catch(async (e) => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1); })
  .finally(() => prisma.$disconnect());
