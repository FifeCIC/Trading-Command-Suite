#!/usr/bin/env node
/**
 * inspect-781-symbols.cjs — what is actually PERSISTED for the #781 symbols?
 *
 * WHY: #781 reports UK100 serving a 4-month-old feed and VIX returning 0 bars *from the bridge*.
 * But the bridge and the DATABASE are different questions, and only the database affects
 * scoring. `bar-refresh.service.ts` upserts with ON DUPLICATE KEY UPDATE keyed on
 * (symbolId, timeframe, timestamp) — so it can INSERT a fresh bar but can NEVER delete the
 * stale one. A stale row therefore persists harmlessly UNLESS it is the newest row.
 *
 * This script answers: for each symbol, is the NEWEST row in the DB fresh or stale, and which
 * provider wrote it?
 *
 * Read-only.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const WANT = ['UK100', 'VIX', 'US500', 'USTEC', 'GER40'];
const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];

(async () => {
  console.log(`\npersisted bar freshness — checked ${new Date().toISOString()} (UTC)\n`);

  for (const ticker of WANT) {
    const sym = await prisma.symbol.findFirst({ where: { ticker } });
    if (!sym) { console.log(`${ticker.padEnd(7)} — NO SYMBOL ROW (cannot be scored at all)`); continue; }

    const route = await prisma.symbolRoute.findFirst({ where: { symbol: ticker } }).catch(() => null);
    console.log(`${ticker.padEnd(7)} symbolId=${sym.id} route.provider=${route?.provider ?? '(none)'} route.enabled=${route?.enabled ?? '?'}`);

    for (const tf of TFS) {
      const rows = await prisma.marketBar.findMany({
        where: { symbolId: sym.id, timeframe: tf },
        orderBy: { timestamp: 'desc' },
        take: 2,
        select: { timestamp: true, provider: true, close: true },
      });
      if (!rows.length) { console.log(`   ${tf.padEnd(4)} — no bars`); continue; }

      const newest = rows[0];
      const ageMs = Date.now() - new Date(newest.timestamp).getTime();
      const mins = ageMs / 60000;
      const label = mins < 0 ? `${(-mins).toFixed(1)} min in the FUTURE`
        : mins < 60 ? `${mins.toFixed(1)} min`
        : mins < 2880 ? `${(mins / 60).toFixed(1)} h`
        : `${(mins / 1440).toFixed(1)} days`;
      const staleish = mins > 1440 ? '   <-- STALE as newest row' : '';
      console.log(`   ${tf.padEnd(4)} newest=${new Date(newest.timestamp).toISOString()} ` +
                  `price=${newest.close} provider=${newest.provider} age=${label}${staleish}` +
                  (rows[1] ? `   [prev ${new Date(rows[1].timestamp).toISOString()}]` : ''));
    }

    // Total row count + distinct providers, to see WHO has been writing.
    const all = await prisma.marketBar.groupBy({
      by: ['provider'],
      where: { symbolId: sym.id },
      _count: { _all: true },
    }).catch(() => []);
    if (all.length) {
      console.log(`   providers: ${all.map((a) => `${a.provider}=${a._count._all}`).join(', ')}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
