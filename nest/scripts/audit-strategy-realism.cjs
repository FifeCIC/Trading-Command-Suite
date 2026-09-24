#!/usr/bin/env node
/**
 * audit-strategy-realism.cjs — #960 Tier 1, as a GUARD rather than a one-off.
 * ===========================================================================
 * #960 (Strategy Establishment) defines a strategy as *realistic* only when seven things are true,
 * and Tier 1 is explicit that the audit which found the two mis-sized gold bots must be
 * **"repeat it as a guard, not a one-off."** This is that guard for the four requirements that are
 * answerable from the database alone.
 *
 * ── WHAT IT CHECKS, PER BOT ─────────────────────────────────────────────────────────────────────
 *
 *   EXIT-UNDEFINED      `slPct`/`tpPct` missing or zero. #960 req 7 — an entry thesis with no exit
 *                       thesis is half a strategy, and it cannot be judged at all.
 *   UNREALISTIC-EXIT    the share of the bot's closed trades that ended `broker:sl` is at or above
 *                       the threshold. This is the measurable form of "the stop is inside the
 *                       instrument's noise": a stop placed inside normal movement is hit almost
 *                       every time regardless of whether the entry was right.
 *   LOSS-OVER-CEILING   the worst single realised loss on this bot's own trades is above the ceiling.
 *                       #960 req 3 — the size must respect the floor AND the ceiling.
 *   NO-EVIDENCE         no closed trades. Reported, never fatal: an unproven bot is not a broken one.
 *
 * ⚠️ REPORTED, DELIBERATELY NOT FLAGGED — declared vs recorded stop distance
 * ------------------------------------------------------------------------
 * The table prints the bot's declared `slPct` next to the distance actually recorded on its closed
 * trades. These disagree often, and **that disagreement is not by itself a defect** — which is a
 * correction this file made to itself after its first run:
 *
 *   • `stop_adjustment` holds **56 XAUUSD rows** (607 overall), so the stop guardian TRAILS here. A
 *     trailed stop is tighter than the declared one BY DESIGN.
 *   • Three of the four gold bots record a distance TIGHTER than they declare (Position 4H declares 3%
 *     and records 1.234%; Day-Trade declares 0.5% and records 0.372%).
 *   • `1.001%` recurs across unrelated bots and unrelated symbols — the signature of the guardian's
 *     `strat?.slPct ?? 1` fallback, not of a misconfigured strategy.
 *
 * So a threshold on this comparison would fire on the normal trailing mechanism and would be
 * allowlisted within a week. It was first written as a flag (`STOPS-TOO-CLOSE`, then
 * `DECLARED-MISMATCH`); it is now a COLUMN. ⚠️ A guard that fires for unrelated reasons is worse than
 * no guard, and a mislabelled finding is worse than either.
 *
 * ⚠️ WHY LOSS IS MEASURED, NOT MODELLED
 * --------------------------------------
 * The first version computed risk as `size × slPct% × price`. That is wrong by a factor of ~100,000
 * for FX (0.01 lots is 1,000 units, not 0.01), and it reported £0.00 risk on EURUSD. A wrong number
 * in a risk column is worse than no column — so the ceiling is checked against the loss the bot
 * ACTUALLY took, read from `trade.pnl`, which is already in account currency. No contract-size
 * modelling, and nothing for a future reader to mis-trust.
 *
 * ⚠️ WHAT THIS IS NOT
 * -------------------
 * It does not decide whether a bot should run, and it never changes one. It is READ-ONLY. It also
 * cannot see the broker's lot floor or `tradeMode` — those are `audit-bot-activation.cjs`'s job, and
 * the two audits are complementary: that one asks *can* this bot trade, this one asks whether the
 * trade it would place is *realistic*.
 *
 * ⚠️ ATTRIBUTION CAVEAT, STATED NOT ASSUMED
 * -----------------------------------------
 * Trades are attributed to a bot by the `trade.strategy` STRING, not by a foreign key. That field is
 * known to be broken (#949 — null on 184 of 186 closes at its worst), so a bot whose trades are
 * untagged shows NO-EVIDENCE even though it has been trading. The audit reports the coverage it
 * actually achieved (see the footer) so the gap is visible rather than silent.
 *
 * ⚠️ THE £100 CEILING HAS NO CANONICAL HOME
 * -----------------------------------------
 * £100 is the figure quoted in #960's body. A search of `nest/src` and `nest/prisma` on 2026-09-24
 * found no config entry for it. It is therefore read from env/constant here, and **that is a defect
 * in itself** — a ceiling hardcoded in an audit is the same class as a threshold hardcoded in a
 * service. If a canonical home exists, this must read from it.
 *
 * Usage (from nest/):  node scripts/audit-strategy-realism.cjs [--self-test] [--all]
 *   --self-test  prove the classifier CAN return each verdict (no database needed)
 *   --all        include inactive bots (default: active only)
 * Exit code: 1 if any ACTIVE bot is flagged, 0 otherwise.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');

/** ⚠️ See the header: no canonical home was found for this. Override with REALISM_MAX_RISK. */
const MAX_RISK_PER_TRADE = Number(process.env.REALISM_MAX_RISK ?? 100);

