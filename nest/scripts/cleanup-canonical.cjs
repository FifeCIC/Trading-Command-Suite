// Generalised canonical cleanup: for every protocol, delete score rows whose
// symbol is NOT in the protocol's resolved set (per the API's resolveSymbols).
const http = require('http');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3201, path }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  await p.$connect();

  const data = await getJson('/api/scoring/gated/protocols');
  const protocols = data.protocols || [];
  console.log('protocols:', protocols.length);

  let delScore = 0, delSnap = 0;
  for (const proto of protocols) {
    const slug = proto.id || proto.slug;
    const symbols = (proto.resolvedSymbols || []).map((s) => s.toUpperCase());
    if (!slug || symbols.length === 0) continue;

    const placeholders = symbols.map(() => '?').join(',');
    const sqlParams = [slug, ...symbols];

    // Score rows: join symbol for ticker, keep only resolved tickers.
    const r1 = await p.$executeRawUnsafe(
      `DELETE sc FROM score sc JOIN symbol s ON sc.symbolId = s.id
       WHERE sc.strategyId = ? AND s.ticker NOT IN (${placeholders})`,
      ...sqlParams,
    );
    delScore += r1;

    // Rarity snapshots: same rule.
    const r2 = await p.$executeRawUnsafe(
      `DELETE FROM score_snapshot WHERE protocolId = ? AND symbol NOT IN (${placeholders})`,
      ...sqlParams,
    );
    delSnap += r2;

    if (r1 > 0 || r2 > 0) console.log(`  ${slug}: -${r1} score, -${r2} snapshots`);
  }

  console.log('total deleted score rows:', delScore, '| snapshots:', delSnap);
  await p.$disconnect();
})();
