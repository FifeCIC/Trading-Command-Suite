#!/usr/bin/env node
/**
 * validate-protocol-covers-bot-symbol.cjs — a bot's protocol must be configured to score the
 * bot's OWN symbol, or the bot can never act on a single score it produces.
 * =================================================================================================
 *
 * THE DEFECT THIS GUARDS (#970)
 * -----------------------------
 * `symbol` is a field on the BOT, but a protocol is scored per-TICKER. Nothing joins the two, so
 * they can disagree silently: the protocol scores `SPY` 37×/day, the only bot consuming it trades
 * `US500`, and every score lands on a ticker no bot owns.
 *
 * It is invisible in the way this repo keeps paying for — **plausible output, no error**. No block
 * is recorded (nothing ever attempts), no error is logged (nothing is wrong), and the rows read
 * `SCORED … signal=BUY` with a high composite, which is indistinguishable from a signal that should
 * have traded.
 *
 * ⚠️ MEASURED 2026-10-02 — THE INSTANCE IN THE ISSUE IS ALREADY FIXED, AND THE SET IS EMPTY
 * -----------------------------------------------------------------------------------------
 * `US SPY Speed` trades `US500` on protocol `spy-speed-v1`. `symbol_protocol_assignment` now holds
 * BOTH `SPY` and `US500` for that protocol, a watchlist is linked by FK carrying `US500`, and
 * `decision_log` shows `US500` scored **31× in 7 days** alongside `SPY`'s 40. So the protocol DOES
 * score the bot's symbol today, and `0 of 39` active bots fail this rule.
 *
 * What was missing was not the fix — it was the GUARD. That is the whole point of this file:
 * *fix the instance, then guard the class.*
 *
 * ⚠️ A PROTOCOL SCORING MANY SYMBOLS IS CORRECT — DO NOT "FIX" THAT
 * ------------------------------------------------------------------
 * A leverage protocol covering 79 symbols is fine; each bot picks one. The ONLY fault is a bot
 * whose own symbol is absent from everything its protocol scores. This rule tests exactly that and
 * nothing else.
 *
 * ⚠️ "CANNOT JUDGE" IS NOT "FAIL"
 * ------------------------------
 * A protocol with neither an assignment nor a linked watchlist resolves its symbols by GUESSING
 * from its slug (`ProtocolDbService.resolveSymbols` path 3, #761/#763). This script cannot follow a
 * guess, so it reports that bot as CANNOT JUDGE — deliberately NOT a failure. Collapsing "fine" and
 * "cannot judge" into one bucket is the defect this repo names most often.
 *
 * ⚠️ WHY THIS IS NOT IN `prebuild`
 * --------------------------------
 * It needs `trading_strategy` and the config tables LIVE. Every `prebuild` validator is static and
 * must run on a machine with no database. This is the live companion, in the same relationship as
 * `db:route-capability` to the static checks — see `validate-route-capability.cjs`.
 *
 * ⚠️ A VERIFIER THAT CANNOT READ ITS INPUT MUST ERROR, NEVER PASS
 * --------------------------------------------------------------
 * If the database is unreachable this EXITS NON-ZERO. A check that inspects nothing and reports OK
 * is worse than no check, because the next reader trusts it.
 *
 * Usage:  node scripts/validate-protocol-covers-bot-symbol.cjs
 *         node scripts/validate-protocol-covers-bot-symbol.cjs --self-test   (proves the rule can fail)
 *         node scripts/validate-protocol-covers-bot-symbol.cjs --json
 */

/** A watchlist `symbols` blob is JSON, and has been seen in three shapes. */
function tickersFromWatchlist(raw) {
  const out = [];
  const push = (t) => {
    const u = String(t ?? '').toUpperCase();
    if (u && !out.includes(u)) out.push(u);
  };
  if (raw == null) return out;
  let parsed = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return out; }
  }
  if (!Array.isArray(parsed)) return out;
  for (const s of parsed) push(typeof s === 'string' ? s : (s?.ticker || s?.symbol || ''));
  return out;
}

/**
 * The rule, as a PURE function so it can be exercised without a database.
 *
 * @param bots        [{ id, name, symbol, protocolId }]           — active bots only
 * @param protocols   [{ id, slug }]                               — to resolve slug ↔ UUID (#801)
 * @param assignments [{ protocolId, symbol }]
 * @param watchlists  [{ protocolId, symbols }]                    — symbols is Json or JSON text
 * @returns {{ failures, cannotJudge, coverage }}
 *
 * A FAILURE is narrow on purpose: the protocol HAS a declared symbol set, and the bot's own symbol
 * is not in it. Anything else is a NOTE, because over-firing gets a guard allowlisted.
 */
