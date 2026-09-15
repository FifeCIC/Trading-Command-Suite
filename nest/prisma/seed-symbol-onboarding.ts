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
  // ── FX crosses for the forex-session-v1 session pairs (2026-09-15) ──────────
  //
  // Eight bots exist for these pairs (`… Session`, active:false) but their SYMBOLS WERE
  // NEVER REGISTERED — so `forex-session-v1` could not resolve them, no bars were ever
  // fetched, and the bots could not have traded even if enabled. Registering the symbol is
  // the precondition for every other reference to it (the same lesson as XAGUSD above).
  //
  // ⚠️ Verified BEFORE onboarding, on BOTH bridges (2026-09-15): all eight report
  // `tradeMode 4` with a 0.01 volume floor — except NZDJPY, whose MetaQuotes floor is
  // **0.1**, so its bot's `baseSize` had to be 0.1 rather than the 0.01 the other FX
  // session bots use.
  { ticker: 'AUDJPY', name: 'Australian Dollar vs Japanese Yen', type: 'forex' },
  { ticker: 'EURCAD', name: 'Euro vs Canadian Dollar', type: 'forex' },
  { ticker: 'EURCHF', name: 'Euro vs Swiss Franc', type: 'forex' },
  { ticker: 'EURGBP', name: 'Euro vs British Pound', type: 'forex' },
  { ticker: 'EURJPY', name: 'Euro vs Japanese Yen', type: 'forex' },
  { ticker: 'GBPCAD', name: 'British Pound vs Canadian Dollar', type: 'forex' },
  { ticker: 'GBPJPY', name: 'British Pound vs Japanese Yen', type: 'forex' },
  { ticker: 'NZDJPY', name: 'New Zealand Dollar vs Japanese Yen', type: 'forex' },
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
  // ⚠️ FRA40 RE-POINTED 2 -> 3 on 2026-09-15. The previous note ("Pepperstone returns 0")
  // was measured on 2026-09-10 and is NO LONGER TRUE: :5001 now feeds FRA40 live
  // (contiguous 1h bars verified on BOTH bridges), and it is the broker that ACCEPTS
  // orders — :5000 reports FRA40 as tradeMode 0. Keeping the route on :5000 meant a
  // FRA40 card could never be traded. Found by INV-TRADEABLE-ROUTE.
  // ⚠️ The seeder is UPSERT-ONLY, so it cannot remove the retired broker-2 row — that row
  // must be deleted explicitly (or it competes with this one in the router, which takes
  // the first row per symbol).
  {
    symbol: 'FRA40',
    brokerId: 3,
    note: 'CAC 40 — re-pointed to Pepperstone 2026-09-15: :5000 refuses orders (tradeMode 0), :5001 accepts them AND feeds it live (both bridges verified, contiguous 1h bars)',
  },
  // US30 — added 2026-09-15. It had NO route row, so orders fell back to the primary broker
  // (MetaQuotes :5000) which reports US30 as `tradeMode 0` — the identical US500 fault
  // (a card that reads actionable while the bridge refuses the click). Pepperstone accepts
  // US30 orders and feeds it live, so :5001 is safe for both jobs. Found by
  // INV-TRADEABLE-ROUTE's live probe, which is the point of the guard.
  {
    symbol: 'US30',
    brokerId: 3,
    note: 'Dow 30 — added 2026-09-15: no route existed (silent fallback to :5000, tradeMode 0); Pepperstone accepts orders and feeds it live (verified both bridges)',
  },
  // US500 — added 2026-09-15. It had NO route row at all, so `Mt5SymbolRouter` fell
  // back to the PRIMARY broker (slot 2 = MetaQuotes :5000) for both its feed and its
  // orders — silently, because an absent route and a deliberate one are indistinguishable
  // from the caller's side.
  //
  // MetaQuotes reports US500 as `tradeMode 0` (trading DISABLED), so the bridge's
  // `/order` pre-flight refused every attempt with "US500 not tradeable (trade mode: 0)"
  // — while the Signals card showed it as fully actionable, because the app could only
  // see that the symbol was LISTED. Pepperstone (:5001) reports `tradeMode 4` (FULL) under
  // Retail\Indices\Majors\US500, i.e. it is the broker that can actually trade it.
  //
  // ⚠️ Re-verify with BOTH of these before changing or trusting this route, because
  // `tradeMode` is a property of the BROKER, not of the symbol — the same ticker is
  // listed on both bridges and tradeable on only one:
  //   (Invoke-RestMethod http://localhost:5001/symbols).symbols | ? name -eq US500   # expect tradeMode 4
  //   (Invoke-RestMethod http://localhost:5000/symbols).symbols | ? name -eq US500   # measures 0
  // A tradeMode of 0 outside its session means "market shut", not "disabled" — so check
  // during exchange hours before concluding the route is wrong.
  {
    symbol: 'US500',
    brokerId: 3,
    note: 'US 500 Index — Pepperstone tradeMode=4 verified 2026-09-15; MetaQuotes :5000 reports tradeMode=0 (trading disabled)',
  },
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
  // FX crosses (2026-09-15) — path 0 of the resolution chain in
  // docs/guides/symbol-onboarding-procedure.md (a real FK, not name guessing --
  // INV-NO-SYMBOL-GUESSING). Assignment is ALSO what puts a symbol into the
  // bar-refresh set: that feature resolves ['positions','active-strategies',
  // 'forex-floor','protocol-symbols'], and `protocol-symbols` IS this table.
  { symbol: 'AUDJPY', protocolSlug: 'forex-session-v1' },
  { symbol: 'EURCAD', protocolSlug: 'forex-session-v1' },
  { symbol: 'EURCHF', protocolSlug: 'forex-session-v1' },
  { symbol: 'EURGBP', protocolSlug: 'forex-session-v1' },
  { symbol: 'EURJPY', protocolSlug: 'forex-session-v1' },
  { symbol: 'GBPCAD', protocolSlug: 'forex-session-v1' },
  { symbol: 'GBPJPY', protocolSlug: 'forex-session-v1' },
  { symbol: 'NZDJPY', protocolSlug: 'forex-session-v1' },
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
          // Tags are display/filter metadata. They must not claim a type the symbol is
          // not, or a filter on them silently lies about the instrument.
          tags: (s.type === 'index'
            ? ['speed-trading', 'xtrend', 'index']
            : s.type === 'forex'
              ? ['speed-trading', 'xtrend', 'forex']
              : ['speed-trading', 'xtrend', 'metals', 'commodity']) as any,
        },
      });
      console.log(`  ✓ symbol ${s.ticker} (${s.type})`);
    }
  }

  for (const r of ROUTES) {
    // ⚠️ `update` must carry EVERY field the route depends on, not just `enabled`.
    // An upsert whose update omits a field silently leaves whatever the DB already
    // has, so a re-seed could not REPAIR a wrong brokerSymbol — it would only
    // re-enable the row. brokerSymbol and provider are both load-bearing for
    // symbol resolution (#760), so both are set on update as well as create.
    await prisma.symbolRoute.upsert({
      where: { symbol_brokerId: { symbol: r.symbol, brokerId: r.brokerId } },
      update: {
        enabled: true,
        note: r.note,
        provider: r.provider ?? 'mt5',
        brokerSymbol: r.brokerSymbol ?? undefined,
      },
      create: {
        symbol: r.symbol,
        brokerId: r.brokerId,
        enabled: true,
        note: r.note,
        provider: r.provider ?? 'mt5',
        brokerSymbol: r.brokerSymbol ?? null,
      },
    });
    console.log(`  ✓ route ${r.symbol} -> broker ${r.brokerId}${r.brokerSymbol ? ` (brokerSymbol=${r.brokerSymbol})` : ''}`);
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
