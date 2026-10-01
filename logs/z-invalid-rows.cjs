// @prisma/client resolves from nest/node_modules, not the repo root.
const { PrismaClient } = require('C:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.trade.findMany({
    where: { pnlInvalid: 1 },
    select: { symbol: true, provider: true, brokerTicket: true, status: true, closeReason: true },
  });
  const byLen = {};
  for (const r of rows) {
    const k = (r.brokerTicket || 'null').length + '-char';
    byLen[k] = (byLen[k] || 0) + 1;
  }
  console.log('total pnlInvalid rows:', rows.length);
  console.log('by brokerTicket length:', JSON.stringify(byLen));
  console.log('by status:', JSON.stringify(rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})));
  console.log('samples:');
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${r.symbol} ${r.provider} ticket=${r.brokerTicket} status=${r.status} reason=${r.closeReason}`);
  }
  // Are any of these tickets ALSO a live positionId on the bridge? (checked separately)
  await p.$disconnect();
})();
