/**
 * Scratch measurement for #1056 — is "FRA40 has zero stop_adjustment rows" a defect, or the expected
 * result of a trail having nothing to move?
 *
 * THE TEST: a trailing stop only moves when there is a level to move TO. `trade.peakProfitPct`
 * records whether the position was EVER in profit, so it separates:
 *   - "the guardian refused to manage this"  (a defect)
 *   - "there was never a better stop to place" (expected, no defect)
 *
 * Read-only. Lives in logs/ on purpose: a file in scripts/ stales docs/TOOLS-INDEX.md.
 */
// ⚠️ Absolute require — this file lives in logs/, and node resolves `@prisma/client` from the
// SCRIPT's directory, not the cwd.
const { PrismaClient } = require('c:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

const BROKER3 = ['US500', 'GER40', 'UK100', 'XAGUSD', 'US30', 'FRA40'];

(async () => {
  console.log('=== #1056 — was there ever a better stop to place? ===\n');

  const adj = await prisma.stopAdjustment.findMany({ select: { symbol: true, tradeTicket: true, reason: true } });
  const bySymbol = {};
  for (const a of adj) (bySymbol[a.symbol] ||= []).push(a);
  console.log(`stop_adjustment rows in total: ${adj.length}\n`);

  console.log('--- broker-3 symbols ---');
  const w = (s, n) => String(s ?? '-').padEnd(n).slice(0, n);
  console.log(`${w('symbol', 9)}${w('trades', 7)}${w('winners', 8)}${w('peak>0', 8)}${w('adj rows', 9)}verdict`);

  for (const sym of BROKER3) {
    const trades = await prisma.trade.findMany({
      where: { symbol: sym, provider: 'mt5' },
      select: { id: true, brokerTicket: true, pnl: true, status: true, peakProfitPct: true, openedAt: true, closedAt: true, side: true },
      orderBy: { openedAt: 'asc' },
    });
    const winners = trades.filter((t) => (t.pnl ?? 0) > 0).length;
    const peaked = trades.filter((t) => (t.peakProfitPct ?? 0) > 0).length;
    const rows = (bySymbol[sym] || []).length;
    const verdict = rows > 0
      ? 'managed'
      : (peaked === 0 ? 'NO peak>0 EVER — no trail could fire (expected)' : 'peak>0 but never managed  <-- real gap');
    console.log(`${w(sym, 9)}${w(trades.length, 7)}${w(winners, 8)}${w(peaked, 8)}${w(rows, 9)}${verdict}`);

    if (sym === 'FRA40' || sym === 'GER40') {
      for (const t of trades.slice(-4)) {
        console.log(`    ${w(t.side, 5)}${w(t.status, 8)}pnl=${w(t.pnl, 9)}peakProfitPct=${w(t.peakProfitPct, 8)}adj=${(bySymbol[sym] || []).filter((a) => a.tradeTicket === t.brokerTicket).length}`);
      }
    }
  }

  console.log('\n--- what reasons do the adjustments carry? ---');
  const reasons = {};
  for (const a of adj) { const k = a.reason.slice(0, 58); reasons[k] = (reasons[k] || 0) + 1; }
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([r, n]) => console.log(`  ${String(n).padStart(3)}x ${r}`));

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
