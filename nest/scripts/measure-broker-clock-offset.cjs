/**
 * measure-broker-clock-offset.cjs — is the future-lead explained by the TICK-LAG
 * bias in `detect_server_utc_offset()`?
 *
 * THE HYPOTHESIS (must be tested, not assumed)
 * --------------------------------------------
 * `scripts/mt5-bridge/mt5_bridge_v2.py` derives the broker's UTC offset from the
 * ONE pair of clocks readable at once:
 *
 *     SERVER_UTC_OFFSET_SECONDS = int(round((tick.time - now) / 900.0) * 900)
 *
 * `tick.time` is the timestamp of the **last tick**, not of the current instant.
 * So the expression measures:
 *
 *     (true_UTC + server_offset) - true_UTC_now  =  server_offset - tick_age
 *
 * i.e. it UNDERESTIMATES the offset by the tick age. The 15-minute rounding is
 * there to absorb tick lag, but it only absorbs lag below 7.5 minutes. Any
 * quieter symbol loses more than that, and the residue becomes a FUTURE lead:
 *
 *     utc_iso(epoch) = (true_UTC + offset) - measured_offset
 *                    = true_UTC + (offset - measured_offset)
 *                    = true_UTC + tick_age_rounding_error
 *
 * Measured leads on position.openedAt / trade.closedAt were 4–14 min — all
 * below one 15-minute step, which is what this hypothesis predicts.
 *
 * WHAT THIS SCRIPT MEASURES
 * -------------------------
 * For each queried symbol, the three raw numbers that decide it:
 *   - tick.time as a true-UTC instant (using the bridge's own arithmetic)
 *   - tick age in seconds at the moment of measurement
 *   - the offset the bridge's formula WOULD derive from that tick
 * and then it reports the implied future lead, so the hypothesis is confirmed or
 * refuted by arithmetic rather than by a plausible story.
 *
 * It does NOT write anything and does NOT call the broker.
 */
const http = require('http');

const BRIDGES = [
  { tag: 'MetaQuotes-Demo', port: 5000 },
  { tag: 'PepperstoneUK-Demo', port: 5001 },
];

function getJson(port, path, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`non-JSON from :${port}${path} — ${data.slice(0, 120)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('Broker-clock offset probe — is the future lead the tick-lag bias?');
  console.log('');

  for (const b of BRIDGES) {
    console.log(`── ${b.tag} (:${b.port}) ─────────────────────────────────`);
    try {
      const health = await getJson(b.port, '/health');
      console.log(`   bridge reachable: ${JSON.stringify(health).slice(0, 160)}`);
    } catch (e) {
      console.log(`   ❌ unreachable: ${e.message}`);
      console.log('');
      continue;
    }

    // Ask for a few symbols spanning the liquidity range — the hypothesis predicts
    // the bias is LARGER for quieter symbols, because their last tick is older.
    for (const symbol of ['EURUSD', 'XAUUSD', 'AUDUSD', 'EURCHF', 'EURCAD']) {
      try {
        const t = await getJson(b.port, `/tick/${symbol}`);
        const serverEpoch = t.time ?? t.timestamp ?? null;
        if (!serverEpoch) {
          console.log(`   ${symbol.padEnd(8)} no tick time in payload: ${JSON.stringify(t).slice(0, 100)}`);
          continue;
        }
        const nowTrue = Math.floor(Date.now() / 1000);
        const measuredOffset = Math.round((serverEpoch - nowTrue) / 900) * 900;
        const tickAge = nowTrue - (serverEpoch - measuredOffset);
        const impliedLead = tickAge; // seconds the stored value would sit in the future
        console.log(
          `   ${symbol.padEnd(8)} raw(server-epoch − now) = ${String(serverEpoch - nowTrue).padStart(6)}s  ` +
            `-> derived offset ${String(measuredOffset).padStart(6)}s  ` +
            `-> implied FUTURE lead ${String(impliedLead).padStart(5)}s ` +
            `(${(impliedLead / 60).toFixed(1)} min)`,
        );
      } catch (e) {
        console.log(`   ${symbol.padEnd(8)} tick query failed: ${e.message}`);
      }
    }
    console.log('');
  }

  console.log('READ THIS AS: the "implied FUTURE lead" column is the prediction. If it is');
  console.log('non-zero and of the same order as the observed 4–14 min leads on position/');
  console.log('trade rows, the tick-lag bias is the cause. If it is ~0, the hypothesis is');
  console.log('REFUTED and the cause is elsewhere — do not accept a story over the number.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
