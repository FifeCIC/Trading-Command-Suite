#!/usr/bin/env node
/**
 * audit-signal-capacity.cjs — answers "why is the Signal denominator 725?" (#781 follow-up)
 *
 * WHY THIS EXISTS: the owner observed Signal 110/725 (15%) and Opportunity 354/825, and
 * remembered the signal maximum being ~250. Two claims need separating:
 *
 *   1. Have Signal and Opportunity been SWAPPED?  -> arithmetic can answer this exactly.
 *   2. Did the signal denominator legitimately grow, or is capacity counting something it
 *      should not?
 *
 * Signal = sum of maxScore over NON-GATE groups.
 * Opportunity = sum of maxScore over ALL groups (including gate/risk).
 * Therefore  opportunityMax - signalMax == (sum of GATE group maxScores).
 *
 * If that identity holds for the live numbers, nothing is swapped — the two denominators are
 * near-identical BY CONSTRUCTION, and "only 100 apart" is expected, not a mix-up.
 *
 * Read-only. Prints one JSON block.
 */

const http = require('http');
const API = 'http://localhost:3201';

function get(path, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const req = http.get(`${API}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, raw: body.slice(0, 300) }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

(async () => {
  const out = { at: new Date().toISOString() };

  // ── 1. Thresholds: the rescale that happened today (80/40 -> 13/6) ──
  for (const p of ['/api/scoring/thresholds', '/api/scoring/protocols/thresholds']) {
    const r = await get(p);
    if (!r.error && r.status < 400) { out.thresholds = { path: p, value: r.json }; break; }
    out.thresholds ??= { error: `${p} -> ${r.error || r.status}` };
  }

  // ── 2. Find a symbol whose numbers look like the owner's (110/725, 354/825) ──
  const ranked = await get('/api/scoring/ranked');
  if (ranked.error || ranked.status >= 400) {
    out.ranked = { error: ranked.error || `HTTP ${ranked.status}` };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const rows = Array.isArray(ranked.json)
    ? ranked.json
    : (ranked.json?.ranked ?? ranked.json?.symbols ?? ranked.json?.data ?? []);
  out.rankedCount = rows.length;
  out.ipStrategy = ranked.json?.strategy ?? null;
  out.ipSummary = ranked.json?.summary ?? null;

  const shape = rows.slice(0, 12).map((r) => ({
    symbol: r.symbol,
    signal: r.signal,
    signalRaw: r.signalRaw ?? r.score,
    signalMax: r.signalMax ?? r.scoreMax,
    signalPct: r.signalPct ?? r.pct,
    opportunityScore: r.opportunityScore,
    opportunityMax: r.opportunityMax,
  }));
  out.sample = shape;

  // ── 3. Pull a full breakdown for the first symbol and reconcile the identity ──
  const target = shape.find((s) => s.opportunityMax) || shape[0];
  if (!target) { console.log(JSON.stringify(out, null, 2)); return; }
  out.reconciledSymbol = target.symbol;

  const bd = await get(`/api/scoring/breakdown/${encodeURIComponent(target.symbol)}`);
  if (bd.error || bd.status >= 400) {
    out.breakdown = { error: bd.error || `HTTP ${bd.status}` };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const data = bd.json?.data ?? bd.json;
  const b = data?.breakdown ?? data;

  // Groups are keyed by group id; each holds directive rows with maxScore + isGate info.
  const groups = b?.breakouts ?? {};
  const perGroup = Object.entries(groups).map(([gid, items]) => {
    const rows2 = Array.isArray(items) ? items : [];
    const all = sum(rows2.map((x) => x.maxScore ?? 0));
    // `risk` is the gate group in this app; anything else is a voter.
    const isGate = gid === 'risk';
    return {
      groupId: gid,
      isGate,
      directives: rows2.length,
      allMax: all,
      nonGateMax: isGate ? 0 : all,
      topDirectives: rows2
        .slice()
        .sort((x, y) => (y.maxScore ?? 0) - (x.maxScore ?? 0))
        .slice(0, 8)
        .map((x) => `${x.directiveId}(${x.maxScore})`),
      neutralCount: rows2.filter((x) => x.signalClass === 'neutral').length,
    };
  });

  out.perGroup = perGroup;
  out.computed = {
    signalMax_nonGate: sum(perGroup.map((g) => g.nonGateMax)),
    opportunityMax_all: sum(perGroup.map((g) => g.allMax)),
    gateMax: sum(perGroup.filter((g) => g.isGate).map((g) => g.allMax)),
    reportedSignalMax: b?.signalMax ?? data?.signalMax,
    reportedConfiguredSignalMax: b?.configuredSignalMax ?? data?.configuredSignalMax,
    reportedOpportunityMax: b?.opportunityMax ?? data?.opportunityMax,
  };
  out.computed.gap_allMinusNonGate = out.computed.opportunityMax_all - out.computed.signalMax_nonGate;

  // ── 4. The decisive checks ──
  out.verdict = {
    swapped: (out.computed.reportedSignalMax > out.computed.reportedOpportunityMax) || null,
    gapExplainedByGateGroups:
      out.computed.reportedOpportunityMax != null && out.computed.reportedSignalMax != null
        ? out.computed.reportedOpportunityMax - out.computed.reportedSignalMax
        : null,
    note: 'gap == sum of GATE-group maxScores means the two denominators are related by construction, not swapped.',
  };

  console.log(JSON.stringify(out, null, 2));
})();
