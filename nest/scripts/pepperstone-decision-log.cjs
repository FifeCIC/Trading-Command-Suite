/**
 * pepperstone-decision-log.cjs — what did the automation loop DECIDE today?
 *
 * WHY THIS AND NOT MORE REASONING
 * -------------------------------
 * The first pass established the configuration:
 *   - all 5 open positions are on broker 2 (account 10011309743)
 *   - broker 3 (Pepperstone) owns only 7 routes, all index/commodity:
 *     UK100, GER40, XAGUSD, VIX, US500, FRA40, US30
 *   - 8 trades DID open today, so the loop ran and could place orders
 *   - `trading_strategy.brokerId` holds the STRING 'mt5', not a broker slot, so the bot
 *     record does not select a broker — routing is decided by `symbol_route` alone
 *
 * That leaves the question "why none of the 7 index bots reached Pepperstone today".
 * `decision_log` is the loop's own record of what it decided and WHY, so it answers this
 * directly, without me inferring from configuration.
 *
 * The blockers the loop can report are specific and named (pacing, broker gate, capacity,
 * no-signal), so the distribution of reasons IS the answer.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// The 7 symbols that route to broker 3. Kept explicit so a route change is visible here.
const BROKER_3_SYMBOLS = ['UK100', 'GER40', 'XAGUSD', 'VIX', 'US500', 'FRA40', 'US30'];

(async () => {
  console.log('Automation decisions today — focus on broker 3 (Pepperstone) symbols');
  console.log('');

  // ── 1. decision_log shape ───────────────────────────────────────────────────────
  const cols = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'decision_log' ORDER BY ORDINAL_POSITION`,
  );
  console.log(`decision_log columns: ${cols.map((c) => c.COLUMN_NAME).join(', ')}`);
  console.log('');

  const total = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM decision_log WHERE timestamp >= UTC_DATE()`,
  );
  console.log(`decision_log rows today: ${total[0].n}`);
  console.log('');

  // ── 2. The distribution of decisions and reasons ────────────────────────────────
  // Whatever the loop is doing, this is what it says it is doing.
  const byDecision = await prisma.$queryRawUnsafe(
    `SELECT decision, COUNT(*) AS n
       FROM decision_log WHERE timestamp >= UTC_DATE()
      GROUP BY decision ORDER BY n DESC`,
  );
  console.log('decisions today:');
  for (const d of byDecision) console.log(`   ${String(d.decision).padEnd(12)} ${d.n}`);
  console.log('');

  const byReason = await prisma.$queryRawUnsafe(
    `SELECT reason, COUNT(*) AS n
       FROM decision_log WHERE timestamp >= UTC_DATE()
      GROUP BY reason ORDER BY n DESC LIMIT 15`,
  );
  console.log('reasons today (most common first):');
  for (const r of byReason) {
    console.log(`   ${String(r.n).padStart(5)}  ${String(r.reason ?? '(null)').slice(0, 130)}`);
  }
  console.log('');

  // ── 3. Did ANY decision mention a broker-3 symbol? ──────────────────────────────
  const placeholders = BROKER_3_SYMBOLS.map(() => '?').join(',');
  const b3 = await prisma.$queryRawUnsafe(
    `SELECT symbol, decision, reason, timestamp AS createdAt
       FROM decision_log WHERE timestamp >= UTC_DATE() AND symbol IN (${placeholders})
      ORDER BY createdAt DESC LIMIT 30`,
    ...BROKER_3_SYMBOLS,
  );
  console.log(`decisions today mentioning a broker-3 symbol: ${b3.length}`);
  if (b3.length === 0) {
    console.log('   ⚠️ ZERO — the loop never even CONSIDERED a broker-3 symbol today.');
    console.log('      That is a different failure from "considered and blocked": it points at');
    console.log('      the symbol never reaching the loop (no bars / not in the queue / not');
    console.log('      subscribed), not at a gate.');
  }
  for (const d of b3.slice(0, 20)) {
    console.log(`   ${new Date(d.createdAt).toISOString()} ${String(d.symbol).padEnd(8)} ${String(d.decision).padEnd(10)} ${String(d.reason ?? '').slice(0, 100)}`);
  }
  console.log('');

  // ── 4. Which symbols DID reach the loop today? ──────────────────────────────────
  const seen = await prisma.$queryRawUnsafe(
    `SELECT symbol, COUNT(*) AS n, SUM(CASE WHEN decision='EXECUTED' THEN 1 ELSE 0 END) AS executed FROM decision_log WHERE timestamp >= UTC_DATE()
      GROUP BY symbol ORDER BY n DESC`,
  );
  console.log('symbols the loop considered today:');
  for (const s of seen) {
    const isB3 = BROKER_3_SYMBOLS.includes(String(s.symbol).toUpperCase());
    console.log(`   ${String(s.symbol).padEnd(8)} considered=${String(s.n).padStart(4)} executed=${String(s.executed).padStart(3)}${isB3 ? '   <-- broker 3' : ''}`);
  }
  console.log('');

  // ── 5. Do broker-3 symbols even have fresh bars? ────────────────────────────────
  // If there are no bars, nothing can score, and the symbol never reaches the queue.
  // This distinguishes "gate blocked it" from "no data to act on".
  const bars = await prisma.$queryRawUnsafe(
    `SELECT sy.ticker,
            COUNT(*) AS bar_count,
            MAX(mb.timestamp) AS newest
       FROM marketbar mb
       JOIN symbol sy ON sy.id = mb.symbolId
      WHERE sy.ticker IN (${placeholders})
      GROUP BY sy.ticker ORDER BY newest DESC`,
    ...BROKER_3_SYMBOLS,
  );
  console.log('bars available for broker-3 symbols:');
  const nowMs = Date.now();
  if (bars.length === 0) {
    console.log('   ⚠️ NONE of the 7 broker-3 symbols has ANY bars — nothing can score.');
  }
  for (const b of bars) {
    const ageH = b.newest ? ((nowMs - new Date(b.newest).getTime()) / 3600000).toFixed(1) : 'n/a';
    console.log(`   ${String(b.ticker).padEnd(8)} bars=${String(b.bar_count).padStart(6)} newest=${b.newest ? new Date(b.newest).toISOString() : 'null'} (${ageH}h old)`);
  }
  const withBars = bars.map((b) => b.ticker);
  const missing = BROKER_3_SYMBOLS.filter((s) => !withBars.includes(s));
  if (missing.length) console.log(`   symbols with NO bars at all: ${missing.join(', ')}`);
  console.log('');

  // ── 6. Are the broker-3 symbols in the SIGNAL QUEUE? ────────────────────────────
  const queue = await prisma.$queryRawUnsafe(
    `SELECT symbol, status, COUNT(*) AS n FROM strategy_signal_queue
      WHERE symbol IN (${placeholders}) GROUP BY symbol, status ORDER BY symbol`,
    ...BROKER_3_SYMBOLS,
  );
  console.log('strategy_signal_queue for broker-3 symbols:');
  if (queue.length === 0) console.log('   (nothing queued for any of them)');
  for (const q of queue) console.log(`   ${String(q.symbol).padEnd(8)} status=${String(q.status).padEnd(10)} n=${q.n}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
