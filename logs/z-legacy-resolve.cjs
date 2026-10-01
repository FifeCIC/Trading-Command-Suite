const { PrismaClient } = require('C:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const http = require('http');
const p = new PrismaClient();

const getJson = (url) => new Promise((resolve) => {
  const req = http.get(url, { timeout: 20000 }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => {
      try { resolve({ ok: res.statusCode === 200, body: JSON.parse(b) }); }
      catch (e) { resolve({ ok: false, status: `unparseable ${e.message}` }); }
    });
  });
  req.on('error', (e) => resolve({ ok: false, status: e.code }));
  req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
});

(async () => {
  const rows = await p.trade.findMany({
    where: { pnlInvalid: 1 },
    select: { id: true, symbol: true, brokerTicket: true, provider: true, quantity: true, openedAt: true },
  });
  const legacy = rows.filter((r) => r.brokerTicket && String(r.brokerTicket).length === 12);
  console.log(`pnlInvalid rows with a 12-char (order-shaped) ticket: ${legacy.length}`);

  // Which bridge holds this symbol? Try both.
  let deals = [];
  for (const port of [5000, 5001]) {
    const r = await getJson(`http://localhost:${port}/history/deals?days=30`);
    if (r.ok && Array.isArray(r.body?.deals)) {
      console.log(`  :${port} returned ${r.body.deals.length} deals`);
      deals = deals.concat(r.body.deals.map((d) => ({ ...d, _port: port })));
    } else {
      console.log(`  :${port} — ${r.status || 'no deals array'}`);
    }
  }
  if (!deals.length) { console.log('\nNo deal history available — cannot verify resolution.'); await p.$disconnect(); return; }

  const byOrder = new Map();
  for (const d of deals) if (d.orderId != null) byOrder.set(String(d.orderId), d);

  let resolved = 0;
  console.log('\nResolution of the legacy tickets against REAL deal history:');
  for (const r of legacy.slice(0, 20)) {
    const hit = byOrder.get(String(r.brokerTicket));
    if (hit) {
      resolved++;
      console.log(`  ${r.symbol} ticket=${r.brokerTicket} -> positionId=${hit.positionId} (port ${hit._port}) RESOLVED`);
    } else {
      console.log(`  ${r.symbol} ticket=${r.brokerTicket} -> NOT in the returned window (older than 30d?)`);
    }
  }
  console.log(`\n${resolved}/${Math.min(20, legacy.length)} checked tickets resolve via orderId.`);
  await p.$disconnect();
})();
