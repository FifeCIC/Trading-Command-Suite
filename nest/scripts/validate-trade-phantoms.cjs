#!/usr/bin/env node
/**
 * validate-trade-phantoms.cjs — LOUD GUARD: a "closed" trade with no fill must not read as valid (#931).
 * ======================================================================================================
 *
 * ONE question, asked of the LIVE database:
 *
 *     COUNT(*) FROM trade
 *      WHERE status='closed' AND brokerTicket IS NULL AND exitPrice IS NULL AND pnlInvalid = 0
 *
 * Non-zero → exit 1, names the rows, points at the repair command.
 *
 * WHY A LIVE GUARD AND NOT A STATIC CHECK
 * ---------------------------------------
 * The defect class is DATA, not code: 99 phantom closes (48% of all rows) were
 * bulk reconciler artefacts, and the one-off quarantine that caught 82 used a
 * DATE WINDOW ("pre-2026-09-10") — so the batch that ran ON 2026-09-10 (17
 * rows) escaped and USDCAD's "20 trades / 15% wins" was really "3 trades /
 * 3 wins". A predicate that lives in a script nothing runs is how that
 * happened; this guard is the thing that runs.
 *
 * Pair: `quarantine-phantom-closes.cjs --apply` performs the repair this
 * guard tells you to run. Nothing here writes to the trade record — the
 * canary verifies it can make its own edit and removes it again, or refuses
 * to report (CANARY INVALID), never a false OK.
 *
 * Usage:
 *   node nest/scripts/validate-trade-phantoms.cjs           # guard: exit 1 on unflagged phantoms
 *   node nest/scripts/validate-trade-phantoms.cjs --canary  # prove the guard bites: insert → fail → remove → pass
 */

const { randomUUID } = require('crypto');

const CANARY = process.argv.includes('--canary');

// Shared with quarantine-phantom-closes.cjs — ONE definition, in nest/scripts/lib (#931).
const { loadEnv, PREDICATE } = require('./lib/phantom-predicate.cjs');

loadEnv();

(async () => {
  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    console.error(`\n\u274c Cannot reach the database: ${err.message.split('\n')[0]}`);
    console.error('   A verifier that cannot read its input must ERROR, never pass.');
    process.exit(1);
  }

  const count = async () => {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM trade WHERE ${PREDICATE}`);
    return Number(rows[0].n);
  };

  try {
    if (!CANARY) {
      const n = await count();
      if (n === 0) {
        console.log('\u2705 trade phantoms: none unflagged (predicate: closed with no brokerTicket and no exitPrice).');
        return;
      }
      console.error(`\n\u274c ${n} phantom close(s) read as VALID — every win-rate or payoff query over status='closed' currently counts them.`);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, symbol, closedAt FROM trade WHERE ${PREDICATE} ORDER BY closedAt LIMIT 10`,
      );
      for (const r of rows) {
        console.error(`   ${r.id}  ${r.symbol}  closedAt=${new Date(r.closedAt).toISOString()}`);
      }
      console.error('\n   Repair:  node nest/scripts/quarantine-phantom-closes.cjs --apply');
      process.exit(1);
    }

    // ── --canary: prove the guard bites, or refuse to report ────────────────────────────────────
    const real = await count();
    if (real !== 0) {
      console.error(`CANARY INVALID — the guard is already failing on ${real} real row(s); fix those first,`);
      console.error('then re-run the canary so a pass means the canary was the only cause.');
      process.exit(2);
    }

    const id = randomUUID();
    let inserted = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO trade (id, symbol, side, quantity, entryPrice, status, provider, origin, closedAt, pnl)
         VALUES (?, 'CANARY931', 'buy', 0, 0, 'closed', 'canary', 'system', UTC_TIMESTAMP(3), 0)`,
        id,
      );
      const landed = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM trade WHERE id = ?`,
        id,
      );
      inserted = Number(landed[0].n) === 1;
      if (!inserted) {
        console.error('CANARY INVALID — the canary row could not be inserted; the guard was NOT exercised.');
        process.exit(2);
      }

      const nWithCanary = await count();
      if (nWithCanary < 1) {
        console.error('CANARY INVALID — a phantom exists but the guard did not see it.');
        process.exit(2);
      }
      console.log(`canary: guard correctly FAILED with the canary present (count=${nWithCanary}).`);
    } finally {
      if (inserted) {
        await prisma.$executeRawUnsafe(`DELETE FROM trade WHERE id = ?`, id);
      }
    }

    const left = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM trade WHERE id = ?`, id);
    if (Number(left[0].n) !== 0) {
      console.error('CANARY INVALID — could not remove the canary row; leaving it is worse than no canary.');
      process.exit(2);
    }
    const nAfter = await count();
    if (nAfter !== 0) {
      console.error(`CANARY INVALID — count is ${nAfter} after removing the canary; something else changed.`);
      process.exit(2);
    }
    console.log('\u2705 CANARY OK — guard fails with a phantom present, passes after removal.');
  } finally {
    await prisma.$disconnect();
  }
})();
