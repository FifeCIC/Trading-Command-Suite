#!/usr/bin/env node
/**
 * probe-diagram-truth.cjs — TEMPORARY DISCOVERY PROBE (2026-09-21)
 *
 * Reads the LIVE system and prints the values that the DiagramsPage diagrams make
 * claims about, so the claims can be compared against ground truth rather than
 * against each other.
 *
 * This is discovery, not a guard. It asserts nothing and exits 0 unless the API is
 * unreachable. The permanent artefact is src/core/diagram-claims.js.
 *
 * ⚠️ Why this exists: the 33 diagrams disagree with EACH OTHER about the same facts
 * (protocol count appears as 32/37/42/44; directive count as 98/99+/100/101/104).
 * Whichever one is right, the others are teaching a wrong number to every reader and
 * to every AI agent that loads the page.
 */
const API = process.env.TCS_API || 'http://localhost:3201';

async function get(path) {
  try {
    const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    if (!res.ok) return { __status: res.status, __body: text.slice(0, 200) };
    try { return JSON.parse(text); } catch { return { __status: res.status, __raw: text.slice(0, 200) }; }
  } catch (e) {
    return { __error: e.message };
  }
}

function show(label, v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  console.log(`  ${label.padEnd(34)} ${s === undefined ? '(undefined)' : String(s).slice(0, 170)}`);
}

(async () => {
  console.log('\n=== THRESHOLDS  (diagram claims: >=80 STRONG, 40-79 BUY/SELL, <40 HOLD) ===');
  const th = await get('/api/scoring/gated/thresholds');
  if (th && !th.__error && !th.__status) {
    for (const [k, v] of Object.entries(th)) show(k, v);
  } else show('RAW', th);

  console.log('\n=== PROTOCOLS  (diagrams claim 32 / 37 / 42 / 44 total) ===');
  const proto = await get('/api/scoring/gated/protocols');
  if (Array.isArray(proto)) {
    show('array length', proto.length);
    show('sample row keys', Object.keys(proto[0] || {}).join(','));
  } else if (proto && proto.protocols) {
    show('protocols length', proto.protocols.length);
    show('sample row keys', Object.keys(proto.protocols[0] || {}).join(','));
  } else show('RAW', proto);

  console.log('\n=== DIRECTIVES  (diagrams claim 98 / 99+ / 100 / 101 / 104) ===');
  const dirReg = await get('/api/directives/registry');
  if (dirReg && !dirReg.__error && !dirReg.__status) {
    show('type', Array.isArray(dirReg) ? `array(${dirReg.length})` : 'object');
    show('keys', Object.keys(dirReg).slice(0, 12).join(','));
    if (Array.isArray(dirReg)) show('length', dirReg.length);
  } else show('RAW', dirReg);
  const dirList = await get('/api/directives');
  if (dirList && !dirList.__error && !dirList.__status) {
    show('/api/directives length', Array.isArray(dirList) ? dirList.length : Object.keys(dirList).slice(0, 8).join(','));
  } else show('/api/directives RAW', dirList);

  console.log('\n=== MANIFEST  (diagram claims: 46 modules, routes, version) ===');
  const man = await get('/api/architecture/manifest');
  if (man && !man.__error && !man.__status) {
    show('_meta.version', man._meta?.version);
    show('_meta.uiPages', man._meta?.uiPages);
    show('top-level keys', Object.keys(man).join(','));
    if (man.modules) show('modules count', Array.isArray(man.modules) ? man.modules.length : Object.keys(man.modules).length);
    if (man.navTree) show('navTree areas', Array.isArray(man.navTree) ? man.navTree.length : Object.keys(man.navTree).length);
    if (man.uiPages) show('uiPages count', Array.isArray(man.uiPages) ? man.uiPages.length : Object.keys(man.uiPages).length);
  } else show('RAW', man);

  console.log('\n=== PROVIDERS  (diagram claims 8 registered; one lists Alpha Vantage, another Finnhub) ===');
  const ph = await get('/api/providers/health');
  if (ph && !ph.__error && !ph.__status) {
    if (Array.isArray(ph)) show('array length', ph.length);
    else show('keys', Object.keys(ph).slice(0, 15).join(','));
    show('JSON', JSON.stringify(ph).slice(0, 400));
  } else show('RAW', ph);

  console.log('\n=== TRADING STRATEGIES  (diagram claims 35 trading / 7 scoring) ===');
  const ts = await get('/api/trading/strategies');
  if (ts && !ts.__error && !ts.__status) {
    show('count', Array.isArray(ts) ? ts.length : (ts.strategies?.length ?? Object.keys(ts).length));
    const row = Array.isArray(ts) ? ts[0] : ts.strategies?.[0];
    if (row) show('row keys', Object.keys(row).join(','));
  } else show('RAW', ts);

  console.log('\n=== SCORING STRATEGIES  (diagram claims 7) ===');
  const ss = await get('/api/scoring/strategies');
  if (ss && !ss.__error && !ss.__status) {
    show('count', Array.isArray(ss) ? ss.length : Object.keys(ss).length);
  } else show('RAW', ss);

  console.log('\n=== DERIVED STRATEGIES (batch #20 measured 26 bots / 26 strategies) ===');
  const dv = await get('/api/scoring/strategies/derived');
  if (dv && !dv.__error && !dv.__status) {
    show('count', Array.isArray(dv) ? dv.length : (dv.strategies?.length ?? Object.keys(dv).length));
    show('JSON head', JSON.stringify(dv).slice(0, 300));
  } else show('RAW', dv);

  console.log('\n=== CALIBRATIONS  (diagram claims 16 seeded) ===');
  const cal = await get('/api/scoring/calibrations');
  if (cal && !cal.__error && !cal.__status) {
    show('count', Array.isArray(cal) ? cal.length : Object.keys(cal).length);
  } else show('RAW', cal);

  console.log('\n=== ALERTS  (diagram claims 9 triggers, 8 configs, 200 max) ===');
  const cfg = await get('/api/alerts/configs');
  if (cfg && !cfg.__error && !cfg.__status) {
    show('count', Array.isArray(cfg) ? cfg.length : Object.keys(cfg).length);
    if (Array.isArray(cfg)) show('ids', cfg.map((c) => c.id || c.triggerId).join(','));
  } else show('RAW', cfg);

  console.log('\n=== SPEED SCANNER  (diagram claims 23 default symbols, 60+ map entries) ===');
  const sp = await get('/api/speed/symbols');
  if (sp && !sp.__error && !sp.__status) show('JSON', JSON.stringify(sp).slice(0, 300));
  else show('RAW', sp);

  console.log('\n=== MT5 BRIDGE PORT  (one diagram says :5000, another says :5001) ===');
  for (const port of [5000, 5001]) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(6000) });
      console.log(`  port ${port} /health -> HTTP ${r.status}  ${(await r.text()).slice(0, 90)}`);
    } catch (e) { console.log(`  port ${port} /health -> ${e.message}`); }
  }

  console.log('\n=== FYI: /api/scoring/gated/thresholds shape used by the prototype ===');
  console.log('  ' + JSON.stringify(th).slice(0, 400));
  console.log('');
})().catch((e) => { console.error('probe failed:', e.message); process.exit(2); });
