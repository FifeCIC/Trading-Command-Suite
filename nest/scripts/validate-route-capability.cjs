#!/usr/bin/env node
/**
 * validate-route-capability.cjs — every ACTIVE bot must have a symbol that at least one active
 * broker can actually TRADE.
 * =================================================================================================
 *
 * THE DEFECT THIS GUARDS (#1002)
 * ------------------------------
 * A broker can LIST a symbol and still refuse to trade it: `broker_symbol.tradeMode = 0`. Measured
 * 2026-09-25 — **broker 2 lists 925 such symbols**, broker 3 lists 1.
 *
 * Until #1002 the router answered `primaryBrokerId()` for any symbol with no `symbol_route` row
 * **without checking the primary could trade it**, so the order went to a broker that refused it and
 * nothing named the reason. US30's own `symbol_route.note` records the failure verbatim:
 * *"no route existed (silent fallback to :5000, tradeMode 0)"*.
 *
 * #1002 fixed the RUNTIME: `resolveForOrder()` prefers a broker that can trade the symbol, and
 * `orderRouteProblems()` refuses by name when none can. This is the complementary check for the
 * remaining state that no runtime fallback can rescue — a bot whose symbol **no active broker can
 * carry at all**. Such a bot is dead on arrival and there is nothing to route it to.
 *
 * ⚠️ WHY THIS IS NOT IN `prebuild`
 * --------------------------------
 * Every `prebuild` validator in this repo is STATIC — it reads source files and needs no database, so
 * it runs everywhere. This needs `trading_strategy` and `broker_symbol` LIVE. Putting it in `prebuild`
 * would break the build on any machine without the database running. It is the LIVE companion to the
 * static checks, exactly as `validate-config-db-refs.cjs` is to `validate-schema-safety.cjs` — and for
 * the same reason, neither is a substitute for the other.
 *
 * ⚠️ A VERIFIER THAT CANNOT READ ITS INPUT MUST ERROR, NEVER PASS
 * --------------------------------------------------------------
 * If the database is unreachable this EXITS NON-ZERO. A check that inspects nothing and reports OK is
 * worse than no check, because the next reader trusts it.
 *
 * ⚠️ TWO CHECKS, TWO DEPTHS — THIS IS DEPTH 1. They are NOT duplicates.
 * -------------------------------------------------------------------
 * `audit-bot-activation.cjs` (`npm run audit:bot-activation`) answers DEPTH 2: can this BOT trade
 * **right now**? It adds bars, the `strategy_protocol` subscription and floor-vs-`baseSize`, and it
 * reads `tradeMode` from the LIVE BRIDGES.
 *
 * THIS script answers DEPTH 1: can any active broker take this SYMBOL **at all**? It reads only
 * `broker_symbol` in the DATABASE — so it still works when both bridges are DOWN, which is the one
 * thing the audit cannot do. That is the whole reason it exists alongside the audit.
 *
 * ⚠️ Measured 2026-09-25 by running both on the same data: this exits **0** while the audit exits
 * **1**, naming `BTC … BELOW-FLOOR(0.01<1)`. Both reported **38 active bots**, so the population
 * agrees and only the depth differs. Neither is a duplicate, and a third mechanism for this
 * question would be pure debt.
 *
 * ⚠️ BUT THE CAUSE WAS MISREAD — CORRECTED 2026-09-26. I first recorded "both are right: BTC's
 * symbol is tradeable, its bot is not." **That is wrong.** BTC is routed `provider 'binance'`, and
 * the AUDIT's route subquery selects `provider = 'mt5'` only — so IT falls back to MetaQuotes and
 * applies `volumeMin 1` to a symbol that does not trade there. `BTC` also exists on :5000 as a
 * DIFFERENT instrument (the #914 hazard). **So the audit's `BELOW-FLOOR` for BTC is a false positive
 * by venue, and this script was RIGHT to skip it** — which is the one thing the measurement does
 * show: this script's non-MT5 skip is load-bearing, not a convenience.
 *
 * WHEN TO RUN WHICH: bridges UP → run the AUDIT (it subsumes this question and adds the rest).
 * Bridges DOWN, on CI, or on a machine with no bridge → run THIS.
 *
 * Usage:  node scripts/validate-route-capability.cjs
 *         node scripts/validate-route-capability.cjs --self-test    (proves the rule can fail)
 *         node scripts/validate-route-capability.cjs --json
 */

