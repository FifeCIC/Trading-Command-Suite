/**
 * why-no-pepperstone-trades.cjs — the user reports no trades on Pepperstone today,
 * while "MT5" shows 5 positions.
 *
 * ORIENTATION (establish first, assume nothing)
 * --------------------------------------------
 *   broker 2 :5000 MetaQuotes-Demo    account 10011309743
 *   broker 3 :5001 PepperstoneUK-Demo account 62135531
 *
 * "MT5 has 5" almost certainly means the 5 MT5-provider rows in `position`. The question is
 * whether those 5 sit on broker 2, and if so WHY nothing lands on broker 3.
 *
 * The candidate causes, each separately checkable — this script measures all of them
 * rather than picking the most plausible:
 *
 *   A. ROUTING     — `symbol_route` sends every traded symbol to broker 2, so no bot can
 *                    reach broker 3 in the first place. (A configuration fact, not a failure.)
 *   B. BOT CONFIG  — bots carry a `brokerId`; if they all say 2, the automation loop targets
 *                    broker 2 by design.
 *   C. BROKER GATE — `state.brokerStates[3].tradingEnabled` may be false, which the loop
 *                    reports as "broker 3 tradingEnabled=false (layer ON)" and skips.
 *   D. CAPACITY    — the global gate `MT5_MAX_OPEN_POSITIONS` is 5 and exactly 5 are open,
 *                    so nothing new opens anywhere. This would explain "no trades at all"
 *                    and is the cheapest thing to rule in or out.
 *   E. SYMBOL      — Pepperstone's symbols are not subscribed/scored, so no signal is
 *                    produced for anything it holds.
 *
 * ⚠️ D is the one that would make the question misleading: if the GLOBAL limit is already
 * full, then "no Pepperstone trades" is not a Pepperstone problem at all.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

const BROKER_2 = 2;
const BROKER_3 = 3;

function getJson(path, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:3201${path}`, { timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  console.log('Why no Pepperstone (broker 3) trades today?');
  console.log('');

  // ── Orient: where are the 5 MT5 positions actually held? ────────────────────────
  const pos = await prisma.$queryRawUnsafe(
    `SELECT symbol, side, quantity, accountId, provider, brokerTicket, openedAt
       FROM position WHERE provider = 'mt5' ORDER BY openedAt DESC`,
  );
  console.log(`MT5-provider positions in the position table: ${pos.length}`);
  for (const p of pos) {
    console.log(
      `  ${String(p.symbol).padEnd(8)} ${String(p.side ?? '-').padEnd(5)} qty=${String(p.quantity).padEnd(6)} ` +
        `accountId=${p.accountId ?? 'NULL'} ticket=${p.brokerTicket ?? '-'}`,
    );
  }
  const accounts = [...new Set(pos.map((p) => p.accountId))];
  console.log(`  accountId(s) present: ${accounts.map((a) => a ?? 'NULL').join(', ')}`);
  console.log('');

  // ── A. Routing: which broker does each traded symbol resolve to? ─────────────────
  const routes = await prisma.$queryRawUnsafe(
    `SELECT brokerId, COUNT(*) AS n FROM symbol_route GROUP BY brokerId ORDER BY n DESC`,
  );
  console.log('A. symbol_route distribution by brokerId:');
  for (const r of routes) console.log(`     broker ${r.brokerId}: ${r.n} route(s)`);
  const routesB3 = await prisma.$queryRawUnsafe(
    `SELECT symbol, brokerSymbol, enabled FROM symbol_route WHERE brokerId = ?`,
    BROKER_3,
  );
  console.log(`     broker 3 routes: ${routesB3.map((r) => `${r.symbol}(enabled=${r.enabled})`).join(', ') || '(none)'}`);
  console.log('');

  // ── B. Bot config: which broker do the active bots target? ──────────────────────
  const bots = await prisma.$queryRawUnsafe(
    `SELECT brokerId, COUNT(*) AS n, GROUP_CONCAT(symbol) AS symbols
       FROM trading_strategy WHERE active = 1 GROUP BY brokerId ORDER BY n DESC`,
  );
  console.log('B. active bots by brokerId:');
  for (const b of bots) {
    console.log(`     brokerId=${b.brokerId}  ${b.n} bot(s)`);
  }
  console.log('');

  // ── D. Capacity: is the GLOBAL gate already full? ───────────────────────────────
  const openM = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM trade WHERE status = 'open'`,
  );
  console.log(`D. open trades in DB: ${openM[0].n}`);
  console.log('     (the loop gate compares LIVE broker positions, not this — see /diagnostics)');
  console.log('');

  // ── Today's trades by broker/account ────────────────────────────────────────────
  const today = await prisma.$queryRawUnsafe(
    `SELECT provider, origin, COUNT(*) AS n, MIN(openedAt) AS first, MAX(openedAt) AS last
       FROM trade
      WHERE openedAt >= UTC_DATE()
      GROUP BY provider, origin ORDER BY n DESC`,
  );
  console.log("trades opened today (UTC) by provider/origin:");
  if (today.length === 0) console.log('     (none at all today)');
  for (const t of today) {
    console.log(`     provider=${String(t.provider).padEnd(12)} origin=${String(t.origin).padEnd(9)} n=${t.n}`);
  }
  console.log('');

  // ── C. Broker-level trading gate, from the live automation state ────────────────
  console.log('C. live automation state (broker gates):');
  try {
    const s = await getJson('/api/automation/status');
    if (!s) {
      console.log('     (no /api/automation/status payload)');
    } else {
      console.log(`     tradingEnabled (layer): ${s.tradingEnabled}`);
      const bs = s.brokerStates ?? s.state?.brokerStates ?? {};
      for (const [id, v] of Object.entries(bs)) {
        console.log(`     brokerStates[${id}].tradingEnabled = ${v?.tradingEnabled}`);
      }
      if (Object.keys(bs).length === 0) console.log('     ⚠️ brokerStates EMPTY — every broker would be treated as OFF');
    }
  } catch (e) {
    console.log(`     failed: ${e.message}`);
  }
  console.log('');

  // ── Decisive: what did the loop DECIDE today? ───────────────────────────────────
  // The loop writes decisions; those name the blocking rule. This is the observation that
  // distinguishes A/B/C/D/E without needing to reason about them.
  const tables = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE '%audit%' OR TABLE_NAME LIKE '%decision%')`,
  );
  console.log(`decision/audit tables: ${tables.map((t) => t.TABLE_NAME).join(', ') || '(none)'}`);
  for (const t of tables) {
    if (t.TABLE_NAME === 'decision_trail') continue; // scored-signal trail, not the loop
    const cols = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, t.TABLE_NAME,
    );
    const names = cols.map((c) => c.COLUMN_NAME);
    const hasCreated = names.includes('createdAt');
    if (!hasCreated) continue;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM \`${t.TABLE_NAME}\` WHERE createdAt >= UTC_DATE()`,
    );
    console.log(`  ${t.TABLE_NAME}: ${rows[0].n} row(s) today`);
  }
  console.log('');

  console.log('── HOW TO READ THIS ────────────────────────────────────────────────────');
  console.log('  If A shows every route on broker 2 and B shows every bot on brokerId 2,');
  console.log('  then Pepperstone is not "failing" — nothing is configured to trade it.');
  console.log('  Check C: if brokerStates is empty or broker 3 is false, that is the block.');
  console.log('  Check D: a full global position gate stops ALL brokers, which would make the');
  console.log('  question "why no Pepperstone trades" the wrong question.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
