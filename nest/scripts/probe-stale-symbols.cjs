#!/usr/bin/env node
/**
 * probe-stale-symbols.cjs — diagnostic for #781 (UK100 4-month-old feed, VIX 0 bars).
 *
 * WHY THIS EXISTS: #781 was filed 2026-09-10 with a specific observation, and it explicitly
 * left three things UNMEASURED. This script measures all three rather than re-reading the
 * issue's numbers, because a five-day-old measurement is not evidence about today.
 *
 * It answers:
 *   1. Which broker, if either, serves UK100 (and VIX) at a CURRENT timestamp?
 *   2. What is the newest bar per broker, and how stale is it?
 *   3. Is the staleness symbol-specific or broker-wide?
 *
 * Read-only. Touches no database and no application code.
 */

const http = require('http');

const BRIDGES = [
  { port: 5000, label: 'MetaQuotes-Demo' },
  { port: 5001, label: 'PepperstoneUK-Demo' },
];

// #781's three subjects plus two known-good controls from the original report.
const SYMBOLS = ['UK100', 'VIX', 'US500', 'USTEC'];

function get(port, path, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ ok: true, json: JSON.parse(body) });
        } catch {
          resolve({ ok: false, raw: body.slice(0, 300) });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function ageLabel(ms) {
  if (ms === null) return 'n/a';
  const mins = ms / 60000;
  if (mins < 60) return `${mins.toFixed(1)} min`;
  if (mins < 60 * 48) return `${(mins / 60).toFixed(1)} h`;
  return `${(mins / 1440).toFixed(1)} days`;
}

(async () => {
  const now = Date.now();
  console.log(`\nprobe at ${new Date(now).toISOString()} (true UTC)\n`);

  for (const b of BRIDGES) {
    console.log(`══════════ ${b.label} (:${b.port}) ══════════`);
    const h = await get(b.port, '/health');
    if (!h.ok) { console.log(`  /health FAILED: ${h.error || h.raw}\n`); continue; }
    console.log(`  connected=${h.json.connected} server=${h.json.server} ` +
                `utcOffsetSec=${h.json.serverUtcOffsetSeconds ?? 'MISSING'}`);

    for (const sym of SYMBOLS) {
      const r = await get(b.port, `/candles?symbol=${sym}&timeframe=5m&limit=2`);
      if (!r.ok) { console.log(`  ${sym.padEnd(7)} ERROR ${r.error || r.raw}`); continue; }
      const bars = r.json?.bars ?? r.json ?? [];
      if (!Array.isArray(bars) || bars.length === 0) {
        console.log(`  ${sym.padEnd(7)} 0 bars  <-- no-bars path (different code path to stale)`);
        continue;
      }
      // Find the newest bar regardless of field naming.
      const times = bars
        .map((x) => x.time ?? x.timestamp ?? x.t ?? x.date)
        .filter((t) => t !== undefined && t !== null)
        .map((t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t)))
        .filter((t) => Number.isFinite(t))
        .sort((a, c) => c - a);
      if (times.length === 0) {
        console.log(`  ${sym.padEnd(7)} ${bars.length} bar(s) but NO parseable timestamp ` +
                    `— keys: ${Object.keys(bars[0]).join(',')}`);
        continue;
      }
      const newest = times[0];
      const age = now - newest;
      const future = age < 0;
      console.log(`  ${sym.padEnd(7)} newest=${new Date(newest).toISOString()}  age=${ageLabel(age)}` +
                  `${future ? '   <-- FUTURE-STAMPED' : ''}${age > 24 * 3600_000 && !future ? '   <-- STALE' : ''}`);
    }
    console.log('');
  }
})();
