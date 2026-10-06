/**
 * Scratch measurement for #871 — are there trades `status='open'` with no live broker position?
 * Read-only. Lives in logs/ on purpose: a file in scripts/ stales docs/TOOLS-INDEX.md.
 *
 * Usage:  $env:DATABASE_URL='...'; node logs/issue-871-measure.cjs
 */
// ⚠️ Absolute require: this file lives in logs/, and node resolves `@prisma/client` from the SCRIPT's
// directory, not the cwd — so a bare require fails with MODULE_NOT_FOUND even when run from nest/.
const { PrismaClient } = require('c:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

const BRIDGES = [
  { brokerId: 2, url: 'http://localhost:5000' },
  { brokerId: 3, url: 'http://localhost:5001' },
];

async function livePositions() {
  const out = [];
  for (const b of BRIDGES) {
    try {
      const r = await fetch(`${b.url}/positions`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.positions || []);
      for (const p of list) {
        out.push({
          brokerId: b.brokerId,
          ticket: String(p.ticket ?? p.position ?? p.id ?? ''),
          symbol: p.symbol,
          volume: p.volume ?? p.volume_current,
        });
      }
      console.log(`  bridge ${b.brokerId} (${b.url}) -> ${list.length} position(s)`);
    } catch (e) {
      console.log(`  bridge ${b.brokerId} (${b.url}) -> UNREACHABLE: ${e.message}`);
      out.push({ brokerId: b.brokerId, unreachable: true });
    }
  }
  return out;
}

(async () => {
  console.log('=== #871 measurement — ticketed open trades vs live broker positions ===\n');

  console.log('Broker positions:');
  const live = await livePositions();
  const liveTickets = new Set(live.filter((p) => !p.unreachable).map((p) => p.ticket));
  const anyUnreachable = live.some((p) => p.unreachable);
  console.log(`  total live tickets: ${liveTickets.size}${anyUnreachable ? '  (INCOMPLETE — a bridge did not answer)' : ''}\n`);

  const openTrades = await prisma.trade.findMany({
    where: { status: 'open' },
    select: {
      id: true, symbol: true, side: true, provider: true, accountId: true,
      brokerTicket: true, ticket: true, origin: true, strategy: true,
      openedAt: true, abTestId: true, abTestSide: true,
    },
    orderBy: { openedAt: 'asc' },
  });

  const positions = await prisma.position.findMany({
    select: { brokerTicket: true, symbol: true, provider: true, accountId: true },
  });
  const posTickets = new Set(positions.map((p) => String(p.brokerTicket ?? '')));

  console.log(`open trades: ${openTrades.length}   position rows: ${positions.length}\n`);

  const rows = openTrades.map((t) => {
    const ticket = t.brokerTicket != null ? String(t.brokerTicket) : null;
    const hasPositionRow = ticket !== null && posTickets.has(ticket);
    const brokerReports = ticket !== null && liveTickets.has(ticket);
    const ageH = ((Date.now() - new Date(t.openedAt).getTime()) / 3.6e6).toFixed(1);
    let verdict;
    if (anyUnreachable) verdict = 'CANNOT JUDGE (a bridge did not answer)';
    else if (ticket === null) verdict = 'unticketed — path 2 territory';
    else if (brokerReports) verdict = 'LIVE on broker — ok';
    else if (hasPositionRow) verdict = 'ORPHAN: position row exists, broker does not report it';
    else verdict = 'ORPHAN: no position row AND broker does not report it  <-- the #871 case';
    return { t, ticket, ageH, hasPositionRow, brokerReports, verdict };
  });

  const w = (s, n) => String(s ?? '-').padEnd(n).slice(0, n);
  console.log(`${w('symbol', 9)}${w('side', 5)}${w('origin', 9)}${w('ticket', 15)}${w('age h', 7)}${w('posRow', 7)}${w('onBroker', 9)}verdict`);
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(`${w(r.t.symbol, 9)}${w(r.t.side, 5)}${w(r.t.origin, 9)}${w(r.ticket, 15)}${w(r.ageH, 7)}${w(r.hasPositionRow, 7)}${w(r.brokerReports, 9)}${r.verdict}`);
  }

  const orphans = rows.filter((r) => r.verdict.startsWith('ORPHAN'));
  console.log(`\n=== RESULT ===`);
  console.log(`open trades          : ${openTrades.length}`);
  console.log(`live broker positions: ${liveTickets.size}`);
  console.log(`orphaned open trades : ${orphans.length}  (${orphans.map((o) => o.t.symbol).join(', ') || 'none'})`);
  if (anyUnreachable) console.log('⚠️  A BRIDGE DID NOT ANSWER — this run cannot distinguish "no position" from "not measured".');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
