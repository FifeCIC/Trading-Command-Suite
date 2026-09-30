/**
 * replay-exit-verdict.cjs — STEP 3d (#1024's untested question).
 *
 * #1024 replayed a SIMPLE rule (peak give-back / adverse fraction) and found it a wash. That is NOT
 * the same claim as "our own verdict is a wash" — the verdict is five directives plus a consensus
 * rule, and it had never been replayed. This does exactly that.
 *
 * ⚠️ IT USES THE REAL THINGS, NOT COPIES. The directives are the COMPILED classes, the cadence comes
 * from `getDirectiveSuitability()`, and the decide-to-leave rule is the exported `arguesExitFor()` —
 * the same function the live `ExitConsensusService` calls. A replay built on a re-implementation
 * would measure the re-implementation (the `verify-guards-read-real-source` trap).
 *
 * ⚠️ IT REPORTS WHAT IT DAMAGES. Same discipline as #1024: `winners cut` and `turned red` are printed
 * beside every setting, because an exit rule cuts winners as well as losers.
 *
 * READ-ONLY.
 *
 *   node scripts/replay-exit-verdict.cjs                 # both levels
 *   node scripts/replay-exit-verdict.cjs --level EXIT    # only EXIT
 *   node scripts/replay-exit-verdict.cjs --self-test
 */
const fs = require('fs');
const path = require('path');
const { connect, query } = require('./lib/mysql-cli.cjs');
// ⚠️ THE SHARED HARNESS (#1032). See the note in replay-exit-counterfactual.cjs.
const { runCases } = require('./lib/validator-helpers.cjs');

const DIST = path.resolve(__dirname, '..', 'nest', 'dist', 'src', 'modules');
const IMPL_DIR = path.join(DIST, 'directives', 'implementations');

/** The live list, not a hardcoded one — if a sixth exit directive is added, this follows. */
function liveDirectiveIds() {
  try {
    const svc = require(path.join(DIST, 'scoring', 'exit-consensus.service.js'));
    if (Array.isArray(svc.EXIT_DIRECTIVE_IDS)) return svc.EXIT_DIRECTIVE_IDS;
  } catch { /* fall through */ }
  return null;
}

function liveArguesExitFor() {
  try {
    const svc = require(path.join(DIST, 'scoring', 'exit-consensus.service.js'));
    if (typeof svc.arguesExitFor === 'function') return svc.arguesExitFor;
  } catch { /* fall through */ }
  return null;
}

function declaredCadence(id) {
  try {
    const reg = require(path.join(DIST, 'directives', 'directive-suitability.registry.js'));
    const decl = String(reg.getDirectiveSuitability(id)?.minTimeframe ?? 'H1');
    const map = { '1m': '1m', '5m': '5m', M15: '15m', '15m': '15m', H1: '1h', '1h': '1h', H4: '4h', D1: '1d', '1d': '1d' };
    return map[decl] || '1h';
  } catch {
    return '1h';
  }
}

function loadDirectives(ids) {
  const out = [];
  for (const id of ids) {
    const file = path.join(IMPL_DIR, `${id}.directive.js`);
    try {
      const mod = require(file);
      const cls = Object.values(mod).find((v) => typeof v === 'function' && v.prototype && 'calculate' in v.prototype);
      if (cls) out.push({ id, inst: new cls(), tf: declaredCadence(id) });
    } catch { /* a directive that cannot load is reported below, not silently dropped */ }
  }
  return out;
}

// ── the consensus rule (mirrors runExitDirectives: >=2 arguing => EXIT, 1 => REDUCE, 0 => HOLD) ──
function convictionFor(arguingCount) {
  return arguingCount >= 2 ? 'EXIT' : arguingCount === 1 ? 'REDUCE' : 'HOLD';
}

/** Does this conviction level command a close? */
function levelSaysLeave(conviction, level) {
  if (level === 'EXIT') return conviction === 'EXIT';
  if (level === 'REDUCE') return conviction === 'EXIT' || conviction === 'REDUCE';
  return false;
}