function evaluate(bots, protocols, assignments, watchlists) {
  const bySlug = new Map();
  for (const p of protocols) {
    if (p?.slug) bySlug.set(String(p.slug), p);
    if (p?.id) bySlug.set(String(p.id), p);
  }

  // protocol key -> declared symbols, from both config paths.
  const declared = new Map();
  const add = (pid, sym) => {
    if (!pid || !sym) return;
    const k = String(pid);
    const u = String(sym).toUpperCase();
    if (!declared.has(k)) declared.set(k, []);
    if (!declared.get(k).includes(u)) declared.get(k).push(u);
  };
  for (const a of assignments) add(a.protocolId, a.symbol);
  for (const w of watchlists) for (const t of tickersFromWatchlist(w.symbols)) add(w.protocolId, t);

  const failures = [];
  const cannotJudge = [];
  const coverage = [];

  for (const b of bots) {
    const pid = b.protocolId == null ? '' : String(b.protocolId);
    const botSym = String(b.symbol ?? '').toUpperCase();
    if (!pid) continue;

    // The declared set may be keyed by slug OR by UUID (#801) — gather both keys.
    const keys = new Set([pid]);
    const p = bySlug.get(pid);
    if (p?.id) keys.add(String(p.id));
    if (p?.slug) keys.add(String(p.slug));

    const set = [];
    for (const k of keys) for (const s of declared.get(k) ?? []) if (!set.includes(s)) set.push(s);

    if (set.length === 0) {
      cannotJudge.push({ bot: b.name, symbol: botSym, protocol: pid });
      continue;
    }
    if (set.includes(botSym)) {
      coverage.push({ bot: b.name, symbol: botSym, protocol: pid, set });
    } else {
      failures.push({ bot: b.name, symbol: botSym, protocol: pid, set });
    }
  }

  return { failures, cannotJudge, coverage };
}

/* ── self-test ────────────────────────────────────────────────────────────────────────────────
 * ⚠️ A guard that has never been observed to fail is a decoration. Every case below asserts a
 * DIRECTION; case 1 is the #970 instance itself, and cases 2–3 are its inverse. The pair is what
 * distinguishes "the guard works" from "the guard never runs".
 */