/** Share of a bot's closed trades that may end at the stop before the stop is judged too tight. */
const STOP_OUT_THRESHOLD_PCT = Number(process.env.REALISM_STOP_OUT_PCT ?? 60);

/** Below this many closed trades, a rate is reported but not judged — 3 trades is not a rate. */
const MIN_TRADES_FOR_VERDICT = 3;

function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/**
 * classify(bot, stats, cfg) — the WHOLE rule set, as a PURE function.
 *
 * Pure on purpose: `--self-test` calls THIS function with deliberately awkward input. A self-test
 * against a copy would prove nothing — the failure this repo has already recorded once.
 */
function classify(bot, stats, cfg = {}) {
  const maxRisk = cfg.maxRisk ?? MAX_RISK_PER_TRADE;
  const stopOutPct = cfg.stopOutPct ?? STOP_OUT_THRESHOLD_PCT;
  const minTrades = cfg.minTrades ?? MIN_TRADES_FOR_VERDICT;

  const flags = [];
  const slPct = Number(bot?.slPct);
  const tpPct = Number(bot?.tpPct);

  if (!Number.isFinite(slPct) || slPct <= 0 || !Number.isFinite(tpPct) || tpPct <= 0) {
    flags.push('EXIT-UNDEFINED');
  }

  const trades = stats?.trades ?? 0;
  const stopped = stats?.stopped ?? 0;
  const stopRate = trades > 0 ? (stopped / trades) * 100 : null;

  if (trades >= minTrades && stopRate !== null && stopRate >= stopOutPct) {
    flags.push('UNREALISTIC-EXIT');
  }

  // Declared vs recorded stop distance — PREPORTED ONLY. See the header: the guardian trails, so a
  // disagreement is the expected shape, not a fault. Returned so the table can print both numbers.
  const declaredPct = stats?.avgDeclaredPct ?? null;

  // Ceiling against the loss the bot ACTUALLY took — see the header on why this is not modelled.
  const worstLoss = stats?.worstLoss === undefined ? null : stats.worstLoss;
  if (worstLoss !== null && Math.abs(worstLoss) > maxRisk) flags.push('LOSS-OVER-CEILING');

  if (trades === 0) flags.push('NO-EVIDENCE');

  return { flags, stopRate, worstLoss, declaredPct };
}