const fs = require('fs');
const path = require('path');

/** tradeMode 0 = the broker lists the symbol and trading is disabled for it. */
const TRADE_MODE_DISABLED = 0;

/**
 * The active broker list, from the SAME source the runtime uses.
 *
 * ⚠️ `process.env` FIRST, then `nest/.env` as a fallback. The API loads `.env` and reads
 * `process.env`, so a shell override (or a different `.env`) changes runtime behaviour — and a check
 * that read only the file would validate a configuration the process is not using. It also makes the
 * failure path testable without touching a single production row:
 *
 *     $env:MT5_ACTIVE_BROKERS='9'; node scripts/validate-route-capability.cjs    # must FAIL
 *
 * Returns `null` when neither is set, and the caller says so out loud rather than inventing a
 * default — an unstated fallback is how #1002's defect hid in the first place.
 */
function readActiveBrokersFromEnv() {
  const parse = (raw) =>
    String(raw)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));

  if (process.env.MT5_ACTIVE_BROKERS) {
    const fromEnv = parse(process.env.MT5_ACTIVE_BROKERS);
    if (fromEnv.length > 0) return fromEnv;
  }

  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '.env.local')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*MT5_ACTIVE_BROKERS\s*=\s*(.+?)\s*$/);
      if (m) {
        const parsed = parse(m[1]);
        if (parsed.length > 0) return parsed;
      }
    }
  }
  return null;
}

/**
 * The rule, as a PURE function so it can be exercised without a database.
 *
 * @param bots        [{ name, symbol, active, baseSize }]  — active bots only
 * @param routes      [{ symbol, brokerId, enabled, brokerSymbol? }]
 * @param capability  [{ brokerId, name, tradeMode, volumeMin }]
 * @param activeBrokers number[]
 * @returns {{ failures, notes, sizeFailures, sizeNotes }}
 *
 * A FAILURE is a bot that can never trade: no active broker can carry its symbol.
 * A NOTE is a bot the #1002 runtime fallback will redirect to a broker that can — visible, not fatal.
 * A SIZE FAILURE (#1005) is a bot whose symbol CAN trade but whose `baseSize` is below the floor on
 * every broker that can carry it, so it can never fill. A SIZE NOTE is the partial case — it fills
 * on some brokers but not others.
 */
