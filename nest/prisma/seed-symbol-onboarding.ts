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

/**
 * The provider a `symbol_route` gets when its seed entry does not name one.
 *
 * ⚠️ NAMED, not an inline literal (#967). `provider` mirrors an EXTERNAL FACT — which adapter
 * actually serves the route — so a fallback for it has to be *declared and checkable*, not typed
 * at the call site. #959 is the cautionary case: `exchange: s.exchange ?? 'Xtrend'` invented a
 * non-existent broker on 12% of symbols because the literal sat inside the assignment where no
 * reviewer had to weigh it.
 *
 * `mt5` IS REAL AND CHECKABLE: `Mt5ConnectionManager` instantiates an MT5 instance per configured
 * broker (`Multi-broker MT5: 2 instance(s) — #2→:5000, #3→:5001`) and `symbol_route.provider`
 * selects the adapter used to resolve the venue's ticker. Every route in `ROUTES` is an MT5 CFD
 * route. If a non-MT5 provider is ever added, that entry must NAME its provider rather than
 * inheriting this default.
 *
 * Enforced by `nest/scripts/validate-seed-literals.cjs` (prebuild).
 */
const ROUTE_DEFAULT_PROVIDER = 'mt5';

const SYMBOLS: Array<{ ticker: string; name: string; type: string; exchange?: string }> = [
  { ticker: 'UK100', name: 'FTSE 100 Index', type: 'index' },
  { ticker: 'GER40', name: 'DAX 40 Index', type: 'index' },
  { ticker: 'FRA40', name: 'CAC 40 Index', type: 'index' },
  // USTEC — added 2026-10-12, owner-approved onboarding of the three unsubscribed ladder
  // protocols. The `symbol` row and its `qqq-speed-v1` assignment ALREADY existed in the
  // database (scoring worked), but with no entry here a reinstall would lose the row and the
  // instrument would silently become unscorable — the exact class recorded for VIX, XAGUSD
  // and the USD majors above.
  { ticker: 'USTEC', name: 'NASDAQ 100 Index', type: 'index' },
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
  // ── The USD majors (2026-09-22) ─────────────────────────────────────────────
  //
  // ⚠️ THESE HAD NO SEED PATH AT ALL, and it is the same defect class as VIX and XAGUSD
  // above — worse, because nothing looked wrong. The `symbol` rows have existed in the
  // database since 2026-06-24 and bars are still fetched for them every cycle (audited
  // 2026-09-22: AUDUSD 1,963 bars, last 07:18 that morning), so the ladder renders and the
  // symbol appears entirely healthy. What was missing was the ASSIGNMENT — and with no
  // `symbol_protocol_assignment` row, `resolveProtocolForSymbol()` fell through to its
  // hardcoded `SYMBOL_PROTOCOL_MAP`, which happens to name a protocol for each of these.
  //
  // Measured consequence: all five stopped being SCORED on 2026-09-15 — the same day the
  // eight FX crosses below were onboarded — and produced no score, no decision and no trade
  // for a week, while their bots sat `active=1` in the UI and their markets were open.
  // **No error was raised anywhere.** Diagnosed by the owner asking why nothing was trading.
  //
  // The lesson is the one this file already states twice: registering the symbol is the
  // precondition for every other reference to it. Registering it is not enough — it must
  // also be ASSIGNED, or it is a symbol the scanner cannot see.
  { ticker: 'AUDUSD', name: 'Australian Dollar vs USD', type: 'forex' },
  { ticker: 'EURUSD', name: 'Euro vs USD', type: 'forex' },
  { ticker: 'GBPUSD', name: 'British Pound vs USD', type: 'forex' },
  { ticker: 'USDCAD', name: 'US Dollar vs Canadian Dollar', type: 'forex' },
  { ticker: 'USDCHF', name: 'US Dollar vs Swiss Franc', type: 'forex' },
  { ticker: 'USDJPY', name: 'US Dollar vs Japanese Yen', type: 'forex' },
  { ticker: 'NZDUSD', name: 'New Zealand Dollar vs USD', type: 'forex' },
  // ── US small-cap equity — the opportunity-detection CASE STUDY (2026-09-22) ──
  //
  // GRML (Greenland Mines) is not a normal onboarding. It is registered as the
  // reference case for a capability the app does NOT have: recognising that an
  // UNREGISTERED instrument is moving. It went from 2.85 (close 2026-09-17) to an
  // 18.21 high on 2026-09-21 — **+539% in two sessions** — on a volume step from
  // 465 to 263,322 (566×). The app produced nothing, and could not have: with no
  // `symbol` row no bars were ever fetched, so the move was not 'un-alerted', it
  // was **unobservable**. See #956's sibling epic for the sprint.
  //
  // ⚠️ Verified on the bridge BEFORE adding this row (2026-09-22), so the claim is
  // measured rather than assumed:
  //   • `:5000` /symbol/GRML/info → present (digits 2, contractSize 1.0,
  //     volumeMin 1.0, currencyProfit USD). Note: that endpoint does NOT report
  //     `tradeMode`, so this seeder does **not** claim one. Do not add one without
  //     measuring it.
  //   • `:5000` /candles?symbol=GRML&timeframe=1d&limit=30 → 30 clean daily bars.
  //   • `:5000` /quote?symbol=GRML → bid 0.0 / ask 0.0 / last 0.0 — **no live tick**.
  //     Bars exist; a live quote does not. Anything reading a *quote* for GRML will
  //     see zero, which looks like a price of zero. Read BARS for this symbol.
  //   • `:5001` (Pepperstone) → 404. GRML is MetaQuotes-only. Do not add a :5001 route.
  { ticker: 'GRML', name: 'Greenland Mines Inc', type: 'stock', /* exchange removed — see below */ },
];

