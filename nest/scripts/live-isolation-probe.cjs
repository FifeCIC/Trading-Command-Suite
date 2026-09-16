/**
 * live-isolation-probe.cjs — #846. Replay the user's exact scenario against the live API.
 *
 * ⚠️ WHY THIS EXISTS WHEN THERE IS ALREADY A UNIT SPEC
 * ---------------------------------------------------
 * The spec proves the adapter's LOGIC. It cannot prove that the deployed behaviour changed,
 * and the passive before/after check came back INCONCLUSIVE because the app was quiet —
 * only 12 bridge events in 5 minutes, so the breaker was never exercised. Waiting for
 * ambient traffic to test a fix is not verification; it is hope.
 *
 * This drives the condition deliberately, using READ-ONLY endpoints:
 *
 *   1. Hammer `quotes?symbols=EURUSD` (routed to broker 2, whose terminal is disconnected)
 *      until broker 2's breaker trips.
 *   2. Ask for `quotes?symbols=VIX` — routed to broker 3, which is healthy.
 *
 * The user's reported failure was exactly this shape: a VIX order refused because ANOTHER
 * broker's terminal was down. Nothing here places, modifies or cancels an order.
 *
 * ⚠️ The control is the third step: EURUSD (broker 2) must STILL be refused. Without it,
 * an adapter with no breaker at all would pass — and "VIX works" would prove nothing about
 * isolation.
 */
const http = require('http');

const API = 'http://localhost:3201';
const EURUSD = 'EURUSD'; // broker 2 — the broken one
const VIX = 'VIX';       // broker 3 — the one that was collateral damage

function getJson(path, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${API}${path}`, { timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: d.slice(0, 200) }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** How many quotes came back, and how many were silently dropped. */
function summarise(res) {
  const quotes = res.json?.quotes ?? [];
  return { returned: quotes.length, symbols: quotes.map((q) => q.symbol) };
}

(async () => {
  console.log('Live per-broker breaker probe (#846) — read-only');
  console.log('');

  // ── Baseline: both brokers before we interfere ───────────────────────────────────
  const before3 = summarise(await getJson(`/api/providers/mt5/quotes?symbols=${VIX}`));
  console.log(`  baseline VIX    (broker 3): ${before3.returned} quote(s) ${JSON.stringify(before3.symbols)}`);

  // ── Trip broker 2 by hammering its routed symbol ─────────────────────────────────
  console.log('');
  console.log(`  driving ${EURUSD} (broker 2) to trip its breaker...`);
  let tripAt = null;
  for (let i = 1; i <= 14; i++) {
    const r = await getJson(`/api/providers/mt5/quotes?symbols=${EURUSD}`);
    const s = summarise(r);
    if (i === 1 || i === 14 || s.returned === 0) {
      console.log(`     call ${String(i).padStart(2)}: ${s.returned} quote(s)`);
    }
  }

  // ── Now the two observations that decide it ──────────────────────────────────────
  console.log('');
  const b2 = summarise(await getJson(`/api/providers/mt5/quotes?symbols=${EURUSD}`));
  const b3 = summarise(await getJson(`/api/providers/mt5/quotes?symbols=${VIX}`));

  console.log(`  AFTER tripping broker 2:`);
  console.log(`     ${EURUSD.padEnd(7)} (broker 2, terminal DOWN)  -> ${b2.returned} quote(s)`);
  console.log(`     ${VIX.padEnd(7)} (broker 3, terminal UP)    -> ${b3.returned} quote(s)`);
  console.log('');

  console.log('── VERDICT ─────────────────────────────────────────────────────────────');
  if (b2.returned === 0 && b3.returned >= 1) {
    console.log('✅ ISOLATION CONFIRMED LIVE — broker 2 is blocked, broker 3 is NOT.');
    console.log('   This is the user\'s scenario reversed: the VIX path stays open while the');
    console.log('   failing broker is gated. Before the fix, b3 would also be 0.');
  } else if (b2.returned === 0 && b3.returned === 0) {
    console.log('❌ STILL SHARED — both brokers blocked. The fix is not in effect, or the');
    console.log('   process is running a build older than dist/. Check the restart.');
  } else if (b2.returned >= 1 && b3.returned >= 1) {
    console.log('⚠️ INCONCLUSIVE — broker 2 was NOT blocked, so the breaker did not trip and');
    console.log('   isolation was not exercised. Its terminal may have reconnected, or 14');
    console.log('   calls were not enough to reach the threshold.');
  } else {
    console.log('⚠️ UNEXPECTED — broker 2 returned quotes but broker 3 returned none. That is');
    console.log('   the opposite of expected; investigate before concluding anything.');
  }

  console.log('');
  console.log('  Note: a 0-quote result is indistinguishable here between "blocked by the');
  console.log('  breaker" and "the broker had no data". Cross-check with');
  console.log('  `node nest/scripts/breaker-post-fix-check.cjs` to confirm a SKIP was recorded.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