// ── data ───────────────────────────────────────────────────────────────────────────────────────
function parseTsv(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] === 'NULL' ? null : cells[i]; });
    return row;
  });
}

/**
 * ⚠️ ALL BARS ARE LOADED ONCE, PER CADENCE, THEN SLICED IN MEMORY.
 * The naive shape — a query per evaluation point per directive — would be ~95,000 `mysql.exe`
 * spawns at ~200ms each, i.e. hours. Six queries and binary searches instead.
 */
function loadBarCache(conn) {
  const caches = new Map(); // `${symbolId}|${tf}` -> [bar]
  const rows = parseTsv(query(
    `SELECT symbolId, timeframe, UNIX_TIMESTAMP(timestamp) t, open, high, low, close, volume
     FROM marketbar WHERE timeframe IN ('15m','1h','1d')
     ORDER BY symbolId, timeframe, timestamp`, conn));
  for (const r of rows) {
    const key = `${r.symbolId}|${r.timeframe}`;
    if (!caches.has(key)) caches.set(key, []);
    caches.get(key).push(toBar(r));
  }
  return caches;
}

/**
 * toBar() — the shape contract between this replay and the REAL directive implementations.
 *
 * ⚠️ THE FULL NAMES ARE THE CONTRACT, NOT A STYLE CHOICE. The directives read `bars.map(b => b.close)`,
 * `.high`, `.low`, `.volume`, `.timestamp`. The short keys `t/o/h/l/c/v` exist ONLY so this script's
 * binary search can work; they are not what a directive reads.
 *
 * ⚠️ MEASURED FAILURE 2026-09-29. Shipping the short keys alone fed every directive `undefined`.
 * All five then returned `neutral` with a CONSTANT score (momentum-exhaustion 10, regime-shift-exit
 * 14, time-stop 25, chandelier-exit 45) and `target-achieved` returned `NaN` — across **47,105**
 * evaluations. The result that printed was `argues = 0 for 166 trades`, which reads as a decisive
 * finding ("the exit verdict never fires") and was in fact a broken replay. Nothing threw; nothing
 * was skipped. **Plausible output, no error** — the defect class this repo keeps re-finding.
 *
 * Guarded by the 'a cached bar exposes the field names the directives read' self-test below.
 * If you change this shape, that test is the thing that catches you.
 */
function toBar(r) {
  return {
    timestamp: Number(r.t), open: +r.open, high: +r.high, low: +r.low,
    close: +r.close, volume: +r.volume,
    t: Number(r.t),
  };
}

const CACHE = { c: null };

/** Last `limit` bars at or before `atUnix`. Binary search, because the arrays are sorted. */
function sliceAt(bars, atUnix, limit = 400) {
  if (!bars || !bars.length) return [];
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= atUnix) lo = mid + 1; else hi = mid;
  }
  return bars.slice(Math.max(0, lo - limit), lo);
}

function loadTrades(conn) {
  const rows = parseTsv(query(
    `SELECT t.id, t.symbol, t.side, t.entryPrice, t.exitPrice, t.sl, s.id AS symbolId,
            UNIX_TIMESTAMP(t.openedAt) o, UNIX_TIMESTAMP(t.closedAt) c
     FROM trade t JOIN symbol s ON s.ticker = t.symbol
     WHERE t.status='closed' AND t.pnlInvalid=0 AND t.exitPrice IS NOT NULL AND t.closedAt IS NOT NULL
     ORDER BY t.openedAt`, conn));
  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, symbolId: r.symbolId, side: r.side,
    entryPrice: +r.entryPrice, exitPrice: +r.exitPrice,
    opened: Number(r.o), closed: Number(r.c),
  }));
}

const signedPct = (side, entry, exit) => ((exit - entry) / entry) * 100 * (side === 'buy' ? 1 : -1);

