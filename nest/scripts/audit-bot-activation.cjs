#!/usr/bin/env node
/**
 * audit-bot-activation.cjs — WHY each trading bot can or cannot trade.
 * ===================================================================
 * Born from the US500 incident (2026-09-15): a bot looked perfectly configured in the UI
 * while the bridge refused every order it sent. Three separate faults were found by hand
 * before this script existed, and all three shared one property — **the app could not see
 * them**:
 *
 *   1. NO ROUTE      — the symbol falls back to the primary broker, which may refuse it
 *                      (US500 on MetaQuotes: `tradeMode 0`).
 *   2. NOT TRADEABLE — the broker LISTS the symbol and still refuses to trade it. `tradeMode`
 *                      is a property of BROKER × SYMBOL, never of the symbol alone.
 *   3. BELOW FLOOR   — every index symbol has a 0.1-lot minimum on both bridges, while the
 *                      seeded bots all shipped `baseSize: 0.01`. `Volume 0.01 below UK100
 *                      minimum (0.1)` in the log is the receipt.
 *
 * A fourth fault is config-only: an INACTIVE bot or one with no `strategy_protocol`
 * subscription never receives a queued signal, so it cannot trade however healthy it looks.
 *
 * This prints a per-bot verdict so "why is nothing trading?" is answerable in one command
 * instead of an afternoon. It is READ-ONLY: it never changes a bot, a route or an order.
 *
 * Usage (from nest/):  node scripts/audit-bot-activation.cjs
 *                      npm run audit:bot-activation
 * Exit code: 1 if any ACTIVE bot is blocked, 0 otherwise (inactive bots are reported, not fatal).
 *
 * ⚠️ TWO CHECKS, TWO DEPTHS — THIS IS DEPTH 2. They are NOT duplicates.
 * -------------------------------------------------------------------
 * `validate-route-capability.cjs` (`npm run db:route-capability`) answers DEPTH 1: can any active
 * broker trade this SYMBOL **at all**? It reads only `broker_symbol` in the DATABASE, so it still
 * works with both bridges down — which is the one thing this script cannot do.
 *
 * THIS script answers DEPTH 2: can this BOT trade **right now**? It adds bars, the
 * `strategy_protocol` subscription and floor-vs-`baseSize`, and it reads `tradeMode` from the LIVE
 * BRIDGES rather than from the database.
 *
 * ⚠️ Measured 2026-09-25 by running both on the same data, because "they might be duplicates" is a
 * claim and this is the observation:
 *   • `db:route-capability` → exit **0**, "every active bot has a symbol at least one active broker can trade"
 *   • this audit          → exit **1**, BTC Investment Monitor blocked `BELOW-FLOOR(0.01<1)`
 * Both reported **38 active bots**, so the population agrees and only the depth differs.
 *
 * ⚠️ BUT THE CAUSE OF THE DISAGREEMENT WAS MISREAD — CORRECTED 2026-09-26. I first recorded "both are
 * right: BTC's *symbol* is tradeable, its *bot* is not." **That is wrong**, and it is written here
 * because the wrong version was already published. `symbol_route` holds `BTC → provider 'binance'`
 * (brokerId 0), and the `routedBroker` subquery above selects `provider = 'mt5'` **only** — so BTC's
 * route reads as NULL, this script falls back to the primary broker, and it applies **MetaQuotes'**
 * `volumeMin 1` to a symbol that does not trade on MetaQuotes. The bare ticker `BTC` does exist on
 * :5000 — the #914 hazard the guard was already corrected for. **So this script's `BELOW-FLOOR` for
 * BTC is a FALSE POSITIVE by venue, and because BTC is its only blocked bot, this script's exit 1
 * rests entirely on it.**
 *
 * ⚠️ Do NOT "fix" that by raising BTC's `baseSize` — that changes a number to satisfy a constraint
 * from the wrong venue. The fix is to skip, or explicitly NAME, non-MT5-routed symbols here, exactly
 * as `validate-route-capability.cjs` already does for the same reason.
 *
 * WHEN TO RUN WHICH: bridges UP → run THIS (it subsumes depth 1's question and adds the rest).
 * Bridges DOWN, on CI, or on a machine with no bridge → run `db:route-capability`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const NEST_ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Broker slot -> bridge port is declared by MT5_ACTIVE_BROKERS order (2 = :5000, 3 = :5001). */