function selfTest() {
  const bot = { slPct: 1, tpPct: 2, baseSize: 0.01 };
  const ok = { trades: 10, stopped: 2, avgDeclaredPct: 1, worstLoss: -4 };
  const cases = [
    ['a healthy bot', bot, ok, []],
    ['no exit declared', { ...bot, slPct: 0 }, ok, ['EXIT-UNDEFINED']],
    ['nearly every trade stops out', bot, { ...ok, stopped: 8 }, ['UNREALISTIC-EXIT']],
    ['declared 1% but the recorded stops are 2.5%', bot, { ...ok, avgDeclaredPct: 2.5 }, []],
    ['a loss above the ceiling', bot, { ...ok, worstLoss: -250 }, ['LOSS-OVER-CEILING']],
    ['no trades yet', bot, { trades: 0, stopped: 0, avgDeclaredPct: null, worstLoss: null }, ['NO-EVIDENCE']],
    ['a gold-shaped bot: 0.3% stop, 80% stop-outs', { ...bot, slPct: 0.3, baseSize: 0.01 }, { trades: 10, stopped: 8, avgDeclaredPct: 0.9, worstLoss: -12 }, ['UNREALISTIC-EXIT']],
    ['too few trades to judge a rate', bot, { trades: 2, stopped: 2, avgDeclaredPct: 1, worstLoss: -3 }, []],
  ];

  let bad = 0;
  for (const [label, b, s, expected] of cases) {
    const { flags } = classify(b, s);
    const missing = expected.filter((f) => !flags.includes(f));
    const extra = flags.filter((f) => !expected.includes(f));
    if (missing.length || extra.length) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — missing [${missing}] extra [${extra}]`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n  ✗ ${bad} self-test case(s) misbehaved — the verdict set is not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — every verdict was observed to fire, and a healthy bot was observed to pass.`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  loadEnv();
  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(`Cannot audit without the database: ${String(err.message).split('\n')[0]}`);
    process.exit(1);
  }

  const where = args.includes('--all') ? '' : 'WHERE active = 1';
  const bots = await prisma.$queryRawUnsafe(
    `SELECT name, symbol, slPct, tpPct, baseSize, mode FROM trading_strategy ${where} ORDER BY symbol, slPct`,
  );
  const stats = await prisma.$queryRawUnsafe(
    `SELECT strategy AS name, COUNT(*) AS trades,
            SUM(closeReason = 'broker:sl') AS stopped,
            AVG(ABS(entryPrice - sl) / NULLIF(entryPrice, 0) * 100) AS avgDeclaredPct,
            MIN(pnl) AS worstLoss
     FROM trade
     WHERE status = 'closed' AND strategy IS NOT NULL AND entryPrice > 0 AND sl > 0
     GROUP BY strategy`,
  );

  const byName = new Map(stats.map((s) => [s.name, s]));
  const rows = [];
  let flagged = 0;

  for (const bot of bots) {
    const s = byName.get(bot.name) || { trades: 0, stopped: 0, avgDeclaredPct: null, worstLoss: null };
    const verdict = classify(bot, {
      trades: Number(s.trades ?? 0),
      stopped: Number(s.stopped ?? 0),
      avgDeclaredPct: s.avgDeclaredPct === null || s.avgDeclaredPct === undefined ? null : Number(s.avgDeclaredPct),
      worstLoss: s.worstLoss === null || s.worstLoss === undefined ? null : Number(s.worstLoss),
    });
    if (verdict.flags.some((f) => f !== 'NO-EVIDENCE')) flagged++;
    rows.push({ bot, stats: s, ...verdict });
  }

  const closedTotal = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n, SUM(strategy IS NOT NULL) AS tagged FROM trade WHERE status = 'closed'`,
  );
  const coverage = closedTotal[0] ? { n: Number(closedTotal[0].n), tagged: Number(closedTotal[0].tagged) } : { n: 0, tagged: 0 };

  console.log('\n  STRATEGY REALISM — the Tier 1 truth pass for every active bot (#960)\n');
  console.log('  bot                            symbol   sl/tp    recorded  trades  stop%   worst    verdict');
  console.log('  ' + '-'.repeat(104));
  for (const r of rows) {
    const b = r.bot;
    const rate = r.stopRate === null ? '  —  ' : `${r.stopRate.toFixed(0).padStart(3)}% `;
    const worst = r.worstLoss === null ? '   —   ' : `£${Math.abs(r.worstLoss).toFixed(2).padStart(6)}`;
    const recorded = r.declaredPct === null ? '   —   ' : `${r.declaredPct.toFixed(3)}%`;
    const verdict = r.flags.length ? r.flags.join(' ') : 'OK';
    console.log(
      `  ${String(b.name).slice(0, 30).padEnd(31)}${String(b.symbol).padEnd(9)}` +
      `${`${b.slPct ?? '—'}/${b.tpPct ?? '—'}`.padEnd(9)}${recorded.padEnd(10)}` +
      `${String(r.stats.trades ?? 0).padStart(6)}  ${rate} ${worst}  ${verdict}`,
    );
  }

  console.log(`\n  ceiling £${MAX_RISK_PER_TRADE} worst loss/trade · stop-out threshold ${STOP_OUT_THRESHOLD_PCT}% · min trades ${MIN_TRADES_FOR_VERDICT}`);
  console.log('  ⚠️ recorded% is the stop distance on CLOSED trades — the guardian trails (607 adjustments in `stop_adjustment`), so it is expected to be tighter than declared. Reported, not judged.');
  console.log(`  ⚠️ attribution coverage: ${coverage.tagged} of ${coverage.n} closed trades carry a bot name — an untagged bot shows NO-EVIDENCE through no fault of its own (#949).`);
  console.log(`  flagged (excluding NO-EVIDENCE): ${flagged} of ${rows.length} bot(s)\n`);

  await prisma.$disconnect();
  process.exit(flagged > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
