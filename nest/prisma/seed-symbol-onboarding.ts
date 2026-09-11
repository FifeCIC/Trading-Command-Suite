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
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ THIS FILE IS THE ONLY WAY symbol_route SURVIVES A REINSTALL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Nothing else seeds `symbol_route`. The only other writer in the whole repo is
 * `Mt5Controller` (i.e. an API call made by hand at runtime), so a route added
 * directly to the database is **permanently lost** the moment the app is
 * reinstalled or the DB is rebuilt — silently, with no error, and with the
 * symptom appearing much later as "this symbol stopped trading".
 *
 * **If you add a `symbol_route` row to the database, add it HERE in the same
 * change.** See `.github/instructions/database-seed-discipline.instructions.md`.
 *
 * Same rule applies to the `symbol` and `symbol_protocol_assignment` rows this
 * file owns, and to `trading_strategy` bots (see strategy-seed-data.ts).
 *
 * Idempotent: every write below is an upsert, so re-running is safe and the
 * seeder CONVERGES the DB to the lists it declares.
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
  // VIX — added 2026-09-11 (#772). The `symbol` row already existed, but it had no
  // `symbol_route`, so no broker could price it. It is the app's only tradable
  // short instrument, which made the short-side path untestable.
  { ticker: 'VIX', name: 'CBOE Volatility Index', type: 'index' },
];

// Broker slot → bridge port is declared in MT5_ACTIVE_BROKERS order
// (2 = MetaQuotes :5000, 3 = Pepperstone :5001). Chosen per symbol by feed quality.
//
// ⚠️ `note` is USER-FACING and is the only explanation of WHY a route points at a
// given broker. Record the evidence (feed quality, availability) — not just the
// fact. A future reader has to be able to re-verify the choice, so name the
// measurement, e.g. "verified tradeMode=4 on :5001; absent from :5000".
const ROUTES: Array<{ symbol: string; brokerId: number; note: string; provider?: string; brokerSymbol?: string | null }> = [
  { symbol: 'UK100', brokerId: 3, note: 'FTSE 100 — Pepperstone feed current; MetaQuotes stale since 2026-05' },
  { symbol: 'GER40', brokerId: 3, note: 'DAX 40 — Pepperstone has a real GER40 feed' },
  { symbol: 'FRA40', brokerId: 2, note: 'CAC 40 — MetaQuotes feed live; Pepperstone returns 0' },
  { symbol: 'XAGUSD', brokerId: 3, note: 'Silver — live on both bridges; Pepperstone (3) is primary for metals' },
  // VIX — added 2026-09-11 (#772). Pepperstone-ONLY: :5001 lists
  // {"name":"VIX","tradeMode":4} under Retail\Indices\Minors\VIX and returns 200
  // 1h bars; :5000 has no VIX at all and returns 0 bars. brokerSymbol is the
  // broker's exact ticker — verified against /symbols, NOT assumed. Four symbols
  // were once named wrong and silently delivered zero bars (#760 / INV-PROVIDER-REACHABLE).
  {
    symbol: 'VIX',
    brokerId: 3,
    note: 'VIX — Pepperstone-only; tradeMode=4 verified on :5001, absent from :5000 (#772)',
    // ⚠️ brokerSymbol MATTERS. An earlier version of this seeder omitted it, so a
    // re-seeded route came back with brokerSymbol=null even though the live row had
    // the verified ticker — i.e. the seed was NOT a faithful copy of what works.
    // Always set it when the broker's ticker differs from (or must be pinned to)
    // the canonical one. Verified against the bridge's own /symbols list.
    brokerSymbol: 'VIX',
    provider: 'mt5',
  },
];

// ⚠️ CRYPTO ROUTES ARE NOT SEEDED HERE.
//
// BTC / DOGE / ETH / SOL carry `provider: 'binance'` with `brokerId: 0`, so they
// are NOT MT5 routes and must not be mixed into the list above (brokerId 0 has no
// bridge). They were added directly to the database on 2026-09-10 and therefore
// had no seed path — the same defect that lost VIX. See the follow-up issue
// referenced in .github/instructions/database-seed-discipline.instructions.md:
// they need their own seeder, not an entry here.

const ASSIGNMENTS: Array<{ symbol: string; protocolSlug: string }> = [
  { symbol: 'UK100', protocolSlug: 'ftse-speed-v1' },
  { symbol: 'GER40', protocolSlug: 'dax-speed-v1' },
  { symbol: 'FRA40', protocolSlug: 'cac-speed-v1' },
  { symbol: 'XAGUSD', protocolSlug: 'xau-speed-v1' },
  // VIX short assignment is deliberately NOT added yet. Per #772, nothing is
  // assigned until the first demo short has actually executed (Step 2), so the
  // short path is not spread across more protocols before it is proven once.
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
