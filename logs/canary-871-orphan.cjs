// #871 live observation: plant a synthetic TICKETED orphan (a trade row with a broker ticket
// and NO position row) and watch the position-sync reconciler reach it — the exact class that
// was invisible to both paths. Clone of closed GER40 ticket 89649760 so provider/accountId/side
// are realistic (broker-3 symbol also exercises the #1089 fan-out).
const path = require('path');
const fs = require('fs');
const NEST = 'C:\\wamp64\\www\\trading-command-suite\\nest';
for (const line of fs.readFileSync(path.join(NEST, '.env'), 'utf8').split(/\r?\n/)) {
  const kv = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
}
const { PrismaClient } = require(path.join(NEST, 'node_modules', '@prisma', 'client'));
const client = new PrismaClient();

const TICKET = 'CANARY-871-' + Date.now();

(async () => {
  await client.$connect();
  const src = await client.trade.findFirst({ where: { brokerTicket: '89649760' } });
  if (!src) { console.error('source row not found'); process.exit(1); }

  const clone = { ...src };
  for (const k of Object.keys(clone)) {
    if (k === 'id' || k === 'brokerTicket' || k === 'status' || k === 'openedAt' ||
        k === 'closedAt' || k === 'closeReason' || k === 'pnl' || k === 'exitPrice' ||
        k === 'pnlInvalid' || k === 'peakPrice' || k === 'peakProfitPct') {
      delete clone[k];
    }
  }
  const created = await client.trade.create({
    data: {
      ...clone,
      id: 'canary-871-' + Date.now(),
      brokerTicket: TICKET,
      status: 'open',
      openedAt: new Date(),
    },
  });
  console.log(`PLANTED: id=${created.id} ticket=${TICKET} symbol=${created.symbol} accountId=${created.accountId}`);

  // Poll for up to 8 minutes: does it get visited + closed?
  const deadline = Date.now() + 8 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    const row = await client.trade.findUnique({ where: { id: created.id } });
    const state = `${row.status}/${row.closeReason ?? '-'}/pnl=${row.pnl ?? '-'}`;
    if (state !== last) { console.log(`  t+${Math.round((Date.now() - deadline + 8 * 60 * 1000) / 1000)}s: ${state}`); last = state; }
    if (row.status !== 'open') {
      console.log(`OBSERVED: reconciled. closeReason=${row.closeReason} exitPrice=${row.exitPrice} pnl=${row.pnl}`);
      break;
    }
  }
  const final = await client.trade.findUnique({ where: { id: created.id } });
  if (final.status === 'open') console.log('NOT RECONCILED within 8 minutes');
  console.log(`CLEANUP: deleting canary row ${created.id}`);
  await client.trade.delete({ where: { id: created.id } });
  await client.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
