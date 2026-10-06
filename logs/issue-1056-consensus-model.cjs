/**
 * Scratch measurement for #1056 — DOES THE PUBLISHED CONSENSUS REPRODUCE FROM THE 4 DIRECTIVES?
 *
 * The guardian computes, for each position (`stop-guardian.service.ts:1330`):
 *     stopConfidence = max(0, round(alignedAvg - opposingAvg))
 * where only NON-NEUTRAL directives count, aligned by the position's side ("no evidence, never a
 * neutral 50").
 *
 * This re-derives that number independently, from `POST /api/directives/:id/test`, and compares it
 * to the LIVE value on the status payload. If they agree for every guarded position, the model is
 * validated and FRA40's decline can be explained without a FRA40 position existing.
 *
 * ⚠️ A model that agrees on one symbol is an anecdote. This checks all of them, and reports any
 * mismatch rather than averaging it away.
 *
 * Read-only. logs/ on purpose (a file in scripts/ stales docs/TOOLS-INDEX.md).
 */
const API = 'http://localhost:3201';
const DIRS = ['atr-trailing-stop', 'supertrend', 'chandelier-exit', 'wick-filter'];

const post = async (path, body) => {
  const r = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
};

(async () => {
  const status = await (await fetch(`${API}/api/automation/stop-guardian/status`)).json();
  const positions = status.guardedPositions || [];
  console.log(`guarded positions: ${positions.length}\n`);
  console.log(`${'symbol'.padEnd(9)}${'side'.padEnd(6)}${'live'.padEnd(6)}${'derived'.padEnd(9)}match  detail`);

  let ok = 0, bad = 0;
  for (const p of positions) {
    const classes = {};
    for (const d of DIRS) {
      try {
        const r = await post(`/api/directives/${d}/test`, { symbol: p.symbol, timeframe: '5m', barCount: 30 });
        classes[d] = r?.result ? { score: r.result.score, cls: r.result.signalClass } : null;
      } catch { classes[d] = null; }
    }

    // Re-derive exactly as the service does.
    let aSum = 0, aN = 0, oSum = 0, oN = 0;
    const detail = [];
    for (const d of DIRS) {
      const c = classes[d];
      if (!c || c.cls === 'neutral' || c.cls == null) { detail.push(`${d.split('-')[0]}=${c ? c.cls : 'ERR'}:skip`); continue; }
      const isBull = c.cls === 'bullish';
      const aligned = p.side === 'BUY' ? isBull : !isBull;
      if (aligned) { aSum += c.score; aN += 1; detail.push(`${d.split('-')[0]}=${c.score}${isBull ? '↑' : '↓'}`); }
      else { oSum += c.score; oN += 1; detail.push(`${d.split('-')[0]}=${c.score}${isBull ? '↑opp' : '↓opp'}`); }
    }
    const derived = Math.max(0, Math.round((aN ? aSum / aN : 0) - (oN ? oSum / oN : 0)));
    const match = derived === p.stopConfidence;
    if (match) ok++; else bad++;
    console.log(
      `${String(p.symbol).padEnd(9)}${String(p.side).padEnd(6)}${String(p.stopConfidence).padEnd(6)}${String(derived).padEnd(9)}${match ? 'YES  ' : 'NO   '}${detail.join(' ')}`,
    );
  }

  console.log(`\n=== RESULT ===`);
  console.log(`exact match : ${ok}/${positions.length}`);
  console.log(`mismatch    : ${bad}`);
  console.log(bad === 0
    ? 'The consensus is fully reproduced from the four directive outputs — the model is validated.'
    : '⚠️ The model does NOT reproduce every position — do not use it to explain FRA40.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
