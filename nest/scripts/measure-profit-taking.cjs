/**
 * measure-profit-taking.cjs — are the bots using profit-taking or trailing stops?
 *
 * THE QUESTION IS "ACTIVE OR MERELY REACHABLE?"
 * --------------------------------------------
 * The codebase contains several profit-taking mechanisms:
 *   - a static broker-side TP set at entry (`automation-loop` computes tp from `tpPct`)
 *   - `StopGuardianService` — directive-consensus TRAILING stop management
 *   - `risk.service.ts` — TakeProfitType incl. 'trailing-atr', updateTrailingStop()
 *   - `trading-strategy.service.ts` — `useTrailingStop = mode === 'auto'` bracket orders
 *
 * Only the first is on the path that actually places orders. `trading-strategy.service.ts`
 * holds the richest trailing logic and its `execute()` is reachable only from
 * `evaluateAllActive()`, which has ZERO callers (#843). So the trailing code there is DEAD,
 * and saying "the bots trail stops" on the strength of that file would be wrong.
 *
 * This measures what is configured and what actually happened, rather than what exists.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Profit-taking / trailing — configured vs actually used');
  console.log('');

  // ── 1. What each active bot is CONFIGURED with ──────────────────────────────────
  const strats = await prisma.$queryRawUnsafe(
    `SELECT id, name, symbol, mode, slPct, tpPct, maxHoldHours, active
       FROM trading_strategy
      WHERE active = 1
      ORDER BY name`,
  );
  console.log(`active bots: ${strats.length}`);
  console.log('  name                              symbol   mode    slPct  tpPct  maxHold');
  for (const s of strats) {
    console.log(
      `  ${String(s.name).padEnd(33)} ${String(s.symbol).padEnd(8)} ${String(s.mode).padEnd(7)} ` +
        `${String(s.slPct).padStart(5)}  ${String(s.tpPct).padStart(5)}  ${s.maxHoldHours ?? '-'}`,
    );
  }
  const withTp = strats.filter((s) => s.tpPct !== null && Number(s.tpPct) > 0).length;
  console.log('');
  console.log(`  bots with tpPct > 0: ${withTp}/${strats.length}`);
  console.log('  ⚠️ tpPct sets a broker-side TAKE PROFIT at entry. It is a fixed target, not a');
  console.log('     trail: nothing moves it after the order is placed.');
  console.log('');

  // ── 2. Do the LIVE bot positions actually carry sl/tp? ──────────────────────────
  const openBotTrades = await prisma.$queryRawUnsafe(
    `SELECT symbol, brokerTicket, sl, tp, origin, strategy, scoringStrategyId, openedAt
       FROM trade
      WHERE status = 'open' AND origin IN ('strategy','agent')
      ORDER BY openedAt DESC`,
  );
  console.log(`open bot TRADES: ${openBotTrades.length}`);
  for (const t of openBotTrades) {
    console.log(
      `  ${String(t.symbol).padEnd(8)} ticket=${String(t.brokerTicket ?? '-').padEnd(12)} ` +
        `sl=${t.sl ?? 'NULL'} tp=${t.tp ?? 'NULL'} scoringStrategyId=${t.scoringStrategyId ?? '-'}`,
    );
  }
  const missingTp = openBotTrades.filter((t) => t.tp === null).length;
  const missingSl = openBotTrades.filter((t) => t.sl === null).length;
  console.log('');
  console.log(`  bot trades with NO tp recorded: ${missingTp}/${openBotTrades.length}`);
  console.log(`  bot trades with NO sl recorded: ${missingSl}/${openBotTrades.length}`);
  console.log('');

  // ── 3. Has ANY stop ever been ADJUSTED? (the trailing mechanism's signature) ────
  // `StopGuardianService` records adjustments. If there is no ledger table, the honest
  // answer is that the effect is unobservable rather than that it never happened.
  const tables = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND (TABLE_NAME LIKE '%stop%' OR TABLE_NAME LIKE '%guardian%'
             OR TABLE_NAME LIKE '%adjust%' OR TABLE_NAME LIKE '%trail%')`,
  );
  console.log(`tables that could hold stop adjustments: ${tables.length}`);
  for (const t of tables) console.log(`  ${t.TABLE_NAME}`);
  if (tables.length === 0) {
    console.log('  (none — so a trailing adjustment leaves NO durable record; effect unobservable)');
  }
  console.log('');

  // ── 4. Did any bot trade CLOSE at a profit, and was TP the reason? ──────────────
  const closes = await prisma.$queryRawUnsafe(
    `SELECT symbol, pnl, status, origin, openedAt, closedAt
       FROM trade
      WHERE status = 'closed' AND origin IN ('strategy','agent')
      ORDER BY closedAt DESC LIMIT 15`,
  );
  console.log(`recent CLOSED bot trades: ${closes.length}`);
  for (const c of closes) {
    const held = c.closedAt && c.openedAt
      ? Math.round((new Date(c.closedAt) - new Date(c.openedAt)) / 60000)
      : null;
    console.log(
      `  ${String(c.symbol).padEnd(8)} pnl=${String(c.pnl ?? 'NULL').padStart(8)} ` +
        `held=${held === null ? '-' : held + 'min'}`,
    );
  }
  console.log('');

  // ── 5. Is the time-stop the thing actually closing them? ────────────────────────
  // `PositionTimeStopService` was visible in test logs closing positions on a hold limit.
  // If hold times cluster at maxHoldHours, the EXIT rule in practice is the time stop —
  // not profit-taking. That is the discriminator worth checking.
  if (closes.length) {
    const held = closes
      .filter((c) => c.closedAt && c.openedAt)
      .map((c) => Math.round((new Date(c.closedAt) - new Date(c.openedAt)) / 60000));
    if (held.length) {
      const avg = Math.round(held.reduce((a, b) => a + b, 0) / held.length);
      console.log(`  average hold of closed bot trades: ${avg} min`);
      console.log('  Compare against each bot\'s maxHoldHours (printed above). If the holds');
      console.log('  cluster at the limit, the effective exit rule is the TIME STOP.');
    }
  }

  console.log('');
  console.log('── WHAT TO READ FROM THIS ──────────────────────────────────────────────');
  console.log('  A fixed tpPct at entry IS a profit-taking rule. It is not a trailing stop.');
  console.log('  Trailing requires MOVING the stop after entry, and that only exists in');
  console.log('  StopGuardianService (default enabled:false) and in dead code in');
  console.log('  trading-strategy.service.ts. Check whether the guardian is actually RUNNING');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