function evaluate(bots, routes, capability, activeBrokers) {
  const canTrade = new Map(); // SYMBOL -> Set<brokerId that can trade it>
  for (const c of capability) {
    if (c.tradeMode === TRADE_MODE_DISABLED) continue; // listed, but trading disabled
    const key = String(c.name).toUpperCase();
    if (!canTrade.has(key)) canTrade.set(key, new Set());
    canTrade.get(key).add(Number(c.brokerId));
  }

  const routeOf = new Map();
  /** Symbols routed to a NON-MT5 venue (crypto → binance). Out of scope for an MT5 check. */
  const nonMt5Routed = new Set();
  for (const r of routes) {
    if (r.enabled === false) continue;
    const key = String(r.symbol).toUpperCase();
    // ⚠️ A symbol routed to a non-MT5 venue is not an MT5 symbol and must be SKIPPED, not checked.
    // The first version of this script checked it anyway and reported BTC as a bot that can never
    // trade — on a symbol that is deliberately traded through binance.
    if (String(r.provider ?? 'mt5') !== 'mt5') { nonMt5Routed.add(key); continue; }
    if (!activeBrokers.includes(Number(r.brokerId))) continue;
    // ⚠️ The WHOLE route is kept, not just the brokerId: `brokerSymbol` is the capability KEY
    // (see the loop below) — USTEC is `NAS100` on broker 3 (#1112).
    if (!routeOf.has(key)) routeOf.set(key, { brokerId: Number(r.brokerId), brokerSymbol: r.brokerSymbol ?? null });
  }

  const bySymbol = new Map(); // SYMBOL -> [bot]  (the whole bot, so `baseSize` is available)
  for (const b of bots) {
    const key = String(b.symbol || '').toUpperCase();
    if (!key) continue;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key).push(b);
  }

  // SYMBOL -> Map(brokerId -> volumeMin), for brokers that CAN trade it. (#1005)
  const floorOf = new Map();
  for (const c of capability) {
    const key = String(c.name).toUpperCase();
    const id = Number(c.brokerId);
    if (!canTrade.get(key)?.has(id)) continue;
    if (c.volumeMin == null) continue; // NULL is UNKNOWN, never "no minimum"
    if (!floorOf.has(key)) floorOf.set(key, new Map());
    floorOf.get(key).set(id, Number(c.volumeMin));
  }

  const failures = [];
  const notes = [];
  /** #1005 — capability says the symbol CAN trade; the bot's CONFIGURED SIZE says otherwise. */
  const sizeFailures = [];
  const sizeNotes = [];
  for (const [symbol, botList] of bySymbol) {
    const names = botList.map((b) => b.name);
    // ⚠️ The capability KEY is the BROKER'S name for the symbol, not ours (#1112). `canTrade` is
    // keyed by `broker_symbol.name`, and an explicit route maps USTEC → NAS100; asking under the
    // canonical ticker finds nothing and publishes a DEFINITE "cannot trade" for a live route.
    // Measured 2026-10-12: this script reported USTEC as a bot that can never trade while the
    // router (fixed the same day) answered canTrade=true for broker 3.
    const routeEntry = routeOf.get(symbol);
    const nativeKey = String(routeEntry?.brokerSymbol || symbol).toUpperCase();
    const tradeable = [...(canTrade.get(nativeKey) || [])].filter((id) => activeBrokers.includes(id));
    let usable = [];

    // ── An EXPLICIT active-MT5 route is a capability fact someone verified by hand, and #1002
    //    never second-guesses it. So this check does not either: if that broker cannot trade the
    //    symbol, that IS the failure, and there is no fallback to note.
    if (routeEntry) {
      const routed = routeEntry.brokerId;
      if (!tradeable.includes(routed)) {
        const asClause = nativeKey !== symbol ? ` as ${nativeKey}` : '';
        failures.push({
          symbol,
          bots: names,
          reason:
            `routed to broker ${routed}${asClause}, which reports tradeMode=0 (or does not list it), and an ` +
            `explicit route is never overridden — this bot can never trade`,
        });
        continue;
      }
      usable = [routed];
    } else if (nonMt5Routed.has(symbol)) {
      // ⚠️ Checked BEFORE the capability branch: a symbol routed to binance is not an MT5 symbol,
      // and testing it against MT5 tradeMode reported a healthy crypto bot as permanently dead.
      // It is ALSO why the size floor below cannot false-positive: this `continue` happens first.
      continue;
    } else if (tradeable.length === 0) {
      failures.push({
        symbol,
        bots: names,
        reason:
          `no active broker can trade ${symbol} — it is either absent from every broker's symbol ` +
          `list, or listed with tradeMode=0 on all of them (active brokers: ${activeBrokers.join(', ')})`,
      });
      continue;
    } else {
      usable = tradeable;
      const dflt = activeBrokers[0];
      if (!tradeable.includes(dflt)) {
        notes.push({
          symbol,
          bots: names,
          reason:
            `has no explicit route and the default broker ${dflt} cannot trade it; ` +
            `#1002's resolveForOrder() will use broker ${tradeable[0]} instead`,
        });
      }
    }

    // ── SIZE FLOOR (#1005) — reached only when the symbol CAN be traded. Venue-aware BY
    //    CONSTRUCTION rather than by an extra check: the non-MT5 branch above `continue`s first, so
    //    an MT5 floor is never applied to a symbol routed elsewhere (the BTC false positive that
    //    audit-bot-activation.cjs was corrected for on 2026-09-26).
    // ⚠️ Same key rule as `tradeable` above: the floor lives under the BROKER'S name (#1112).
    const floors = [...(floorOf.get(nativeKey) ?? new Map())].filter(([id]) => usable.includes(id));
    if (floors.length === 0) continue; // no KNOWN floor — unknown must never read as a failure
    for (const bot of botList) {
      const size = Number(bot.baseSize);
      if (!Number.isFinite(size)) continue;
      const fits = floors.filter(([, min]) => min <= size);
      if (fits.length === 0) {
        sizeFailures.push({
          symbol,
          bot: bot.name,
          reason:
            `baseSize ${size} is below the volume floor on EVERY broker that can trade ${symbol} ` +
            `(${floors.map(([id, min]) => `broker ${id}: ${min}`).join(', ')}) — it can never fill`,
        });
      } else if (fits.length < floors.length) {
        sizeNotes.push({
          symbol,
          bot: bot.name,
          reason:
            `baseSize ${size} is below the floor on some brokers that can trade ${symbol} ` +
            `(${floors.filter(([, min]) => min > size).map(([id, min]) => `broker ${id}: ${min}`).join(', ')}) ` +
            `— it fills only on the others`,
        });
      }
    }
  }
  return { failures, notes, sizeFailures, sizeNotes };
}

