#!/usr/bin/env node
/**
 * validate-pnl-integrity.cjs — a closed trade whose P&L could not be computed must not be SILENT (#1003).
 * ==========================================================================================================
 *
 * THE DEFECT
 * ----------
 * A trade can close with `pnl = 0` and **look like an ordinary zero-P&L trade**. Only
 * `pnlInvalidReason` says otherwise. Measured 2026-09-26, 123 closed trades are flagged:
 *
 *   | reason                                                        |  n | first    | last     |
 *   |---------------------------------------------------------------|----|----------|----------|
 *   | Shared exitPrice across batch — pre-close floating value       | 82 | 07-29    | 08-19    |
 *   | Structural phantom — no brokerTicket and no exitPrice          | 17 | 09-10    | 09-10    |
 *   | A/B intent only — no order placed (#929 pre-fix)               | 14 | 09-22    | 09-23    |
 *   | exit-unknown: position vanished; no deal history, no last price| 10 | 09-18    | 09-23    |
 *
 * **The cost is a wrong answer, not a crash.** A consumer counting `pnl` without filtering
 * `pnlInvalid` reports a win rate over rows that have no outcome — measured: **23.9% over all 264
 * closed trades against 48.5% over the 130 with a definite result.** One table, two answers.
 *
 * ⚠️ THIS IS A SYMPTOM GUARD, ON PURPOSE
 * -------------------------------------
 * `exit-unknown` **stopped on its own after 2026-09-23 and nobody knows why.** Per the repo rule
 * *"do not attribute a fix you did not isolate"*, a fault that vanishes unattributed is worse than
 * one that is understood — there is no record of what to check when it returns. So this guards the
 * SYMPTOM (a recent closed trade with no computable P&L), which fires without needing the cause to
 * be right. A cause guard would inherit whatever was wrong with the theory.
 *
 * ⚠️ WHY A WINDOW, AND WHY IT IS NOT CHEATING
 * ------------------------------------------
 * 123 trades are ALREADY flagged and most are historical and understood (the pre-2026-09-10 bridge
 * bug, the #929 pre-fix intents). A guard that failed on any flagged row would be red from the day
 * it was written and would be ignored — *an allowlisted guard is worse than none*. So this fails on
 * a RECURRENCE inside the window, and REPORTS the historical total so the number stays visible
 * rather than being filtered out of sight.
 *
 * Usage (from nest/):
 *   node scripts/validate-pnl-integrity.cjs               default window: 3 days
 *   node scripts/validate-pnl-integrity.cjs --days 7      wider window
 *   node scripts/validate-pnl-integrity.cjs --json        machine-readable
 *   node scripts/validate-pnl-integrity.cjs --self-test   prove the rule can fail (no database)
 *
 * Exit: 0 = no recurrence in the window · 1 = recurrence found, OR the database could not be read.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');

/** Same loader the other nest scripts use — the API reads `process.env` after loading `.env`. */
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
 * evaluate(rows, cutoffMs) — the rule, as a PURE function so it can be exercised without a database.
 *
 * @param rows      [{ id, symbol, closedAt (ISO string|Date), reason }] — ALL closed trades
 * @param cutoffMs  epoch ms; a flagged row at or after this is a RECURRENCE
 * @returns {{ recent, historical, closedTotal, invalidTotal }}
 *
 * A RECURRENCE is a flagged trade closed inside the window. Everything else is reported, not judged.
 */
function evaluate(rows, cutoffMs) {
  const recent = [];
  const historical = [];
  for (const r of rows) {
    if (!r.invalid) continue;
    const t = r.closedAt instanceof Date ? r.closedAt.getTime() : Date.parse(String(r.closedAt));
    (Number.isFinite(t) && t >= cutoffMs ? recent : historical).push(r);
  }
  return {
    recent,
    historical,
    closedTotal: rows.length,
    invalidTotal: recent.length + historical.length,
  };
}

