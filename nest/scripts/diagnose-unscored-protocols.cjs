// Diagnose why active protocols show no scores on the Protocols Ladder.
// Replicates the automation loop's skip checks: symbol row → >=20 5m bars.
const http = require('http');
const { PrismaClient } = require('@prisma/client');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3201, path }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  const p = new PrismaClient();
  await p.$connect();

  const active = await p.$queryRawUnsafe('SELECT slug, name FROM protocol WHERE active=1 ORDER BY slug');
  console.log(`active protocols: ${active.length}`);

  for (const proto of active) {
    const res = await getJson(`/api/scoring/gated/protocols/${proto.slug}/symbols`);
    const symbols = res?.symbols || [];
    const detail = [];
    for (const sym of symbols) {
      const row = await p.$queryRawUnsafe('SELECT id FROM symbol WHERE ticker=?', sym);
      if (!row.length) { detail.push(`${sym}: no symbol row`); continue; }
      const bars = await p.$queryRawUnsafe(
        "SELECT COUNT(*) n, MAX(timestamp) last FROM marketbar WHERE symbolId=? AND timeframe='5m'",
        row[0].id,
      );
      const n = Number(bars[0].n || 0);
      detail.push(`${sym}: ${n} 5m bars${bars[0].last ? `, last ${bars[0].last.toISOString()}` : ''}${n < 20 ? ' (<20 → loop skips)' : ''}`);
    }
    console.log(`${proto.slug} [${symbols.length} symbols]: ${detail.length ? detail.join(' | ') : 'NO SYMBOLS RESOLVED'}`);
  }

  await p.$disconnect();
})();