/** Synthetic inputs that MUST produce a failure — a guard never observed to fail is decoration. */
function selfTest() {
  const bots = [{ name: 'Ghost Bot', symbol: 'NOSUCH', active: true }];
  const capability = [{ brokerId: 2, name: 'NOSUCH', tradeMode: 0 }]; // listed, disabled
  const r = evaluate(bots, [], capability, [2, 3]);
  if (r.failures.length !== 1) {
    console.error(`❌ self-test: expected 1 failure for a symbol no broker can trade, got ${r.failures.length}`);
    return 1;
  }
  // Direction 2 — a tradeable symbol must NOT fail, or the rule is just "everything fails".
  const ok = evaluate(
    [{ name: 'Good Bot', symbol: 'XAUUSD', active: true }],
    [],
    [{ brokerId: 2, name: 'XAUUSD', tradeMode: 4 }],
    [2, 3],
  );
  if (ok.failures.length !== 0) {
    console.error('❌ self-test: a symbol broker 2 reports tradeMode=4 must not fail');
    return 1;
  }
  // Direction 3 — the #1002 redirect must be a NOTE, not a failure.
  const redirect = evaluate(
    [{ name: 'Redirected Bot', symbol: 'US30', active: true }],
    [],
    [{ brokerId: 2, name: 'US30', tradeMode: 0 }, { brokerId: 3, name: 'US30', tradeMode: 4 }],
    [2, 3],
  );
  if (redirect.failures.length !== 0 || redirect.notes.length !== 1) {
    console.error('❌ self-test: a symbol only broker 3 can trade must be a NOTE, not a failure');
    return 1;
  }
  // Direction 4 — an EXPLICIT active-MT5 route is never overridden, so its failure is terminal.
  const explicitBad = evaluate(
    [{ name: 'Routed Bot', symbol: 'US500', active: true }],
    [{ symbol: 'US500', brokerId: 3, enabled: true, provider: 'mt5' }],
    [{ brokerId: 3, name: 'US500', tradeMode: 0 }],
    [2, 3],
  );
  if (explicitBad.failures.length !== 1 || explicitBad.notes.length !== 0) {
    console.error('❌ self-test: an explicit route to a broker that cannot trade it must FAIL, not be noted');
    return 1;
  }
  // Direction 5 — a NON-MT5 route (crypto → binance) is out of scope entirely.
  // ⚠️ This case exists because the first version of this script produced a NOTE saying #1002 would
  // move BTC to broker 2 — false, and the #914 hazard (`BTC` matches `Nasdaq\ETF\BTC` on MetaQuotes).
  const crypto = evaluate(
    [{ name: 'BTC Investment Monitor', symbol: 'BTC', active: true }],
    [{ symbol: 'BTC', brokerId: 0, enabled: true, provider: 'binance' }],
    [{ brokerId: 2, name: 'BTC', tradeMode: 0 }],
    [2, 3],
  );
  if (crypto.failures.length !== 0 || crypto.notes.length !== 0) {
    console.error('❌ self-test: a non-MT5 (binance) route must be out of scope, not noted or failed');
    return 1;
  }
  // ⚠️ #1005 SIZE-FLOOR cases. The LAST one is the BTC REGRESSION: a floor taken from the wrong venue.
  const belowFloor = evaluate(
    [{ name: 'Tiny Bot', symbol: 'BTC', active: true, baseSize: 0.01 }],
    [],
    [{ brokerId: 2, name: 'BTC', tradeMode: 4, volumeMin: 1 }, { brokerId: 3, name: 'BTC', tradeMode: 4, volumeMin: 1 }],
    [2, 3],
  );
  if (belowFloor.sizeFailures.length !== 1) {
    console.error('❌ self-test: a baseSize below the floor on EVERY capable broker must FAIL');
    return 1;
  }
  const fitsFloor = evaluate(
    [{ name: 'Big Bot', symbol: 'BTC', active: true, baseSize: 1 }],
    [],
    [{ brokerId: 2, name: 'BTC', tradeMode: 4, volumeMin: 1 }],
    [2, 3],
  );
  if (fitsFloor.sizeFailures.length !== 0) {
    console.error('❌ self-test: a baseSize AT the floor must not fail');
    return 1;
  }
  const unknownFloor = evaluate(
    [{ name: 'Unknown Floor Bot', symbol: 'BTC', active: true, baseSize: 0.01 }],
    [],
    [{ brokerId: 2, name: 'BTC', tradeMode: 4, volumeMin: null }],
    [2, 3],
  );
  if (unknownFloor.sizeFailures.length !== 0) {
    console.error('❌ self-test: an UNKNOWN floor (NULL) must not fail — unknown is not "no minimum"');
    return 1;
  }
  const wrongVenue = evaluate(
    [{ name: 'BTC Investment Monitor', symbol: 'BTC', active: true, baseSize: 0.01 }],
    [{ symbol: 'BTC', brokerId: 0, enabled: true, provider: 'binance' }],
    [{ brokerId: 2, name: 'BTC', tradeMode: 4, volumeMin: 1 }],
    [2, 3],
  );
  if (wrongVenue.sizeFailures.length !== 0) {
    console.error('❌ self-test: a non-MT5 symbol must NOT be judged against an MT5 floor (the BTC regression)');
    return 1;
  }
  // Directions 6+7 — a MAPPED route (#1112): capability is asked under the BROKER'S name.
  // ⚠️ This pair exists because the script reported USTEC as a bot that can never trade while the
  // live router answered canTrade=true — the check asked under the canonical ticker.
  const mappedRoute = evaluate(
    [{ name: 'USTEC QQQ Speed', symbol: 'USTEC', active: true, baseSize: 0.1 }],
    [{ symbol: 'USTEC', brokerId: 3, enabled: true, provider: 'mt5', brokerSymbol: 'NAS100' }],
    [{ brokerId: 3, name: 'NAS100', tradeMode: 4, volumeMin: 0.1 }],
    [2, 3],
  );
  if (mappedRoute.failures.length !== 0) {
    console.error('❌ self-test: a MAPPED route (USTEC → NAS100) must PASS — capability is keyed by the broker\'s name');
    return 1;
  }
  const mappedDisabled = evaluate(
    [{ name: 'USTEC QQQ Speed', symbol: 'USTEC', active: true, baseSize: 0.1 }],
    [{ symbol: 'USTEC', brokerId: 3, enabled: true, provider: 'mt5', brokerSymbol: 'NAS100' }],
    [{ brokerId: 3, name: 'NAS100', tradeMode: 0, volumeMin: 0.1 }],
    [2, 3],
  );
  if (mappedDisabled.failures.length !== 1 || !/as NAS100/.test(mappedDisabled.failures[0].reason)) {
    console.error('❌ self-test: a mapped route whose NATIVE listing is tradeMode=0 must FAIL, naming the native name');
    return 1;
  }
  console.log('✅ self-test: 11 cases — the rule was observed to FAIL a dead bot, an explicit route to');
  console.log('   a broker that cannot trade it, a baseSize below the floor on every capable broker, and');
  console.log('   a mapped route whose broker-native listing disables it; PASS a tradeable bot, one AT the');
  console.log('   floor and a healthy MAPPED route; NOTE a #1002 redirect; and treat a non-MT5 route and an');
  console.log('   UNKNOWN floor as NOT failures.');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  const activeBrokers = readActiveBrokersFromEnv();
  if (!activeBrokers || activeBrokers.length === 0) {
    console.error(
      '\n❌ MT5_ACTIVE_BROKERS is not set in nest/.env.\n' +
        '   Refusing to run: without it there is no "active broker" to check against, and inventing a\n' +
        '   default is exactly the silent fallback #1002 exists to remove.\n',
    );
    process.exit(1);
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    console.error(`\n❌ Cannot load @prisma/client: ${err.message.split('\n')[0]}\n`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let bots, routes, capability;
  try {
    [bots, routes, capability] = await Promise.all([
      prisma.tradingStrategy.findMany({ where: { active: true }, select: { name: true, symbol: true, baseSize: true } }),
      prisma.symbolRoute.findMany({ select: { symbol: true, brokerId: true, enabled: true, provider: true, brokerSymbol: true } }),
      prisma.brokerSymbol.findMany({ select: { brokerId: true, name: true, tradeMode: true, volumeMin: true } }),
    ]);
  } catch (err) {
    // ⚠️ ERROR, never pass — see the header. A check that inspects nothing must not report OK.
    console.error(`\n❌ Cannot read the database: ${err.message.split('\n')[0]}`);
    console.error('   This check needs `trading_strategy` and `broker_symbol`. It did NOT pass — it could not run.\n');
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();

  const { failures, notes, sizeFailures, sizeNotes } = evaluate(bots, routes, capability, activeBrokers);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ activeBrokers, bots: bots.length, failures, notes, sizeFailures, sizeNotes }, null, 2));
    process.exit(failures.length > 0 || sizeFailures.length > 0 ? 1 : 0);
  }

  console.log(`\n[route-capability] ${bots.length} active bot(s), ${activeBrokers.length} active broker(s) ` +
    `(${activeBrokers.join(', ')}), ${routes.length} route(s), ${capability.length} broker symbol row(s)`);

  if (notes.length > 0) {
    console.log(`\n\u2139️  ${notes.length} symbol(s) redirected to a broker that can trade them (#1002 handles these):`);
    for (const n of notes) console.log(`   • ${n.symbol} (${n.bots.join(', ')}) — ${n.reason}`);
  }

  if (sizeNotes.length > 0) {
    console.log(`\n\u2139\ufe0f  ${sizeNotes.length} bot(s) fill only on SOME capable brokers (size below another broker's floor):`);
    for (const n of sizeNotes) console.log(`   • ${n.symbol} (${n.bot}) — ${n.reason}`);
  }

  if (failures.length === 0 && sizeFailures.length === 0) {
    console.log('\n✅ OK — every active bot has a symbol at least one active broker can trade,');
    console.log('   and every baseSize meets the floor on a broker that can carry it.\n');
    process.exit(0);
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} bot symbol(s) NO active broker can trade — these bots can never trade:\n`);
    for (const f of failures) console.error(`   • ${f.symbol} (${f.bots.join(', ')})\n     ${f.reason}`);
  }
  if (sizeFailures.length > 0) {
    console.error(`\n❌ ${sizeFailures.length} bot(s) whose CONFIGURED SIZE can never fill (#1005):\n`);
    for (const f of sizeFailures) console.error(`   • ${f.symbol} (${f.bot})\n     ${f.reason}`);
    console.error('   Fix: raise the bot\'s baseSize to the floor, or route it to a broker whose floor it meets.');
    console.error('   ⚠️ Raising a baseSize IS a maths change — it alters how much a tradeable symbol trades.');
  }
  console.error('\n   Note: `broker_symbol` is refreshed from the bridges; a stale row can report the old mode or floor.\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n❌ validate-route-capability failed unexpectedly: ${err.message}\n`);
  process.exit(1);
});
