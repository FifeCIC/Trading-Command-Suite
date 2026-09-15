#!/usr/bin/env node
/**
 * audit-signal-capacity2.cjs — pin the Signal denominator to CONFIG (#781 / owner query).
 *
 * WHY: the owner saw Signal 110/725 (15%) vs Opportunity 354/825 and remembered the signal
 * maximum being ~250. We need to know whether 725 is the protocol's configured directional
 * capacity, and which directives make it up.
 *
 * Sources, in order of authority:
 *   1. GET /api/scoring/protocols                      -> protocol list (slugs)
 *   2. GET /api/scoring/protocols/:slug/directive-config -> the CONFIGURED directive set
 *   3. GET /api/scoring/gated/:symbol                  -> live signalMax/opportunityMax
 *
 * Identity being tested (from protocol-gating.service.ts):
 *     signalMax      = SUM maxScore over NON-GATE groups
 *     opportunityMax = SUM maxScore over ALL groups (incl. risk/gate)
 *   => opportunityMax - signalMax == total GATE-group maxScore
 *
 * Read-only.
 */

const http = require('http');
const API = 'http://localhost:3201';

function get(path, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const req = http.get(`${API}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, raw: body.slice(0, 200) }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

(async () => {
  const out = { at: new Date().toISOString() };

  // ── 1. Protocols ──
  const pl = await get('/api/scoring/protocols');
  const protocols = Array.isArray(pl.json) ? pl.json
    : (pl.json?.protocols ?? pl.json?.data ?? []);
  out.protocolCount = protocols.length;
  out.protocols = protocols.map((p) => ({
    slug: p.slug ?? p.id,
    name: p.name,
    direction: p.direction ?? p.directionMode ?? p.role,
    active: p.active ?? p.enabled,
    directiveCount: p.directiveCount ?? p.directives?.length,
  })).slice(0, 12);

  // ── 2. Directive config for the first active protocol (the one the UI is showing) ──
  const target = protocols.find((p) => (p.active ?? p.enabled)) ?? protocols[0];
  if (target) {
    const slug = target.slug ?? target.id;
    out.targetProtocol = slug;
    const dc = await get(`/api/scoring/protocols/${encodeURIComponent(slug)}/directive-config`);
    const cfg = dc.json?.data ?? dc.json;
    out.directiveConfigKeys = cfg && typeof cfg === 'object' ? Object.keys(cfg).slice(0, 25) : null;

    // The config may expose directives as a flat list or grouped.
    const dirs = cfg?.directives ?? cfg?.items ?? [];
    if (Array.isArray(dirs) && dirs.length) {
      const byGroup = {};
      for (const d of dirs) {
        const g = d.groupId ?? d.group ?? 'unknown';
        byGroup[g] = byGroup[g] ?? { count: 0, max: 0, ids: [] };
        byGroup[g].count++;
        byGroup[g].max += d.maxScore ?? 0;
        byGroup[g].ids.push(`${d.directiveId ?? d.id}(${d.maxScore ?? 0})`);
      }
      out.configuredCapacity = Object.entries(byGroup).map(([groupId, v]) => ({
        groupId,
        isGate: groupId === 'risk',
        count: v.count,
        maxScoreSum: v.max,
        sample: v.ids.slice(0, 10),
      }));
      out.configuredTotals = {
        allGroups: Object.values(byGroup).reduce((a, v) => a + v.max, 0),
        nonGateOnly: Object.entries(byGroup).reduce((a, [g, v]) => a + (g === 'risk' ? 0 : v.max), 0),
        gateOnly: byGroup['risk']?.max ?? 0,
      };
    } else {
      out.directiveConfigShape = JSON.stringify(cfg).slice(0, 900);
    }
  }

  // ── 3. Live gated numbers for a symbol ──
  const ranked = await get('/api/scoring/ranked');
  const rows = Array.isArray(ranked.json) ? ranked.json
    : (ranked.json?.ranked ?? ranked.json?.symbols ?? []);
  const sym = rows.find((r) => r.symbol)?.symbol;
  out.liveSymbol = sym;
  if (sym) {
    const g = await get(`/api/scoring/gated/${encodeURIComponent(sym)}`);
    const gd = g.json?.data ?? g.json;
    out.gated = {
      status: g.status,
      signalMax: gd?.signalMax,
      configuredSignalMax: gd?.configuredSignalMax,
      observedSignalMax: gd?.observedSignalMax,
      signalRaw: gd?.signalRaw,
      signalPct: gd?.signalPct,
      opportunityMax: gd?.opportunityMax,
      opportunityScore: gd?.opportunityScore,
      gap: (gd?.opportunityMax != null && gd?.signalMax != null)
        ? gd.opportunityMax - gd.signalMax : null,
      topLevelKeys: gd && typeof gd === 'object' ? Object.keys(gd).slice(0, 30) : null,
    };
  }

  console.log(JSON.stringify(out, null, 2));
})();
