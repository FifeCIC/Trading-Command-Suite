/**
 * Seed symbol onboarding tables (#747).
 *
 * These DB-driven tables let a NEW symbol work without ANY code change:
 *   - symbol                  : the instrument row
 *   - symbol_route            : which MT5 broker bridge serves it (best feed)
 *   - symbol_protocol_assignment : which protocol scores it
 *
 * Watchlist ↔ protocol pairing is seeded by seed-watchlists.ts (reads the
 * `protocolId` field from each src/data/watchlists/*.json).
 *
 * Run: npm run seed:symbol-onboarding  (or npx ts-node prisma/seed-symbol-onboarding.ts)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYMBOLS: Array<{ ticker: string; name: string; type: string }> = [
  { ticker: 'UK100', name: 'FTSE 100 Index', type: 'index' },
  { ticker: 'GER40', name: 'DAX 40 Index', type: 'index' },
  { ticker: 'FRA40', name: 'CAC 40 Index', type: 'index' },
  // Silver — added 2026-09-10. XAGUSD was already ASSIGNED to xau-speed-v1 but had
  // no `symbol` row, so it rendered a permanent "Not scored" ladder card and could
  // never be scored. Both MT5 bridges price it live. The `symbol` row is the
  // precondition for every other reference to it.
  { ticker: 'XAGUSD', name: 'Silver vs USD', type: 'commodity' },
];

// Broker slot → bridge port is declared in MT5_ACTIVE_BROKERS order
// (2 = MetaQuotes :5000, 3 = Pepperstone :5001). Chosen per symbol by feed quality.
const ROUTES: Array<{ symbol: string; brokerId: number; note: string }> = [
  { symbol: 'UK100', brokerId: 3, note: 'FTSE 100 — Pepperstone feed current; MetaQuotes stale since 2026-05' },
  { symbol: 'GER40', brokerId: 3, note: 'DAX 40 — Pepperstone has a real GER40 feed' },
  { symbol: 'FRA40', brokerId: 2, note: 'CAC 40 — MetaQuotes feed live; Pepperstone returns 0' },
  { symbol: 'XAGUSD', brokerId: 3, note: 'Silver — live on both bridges; Pepperstone (3) is primary for metals' },
];

const ASSIGNMENTS: Array<{ symbol: string; protocolSlug: string }> = [
  { symbol: 'UK100', protocolSlug: 'ftse-speed-v1' },
  { symbol: 'GER40', protocolSlug: 'dax-speed-v1' },
  { symbol: 'FRA40', protocolSlug: 'cac-speed-v1' },
  { symbol: 'XAGUSD', protocolSlug: 'xau-speed-v1' },
];

async function main() {
  console.log('Seeding symbol onboarding (symbols, routes, assignments)…\n');

  for (const s of SYMBOLS) {
    const existing = await prisma.symbol.findUnique({ where: { ticker: s.ticker } });
    if (existing) {
      console.log(`  • symbol ${s.ticker} exists`);
    } else {
      await prisma.symbol.create({
        data: {
          ticker: s.ticker,
          name: s.name,
          exchange: 'Xtrend',
          type: s.type,
          tags: s.type === 'index'
            ? (['speed-trading', 'xtrend', 'index'] as any)
            : (['speed-trading', 'xtrend', 'metals', 'commodity'] as any),
        },
      });
      console.log(`  ✓ symbol ${s.ticker} (${s.type})`);
    }
  }

  for (const r of ROUTES) {
    await prisma.symbolRoute.upsert({
      where: { symbol_brokerId: { symbol: r.symbol, brokerId: r.brokerId } },
      update: { enabled: true, note: r.note },
      create: { symbol: r.symbol, brokerId: r.brokerId, enabled: true, note: r.note },
    });
    console.log(`  ✓ route ${r.symbol} -> broker ${r.brokerId}`);
  }

  for (const a of ASSIGNMENTS) {
    const proto = await prisma.protocol.findUnique({ where: { slug: a.protocolSlug } });
    if (!proto) {
      console.log(`  ! protocol ${a.protocolSlug} not found — skipping assignment for ${a.symbol}`);
      continue;
    }
    await prisma.symbolProtocolAssignment.upsert({
      where: { symbol_protocolId: { symbol: a.symbol, protocolId: proto.id } },
      update: {},
      create: { symbol: a.symbol, protocolId: proto.id },
    });
    console.log(`  ✓ assignment ${a.symbol} -> ${a.protocolSlug}`);
  }

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
