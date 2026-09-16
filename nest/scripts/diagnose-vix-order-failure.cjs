/**
 * diagnose-vix-order-failure.cjs — why was signal 507f7e90 blocked with
 * "Bridge unreachable (circuit breaker active)"?
 *
 * READ-ONLY. No writes, no broker calls.
 *
 * The hypotheses to TEST (not assume):
 *   H1. VIX routes to the bridge whose terminal is disconnected (broker 2 /
 *       MetaQuotes, :5000), so the failure is genuinely about THAT broker.
 *   H2. The circuit breaker is GLOBAL — one boolean on the adapter — so errors from
 *       the disconnected bridge block orders on the healthy one. If true, an order
 *       for a symbol routed to the HEALTHY broker would also be refused, which is
 *       the discriminator: H1 predicts per-broker blocking, H2 predicts global.
 *   H3. The symbol is not tradable on the route, i.e. the failure is not transport.
 *
 * The decisive measurement is the ADAPTER's own state and the route table. It must be
 * checked against the running system, not read from the code, because the breaker is
 * in-memory and only the live process knows whether it is tripped.
 */
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: d.slice(0, 300) }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  console.log('VIX order failure diagnosis');
  console.log('');

  // ── 1. The symbol route: which broker serves VIX? ────────────────────────────────
  // ⚠️ `symbol_route` keys by the TICKER STRING (`symbol`), not a `symbolId` FK —
  // unlike `signal`, which has `symbolId`. Six `Unknown column` errors this session
  // came from recalling a column name; `introspect-columns.cjs` is the fix.
  const routes = await prisma.$queryRawUnsafe(
    `SELECT id, provider, brokerId, brokerSymbol, priority, enabled, note
       FROM symbol_route
      WHERE symbol = 'VIX'
      ORDER BY brokerId`,
  );
  console.log(`symbol_route for VIX: ${routes.length} row(s)`);
  for (const r of routes) {
    console.log(`   brokerId=${r.brokerId} provider=${r.provider} brokerSymbol=${r.brokerSymbol} enabled=${r.enabled}`);
  }
  if (routes.length === 0) console.log('   (none — VIX may resolve via the default route)');
  console.log('');

  // ── 2. Bridge health per broker, from the bridges themselves ─────────────────────
  console.log('bridge health (measured, not assumed):');
  const bridges = [];
  for (const [brokerId, port, label] of [[2, 5000, 'MetaQuotes-Demo'], [3, 5001, 'PepperstoneUK-Demo']]) {
    try {
      const { json } = await getJson(`http://localhost:${port}/health`);
      bridges.push({ brokerId, port, label, up: true, connected: json?.connected === true, offset: json?.serverUtcOffsetSeconds });
      console.log(`   broker ${brokerId} :${port} (${label}) UP connected=${json?.connected} offsetSec=${json?.serverUtcOffsetSeconds}`);
    } catch (e) {
      bridges.push({ brokerId, port, label, up: false });
      console.log(`   broker ${brokerId} :${port} (${label}) DOWN — ${e.message}`);
    }
  }
  console.log('');

  // ── 3. The ADAPTER's live breaker state — only the running process knows ─────────
  console.log('adapter state (from the running API):');
  try {
    const { status, json, raw } = await getJson('http://localhost:3201/api/providers/health');
    if (json) {
      const s = JSON.stringify(json);
      console.log(`   /api/providers/health -> ${status}`);
      console.log(`   ${s.length > 700 ? s.slice(0, 700) + ' …' : s}`);
    } else {
      console.log(`   /api/providers/health -> ${status} (non-JSON) ${raw ?? ''}`);
    }
  } catch (e) {
    console.log(`   /api/providers/health unreachable: ${e.message}`);
  }
  console.log('');

  // ── 4. The signal itself ─────────────────────────────────────────────────────────
  const signal = await prisma.$queryRawUnsafe(
    `SELECT s.id, s.status, s.createdAt, s.decision, s.reason,
            sy.ticker
       FROM signal s
       LEFT JOIN symbol sy ON sy.id = s.symbolId
      WHERE s.id = '507f7e90-7611-4cf4-ab81-a55fd7acd84c'`,
  ).catch(() => null);

  if (signal && signal.length) {
    console.log('signal row:');
    for (const s of signal) {
      console.log(`   ticker=${s.ticker} status=${s.status} decision=${s.decision}`);
      console.log(`   createdAt=${s.createdAt}`);
      console.log(`   reason=${String(s.reason ?? '').slice(0, 300)}`);
    }
  } else {
    console.log("signal 507f7e90 not found in `signal` — checking the queue/outcome tables");
    const alt = await prisma.$queryRawUnsafe(
      `SELECT id, strategyId, symbol, status, createdAt FROM strategy_signal_queue
        WHERE id = '507f7e90-7611-4cf4-ab81-a55fd7acd84c'`,
    ).catch(() => []);
    for (const a of alt) console.log(`   queue: ${JSON.stringify(a)}`);
    if (!alt.length) console.log('   (not in strategy_signal_queue either)');
  }
  console.log('');

  // ── 5. Recent bridge diagnostics — what actually errored, and for which broker ───
  const recent = await prisma.$queryRawUnsafe(
    `SELECT eventType, account, server, errorMessage, createdAt
       FROM bridge_event
      WHERE createdAt > UTC_TIMESTAMP() - INTERVAL 6 HOUR
      ORDER BY createdAt DESC LIMIT 20`,
  ).catch(() => null);

  if (recent) {
    console.log(`recent bridge_event rows (6h): ${recent.length}`);
    for (const r of recent.slice(0, 15)) {
      console.log(`   ${new Date(r.createdAt).toISOString()} ${r.eventType} acct=${r.account ?? '-'} — ${String(r.errorMessage ?? '').slice(0, 120)}`);
    }
  } else {
    console.log('(no bridge_event table / query failed)');
  }

  console.log('');
  console.log('── VERDICT ─────────────────────────────────────────────────────────────');
  const down = bridges.filter((b) => !b.up || !b.connected);
  const up = bridges.filter((b) => b.up && b.connected);
  console.log(`bridges reachable-but-disconnected or down: ${down.map((b) => b.brokerId).join(', ') || 'none'}`);
  console.log(`bridges healthy:                           ${up.map((b) => b.brokerId).join(', ') || 'none'}`);
  console.log('');
  if (down.length && up.length) {
    console.log('⚠️ MIXED BRIDGE STATE, and the circuit breaker is a SINGLE GLOBAL BOOLEAN');
    console.log('   (mt5.adapter.ts: this.tripped / this.consecutiveErrors are not per-broker).');
    console.log('   So errors from the unhealthy bridge trip the breaker for ALL routes, and');
    console.log('   orders on the HEALTHY broker are refused with "circuit breaker active".');
    console.log('   Confirm: an order for a symbol routed to the healthy broker should also fail.');
  } else if (down.length) {
    console.log('ALL bridges unhealthy — the failure is a genuine outage, not attribution.');
  } else {
    console.log('All bridges healthy NOW. The breaker is in-memory with a 60s cooldown, so it');
    console.log('has since self-released — the failure was transient. Check bridge_event for what');
    console.log('tripped it and for which broker.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