function portByBrokerMap() {
  const ids = (process.env.MT5_ACTIVE_BROKERS || '2,3').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  const ports = [5000, 5001];
  const map = {};
  ids.forEach((id, i) => { if (ports[i]) map[id] = ports[i]; });
  return { map, ids };
}

function getJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * classifyFaults() — PURE. Every fault code is a CLAIM about the world, and two of these claims were
 * wrong in ways prose could not prevent (both measured 2026-09-26):
 *
 *   • `BELOW-FLOOR` was asserted for a symbol routed to a NON-MT5 venue — an MT5 floor applied to a
 *     symbol that does not trade on MT5 (BTC → binance).
 *   • `BROKER-HAS-NO-SYMBOL` was asserted when the bridge simply never answered, publishing "cannot
 *     judge" as a definite "the broker does not list it".
 *
 * Extracted and tested so the next wrong claim has to get past `--self-test` first.
 */
function classifyFaults(i) {
  const faults = [];
  if (!i.active) faults.push('INACTIVE');
  if (i.subs === 0) faults.push('NO-SUBSCRIPTION');
  if (i.bars === 0) faults.push('NO-BARS');

  if (i.nonMt5) {
    // Out of scope for an MT5 audit — reported so it is VISIBLE, never silent, and never fatal.
    faults.push(`NON-MT5-VENUE(${i.nonMt5})`);
  } else if (!i.listLoaded) {
    // CANNOT JUDGE — never "the broker has no such symbol". Fatal: a check that could not read its
    // input must not report OK.
    faults.push(`BRIDGE-UNAVAILABLE(:${i.port ?? '?'} ${i.unavailable ?? 'unreachable'})`);
  } else {
    if (i.tradeMode === 0) faults.push('NOT-TRADEABLE-HERE');
    if (i.tradeMode === undefined) faults.push('BROKER-HAS-NO-SYMBOL');
    if (i.volumeMin != null && i.size < i.volumeMin) faults.push(`BELOW-FLOOR(${i.size}<${i.volumeMin})`);
  }
  return faults;
}

/** INACTIVE and NON-MT5-VENUE are reported, not fatal — neither is a defect this audit judges. */
function isBlocked(active, faults) {
  return active && faults.some((f) => f !== 'INACTIVE' && !f.startsWith('NON-MT5-VENUE'));
}

/**
 * Synthetic cases that MUST produce the stated fault — a rule never observed to fail is decoration.
 * Cases 1 and 2 are the two real bugs; cases 3-5 prove the legitimate claims still fire, so the fix
 * cannot have been "make it say nothing".
 */
