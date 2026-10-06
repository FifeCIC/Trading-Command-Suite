/**
 * Scratch follow-up for #1056 — FRA40 had winning trades, so "nothing to trail" needs checking
 * against WHEN the guardian started recording broker-3 adjustments.
 * Read-only. logs/ on purpose (a file in scripts/ stales docs/TOOLS-INDEX.md).
 */
const { PrismaClient } = require('c:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const all = await prisma.stopAdjustment.findMany({ select: { symbol: true, adjustedAt: true }, orderBy: { adjustedAt: 'asc' } });
  console.log(`stop_adjustment overall: ${all.length} rows, first ${all[0]?.adjustedAt?.toISOString?.() ?? all[0]?.adjustedAt}, last ${all[all.length - 1]?.adjustedAt?.toISOString?.() ?? all[all.length - 1]?.adjustedAt}`);

  const bySym = {};
  for (const a of all) (bySym[a.symbol] ||= []).push(a.adjustedAt);
  console.log('\nper-symbol first/last:');
  Object.entries(bySym).sort((a, b) => a[1][0] - b[1][0]).forEach(([s, d]) => {
    console.log(`  ${s.padEnd(9)} ${String(d.length).padStart(4)} rows   ${new Date(d[0]).toISOString().slice(0, 16)} → ${new Date(d[d.length - 1]).toISOString().slice(0, 16)}`);
  });

  console.log('\nFRA40 trades, ALL of them, with dates and SL:');
  const t = await prisma.trade.findMany({
    where: { symbol: 'FRA40', provider: 'mt5' },
    select: { brokerTicket: true, side: true, status: true, pnl: true, sl: true, entryPrice: true, exitPrice: true, openedAt: true, closedAt: true, strategy: true, origin: true },
    orderBy: { openedAt: 'asc' },
  });
  for (const x of t) {
    console.log(`  ${x.brokerTicket ?? '-'}  ${x.side.padEnd(4)} ${x.status.padEnd(7)} pnl=${String(x.pnl).padStart(7)} sl=${String(x.sl ?? '-').padStart(7)} entry=${String(x.entryPrice).padStart(8)} exit=${String(x.exitPrice ?? '-').padStart(8)}  ${new Date(x.openedAt).toISOString().slice(0, 16)} → ${x.closedAt ? new Date(x.closedAt).toISOString().slice(0, 16) : 'open'}  ${x.strategy ?? ''}`);
  }

  console.log('\nfirst broker-3 adjustment overall, by symbol:');
  for (const s of ['US500', 'GER40', 'UK100', 'XAGUSD', 'US30', 'FRA40']) {
    const d = bySym[s] || [];
    console.log(`  ${s.padEnd(9)} ${d.length === 0 ? 'NONE' : new Date(d[0]).toISOString().slice(0, 16)}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
