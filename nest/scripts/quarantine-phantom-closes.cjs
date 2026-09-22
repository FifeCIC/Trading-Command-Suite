#!/usr/bin/env node
/**
 * quarantine-phantom-closes.cjs — flag trade rows that are NOT trades (#931).
 * ==========================================================================
 *
 * THE CLASS
 * ---------
 * A `trade` row with `status='closed'` but **no brokerTicket AND no exitPrice**
 * is a phantom by CONSTRUCTION: there was no fill, so there was no trade. Any
 * query that filters on `status='closed'` counts it as one — and any win-rate
 * or payoff query counts its `pnl` (usually 0) as a result.
 *
 * Measured 2026-09-21 (#931): 99 of 206 rows were phantoms (48%), produced by
 * bulk reconciler writes — 45 rows in one second (2026-08-12), 26 (2026-08-19),
 * 17 (2026-09-10), 5+3+3 (2026-07-29/30). A real close does not share a
 * millisecond with 44 others; every phantom shares its `closedAt` second with
 * another phantom.
 *
 * WHY 17 ESCAPED
 * --------------
 * 82 were quarantined by a one-off pass whose marker was a DATE WINDOW
 * ("pre-2026-09-10"). The batch that ran ON 2026-09-10 fell outside it. The
 * marker was the bug.
 *
 * ⚠️ WHY THIS SCRIPT EXISTS AT ALL. The repo had NO code that writes
 * `pnlInvalid` — the 82 were flagged by hand, and a predicate nobody can re-run
 * is a promise. This is the canonical, idempotent repair path for
 * `validate-trade-phantoms.cjs`, the guard that fails when a new phantom lands.
 *
 * ⚠️ NEVER DELETES ROWS. The rows are the evidence of when each bulk write
 * happened; the `closedAt` clustering is how they were identified. (Same
 * instruction as the issue: "Do not delete the 99 rows.")
 *
 * Usage:
 *   node nest/scripts/quarantine-phantom-closes.cjs            # report only
 *   node nest/scripts/quarantine-phantom-closes.cjs --apply    # flag unflagged phantoms
 */

const APPLY = process.argv.includes('--apply');

// Shared with validate-trade-phantoms.cjs — ONE definition, in nest/scripts/lib (#931).
const { loadEnv, PREDICATE, REASON } = require('./lib/phantom-predicate.cjs');

loadEnv();

(async () => {
  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    console.error(`\n\u274c Cannot reach the database: ${err.message.split('\n')[0]}`);
    console.error('   This repair is LIVE by design — it flags rows in the real trade record.');
    process.exit(1);
  }

  try {
    const before = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM trade WHERE ${PREDICATE}`,
    );
    const total = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n,
              SUM(status = 'closed' AND brokerTicket IS NULL AND exitPrice IS NULL) AS phantoms,
              SUM(pnlInvalid = 1) AS flagged
         FROM trade`,
    );
    const unflagged = Number(before[0].n);

    console.log('\nquarantine-phantom-closes — structural predicate (#931)\n');
    console.log(`  trade rows total        : ${Number(total[0].n)}`);
    console.log(`  phantom closes          : ${Number(total[0].phantoms)}`);
    console.log(`  flagged pnlInvalid      : ${Number(total[0].flagged)}`);
    console.log(`  UNFLAGGED phantoms      : ${unflagged}`);

    if (unflagged === 0) {
      console.log('\n\u2705 Nothing to do — every phantom close is already quarantined.');
      return;
    }

    const sample = await prisma.$queryRawUnsafe(
      `SELECT id, symbol, closedAt FROM trade WHERE ${PREDICATE} ORDER BY closedAt LIMIT 5`,
    );
    console.log('\n  sample (up to 5):');
    for (const r of sample) {
      console.log(`    ${r.id}  ${r.symbol}  closedAt=${new Date(r.closedAt).toISOString()}`);
    }

    if (!APPLY) {
      console.log('\n  Report only. Re-run with --apply to flag these rows.');
      console.log(`  Reason that would be written: "${REASON}"`);
      return;
    }

    const changed = await prisma.$executeRawUnsafe(
      `UPDATE trade SET pnlInvalid = 1, pnlInvalidReason = ? WHERE ${PREDICATE}`,
      REASON,
    );
    const after = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM trade WHERE ${PREDICATE}`,
    );
    console.log(`\n  flagged ${changed} row(s).`);
    console.log(`  unflagged phantoms after : ${Number(after[0].n)}`);
    if (Number(after[0].n) !== 0) {
      console.error('\n\u274c Rows remain unflagged after the update — investigate before trusting 0.');
      process.exit(1);
    }
    console.log('\n\u2705 Every phantom close is now quarantined.');
  } finally {
    await prisma.$disconnect();
  }
})();
