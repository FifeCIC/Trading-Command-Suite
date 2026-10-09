// One-off (#766 audit): what constant value does each flagged ready directive record,
// and over what window? Mirrors directive-guard.cjs mode 7 exactly (same query + same
// breakdown walk) so the numbers are comparable to the guard's report.
const path = require('path');
const fs = require('fs');
const NEST = 'C:\\wamp64\\www\\trading-command-suite\\nest';
for (const line of fs.readFileSync(path.join(NEST, '.env'), 'utf8').split(/\r?\n/)) {
  const kv = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
}
const { PrismaClient } = require(path.join(NEST, 'node_modules', '@prisma', 'client'));
const client = new PrismaClient();

const IDS = ['btc-halving-cycle', 'crypto-weekend-effect', 'earnings-momentum', 'sp500-regime', 'session-open-effect', 'social-buzz'];

(async () => {
  await client.$connect();
  const rows = await client.$queryRawUnsafe('SELECT breakdown, timestamp FROM score ORDER BY timestamp DESC LIMIT 5000');
  console.log(`window: ${rows.length} score rows; newest ${rows[0]?.timestamp?.toISOString?.() ?? rows[0]?.timestamp}; oldest ${rows[rows.length - 1]?.timestamp?.toISOString?.() ?? rows[rows.length - 1]?.timestamp}`);
  const stats = new Map();
  for (const row of rows) {
    const b = row.breakdown || {};
    const breakouts = b.breakouts || {};
    for (const group of Object.values(breakouts)) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        if (!entry || !IDS.includes(entry.directiveId)) continue;
        let e = stats.get(entry.directiveId);
        if (!e) { e = { n: 0, values: new Set(), reasons: new Map(), first: null, last: null }; stats.set(entry.directiveId, e); }
        e.n++;
        e.values.add(entry.score);
        e.reasons.set(entry.reason, (e.reasons.get(entry.reason) || 0) + 1);
        if (!e.first) e.first = row.timestamp;
        e.last = row.timestamp;
      }
    }
  }
  for (const id of IDS) {
    const e = stats.get(id);
    if (!e) { console.log(`\n${id}: NO entries in window`); continue; }
    console.log(`\n${id}: ${e.n} records, values=[${[...e.values].join(', ')}]`);
    console.log(`  window: ${e.first?.toISOString?.() ?? e.first} .. ${e.last?.toISOString?.() ?? e.last}`);
    const top = [...e.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [r, c] of top) console.log(`  reason x${c}: ${String(r).slice(0, 140)}`);
  }
  await client.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
