/**
 * temp-vix-two.cjs — attribution for the two VIX longs on Pepperstone.
 *
 * Bridge says:
 *   ticket 90555750  VIX buy 0.1  opened 16:58:01  comment 'TCS manual vix-spike-v1 23a'
 *   ticket 90563535  VIX buy 0.1  opened 17:39:14  comment 'TCS manual vix-spike-v1 5ac'
 *
 * Same symbol, same direction, same size, 41 minutes apart. Trace:
 *   1. what the DB recorded for each
 *   2. whether they are attributable to a protocol/bot or only to "manual"
 *   3. what the duplicate guard saw
 */
const { PrismaClient } = require('./nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

const num = (v) => (v == null ? null : Number(v));

(async () => {
  console.log('=== position table: VIX rows ===');
  const pos = await prisma.$queryRawUnsafe(
    "SELECT symbol, provider, side, quantity, brokerTicket, accountId, openedAt, updatedAt, pnl FROM position " +
    "WHERE symbol = 'VIX' OR accountId = '62135531' ORDER BY openedAt DESC"
  );
  if (pos.length === 0) console.log('  (none — broker 3 positions are NOT mirrored)');
  for (const p of pos) {
    console.log(`  ${String(p.symbol).padEnd(6)} ${String(p.side ?? '-').padEnd(5)} ${String(p.quantity).padEnd(5)} ` +
      `ticket=${String(p.brokerTicket ?? '-').padEnd(12)} acct=${String(p.accountId ?? '-').padEnd(12)} ` +
      `opened=${p.openedAt ? new Date(p.openedAt).toISOString() : '-'} pnl=${p.pnl ?? '-'}`);
  }

  console.log('\n=== trade table: VIX rows (attribution lives here) ===');
  const tr = await prisma.$queryRawUnsafe(
    'SELECT id, symbol, side, quantity, status, origin, source, brokerTicket, brokerComment, ' +
    'scoringStrategyId, strategy, magic, sl, tp, openedAt, closedAt FROM trade ' +
    "WHERE symbol = 'VIX' ORDER BY openedAt DESC"
  );
  for (const t of tr) {
    console.log(`  --- ${String(t.side).padEnd(5)} ${String(t.quantity).padEnd(5)} status=${String(t.status).padEnd(7)} origin=${String(t.origin ?? '-').padEnd(9)} source=${String(t.source ?? '-').padEnd(9)}`);
    console.log(`      ticket=${t.brokerTicket ?? '-'}  scoringStrategyId=${t.scoringStrategyId ?? '-'}`);
    console.log(`      strategy=${t.strategy ?? '-'}  magic=${t.magic ?? '-'}  sl=${t.sl ?? '-'} tp=${t.tp ?? '-'}`);
    console.log(`      comment='${t.brokerComment ?? '-'}'`);
    console.log(`      opened=${t.openedAt ? new Date(t.openedAt).toISOString() : '-'} closed=${t.closedAt ? new Date(t.closedAt).toISOString() : '-'}`);
  }
  console.log(`  VIX trade rows: ${tr.length}`);

  console.log('\n=== order table: VIX rows ===');
  const or_ = await prisma.$queryRawUnsafe(
    "SELECT symbol, side, quantity, status, providerId, createdAt FROM `order` WHERE symbol = 'VIX' ORDER BY createdAt DESC LIMIT 12"
  );
  for (const o of or_) {
    console.log(`  ${String(o.side).padEnd(5)} ${String(o.quantity).padEnd(5)} ${String(o.status).padEnd(9)} ` +
      `pid=${String(o.providerId ?? '-').padEnd(46)} ${new Date(o.createdAt).toISOString()}`);
  }

  console.log('\n=== decision_log: VIX, everything today ===');
  const dec = await prisma.$queryRawUnsafe(
    "SELECT timestamp, decision, LEFT(reason, 130) AS r FROM decision_log " +
    "WHERE symbol = 'VIX' AND timestamp >= '2026-09-18 00:00:00' ORDER BY timestamp"
  );
  if (dec.length === 0) console.log('  (no VIX decisions today at all)');
  for (const d of dec) {
    console.log(`  ${new Date(d.timestamp).toISOString().slice(11, 19)} ${String(d.decision).padEnd(9)} ${d.r}`);
  }

  console.log('\n=== does anything attribute these to a BOT? ===');
  const bots = await prisma.$queryRawUnsafe(
    "SELECT id, name, symbol, mode, active, protocolId FROM trading_strategy WHERE symbol = 'VIX' OR name LIKE '%VIX%' OR name LIKE '%vix%'"
  );
  for (const b of bots) {
    console.log(`  ${String(b.name).padEnd(34)} sym=${String(b.symbol).padEnd(6)} mode=${String(b.mode).padEnd(10)} active=${b.active} protocolId=${b.protocolId}`);
  }
  console.log(`  VIX-ish bots: ${bots.length}`);
})().catch(async (e) => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1); })
  .finally(() => prisma.$disconnect());