/** Synthetic cases that MUST produce the stated result — a guard never observed to fail is decoration. */
function selfTest() {
  const DAY = 86400000;
  const cutoff = Date.parse('2026-09-24T00:00:00Z');
  const bad = [];
  const check = (label, got, want, fmt = (v) => String(v)) => {
    if (fmt(got) !== want) bad.push(`${label}\n     want: ${want}\n      got: ${fmt(got)}`);
  };

  // Direction 1 — a flagged trade INSIDE the window is a recurrence and MUST fail.
  const inside = evaluate(
    [{ id: 'a', symbol: 'XAUUSD', invalid: true, closedAt: new Date(cutoff + DAY).toISOString(), reason: 'exit-unknown' }],
    cutoff,
  );
  check('1 a flagged trade inside the window must be a RECURRENCE', inside.recent.length, '1');

  // Direction 2 — the SAME fault outside the window must NOT fail, or the guard is permanently red
  // and gets ignored. This is the case that makes the guard usable at all.
  const outside = evaluate(
    [{ id: 'b', symbol: 'XAUUSD', invalid: true, closedAt: new Date(cutoff - DAY).toISOString(), reason: 'exit-unknown' }],
    cutoff,
  );
  check('2 the same fault OUTSIDE the window must be historical, not a recurrence', outside.recent.length, '0');
  check('   …and must still be REPORTED rather than hidden', outside.historical.length, '1');

  // Direction 3 — healthy trades must stay silent, or the rule is just "everything fails".
  const healthy = evaluate(
    [{ id: 'c', symbol: 'XAUUSD', invalid: false, closedAt: new Date(cutoff + DAY).toISOString() }],
    cutoff,
  );
  check('3 a healthy trade must not be flagged', healthy.recent.length, '0');

  // Direction 4 — a row with an UNPARSEABLE date must not crash or silently pass as recent.
  const badDate = evaluate(
    [{ id: 'd', symbol: 'XAUUSD', invalid: true, closedAt: 'not-a-date' }],
    cutoff,
  );
  check('4 an unparseable closedAt must not be counted as a recurrence', badDate.recent.length, '0');

  if (bad.length) {
    console.error(`\n❌ self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('✅ self-test: 4 cases — the rule was observed to FAIL a flagged trade inside the window,');
  console.log('   and NOT to fail the same trade outside it, a healthy trade, or an unparseable date.');
  return 0;
}

/**
 * classifyPopulations(rows) — #1044. The SAME rule as `nest/src/common/trading/pnl-population.ts`,
 * kept here in plain JS so this script needs no build.
 *
 * ⚠️ A SECOND IMPLEMENTATION IS A COST, so it is deliberately minimal and the TS module is named
 * as the owner. It exists because the guard must run against the LIVE database with no build step.
 * If the two ever disagree, the TS module wins and this follows — see the self-test below, which
 * pins the four states so a divergence fails loudly rather than quietly.
 *
 * @param rows [{ id, symbol, closedAt, exitPrice, pnl, pnlInvalid }]
 */
function classifyPopulations(rows) {
  const out = { realised: [], quarantined: [], exitUnknown: [], open: [] };
  for (const r of rows) {
    if (r.closedAt === null || r.closedAt === undefined) { out.open.push(r); continue; }
    if (Number(r.pnlInvalid) === 1) { out.quarantined.push(r); continue; }
    // ⚠️ The structural half is applied to the VALUE, not used to reject the row: a missing exit
    // price on a row carrying a real recovered number must NOT discard it (see the TS owner).
    if ((r.exitPrice === null || r.exitPrice === undefined) && Number(r.pnl ?? 0) === 0) {
      out.exitUnknown.push(r);
      continue;
    }
    out.realised.push(r);
  }
  return out;
}

/**
 * The #1044 self-test — proves `classifyPopulations` can fail in BOTH directions.
 *
 * Measured 2026-10-01: 113 flagged rows and **21 UNFLAGGED** ones, all with no exit price and a
 * placeholder `pnl = 0`. The 21 are the defect: a `pnlInvalid`-only filter accepts them, so they
 * were averaged in as break-even trades and moved the win rate with no error.
 */
function selfTestPopulations() {
  const bad = [];
  const check = (label, got, want) => {
    if (String(got) !== String(want)) bad.push(`${label}\n     want: ${want}\n      got: ${got}`);
  };

  const rows = [
    { id: 'realised', symbol: 'XAUUSD', closedAt: 'x', exitPrice: 1.16, pnl: 42.5, pnlInvalid: 0 },
    { id: 'breakeven', symbol: 'XAUUSD', closedAt: 'x', exitPrice: 1.16, pnl: 0, pnlInvalid: 0 },
    { id: 'flagged', symbol: 'XAUUSD', closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 1 },
    { id: 'phantom', symbol: 'EURUSD', closedAt: 'x', exitPrice: null, pnl: 0, pnlInvalid: 0 },
    { id: 'openrow', symbol: 'EURUSD', closedAt: null, exitPrice: null, pnl: 0, pnlInvalid: 0 },
    // ⚠️ A real recovered number with NO exit price is NOT discarded — the structural fact is
    // applied to the value. Without this case the rule would silently throw away real P&L.
    { id: 'recovered', symbol: 'GBPUSD', closedAt: 'x', exitPrice: null, pnl: -234.52, pnlInvalid: 0 },
  ];
  const p = classifyPopulations(rows);

  check('1 a priced result is realised', p.realised.length, 3);
  check('2 a genuine break-even (pnl 0 WITH an exit) is realised, not discarded',
    p.realised.some((r) => r.id === 'breakeven'), 'true');
  check('3 a real P&L with NO exit price is REALISED — never discard a number that exists',
    p.realised.some((r) => r.id === 'recovered'), 'true');
  check('4 a flagged row is quarantined', p.quarantined.length, 1);
  check('5 a closed row with NO exit price AND a placeholder zero is exit-unknown — the 21-row gap',
    p.exitUnknown.length, 1);
  check('6 …and it is the row we expect, not a coincidence',
    p.exitUnknown[0] && p.exitUnknown[0].id, 'phantom');
  check('7 an open row is neither', p.open.length, 1);
  check('8 the four populations account for every input',
    p.realised.length + p.quarantined.length + p.exitUnknown.length + p.open.length, rows.length);

  if (bad.length) {
    console.error(`\n❌ populations self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('✅ populations self-test: 8 cases — an UNFLAGGED phantom is detected, a FLAGGED one');
  console.log('   is not double-counted, a genuine break-even is not mistaken for one, and a real');
  console.log('   recovered P&L with no exit price is NOT discarded.');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    // Both halves must pass. A self-test that stops at the first suite hides the second.
    const a = selfTest();
    const b = selfTestPopulations();
    process.exit(a === 0 && b === 0 ? 0 : 1);
  }
  const populationsOnly = args.includes('--populations');

  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 3;
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`\n❌ --days needs a positive number, got ${args[daysIdx + 1]}\n`);
    process.exit(1);
  }

  loadEnv();

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    console.error(`\n❌ Cannot load @prisma/client: ${err.message.split('\n')[0]}\n`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, symbol, pnlInvalid, pnlInvalidReason, closedAt, exitPrice, pnl
         FROM trade WHERE status = 'closed'`,
    );
  } catch (err) {
    // ⚠️ ERROR, never pass — a check that cannot read its input must not report OK.
    console.error(`\n❌ Cannot read the database: ${err.message.split('\n')[0]}`);
    console.error('   This check needs `trade`. It did NOT pass — it could not run.\n');
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();

  const cutoffMs = Date.now() - days * 86400000;
  const input = (rows || []).map((r) => ({
    id: r.id,
    symbol: r.symbol,
    invalid: Number(r.pnlInvalid) === 1,
    reason: r.pnlInvalidReason,
    closedAt: r.closedAt,
    exitPrice: r.exitPrice,
    pnl: r.pnl,
    pnlInvalid: r.pnlInvalid,
  }));
  const result = evaluate(input, cutoffMs);

  // ── #1044 — the population split, and the UNFLAGGED phantom ──────────────────────────────
  const pops = classifyPopulations(input);
  const phantomIsRecent = (r) => {
    const t = r.closedAt instanceof Date ? r.closedAt.getTime() : Date.parse(String(r.closedAt));
    return Number.isFinite(t) && t >= cutoffMs;
  };
  const phantomRecent = pops.exitUnknown.filter(phantomIsRecent);
  const phantomHistorical = pops.exitUnknown.filter((r) => !phantomIsRecent(r));

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      windowDays: days,
      cutoff: new Date(cutoffMs).toISOString(),
      ...result,
      populations: {
        realised: pops.realised.length,
        quarantined: pops.quarantined.length,
        exitUnknown: pops.exitUnknown.length,
        open: pops.open.length,
        exitUnknownRecent: phantomRecent.length,
      },
    }, null, 2));
    process.exit(result.recent.length > 0 || phantomRecent.length > 0 ? 1 : 0);
  }

  console.log(`\n[pnl-integrity] ${result.closedTotal} closed trade(s); ${result.invalidTotal} carry no computable P&L.`);
  console.log(`[pnl-integrity] window: last ${days} day(s), from ${new Date(cutoffMs).toISOString()}`);
  console.log('[pnl-integrity] populations (#1044 — the four states a `0` cannot express):');
  console.log(`   realised      ${String(pops.realised.length).padStart(4)}   a result, including a priced break-even`);
  console.log(`   quarantined   ${String(pops.quarantined.length).padStart(4)}   flagged pnlInvalid; \`pnl\` is a placeholder`);
  console.log(`   exit-unknown  ${String(pops.exitUnknown.length).padStart(4)}   closed, no exit price, NOT flagged  <-- the defect`);
  console.log(`   open          ${String(pops.open.length).padStart(4)}   still open; no result yet`);

  if (phantomHistorical.length > 0) {
    console.log(`\nℹ️  ${phantomHistorical.length} HISTORICAL unflagged phantom(s) — reported, not fatal. These are`);
    console.log('   structurally identical to the flagged rows; only the flag is missing. A');
    console.log('   `pnlInvalid`-only filter books each one as a BREAK-EVEN TRADE.');
  }

  if (populationsOnly) {
    console.log(phantomRecent.length === 0
      ? `\n✅ OK — no UNFLAGGED phantom has been written in the last ${days} day(s).\n`
      : `\n❌ ${phantomRecent.length} UNFLAGGED phantom(s) closed in the last ${days} day(s).\n`);
    process.exit(phantomRecent.length === 0 ? 0 : 1);
  }

  if (phantomRecent.length > 0) {
    console.error(`\n❌ PHANTOM — ${phantomRecent.length} trade(s) closed in the last ${days} day(s) with NO`);
    console.error('   exit price and NO `pnlInvalid` flag (#1044). `pnl` holds a placeholder 0, so any');
    console.error('   consumer filtering on `pnlInvalid` alone books them as break-even trades:\n');
    for (const r of phantomRecent.slice(0, 20)) {
      const when = r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt);
      console.error(`   • ${String(r.symbol).padEnd(9)} ${when}  pnl=${r.pnl}`);
    }
    if (phantomRecent.length > 20) console.error(`   …and ${phantomRecent.length - 20} more.`);
    console.error('\n   Fix in the WRITER, not by editing rows: see `position-sync.service.ts`');
    console.error('   (`reapStrandedOpenTrades`). The rule is `pnl-population.ts`.\n');
    process.exit(1);
  }

  if (result.historical.length > 0) {
    const byReason = new Map();
    for (const r of result.historical) {
      const k = String(r.reason || '(no reason)').slice(0, 58);
      byReason.set(k, (byReason.get(k) || 0) + 1);
    }
    console.log(`\nℹ️  ${result.historical.length} HISTORICAL flag(s) — reported, not fatal (a guard that is`);
    console.log('   permanently red gets ignored):');
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   • ${String(n).padStart(3)}  ${reason}`);
    }
  }

  if (result.recent.length === 0) {
    console.log(`\n✅ OK — no trade has closed without a computable P&L in the last ${days} day(s).\n`);
    process.exit(0);
  }

  console.error(`\n❌ RECURRENCE — ${result.recent.length} trade(s) closed in the last ${days} day(s) with NO`);
  console.error('   computable P&L. This is the exit-unknown fault returning (#1003):\n');
  for (const r of result.recent.slice(0, 20)) {
    const when = r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt);
    console.error(`   • ${String(r.symbol).padEnd(9)} ${when}  ${String(r.reason || '(no reason)').slice(0, 60)}`);
  }
  if (result.recent.length > 20) console.error(`   …and ${result.recent.length - 20} more.`);
  console.error('\n   ⚠️ A consumer counting `pnl` without filtering `pnlInvalid` will report these as');
  console.error('      zero-P&L trades and produce a wrong win rate. Check the resolver and the');
  console.error('      stranded-trade reaper (`reapStrandedOpenTrades`) before trusting any P&L figure.\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n❌ validate-pnl-integrity failed unexpectedly: ${err.message}\n`);
  process.exit(1);
});