// ── the replay ─────────────────────────────────────────────────────────────────────────────────
function evaluate(trades, directives, arguesExitFor, level) {
  const s = {
    level, evaluated: 0, skippedNoClock: 0, fired: 0, neverFired: 0,
    improved: 0, worsened: 0, unchanged: 0, winnersCut: 0, winnersTurnedRed: 0,
    deltaSum: 0, actualSum: 0, ruleSum: 0, sawExit: 0, sawReduce: 0, maxArgue: 0,
    // ⚠️ INSTRUMENTATION, NOT DECORATION. The inner loop has `continue`s for "no bars" and "threw".
    // Without these counters a replay that evaluated NOTHING is indistinguishable from a verdict that
    // argued NOTHING — and those are opposite conclusions. A guard that never fires and a guard that
    // never RAN must never print the same line.
    evals: 0, evalsNoBars: 0, evalsThrew: 0, arguedBy: {},
    classesById: {}, scoreRange: {},
  };

  for (const t of trades) {
    // The evaluation clock is the 5m bar: it is the finest cadence the store holds for the set, and
    // deciding more often than the directives can see would add no information.
    const clock = sliceAt(CACHE.c.get(`${t.symbolId}|15m`) || [], t.closed, 100000)
      .filter((b) => b.t >= t.opened && b.t <= t.closed);
    const clock5 = (CACHE.c.get(`${t.symbolId}|5m`) || []);
    const points = clock.length ? clock : clock5.filter((b) => b.t >= t.opened && b.t <= t.closed);
    if (!points.length) { s.skippedNoClock++; continue; }
    s.evaluated++;

    let leaveAt = null;
    for (const p of points) {
      let arguing = 0;
      for (const d of directives) {
        const bars = sliceAt(CACHE.c.get(`${t.symbolId}|${d.tf}`), p.t);
        if (!bars.length) { s.evalsNoBars++; continue; }
        let res;
        try { res = d.inst.calculate({ symbol: t.symbol, bars, timeframe: d.tf }); } catch { s.evalsThrew++; continue; }
        if (!res) { s.evalsThrew++; continue; }
        s.evals++;
        // ⚠️ Record what each directive RETURNED, not only whether it argued. If every class is
        // `neutral` the feed is the problem; if classes vary but argues stays 0, the SIDE logic is.
        // Without this the two look identical, and only one of them is a real finding.
        const cls = String(res.signalClass ?? 'neutral');
        const k = ['neutral', 'bullish', 'bearish'].includes(cls) ? cls : 'other';
        s.classesById[d.id] = s.classesById[d.id] || { neutral: 0, bullish: 0, bearish: 0, other: 0 };
        s.classesById[d.id][k]++;
        if (!s.scoreRange[d.id]) s.scoreRange[d.id] = { min: Infinity, max: -Infinity };
        s.scoreRange[d.id].min = Math.min(s.scoreRange[d.id].min, Number(res.score ?? 0));
        s.scoreRange[d.id].max = Math.max(s.scoreRange[d.id].max, Number(res.score ?? 0));
        const verdict = arguesExitFor(t.side, cls, Number(res.score ?? 0), d.inst.exitScoreThreshold);
        if (verdict.arguesExit) { arguing++; s.arguedBy[d.id] = (s.arguedBy[d.id] || 0) + 1; }
      }
      const conv = convictionFor(arguing);
      if (arguing > s.maxArgue) s.maxArgue = arguing;
      if (conv === 'EXIT') s.sawExit++;
      if (conv === 'REDUCE') s.sawReduce++;
      if (levelSaysLeave(conv, level)) { leaveAt = p; break; }
    }

    const actual = signedPct(t.side, t.entryPrice, t.exitPrice);
    // ⚠️ `.close`, NOT `.c`. Measured 2026-09-29: when the bar shape changed to the directives'
    // field names, `leaveAt.c` became `undefined` and EVERY fired trade produced `rule = NaN`.
    // NaN comparisons are all false, so the report printed `unchanged 166` — a plausible-looking
    // finding that was arithmetic on a missing field. Guarded by the end-of-run invariant below.
    const rule = leaveAt ? signedPct(t.side, t.entryPrice, leaveAt.close) : actual;
    if (leaveAt) s.fired++; else s.neverFired++;

    const d = rule - actual;
    s.actualSum += actual; s.ruleSum += rule; s.deltaSum += d;
    if (d > 1e-9) s.improved++; else if (d < -1e-9) s.worsened++; else s.unchanged++;
    if (actual > 0 && leaveAt && rule < actual) s.winnersCut++;
    if (actual > 0 && rule < 0) s.winnersTurnedRed++;
  }
  return s;
}

