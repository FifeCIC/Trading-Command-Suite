const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const out = [];
const L = (s) => out.push(s);
const N = (v) => (typeof v === 'bigint' ? Number(v) : v);

(async () => {
  const sym = await p.symbol.findFirst({ where: { ticker: 'XAUUSD' }, select: { id: true } });

  // DECISIVE TEST: does a 4h bar's high/low match the 1h bars covering [ts, ts+4h)
  // (OPEN-stamped) or [ts-4h, ts) (CLOSE-stamped)?
  // Only use 4h bars fully in the past so both windows are complete.
  const bars4h = await p.$queryRawUnsafe(`
    SELECT timestamp ts, open, high, low, close, volume FROM marketbar
    WHERE symbolId='${sym.id}' AND timeframe='4h' AND timestamp <= DATE_SUB(NOW(), INTERVAL 1 DAY)
    ORDER BY timestamp DESC LIMIT 6`);

  L('4h ALIGNMENT: does the bar describe [ts, ts+4h) or [ts-4h, ts)?');
  L('');
  for (const b of bars4h) {
    const ts = new Date(b.ts);
    const from = new Date(ts.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const to = ts.toISOString().slice(0, 19).replace('T', ' ');
    const fwdEnd = new Date(ts.getTime() + 4 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    // Forward window: 1h bars [ts, ts+4h)
    const fwd = await p.$queryRawUnsafe(`
      SELECT COUNT(*) n, MAX(high) hi, MIN(low) lo
      FROM marketbar WHERE symbolId='${sym.id}' AND timeframe='1h'
        AND timestamp >= '${to}' AND timestamp < '${fwdEnd}'`);
    // Backward window: 1h bars [ts-4h, ts)
    const bwd = await p.$queryRawUnsafe(`
      SELECT COUNT(*) n, MAX(high) hi, MIN(low) lo
      FROM marketbar WHERE symbolId='${sym.id}' AND timeframe='1h'
        AND timestamp >= '${from}' AND timestamp < '${to}'`);

    const fwdMatch = N(fwd[0].n) === 4 && Math.abs(Number(fwd[0].hi) - Number(b.high)) < 0.5;
    const bwdMatch = N(bwd[0].n) === 4 && Math.abs(Number(bwd[0].hi) - Number(b.high)) < 0.5;

    L('4h bar @ ' + ts.toISOString());
    L('   bar high=' + b.high + '  low=' + b.low);
    L('   FWD  1h[' + to.slice(11) + '..' + fwdEnd.slice(11) + ')  n=' + N(fwd[0].n) + ' hi=' + fwd[0].hi + (fwdMatch ? '   <<< MATCHES (open-stamped)' : ''));
    L('   BWD  1h[' + from.slice(11) + '..' + to.slice(11) + ')  n=' + N(bwd[0].n) + ' hi=' + bwd[0].hi + (bwdMatch ? '   <<< MATCHES (close-stamped)' : ''));
    L('');
  }

  // Same test for 1h, using 5m bars, to confirm 1h is open-stamped.
  L('1h ALIGNMENT (control - expected open-stamped):');
  const bars1h = await p.$queryRawUnsafe(`
    SELECT timestamp ts, high FROM marketbar
    WHERE symbolId='${sym.id}' AND timeframe='1h' AND timestamp <= DATE_SUB(NOW(), INTERVAL 1 DAY)
    ORDER BY timestamp DESC LIMIT 3`);
  for (const b of bars1h) {
    const ts = new Date(b.ts);
    const to = ts.toISOString().slice(0, 19).replace('T', ' ');
    const fwdEnd = new Date(ts.getTime() + 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const from = new Date(ts.getTime() - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const fwd = await p.$queryRawUnsafe(`SELECT COUNT(*) n, MAX(high) hi FROM marketbar WHERE symbolId='${sym.id}' AND timeframe='5m' AND timestamp >= '${to}' AND timestamp < '${fwdEnd}'`);
    const bwd = await p.$queryRawUnsafe(`SELECT COUNT(*) n, MAX(high) hi FROM marketbar WHERE symbolId='${sym.id}' AND timeframe='5m' AND timestamp >= '${from}' AND timestamp < '${to}'`);
    L('  1h @ ' + ts.toISOString() + ' high=' + b.high +
      '  FWD(12x5m) n=' + N(fwd[0].n) + ' hi=' + fwd[0].hi + (Math.abs(Number(fwd[0].hi) - Number(b.high)) < 0.5 ? ' <-- MATCH' : '') +
      '  BWD n=' + N(bwd[0].n) + ' hi=' + bwd[0].hi + (Math.abs(Number(bwd[0].hi) - Number(b.high)) < 0.5 ? ' <-- MATCH' : ''));
  }

  require('fs').writeFileSync('temp-align2.txt', out.join('\n'), 'utf8');
  await p.$disconnect();
})();
