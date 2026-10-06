/**
 * Scratch for #1056, part 3 — does the trail ever move an SL ABOVE entry, and does `trade.sl` track
 * what `stop_adjustment` recorded?
 *
 * THE TEST: on a BUY, a stop trailed into profit has sl > entryPrice. If adjusted symbols show that
 * and FRA40 never does, the trail is not firing for FRA40 rather than having nothing to do.
 *
 * ⚠️ Column names read from scripts/db-schema.cjs, not remembered.
 * Read-only. logs/ on purpose (a file in scripts/ stales docs/TOOLS-INDEX.md).
 */
const { PrismaClient } = require('c:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

const SYMS = ['EURJPY', 'GBPCAD', 'NZDJPY', 'EURCAD', 'US500', 'US30', 'GER40', 'UK100', 'XAGUSD', 'FRA40'];

(async () => {
  console.log('=== BUY trades: was the SL ever recorded ABOVE entry? ===');
  console.log(`${'symbol'.padEnd(9)}${'buys'.padEnd(7)}${'sl>entry'.padEnd(10)}${'closes>0'.padEnd(10)}verdict`);

  for (const s of SYMS) {
    const t = await prisma.trade.findMany({
      where: { symbol: s, provider: 'mt5', side: { in: ['buy', 'BUY'] } },
      select: { sl: true, entryPrice: true, pnl: true, status: true, brokerTicket: true },
    });
    const above = t.filter((x) => x.sl != null && x.entryPrice != null && x.sl > x.entryPrice).length;
    const win = t.filter((x) => (x.pnl ?? 0) > 0).length;
    console.log(`${s.padEnd(9)}${String(t.length).padEnd(7)}${String(above).padEnd(10)}${String(win).padEnd(10)}${above > 0 ? 'trail HAS moved a stop into profit' : 'NEVER moved a stop into profit'}`);
  }

  console.log('\n=== does trade.sl match the LAST stop_adjustment.newSl for that ticket? ===');
  const adj = await prisma.stopAdjustment.findMany({
    select: { tradeTicket: true, symbol: true, newSl: true, adjustedAt: true },
    orderBy: { adjustedAt: 'asc' },
  });
  const lastByTicket = {};
  for (const a of adj) lastByTicket[a.tradeTicket] = a;

  let checked = 0, agree = 0;
  for (const ticket of Object.keys(lastByTicket).slice(-8)) {
    const a = lastByTicket[ticket];
    const t = await prisma.trade.findFirst({ where: { brokerTicket: ticket }, select: { sl: true, symbol: true, status: true } });
    if (!t) { console.log(`  ticket ${ticket} (${a.symbol}) -> no trade row`); continue; }
    checked++;
    const same = t.sl != null && a.newSl != null && Math.abs(Number(t.sl) - Number(a.newSl)) < 0.001;
    if (same) agree++;
    console.log(`  ${t.symbol.padEnd(9)} ${ticket} trade.sl=${String(t.sl).padStart(9)} lastAdj.newSl=${String(a.newSl).padStart(9)} ${same ? 'AGREE' : 'DIFFER'}`);
  }
  console.log(`  -> ${agree}/${checked} agree`);

  console.log('\n=== how many DISTINCT trades has FRA40 ever had, and any stop_adjustment at all? ===');
  const fra = await prisma.stopAdjustment.count({ where: { symbol: 'FRA40' } });
  console.log(`  stop_adjustment rows for FRA40: ${fra}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