// ── self-test ──────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    ['2+ arguing is EXIT', () => convictionFor(2) === 'EXIT' && convictionFor(5) === 'EXIT'],
    ['1 arguing is REDUCE', () => convictionFor(1) === 'REDUCE'],
    ['0 arguing is HOLD', () => convictionFor(0) === 'HOLD'],
    ['the EXIT level leaves only on EXIT', () => levelSaysLeave('EXIT', 'EXIT') && !levelSaysLeave('REDUCE', 'EXIT')],
    ['the REDUCE level leaves on either', () => levelSaysLeave('EXIT', 'REDUCE') && levelSaysLeave('REDUCE', 'REDUCE') && !levelSaysLeave('HOLD', 'REDUCE')],
    ['sliceAt returns the last N at or before a time', () => {
      const bars = [1, 2, 3, 4, 5].map((t) => ({ t, c: t }));
      const s = sliceAt(bars, 3, 2);
      return s.length === 2 && s[0].t === 2 && s[1].t === 3;
    }],
    ['sliceAt before the first bar is empty', () => sliceAt([{ t: 10, c: 1 }], 5).length === 0],
    ['sliceAt with no bars is empty, not a throw', () => sliceAt([], 5).length === 0 && sliceAt(undefined, 5).length === 0],
    ['signedPct is side-aware', () => signedPct('buy', 100, 101) === 1 && signedPct('sell', 100, 101) === -1],
    // ⚠️ CANARY FOR THE 2026-09-29 FAILURE. This asserts the FIELD NAMES a directive reads, not the
    // scale of a number. Remove `close: +r.close` from toBar() and this fails — which is the point:
    // the bug it guards produced a confidently-printed `argues = 0` rather than an exception.
    ['a cached bar exposes the field names the directives read', () => {
      // Walks the FULL producer -> consumer path: toBar() -> sliceAt() -> the field the rule reads.
      // A field renamed on one side only cannot be caught by asserting the object in isolation.
      const b = toBar({ t: '100', open: '1', high: '2', low: '0.5', close: '1.5', volume: '9' });
      const sliced = sliceAt([b], 200, 10);
      return b.close === 1.5 && b.high === 2 && b.low === 0.5 && b.volume === 9
        && b.timestamp === 100 && b.t === 100
        && sliced.length === 1 && Number.isFinite(signedPct('buy', 100, sliced[0].close));
    }],
    ['every exit directive resolves to a cadence the store holds', () => {
      const ids = liveDirectiveIds() || [];
      const dirs = loadDirectives(ids);
      return dirs.length === ids.length && dirs.every((d) => ['15m', '1h', '1d'].includes(d.tf));
    }],
    ['the REAL arguesExitFor is loadable (not a local copy)', () => typeof liveArguesExitFor() === 'function'],
  ];
  // ⚠️ The harness is SHARED (#1032). One behavioural difference, deliberate and adopted: the
  // shared rule is STRICTER (`fn() === true`), where this copy's throw-diagnostic is preserved by
  // reporting the throw on the same line. A case that throws is a FAILURE, never a skip.
  const failed = runCases(cases);
  return failed;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

  console.log('  --- preflight ---');
  if (selfTest()) process.exit(1);

  const ids = liveDirectiveIds();
  const arguesExitFor = liveArguesExitFor();
  if (!ids) { console.log('FATAL: could not read EXIT_DIRECTIVE_IDS from the compiled service.'); process.exit(1); }
  if (!arguesExitFor) { console.log('FATAL: could not read arguesExitFor from the compiled service — refusing to substitute a copy.'); process.exit(1); }
  const directives = loadDirectives(ids);
  if (directives.length !== ids.length) {
    console.log(`FATAL: ${directives.length}/${ids.length} directives loaded — a missing directive would under-count "arguing" and understate the verdict.`);
    process.exit(1);
  }

  const conn = connect();
  CACHE.c = loadBarCache(conn);
  const trades = loadTrades(conn);

  console.log(`\n[exit-verdict replay] ${directives.length} REAL directives · the REAL arguesExitFor · rules from the store\n`);
  console.log(`  closed valid trades                 : ${trades.length}`);
  console.log('  directive cadences                  : ' + directives.map((d) => `${d.id}=${d.tf}`).join(' '));

  const li = argv.indexOf('--level');
  const levels = li >= 0 ? [argv[li + 1]] : ['EXIT', 'REDUCE'];
  let invalid = false;

  for (const level of levels) {
    const s = evaluate(trades, directives, arguesExitFor, level);
    const n = s.fired + s.neverFired;
    console.log(`\n  ── level ${level} ──`);
    console.log(`  evaluated (had a clock)             : ${s.evaluated}   skipped (no clock): ${s.skippedNoClock}`);
    console.log(`  the verdict said leave, and it fired: ${s.fired}   never fired: ${s.neverFired}`);
    console.log(`  max directives arguing at once ever : ${s.maxArgue}   (points at EXIT: ${s.sawExit}, REDUCE: ${s.sawReduce})`);
    console.log(`  DIRECTIVE EVALUATIONS: ran ${s.evals}   no bars ${s.evalsNoBars}   threw/skipped ${s.evalsThrew}`);
    console.log(`  argued-exit counts by directive     : ${Object.keys(s.arguedBy).length ? JSON.stringify(s.arguedBy) : '(NONE EVER ARGUED)'}`);
    for (const [id, c] of Object.entries(s.classesById)) {
      const r = s.scoreRange[id] || { min: 0, max: 0 };
      console.log(`    ${id.padEnd(20)} classes=${JSON.stringify(c)}  score ${r.min}-${r.max}`);
    }
    console.log(`  improved ${s.improved}  worsened ${s.worsened}  unchanged ${s.unchanged}`);
    // 🛑 A NaN IS A BUG, NOT A RESULT. A silent NaN is indistinguishable from a real finding on the
    // page: measured 2026-09-29, a missing field printed `unchanged 166` and read as "the rule
    // changes nothing". Refuse to report rather than print a number nobody can trust.
    if (s.fired > 0 && !Number.isFinite(s.ruleSum)) {
      console.log(`  🛑 INVALID REPLAY — ${s.fired} trades fired but the rule outcome is NaN.`);
      console.log('     That is a defect in THIS SCRIPT, not a measurement. Ignore every number below.');
      invalid = true;
    }
    console.log(`  WINNERS CUT ${s.winnersCut}   TURNED RED ${s.winnersTurnedRed}`);
    if (n) console.log(`  mean actual ${(s.actualSum / n).toFixed(4)}%   mean rule ${(s.ruleSum / n).toFixed(4)}%   delta ${(s.deltaSum / n).toFixed(4)}%`);
  }
  console.log('\n  means are per trade in price %; a trade the verdict never fires on keeps its ACTUAL outcome, so delta 0 is the floor.');
  console.log('  ⚠️ Read WINNERS CUT before delta. An exit rule cuts winners as well as losers.\n');
  if (invalid) {
    console.log('  🛑 EXIT 1 — the run above is INVALID and must not be cited.\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { convictionFor, levelSaysLeave, sliceAt, signedPct, toBar };