function selfTest() {
  let failed = 0;
  const check = (label, got, want) => {
    if (got !== want) { console.error(`❌ self-test: ${label} — expected ${want}, got ${got}`); failed++; }
  };

  const proto = [{ id: 'uuid-1', slug: 'spy-speed-v1' }];

  // 1. THE #970 INSTANCE — protocol declares SPY only, the bot trades US500.
  let r = evaluate(
    [{ id: 'b1', name: 'US SPY Speed', symbol: 'US500', protocolId: 'spy-speed-v1' }],
    proto, [{ protocolId: 'spy-speed-v1', symbol: 'SPY' }], [],
  );
  check('a protocol that never declares the bot symbol must FAIL', r.failures.length, 1);

  // 2. Its inverse — the same setup with US500 declared as well (today's real state) must PASS.
  r = evaluate(
    [{ id: 'b1', name: 'US SPY Speed', symbol: 'US500', protocolId: 'spy-speed-v1' }],
    proto, [{ protocolId: 'spy-speed-v1', symbol: 'SPY' }, { protocolId: 'spy-speed-v1', symbol: 'US500' }], [],
  );
  check('declaring both tickers must PASS', r.failures.length, 0);

  // 3. Config keyed by UUID while the bot carries the slug must still resolve (#801).
  r = evaluate(
    [{ id: 'b1', name: 'B', symbol: 'US500', protocolId: 'spy-speed-v1' }],
    proto, [{ protocolId: 'uuid-1', symbol: 'US500' }], [],
  );
  check('slug bot vs UUID config must resolve, not fail', r.failures.length, 0);

  // 4. A linked watchlist is a declared set too.
  r = evaluate(
    [{ id: 'b1', name: 'B', symbol: 'XAUUSD', protocolId: 'gold-macro-v1' }],
    [{ id: 'uuid-2', slug: 'gold-macro-v1' }],
    [], [{ protocolId: 'gold-macro-v1', symbols: '["XAUUSD"]' }],
  );
  check('a watchlist-declared symbol must PASS', r.failures.length, 0);

  // 5. No declared set at all → CANNOT JUDGE, never a failure.
  r = evaluate(
    [{ id: 'b1', name: 'B', symbol: 'EURUSD', protocolId: 'guessed-from-name-v1' }],
    [], [], [],
  );
  check('an undeclared protocol must be cannot-judge, not a failure', r.failures.length, 0);
  check('…and it must be reported as cannot-judge', r.cannotJudge.length, 1);

  // 6. Per-BOT, not per-protocol: one covered bot and one orphan on the SAME protocol.
  r = evaluate(
    [
      { id: 'b1', name: 'covered', symbol: 'SPY', protocolId: 'p' },
      { id: 'b2', name: 'orphan', symbol: 'QQQ', protocolId: 'p' },
    ],
    [], [{ protocolId: 'p', symbol: 'SPY' }], [],
  );
  check('two bots on one protocol must yield exactly ONE failure', r.failures.length, 1);
  check('…and the named bot must be the orphan', r.failures[0].bot, 'orphan');

  // 7. Case-insensitivity — the DB is not guaranteed to be upper-cased.
  r = evaluate(
    [{ id: 'b1', name: 'B', symbol: 'us500', protocolId: 'p' }],
    [], [{ protocolId: 'p', symbol: 'US500' }], [],
  );
  check('a lower-cased bot symbol must still match', r.failures.length, 0);

  // 8. A many-symbol protocol is CORRECT — a covered bot inside a big set must not fail.
  r = evaluate(
    [{ id: 'b1', name: 'B', symbol: 'MSFT', protocolId: 'leverage' }],
    [], [{ protocolId: 'leverage', symbol: 'AAPL' }, { protocolId: 'leverage', symbol: 'MSFT' }, { protocolId: 'leverage', symbol: 'NVDA' }], [],
  );
  check('a bot inside a 79-symbol protocol must PASS', r.failures.length, 0);

  // 9. Empty population must pass — and must not claim coverage it did not inspect.
  r = evaluate([], [], [], []);
  check('no bots must PASS', r.failures.length, 0);
  check('no bots must report no coverage', r.coverage.length, 0);

  if (failed === 0) {
    console.log('✅ self-test: 9 cases — the rule was observed to FAIL the #970 instance, and to PASS');
    console.log('   its inverse, a UUID-keyed config, a watchlist-declared symbol, a many-symbol');
    console.log('   protocol and an undeclared protocol (cannot-judge, not a failure).');
  }
  return failed === 0 ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    console.error(`\n❌ Cannot load @prisma/client: ${err.message.split('\n')[0]}\n`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let bots, protocols, assignments, watchlists;
  try {
    [bots, protocols, assignments, watchlists] = await Promise.all([
      prisma.tradingStrategy.findMany({ where: { active: true }, select: { id: true, name: true, symbol: true, protocolId: true } }),
      prisma.protocol.findMany({ select: { id: true, slug: true } }),
      prisma.symbolProtocolAssignment.findMany({ select: { protocolId: true, symbol: true } }),
      prisma.watchlist.findMany({ select: { protocolId: true, symbols: true } }),
    ]);
  } catch (err) {
    // ⚠️ ERROR, never pass — see the header.
    console.error(`\n❌ Cannot read the database: ${err.message.split('\n')[0]}`);
    console.error('   This check needs `trading_strategy`, `protocol`, `symbol_protocol_assignment` and `watchlist`.');
    console.error('   It did NOT pass — it could not run.\n');
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();

  const { failures, cannotJudge, coverage } = evaluate(bots, protocols, assignments, watchlists);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ bots: bots.length, failures, cannotJudge, covered: coverage.length }, null, 2));
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log(`\n[bot-symbol-coverage] ${bots.length} active bot(s), ${assignments.length} assignment(s), ${watchlists.length} linked watchlist(s)`);

  if (cannotJudge.length > 0) {
    console.log(`\nℹ️  ${cannotJudge.length} bot(s) CANNOT BE JUDGED — their protocol declares no symbol set,`);
    console.log('   so it resolves by guessing from its slug (ProtocolDbService path 3, #761/#763).');
    console.log('   NOT a failure: a guess cannot be followed from here. Wire it to be checkable:');
    console.log('   add a `symbol_protocol_assignment` row, or link a watchlist via `watchlist.protocolId`.');
    for (const c of cannotJudge) console.log(`   • ${c.bot} (${c.symbol}) — protocol "${c.protocol}"`);
  }

  if (failures.length === 0) {
    console.log(`\n✅ OK — every active bot whose protocol declares a symbol set has its own symbol in it`);
    console.log(`   (${coverage.length} verified, ${cannotJudge.length} not judgeable).\n`);
    process.exit(0);
  }

  console.error(`\n❌ ${failures.length} bot(s) whose protocol scores symbols that NEVER include the bot's own —`);
  console.error('   every score these bots produce is unreachable. This is silent: no error is logged,\n');
  console.error('   because nothing ever attempts a trade.\n');
  for (const f of failures) {
    console.error(`   • ${f.bot} trades ${f.symbol}, but protocol "${f.protocol}" declares [${f.set.join(', ')}]`);
  }
  console.error('\n   Fix: declare the bot\'s symbol on its protocol (a `symbol_protocol_assignment` row,');
  console.error('   or link a watchlist via `watchlist.protocolId`) — or point the bot at a symbol the');
  console.error('   protocol actually scores.');
  console.error('   ⚠️ Do NOT re-ticker the protocol: that moves every existing score (#970).');
  console.error('   ⚠️ Declare it in the SEEDER, not just the database — a direct write is lost on reinstall.\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n❌ validate-protocol-covers-bot-symbol failed unexpectedly: ${err.message}\n`);
  process.exit(1);
});