// Broker slot → bridge port is declared in MT5_ACTIVE_BROKERS order
// (2 = MetaQuotes :5000, 3 = Pepperstone :5001). Chosen per symbol by feed quality.
//
// ⚠️ `note` is USER-FACING and is the only explanation of WHY a route points at a
// given broker. Record the evidence (feed quality, availability) — not just the
// fact. A future reader has to be able to re-verify the choice, so name the
// measurement, e.g. "verified tradeMode=4 on :5001; absent from :5000".
const ROUTES: Array<{ symbol: string; brokerId: number; note: string; provider?: string; brokerSymbol?: string | null }> = [
  // ⚠️ #1009 — EVERY MT5 ROUTE PINS `brokerSymbol`, AND IT IS NOT COSMETIC.
  //
  // Measured 2026-10-01 against the live bridges: all six tickers below are EXACT matches on
  // `:5001` (tradeMode=4), so pinning them is a NO-OP AT RUNTIME today. That is the point — the
  // route was correct because the venue happens to use the same names, not because anything
  // guaranteed it. A bare ticker is a GLOBAL namespace (`:5000` alone lists 12,363 instruments) and
  // can resolve to a DIFFERENT instrument on another venue: that is the hazard already recorded for
  // `BTC` (the #914 class).
  //
  // ⚠️ The coincidence HAS already broken once, in both directions, and both are verifiable now:
  //   `GER40` — ABSENT from `:5000` (that venue calls it `DE40`, and `DE40` there is tradeMode=0)
  //   `VIX`   — ABSENT from `:5000` entirely
  // So a broker-2 route for either would resolve to nothing, or to the wrong instrument, silently.
  // `US500` is the symbol from the 2026-09-15 incident where a bot looked perfectly configured in
  // the UI while the bridge refused every order.
  //
  // ⚠️ Verified against the bridge's own `/symbols`, NOT assumed (#760 / INV-PROVIDER-REACHABLE):
  //   (Invoke-RestMethod http://localhost:5001/symbols).symbols | ? name -eq GER40   # tradeMode 4
  { symbol: 'UK100', brokerId: 3, brokerSymbol: 'UK100', note: 'FTSE 100 — Pepperstone feed current; MetaQuotes stale since 2026-05' },
  { symbol: 'GER40', brokerId: 3, brokerSymbol: 'GER40', note: 'DAX 40 — Pepperstone has a real GER40 feed. ⚠️ :5000 calls this DE40 and disables it, so a fallback here resolves to nothing (#1009)' },
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
    brokerSymbol: 'FRA40',
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
    brokerSymbol: 'US30',
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
    brokerSymbol: 'US500',
    note: 'US 500 Index — Pepperstone tradeMode=4 verified 2026-09-15; MetaQuotes :5000 reports tradeMode=0 (trading disabled)',
  },
  // USTEC — added 2026-10-12 (owner-approved). It had NO route, so feed AND orders fell back
  // to the primary broker (MetaQuotes :5000), which lists USTEC as `tradeMode=0` (trading
  // disabled) — the same fault as US500/US30 before it: a card reading actionable while the
  // bridge could never accept the order. Pepperstone serves it as `NAS100` (Retail\Indices\Majors,
  // tradeMode=4, volumeMin 0.1) — measured 2026-10-12 against :5001 /symbols, NOT assumed.
  {
    symbol: 'USTEC',
    brokerId: 3,
    brokerSymbol: 'NAS100',
    note: 'NASDAQ 100 — NASDAQ vs MetaQuotes USTEC tradeMode=0 (disabled); Pepperstone NAS100 tradeMode=4, volumeMin 0.1 (verified 2026-10-12 on :5001)',
  },
  { symbol: 'XAGUSD', brokerId: 3, brokerSymbol: 'XAGUSD', note: 'Silver — live on both bridges; Pepperstone (3) is primary for metals' },
  // VIX — added 2026-09-11 (#772). Pepperstone-ONLY: :5001 lists
  // {"name":"VIX","tradeMode":4} under Retail\Indices\Minors\VIX and returns 200
  // 1h bars; :5000 has no VIX at all and returns 0 bars. brokerSymbol is the
  // broker's exact ticker — verified against /symbols, NOT assumed. Four symbols
  // were once named wrong and silently delivered zero bars (#760 / INV-PROVIDER-REACHABLE).
  // GRML — MetaQuotes-only (verified: :5000 serves 30 clean daily bars; :5001 returns
  // 404). brokerSymbol is pinned because the canonical ticker and the broker ticker
  // happen to match today, and an unpinned route is what lost VIX's ticker once.
  {
    symbol: 'GRML',
    brokerId: 2,
    brokerSymbol: 'GRML',
    provider: 'mt5',
    note: 'Greenland Mines — MetaQuotes-only. Verified 2026-09-22: :5000 has 30 clean daily bars (2.85 close 09-17 → 18.21 high 09-21); :5001 returns 404. ⚠️ No live QUOTE (bid/ask/last all 0.0) — read bars, not quotes, for this symbol.',
  },
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
  // USD majors (2026-09-22) — see the block in SYMBOLS above. These were the five/six that
  // went silent on 2026-09-15.
  //
  // ⚠️ `forex-session-v1` for ALL of them, deliberately — including USDCAD, whose hardcoded
  // entry in `speed-scan.service.ts` says `usdcad-oil-v1`. That protocol is **active=0**, so
  // following it would re-point the assignment at a disabled protocol and leave the symbol
  // exactly as silent as it is now. The rule applied here: the assignment must name the same
  // protocol the SYMBOL'S BOT subscribes to (`strategy_protocol`), or the bot waits for a
  // signal from a protocol that is not the one scoring its symbol. Every one of these bots
  // subscribes to `forex-session-v1`.
  { symbol: 'AUDUSD', protocolSlug: 'forex-session-v1' },
  { symbol: 'EURUSD', protocolSlug: 'forex-session-v1' },
  { symbol: 'GBPUSD', protocolSlug: 'forex-session-v1' },
  { symbol: 'USDCAD', protocolSlug: 'forex-session-v1' },
  { symbol: 'USDCHF', protocolSlug: 'forex-session-v1' },
  { symbol: 'USDJPY', protocolSlug: 'forex-session-v1' },
  { symbol: 'NZDUSD', protocolSlug: 'forex-session-v1' },
  // ── The seven protocols whose assignments existed ONLY in the database (#1137) ──
  // Measured 2026-10-25: 12 protocols had `symbol_protocol_assignment` rows and only 5 were
  // declared here, so a reinstall would have silently un-wired seven protocols that are wired
  // today. The rows were copied DB → seed (the only sanctioned direction for a value that has
  // no seed path) and round-tripped: delete one, re-seed, it returns.
  // ⚠️ `dow-speed-v1` and `btc-scalp-v1` matter most — `dow-index.json` already declares the
  // FK to `dow-speed-v1`, so the watchlist link and the assignment must not disagree about
  // which protocol scores US30.
  { symbol: 'US30', protocolSlug: 'dow-speed-v1' },
  { symbol: 'BTC', protocolSlug: 'btc-scalp-v1' },
  { symbol: 'ETH', protocolSlug: 'btc-scalp-v1' },
  { symbol: 'SOL', protocolSlug: 'btc-scalp-v1' },
  { symbol: 'WTI', protocolSlug: 'oil-speed-v1' },
  { symbol: 'QQQ', protocolSlug: 'qqq-speed-v1' },
  { symbol: 'USTEC', protocolSlug: 'qqq-speed-v1' },
  { symbol: 'SPY', protocolSlug: 'spy-speed-v1' },
  { symbol: 'US500', protocolSlug: 'spy-speed-v1' },
  { symbol: 'XAGUSD', protocolSlug: 'probe-1dir-rsi' },
  { symbol: 'EURUSD', protocolSlug: 'probe-1dir-v1' },
  // VIX short assignment is deliberately NOT added yet. Per #772, nothing is
  // assigned until the first demo short has actually executed (Step 2), so the
  // short path is not spread across more protocols before it is proven once.

  // ⚠️ GRML IS DELIBERATELY NOT ASSIGNED, and this is a decision rather than an omission.
  //
  // The assignment decides which PROTOCOL scores the symbol. There are 21 active protocols
  // and **not one is suited to a US small-cap equity** — the stock-ish ones (`spy-speed-v1`,
  // `spy-day-v1`, `qqq-speed-v1`, `qqq-day-v1`) are built for index ETFs, and their
  // directives would run against a microcap that shares none of an index's behaviour.
  //
  // Assigning one anyway would produce the exact defect this repo keeps re-finding: a
  // **plausible score with no error**. A number would appear on a ladder, look like a
  // reading, and mean nothing. The owner's case study is about recognising that an
  // instrument is MOVING, which is arithmetic on price and volume — not a protocol vote.
  //
  // Consequence to know while it stays unassigned: `bar-refresh` resolves
  // ['positions','active-strategies','forex-floor','protocol-symbols'], and with no
  // assignment GRML is in none of them, so **no bars are fetched for it**. Its price history
  // is therefore reachable only on demand from the bridge
  // (`/candles?symbol=GRML&timeframe=1d`), which is what `ReplayService.loadBars()` falls
  // back to. Assign a protocol only when one actually fits the instrument.
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
          // ⚠️ NO DEFAULT. This was `?? 'Xtrend'` and it fabricated a broker name into an
          // `exchange` column on **29 of the 30** symbols in this file — every entry here leaves
          // `exchange` unset except one. Measured 2026-09-23: the owner read the Active Symbols
          // page and asked *"Xtrend shows in exchange for many symbols — this cannot be
          // correct"*. It was not: there is no Xtrend exchange and no Xtrend adapter.
          //
          // These are MT5 CFDs (FX pairs, indices, metals, energy, vol). A CFD has no exchange —
          // the instrument cannot answer the question. NULL is the honest value, and it renders
          // as a blank rather than as a confident-looking lie (#959).
          //
          // ⚠️ For the real provenance use `GET /api/symbols` → `sources[]`, which reports
          // `marketbar.provider` — the AUTHORITATIVE field. Do not repopulate this column with a
          // provider name as a convenience: that is what made it dual-meaning in the first place.
          exchange: s.exchange ?? null,
          type: s.type,
          // Tags are display/filter metadata. They must not claim a type the symbol is
          // not, or a filter on them silently lies about the instrument.
          //
          // ⚠️ The fallback branch is `metals/commodity`, so ANY new type silently inherits
          // those tags. A `stock` had to be given its own branch for exactly that reason —
          // without it GRML would have been tagged a commodity and every tag filter on the
          // instrument would have lied about it.
          tags: (s.type === 'index'
            ? ['speed-trading', 'xtrend', 'index']
            : s.type === 'forex'
              ? ['speed-trading', 'xtrend', 'forex']
              : s.type === 'stock'
                ? ['metaquotes', 'stock']
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
    //
    // ⚠️ #1009 — `r.brokerSymbol ?? undefined` is the mechanism, and `undefined` is doing real
    // work: Prisma OMITS an `undefined` field from the UPDATE, whereas `null` would write a NULL.
    // That distinction is what lets a route remain un-pinned deliberately while every route BELOW
    // that should be pinned can now be repaired by a re-seed.
    //
    // VERIFIED BY ROUND-TRIP, 2026-10-01: `GER40` was NULLed directly in the database, the seeder
    // was re-run, and the value came back as `GER40` — so the repair path works and the earlier
    // text above ("a re-seed could not REPAIR a wrong brokerSymbol") is now only true of routes
    // whose seed entry omits the field.
    await prisma.symbolRoute.upsert({
      where: { symbol_brokerId: { symbol: r.symbol, brokerId: r.brokerId } },
      update: {
        enabled: true,
        note: r.note,
        provider: r.provider ?? ROUTE_DEFAULT_PROVIDER,
        brokerSymbol: r.brokerSymbol ?? undefined,
      },
      create: {
        symbol: r.symbol,
        brokerId: r.brokerId,
        enabled: true,
        note: r.note,
        provider: r.provider ?? ROUTE_DEFAULT_PROVIDER,
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
