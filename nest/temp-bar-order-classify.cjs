/**
 * TEMP DIAGNOSTIC (2026-09-11) — classify the INV-BAR-ORDER 5m failure:
 * data gap (no bars in window) vs real scoring bug (#751, bars exist but arena didn't see them).
 * DELETE AFTER USE.
 */
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const s = await p.symbol.findFirst({ where: { ticker: 'AUDUSD' }, select: { id: true, ticker: true } });
  const asOf = new Date('2026-09-11T22:25:00.000Z');
  const newest = new Date('2026-09-11T22:35:00.000Z');

  console.log(`  AUDUSD id=${s.id}`);
  console.log(`  arena asOf = ${asOf.toISOString()}`);
  console.log(`  newest bar = ${newest.toISOString()}`);

  const rows = await p.marketBar.findMany({
    where: { symbolId: s.id, timeframe: '5m', timestamp: { gte: asOf } },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, provider: true },
  });
  console.log(`\n  5m bars at/after asOf: ${rows.length}`);
  for (const r of rows) console.log(`    ${r.timestamp.toISOString()}  ${r.provider}`);

  // The probe's window test: bars strictly between asOf+60s and newest
  const inWindow = await p.marketBar.count({
    where: { symbolId: s.id, timeframe: '5m', timestamp: { gte: new Date(asOf.getTime() + 60_000), lt: newest } },
  });
  console.log(`\n  bars strictly in (asOf+60s, newest) = ${inWindow}`);
  console.log(`  probe verdict: ${inWindow > 0 ? '#751 REAL BUG (bars exist, arena did not see them)' : 'data gap (self-healing, not a bug)'}`);

  await p.$disconnect();
})();
