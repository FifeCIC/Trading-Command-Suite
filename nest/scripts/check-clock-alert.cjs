#!/usr/bin/env node
/**
 * check-clock-alert.cjs — one-off diagnostic for the MT5 clock-offset alert (#750 family).
 *
 * WHY THIS EXISTS: during a `jest` run the alert "MT5 Clock-Offset Telemetry Missing" appears
 * in the output, because `alert-trigger.service.spec.ts` deliberately deletes
 * `serverUtcOffsetSeconds` to exercise the trigger. That makes the suite output *look* like a
 * live critical alert — it has already caused one near-miss false alarm. This script answers
 * the only question that matters: is the alert live RIGHT NOW?
 *
 * Uses Invoke-RestMethod-equivalent fetch with a short timeout. `curl.exe` returns empty in
 * this environment, so we use Node's own HTTP.
 */

const API = 'http://localhost:3201';

function get(path, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = require('http').get(`${API}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, raw: body.slice(0, 400) });
        }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

(async () => {
  const out = { checkedAt: new Date().toISOString() };

  for (const p of ['/api/alerts/active', '/api/alerts']) {
    const r = await get(p);
    if (r.error || r.status >= 400) { out[p] = { error: r.error || `HTTP ${r.status}` }; continue; }
    const list = Array.isArray(r.json) ? r.json : (r.json?.alerts ?? r.json?.data ?? []);
    out[p] = {
      count: Array.isArray(list) ? list.length : 'non-array',
      titles: Array.isArray(list) ? list.map((a) => a.title || a.name || a.type).filter(Boolean) : [],
    };
  }

  // The decisive check: does ANY currently-raised alert mention the clock offset?
  const allTitles = Object.values(out)
    .flatMap((v) => (v && Array.isArray(v.titles) ? v.titles : []));
  out.clockOffsetAlertLive = allTitles.some((t) => /clock-?offset/i.test(String(t)));

  // And what each bridge actually reports (ground truth for the alert's precondition).
  out.bridges = {};
  for (const port of [5000, 5001]) {
    const r = await new Promise((resolve) => {
      const req = require('http').get(`http://localhost:${port}/health`, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    });
    out.bridges[port] = r
      ? { server: r.server, connected: r.connected, serverUtcOffsetSeconds: r.serverUtcOffsetSeconds ?? 'MISSING' }
      : { error: 'unreachable' };
  }

  console.log(JSON.stringify(out, null, 2));
})();
