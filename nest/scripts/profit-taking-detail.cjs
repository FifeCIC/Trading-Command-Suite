/**
 * profit-taking-detail.cjs — has trailing ACTUALLY adjusted any stop?
 *
 * WHY THIS IS THE DECISIVE MEASUREMENT
 * ------------------------------------
 * Code existing is not evidence. There are three trailing implementations in this repo and
 * they sit on different paths:
 *
 *   1. `StopGuardianService` (automation) — LIVE-adjacent: started by the automation loop
 *      (#721) and writes a `stop_adjustment` row for every change.
 *   2. `trading-strategy.service.ts` — `useTrailingStop = mode === 'auto'`, bracket orders
 *      with a trail. Its `execute()` is reachable only from `evaluateAllActive()`, which has
 *      ZERO callers (#843). That code is on a path nothing calls.
 *   3. `risk.service.ts` — `TakeProfitType` incl. 'trailing-atr', `updateTrailingStop()`.
 *      Need to check whether any caller passes those types.
 *
 * `stop_adjustment` is the ledger the guardian writes to. **An empty ledger is the answer**:
 * the mechanism exists and has never run. A non-empty one tells us the trailing works, and
 * lets me check whether the stops actually moved in the profitable direction.
 *
 * ⚠️ Careful with the "it adjusted" -> "it works" step: an adjustment that moves the stop
 * the WRONG WAY is a widening of risk, not trailing. So I check the direction against the
 * position's side rather than just counting rows.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Trailing-stop / profit-taking ledger');
  console.log('');

  // ── 1. Has the guardian EVER written an adjustment? ─────────────────────────────
  const count = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n, MIN(adjustedAt) AS first, MAX(adjustedAt) AS last
       FROM stop_adjustment`,
  );
  const n = Number(count[0].n) || 0;
  console.log(`stop_adjustment rows: ${n}`);
  if (n > 0) {
    console.log(`   first=${new Date(count[0].first).toISOString()}`);
    console.log(`   last =${new Date(count[0].last).toISOString()}`);
  }
  console.log('');

  if (n === 0) {
    console.log('⚠️  THE LEDGER IS EMPTY. `StopGuardianService` writes a row for every change,');
    console.log('   so an empty table means it has NEVER adjusted a stop. The trailing');
    console.log('   mechanism exists but has not run — reachable, not active.');
    console.log('   (Careful: also confirm the guardian is actually STARTED — an empty ledger');
    console.log('    is consistent with "stopped" as well as "ran and found nothing to do".)');
    console.log('');
  } else {
    const recent = await prisma.$queryRawUnsafe(
      `SELECT symbol, tradeTicket, oldSl, newSl, oldTp, newTp, reason, adjustedAt
         FROM stop_adjustment ORDER BY adjustedAt DESC LIMIT 20`,
    );
    console.log('  most recent adjustments:');
    for (const r of recent) {
      console.log(
        `    ${String(r.symbol).padEnd(8)} ticket=${String(r.tradeTicket).padEnd(12)} ` +
          `sl ${r.oldSl ?? 'null'} -> ${r.newSl ?? 'null'}  tp ${r.oldTp ?? 'null'} -> ${r.newTp ?? 'null'}`,
      );
      console.log(`        reason=${String(r.reason).slice(0, 110)}`);
    }
    console.log('');

    // ── Direction check: did the stop move in the SAFE direction? ─────────────────
    // For a BUY, a trailing stop only ever RISES. For a SELL, it only ever FALLS.
    // A stop that moves the other way is risk widening, which is the opposite of trailing.
    const bySymbol = await prisma.$queryRawUnsafe(
      `SELECT sa.symbol, COUNT(*) AS adjustments,
              SUM(CASE WHEN t.side = 'buy'  AND sa.newSl > sa.oldSl THEN 1
                       WHEN t.side = 'sell' AND sa.newSl < sa.oldSl THEN 1
                       ELSE 0 END) AS tightened,
              SUM(CASE WHEN t.side = 'buy'  AND sa.newSl < sa.oldSl THEN 1
                       WHEN t.side = 'sell' AND sa.newSl > sa.oldSl THEN 1
                       ELSE 0 END) AS widened
         FROM stop_adjustment sa
         LEFT JOIN trade t ON t.brokerTicket = sa.tradeTicket
        GROUP BY sa.symbol ORDER BY adjustments DESC`,
    );
    console.log('  direction of movement (tightened = stop moved in the trader\'s favour):');
    let totalWidened = 0;
    for (const r of bySymbol) {
      totalWidened += Number(r.widened) || 0;
      console.log(
        `    ${String(r.symbol).padEnd(8)} adjustments=${String(r.adjustments).padStart(4)} ` +
          `tightened=${String(r.tightened).padStart(4)} widened=${String(r.widened).padStart(4)}`,
      );
    }
    console.log('');
    if (totalWidened > 0) {
      console.log(`  ⚠️ ${totalWidened} adjustment(s) WIDENED the stop — that increases risk rather`);
      console.log('     than trailing it. Worth a look on its own.');
    } else {
      console.log('  All adjustments tightened. That is trailing behaving correctly.');
    }
    console.log('  ⚠️ Note: rows joined to no trade (side unknown) are counted in neither');
    console.log('     direction, so the two columns may not sum to `adjustments`.');
  }
  console.log('');

  // ── 2. Is the guardian RUNNING right now? ───────────────────────────────────────
  console.log('  (guardian running state is in-memory — check the API, not the DB)');
  console.log('');

  // ── 3. Static TP: did any closed bot trade exit AT its TP? ──────────────────────
  // If exits land short of TP, the fixed target is not what closes them — the time stop
  // or a manual close is. That distinguishes "has a profit rule" from "uses it".
  const closed = await prisma.$queryRawUnsafe(
    `SELECT t.symbol, t.pnl, t.sl, t.tp, t.entryPrice, t.exitPrice, t.side,
            t.openedAt, t.closedAt
       FROM trade t
      WHERE t.status = 'closed' AND t.origin IN ('strategy','agent')
        AND t.tp IS NOT NULL AND t.entryPrice IS NOT NULL
      ORDER BY t.closedAt DESC LIMIT 25`,
  );
  if (closed.length) {
    let atTp = 0;
    let shortOfTp = 0;
    const overshoot = [];
    for (const c of closed) {
      const isBuy = String(c.side).toLowerCase() === 'buy';
      const tp = Number(c.tp);
      const exit = c.exitPrice === null ? null : Number(c.exitPrice);
      if (exit === null) continue;
      // "Reached TP" = the exit is at or beyond the target for the direction.
      const reached = isBuy ? exit >= tp - Math.abs(tp) * 0.0005 : exit <= tp + Math.abs(tp) * 0.0005;
      if (reached) atTp += 1;
      else {
        shortOfTp += 1;
        const marginalPct = ((exit - Number(c.entryPrice)) / Number(c.entryPrice)) * 100;
        overshoot.push({ symbol: c.symbol, pnl: c.pnl, movePct: marginalPct.toFixed(3) });
      }
    }
    console.log(`  closed bot trades with a TP set: ${closed.length}`);
    console.log(`     exit at/beyond TP : ${atTp}`);
    console.log(`     exit short of TP  : ${shortOfTp}`);
    if (shortOfTp > atTp) {
      console.log('');
      console.log('  ⚠️ Most exits are SHORT of the configured TP, so the fixed target is not');
      console.log('     what closes these trades. Something else does — most likely the position');
      console.log('     TIME STOP (maxHoldHours) or a manual close. Having a TP configured is');
      console.log('     therefore not the same as taking profit at it.');
      console.log('     A few examples of where they actually exited:');
      for (const o of overshoot.slice(0, 6)) {
        console.log(`        ${String(o.symbol).padEnd(8)} pnl=${String(o.pnl).padStart(8)}  moved ${o.movePct}% from entry`);
      }
    }
  } else {
    console.log('  (no closed bot trades with a TP to compare against)');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