function selfTest() {
  const bad = [];
  const check = (label, got, want) => {
    const g = got.join(' ');
    if (g !== want) bad.push(`${label}\n     want: ${want}\n      got: ${g}`);
  };
  const base = { active: true, subs: 1, bars: 100, port: 5001, size: 0.01, volumeMin: null };

  // 1 — the BTC bug. A non-MT5 venue must NOT be judged against an MT5 floor, however far below it is.
  check('1 non-MT5 route must be out of scope, never BELOW-FLOOR',
    classifyFaults({ ...base, nonMt5: 'binance', listLoaded: true, tradeMode: 4, volumeMin: 1 }),
    'NON-MT5-VENUE(binance)');

  // 2 — the availability bug. No usable list must NOT be published as "the broker has no symbol".
  check('2 no usable list must be BRIDGE-UNAVAILABLE, never BROKER-HAS-NO-SYMBOL',
    classifyFaults({ ...base, nonMt5: null, listLoaded: false, tradeMode: undefined, unavailable: 'terminal-down' }),
    'BRIDGE-UNAVAILABLE(:5001 terminal-down)');

  // 3 — direction check: a loaded list that GENUINELY lacks the ticker must still fire.
  check('3 a loaded list genuinely missing the ticker must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: undefined }),
    'BROKER-HAS-NO-SYMBOL');

  // 4 — direction check: a real tradeMode=0 must still fire.
  check('4 tradeMode=0 on a loaded list must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 0 }),
    'NOT-TRADEABLE-HERE');

  // 5 — direction check: a genuine below-floor MT5 bot must still fire (the floor check is not dead).
  check('5 a genuine MT5 below-floor bot must still fail',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 1 }),
    'BELOW-FLOOR(0.01<1)');

  // 6 — and a healthy bot must be silent, or the rule is just "everything fails".
  check('6 a healthy bot must report nothing',
    classifyFaults({ ...base, nonMt5: null, listLoaded: true, tradeMode: 4, volumeMin: 0.01 }), '');

  if (isBlocked(true, ['NON-MT5-VENUE(binance)'])) bad.push('7 a non-MT5 venue must NOT count as blocked');
  if (isBlocked(true, ['INACTIVE'])) bad.push('8 INACTIVE must NOT count as blocked');
  if (!isBlocked(true, ['BRIDGE-UNAVAILABLE(:5001 terminal-down)'])) {
    bad.push('9 BRIDGE-UNAVAILABLE MUST count as blocked — cannot-judge is not a pass');
  }

  if (bad.length) {
    console.error(`\n\u274c self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('\u2705 self-test: 9 cases — the rule FAILS a genuine below-floor bot, a tradeMode=0 and a');
  console.log('   genuinely-absent symbol; SKIPS a non-MT5 venue entirely; and reports an unreadable bridge');
  console.log('   as BRIDGE-UNAVAILABLE (blocked) rather than as a broker that lacks the symbol.');
  return 0;
}

async function main() {
  if (process.argv.slice(2).includes('--self-test')) process.exit(selfTest());
  loadEnv();
  const { map: portByBroker, ids: brokerIds } = portByBrokerMap();

  let prisma = null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(`Cannot audit without the database: ${err.message.split('\n')[0]}`);
    process.exit(1);
  }

  // ── Per-broker symbol list (tradeMode) — one call per live bridge ──
  const modesByPort = new Map();
  /** port -> WHY the list is unusable, in the BRIDGE'S OWN words (`connectionState`). */
  const listUnavailable = new Map();
  for (const port of Object.values(portByBroker)) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/symbols`);
      const rowsIn = Array.isArray(list.symbols) ? list.symbols : [];
      // ⚠️ AN EMPTY LIST IS NOT AN ANSWER. A bridge whose terminal is down answers 503 WITH a JSON
      // body (measured 2026-09-26: :5001 → `terminal-down`, 616 connection errors), so
      // `list.symbols` is undefined and `new Map([])` would still SET the key — which is exactly how
      // a live outage got published as "the broker does not list this symbol".
      if (rowsIn.length === 0) throw new Error('empty symbol list');
      modesByPort.set(port, new Map(rowsIn.map((s) => [String(s.name).toUpperCase(), s.tradeMode])));
    } catch (err) {
      // Ask the bridge WHY, so the fault names the remedy instead of just "unavailable".
      let why = err && err.message ? String(err.message) : 'unreachable';
      try {
        const h = await getJson(`http://127.0.0.1:${port}/health`);
        if (h && h.connectionState) why = String(h.connectionState);
      } catch { /* health also unreadable — keep the original reason */ }
      listUnavailable.set(port, why);
    }
  }

  /** Per-symbol broker constraints. `/symbol/<X>/info` is the endpoint that carries volumeMin. */
  async function constraints(port, ticker) {
    if (!port) return null;
    try {
      const info = await getJson(`http://127.0.0.1:${port}/symbol/${encodeURIComponent(ticker)}/info`);
      return { volumeMin: typeof info.volumeMin === 'number' ? info.volumeMin : null };
    } catch { return null; }
  }

  // ⚠️ COLLATE IS REQUIRED, NOT COSMETIC. `symbol.ticker` and `trading_strategy.symbol` carry
  // DIFFERENT collations (`utf8mb4_unicode_ci` vs `utf8mb4_0900_ai_ci`), so comparing them
  // raises MySQL error 1267 `Illegal mix of collations … for operation '='`. Pinning one
  // explicit collation on each side is what makes the join legal.
  const bots = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.name, t.symbol, t.active, t.mode, t.baseSize, t.protocolId, t.minComposite,
            (SELECT COUNT(*) FROM strategy_protocol sp WHERE sp.strategyId = t.id) AS subs,
            (SELECT COUNT(*) FROM marketbar b JOIN symbol s2 ON s2.id = b.symbolId
              WHERE s2.ticker COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci) AS bars,
            (SELECT MAX(b.timestamp) FROM marketbar b JOIN symbol s2 ON s2.id = b.symbolId
              WHERE s2.ticker COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci) AS newest,
            (SELECT sr.brokerId FROM symbol_route sr
              WHERE sr.symbol COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci
                AND sr.enabled = 1 AND sr.provider = 'mt5'
              ORDER BY sr.priority ASC LIMIT 1) AS routedBroker,
            (SELECT sr.provider FROM symbol_route sr
              WHERE sr.symbol COLLATE utf8mb4_unicode_ci = t.symbol COLLATE utf8mb4_unicode_ci
                AND sr.enabled = 1 AND sr.provider <> 'mt5'
              ORDER BY sr.priority ASC LIMIT 1) AS nonMt5Provider
       FROM trading_strategy t
      ORDER BY t.symbol, t.name`,
  );

  const primary = brokerIds[0] ?? 2;
  const rows = [];
  for (const b of bots) {
    const ticker = String(b.symbol).toUpperCase();
    // ⚠️ A symbol routed to a NON-MT5 venue (crypto → binance) is not an MT5 symbol. Measured
    // 2026-09-26: BTC is routed `provider 'binance'`, the `routedBroker` subquery selects
    // `provider = 'mt5'` ONLY so it reads NULL, and this script then fell back to :5000 and applied
    // METAQUOTES' `volumeMin 1` to a symbol that does not trade there — reporting
    // `BELOW-FLOOR(0.01<1)` as a fault. The bare ticker `BTC` exists on :5000 as a DIFFERENT
    // instrument (the #914 hazard). That was a FALSE POSITIVE, and it was this script's only blocked
    // bot, so its exit 1 rested entirely on it.
    // So MT5 `tradeMode`/`volumeMin` are NOT consulted for these, and the columns print `n/a` rather
    // than a number from a venue the symbol does not trade on.
    const nonMt5 = b.nonMt5Provider != null ? String(b.nonMt5Provider) : null;
    const brokerId = b.routedBroker != null ? Number(b.routedBroker) : primary;
    const port = nonMt5 ? undefined : portByBroker[brokerId];
    // ⚠️ `modesByPort` only gets a key when the bridge actually ANSWERED (`catch` above leaves it
    // absent). Measured 2026-09-26: :5001 was UP but returned **503** on `/symbols`, so all seven
    // broker-3 symbols read `tradeMode: undefined` and were reported `BROKER-HAS-NO-SYMBOL` — i.e.
    // "we could not ask" published as a definite "the broker does not list it". Those are different
    // facts and only one of them is evidence, so they are now separate faults.
    // ⚠️ A NON-EMPTY list, not merely a present key — this predicate was wrong on the first attempt.
    // Measured 2026-09-26: :5001 returned 503 whose body parsed to `{}`, so `new Map([])` still SET
    // the key, `listLoaded` read true, and all seven broker-3 symbols were still published as
    // BROKER-HAS-NO-SYMBOL. An empty list is not an answer, so the test requires symbols.
    const listLoaded = port != null && (modesByPort.get(port)?.size ?? 0) > 0;
    const tradeMode = nonMt5 || !listLoaded ? undefined : modesByPort.get(port)?.get(ticker);
    const c = nonMt5 || !listLoaded ? null : await constraints(port, ticker);
    const bars = Number(b.bars);
    const size = Number(b.baseSize);
    const active = Number(b.active) === 1;
    const subs = Number(b.subs);

    const faults = classifyFaults({
      active, subs, bars, nonMt5, listLoaded, tradeMode,
      volumeMin: c?.volumeMin ?? null, size, port,
      unavailable: listUnavailable.get(port),
    });

    rows.push({
      ticker,
      name: String(b.name),
      active,
      mode: String(b.mode),
      size,
      brokerId,
      port,
      tradeMode,
      floor: c?.volumeMin ?? null,
      bars,
      newest: b.newest ? new Date(b.newest).toISOString() : null,
      subs,
      minComposite: b.minComposite,
      faults,
      blocked: isBlocked(active, faults),
    });
  }

  console.log('\n[symbol ] [bot                              ] [active] [mode      ] [size] [broker] [tradeMode] [floor] [bars] [subs] verdict');
  console.log('-'.repeat(150));
  for (const r of rows) {
    const verdict = r.faults.length === 0 ? 'OK' : r.faults.join(' ');
    console.log(
      `${r.ticker.padEnd(8)} ${r.name.slice(0, 32).padEnd(32)} ${String(r.active).padEnd(6)} ` +
      `${r.mode.padEnd(10)} ${String(r.size).padEnd(5)} ${String(r.brokerId).padEnd(7)} ` +
      `${String(r.tradeMode ?? 'n/a').padEnd(10)} ${String(r.floor ?? 'n/a').padEnd(6)} ${String(r.bars).padEnd(5)} ` +
      `${String(r.subs).padEnd(5)} ${verdict}`,
    );
  }

  const activeBlocked = rows.filter((r) => r.blocked);
  const inactive = rows.filter((r) => !r.active);
  console.log(`\n${rows.length} bot(s): ${rows.length - activeBlocked.length - inactive.length} active and tradeable, ` +
    `${activeBlocked.length} ACTIVE BUT BLOCKED, ${inactive.length} inactive.`);

  const nonMt5Rows = rows.filter((r) => r.faults.some((f) => f.startsWith('NON-MT5-VENUE')));
  if (nonMt5Rows.length) {
    console.log('\nNON-MT5 VENUE — routed elsewhere; MT5 tradeMode/floor do NOT apply, so they are not checked:');
    for (const r of nonMt5Rows) {
      const which = r.faults.filter((f) => f.startsWith('NON-MT5-VENUE')).join(' ');
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${which}  (an MT5 floor here is NOT a fault)`);
    }
  }

  const unavailable = rows.filter((r) => r.faults.some((f) => f.startsWith('BRIDGE-UNAVAILABLE')));
  if (unavailable.length) {
    console.log('\n\u26a0\ufe0f  CANNOT JUDGE — a bridge did not answer its symbol list, so these were NOT checked:');
    for (const r of unavailable) {
      const why = r.faults.filter((f) => f.startsWith('BRIDGE-UNAVAILABLE')).join(' ');
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${why}`);
    }
    console.log('   This is NOT evidence the broker lacks the symbol. Fix the bridge, then re-run.');
  }

  if (activeBlocked.length) {
    console.log('\nACTIVE BUT BLOCKED — these are configured to trade and cannot:');
    for (const r of activeBlocked) {
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${r.faults.join(' ')}` +
        (r.faults.some((f) => f.startsWith('BELOW-FLOOR'))
          ? `  → raise baseSize to ${r.floor} (the broker minimum)`
          : ''));
    }
  }
  if (inactive.length) {
    console.log('\nINACTIVE — not generating data. Activate only if the symbol has bars AND a tradeable broker:');
    for (const r of inactive) {
      const why = r.faults.filter((f) => f !== 'INACTIVE').join(' ') || 'nothing blocking';
      console.log(`  ${r.ticker.padEnd(8)} ${r.name} — ${why}`);
    }
  }

  await prisma.$disconnect();
  process.exit(activeBlocked.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`audit failed: ${err.message}`);
  process.exit(1);
});
