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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

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
      `SELECT id, symbol, pnlInvalid, pnlInvalidReason, closedAt
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
  }));
  const result = evaluate(input, cutoffMs);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ windowDays: days, cutoff: new Date(cutoffMs).toISOString(), ...result }, null, 2));
    process.exit(result.recent.length > 0 ? 1 : 0);
  }

  console.log(`\n[pnl-integrity] ${result.closedTotal} closed trade(s); ${result.invalidTotal} carry no computable P&L.`);
  console.log(`[pnl-integrity] window: last ${days} day(s), from ${new Date(cutoffMs).toISOString()}`);

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
