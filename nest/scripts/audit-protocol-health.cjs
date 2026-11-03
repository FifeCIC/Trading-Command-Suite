#!/usr/bin/env node
/**
 * audit-protocol-health.cjs — the five questions the owner asked, answered per protocol.
 *
 *   1 DATA SOURCE   is each protocol's market data coming from MT5 / PepperstoneUK MT5?
 *   2 DIRECTIVE DATA does every directive get the bars it declares it needs?
 *   3 MARKET STORED  are bars being persisted so scoring can be repeated?
 *   4 RESULTS STORED are per-directive results recorded?
 *   5 SCORE STORED   is the protocol's score recorded?
 *
 * WHY ONE TOOL FOR FIVE QUESTIONS (owner, 2026-11-03). Each answer is a property of the SAME
 * protocol, and they fail in a chain: no bars -> directives starve -> nothing scores -> nothing is
 * stored. Checking them separately produces five green reports that each miss the cause. This walks
 * the chain in order and stops explaining at the first break, which is why the sections are
 * numbered rather than alphabetised.
 *
 * ⚠️ "EVEN IF TEMPORARY" — the owner's phrasing, and it matters. Some of this is deliberately NOT
 * persisted (the score table rotates). So a table holding nothing is only a fault when the thing
 * that should write it is idle too. Every check compares a WRITE against a WORKLOAD rather than
 * asserting a row count, because "0 rows" on an idle system is not evidence of a defect.
 *
 * ⚠️ PROVIDER IS MEASURED, NOT INTENDED. `symbol_route` records where a symbol SHOULD come from; it
 * is not what happened. `marketbar.provider` is what actually supplied the bar. Measured
 * 2026-11-03: 4 crypto symbols route to `binance` while the owner's stated requirement is MT5 only —
 * a route table alone would not have shown that.
 *
 * USAGE
 *   npm --prefix nest run health:protocols
 *   node nest/scripts/audit-protocol-health.cjs --stale-minutes 120 --json
 *   node nest/scripts/audit-protocol-health.cjs --self-test
 *
 * NOT in `prebuild`: every check needs a live database and a running bridge. A build must not fail
 * because MySQL is down; DB-dependent checks are on demand in this repo (db:check, db:schema-drift).
 */

const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'mysql-cli.cjs'));
const { parseTsv } = require('./report-symbol-priority-ties.cjs');

/** Providers that satisfy "MT5 or PepperstoneUK MT5". Anything else is a different data source. */
const MT5_PROVIDERS = ['mt5', 'pepperstoneuk', 'pepperstone', 'metaquotes'];

/** Signal labels that carry a direction. STRONG_* are SEPARATE values, not prefixes. */
const DIRECTIONAL_SIGNALS = ['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'];
const DIRECTIONAL_SQL = `(${DIRECTIONAL_SIGNALS.map((s) => `'${s}'`).join(',')})`;

/** Quote a protocol slug for the mysql CLI. Slugs are read from the DB, never from user input. */
function sqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Q1 verdict for one (symbol, provider, ageMinutes) observation. PURE so it can be canaried.
 *   ok        MT5-family provider and the bar is fresh
 *   not-mt5   a provider outside the MT5 family supplied the data
 *   stale     right provider, data too old
 *   no-bars   nothing in the window at all
 */
function classifySource(provider, ageMinutes, staleMinutes) {
  if (provider == null || provider === '') return 'no-bars';
  const isMt5 = MT5_PROVIDERS.includes(String(provider).toLowerCase());
  if (!isMt5) return 'not-mt5';
  if (ageMinutes == null || !Number.isFinite(Number(ageMinutes))) return 'no-bars';
  return Number(ageMinutes) > staleMinutes ? 'stale' : 'ok';
}

/**
 * Q2 verdict from a directive's OWN recorded reason. The directive states the shortfall, so this is
 * cause-agnostic: it fires whether the window was too small, the cadence was wrong, or the fetch was
 * truncated — we do not need to guess which.
 */
function classifyStarvation(reason) {
  const m = /need (\d+) bars?, have (\d+)/i.exec(String(reason ?? ''));
  if (!m) return null;
  return { needs: Number(m[1]), have: Number(m[2]), short: Number(m[1]) - Number(m[2]) };
}

/**
 * Q5/Q4 verdict for a protocol's storage state. PURE.
 * `scored` = it has score rows in the window; `snapshotted` = it has score_snapshot rows.
 * ⚠️ An IDLE protocol (no symbols, no bots) legitimately has neither. Calling that "not stored" is
 * the mistake that turns a health check into noise, so `reachable` gates the complaint.
 */
function classifyStorage({ scored, snapshotted, reachable }) {
  if (!reachable) return 'unreachable'; // nothing to score — a config gap, not a storage fault
  if (!scored && !snapshotted) return 'nothing-written';
  if (scored && !snapshotted) return 'score-only'; // results exist, the snapshot path did not fire
  if (!scored && snapshotted) return 'snapshot-only'; // irregular: snapshot without a score row
  return 'ok';
}

/**
 * `--compare <slugA> <slugB>` — the CONTROL/VARIANT report for a copied configuration.
 *
 * ⚠️ WHY THIS IS A FLAG AND NOT A NEW TOOL (owner, 2026-11-03: *"consider how realistic it is at this
 * point to continue adding complexity"*). The comparison needs exactly what this file already
 * queries — both protocols' stored scores, tick counts, and per-directive breakdowns. A second tool
 * would duplicate the connection layer, the staleness rules and the parser, and only one of the two
 * copies would get the next fix. One flag, one entry point.
 *
 * What it answers: are BOTH arms alive, do they differ ONLY in the way they were meant to, and how
 * far apart are they? A comparison between two dead protocols looks identical to a comparison
 * between two agreeing ones — so "cannot judge" is reported explicitly.
 */
function printComparison(conn, slugA, slugB, sinceHours) {
  const stats = (slug) => {
    const rows = parseTsv(query(`
      SELECT COUNT(*) AS ticks,
             ROUND(AVG(composite), 2) AS meanComposite,
             MIN(composite) AS minComposite,
             MAX(composite) AS maxComposite,
             ROUND(AVG(signalPct), 2) AS meanSignalPct,
             SUM(trading_signal IN ('BUY','SELL','STRONG_BUY','STRONG_SELL')) AS directional,
             MAX(snappedAt) AS newest
      FROM score_snapshot
      WHERE protocolId = ${sqlString(slug)}
        AND snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sinceHours} HOUR)`, conn))[0] || {};
    // The newest breakdown tells us the CAPACITY each arm is dividing by — the difference between
    // arms should be attributable, not mysterious.
    let rawMax = null;
    let directives = [];
    try {
      const b = parseTsv(query(
        `SELECT breakdown FROM score WHERE strategyId = ${sqlString(slug)} ORDER BY timestamp DESC LIMIT 1`, conn));
      if (b.length) {
        const bd = JSON.parse(b[0].breakdown);
        rawMax = bd.rawMax ?? null;
        directives = Object.values(bd.breakouts || {}).flat().map((d) => d.directiveId).filter(Boolean);
      }
    } catch { /* newest breakdown unreadable — capacity reported as unknown, never as zero */ }
    return { slug, ...rows, rawMax, directives };
  };

  const a = stats(slugA);
  const b = stats(slugB);
  const line = (label, va, vb) => console.log(`  ${label.padEnd(22)} ${String(va).padStart(14)} ${String(vb).padStart(14)}`);

  console.log(`\n── CONTROL vs VARIANT (last ${sinceHours}h) ${'─'.repeat(24)}`);
  console.log(`  ${''.padEnd(22)} ${slugA.slice(0, 14).padStart(14)} ${slugB.slice(0, 14).padStart(14)}`);
  line('ticks (snapshots)', a.ticks, b.ticks);
  line('mean composite', a.meanComposite, b.meanComposite);
  line('min..max composite', `${a.minComposite}..${a.maxComposite}`, `${b.minComposite}..${b.maxComposite}`);
  line('mean signalPct', a.meanSignalPct, b.meanSignalPct);
  line('directional ticks', a.directional, b.directional);
  line('capacity (rawMax)', a.rawMax ?? 'unknown', b.rawMax ?? 'unknown');
  line('newest', a.newest ?? '—', b.newest ?? '—');

  // The pair is only a valid comparison when the two differ in the ways intended.
  const configured = (slug) => {
    try {
      return parseTsv(query(`
        SELECT DISTINCT e.directiveId AS id
        FROM protocol_directive_entry e
        JOIN protocol_directive_group g ON g.id = e.groupId
        JOIN protocol pu ON pu.slug = g.protocolId OR pu.id = g.protocolId
        WHERE pu.slug = ${sqlString(slug)}`, conn)).map((r) => r.id);
    } catch { return []; }
  };
  const cfgA = configured(slugA);
  const cfgB = configured(slugB);
  const onlyA = a.directives.filter((d) => !b.directives.includes(d));
  const onlyB = b.directives.filter((d) => !a.directives.includes(d));
  const cfgOnlyA = cfgA.filter((d) => !cfgB.includes(d));
  const cfgOnlyB = cfgB.filter((d) => !cfgA.includes(d));

  console.log(`\n  ⚠️ the comparison below is on what actually PARTICIPATES, not what is configured:`);
  console.log(`     configured only in CONTROL : ${cfgOnlyA.map((d) => (a.directives.includes(d) ? d : `${d} (EXCLUDED from scoring)`)).join(', ') || '(none)'}`);
  console.log(`     configured only in VARIANT : ${cfgOnlyB.map((d) => (b.directives.includes(d) ? d : `${d} (EXCLUDED from scoring)`)).join(', ') || '(none)'}`);
  console.log(`     participating only in CONTROL : ${onlyA.join(', ') || '(none)'}`);
  console.log(`     participating only in VARIANT : ${onlyB.join(', ') || '(none)'}`);

  const dead = Number(a.ticks) === 0 || Number(b.ticks) === 0;
  if (dead) {
    console.log(
      `\n  🛑 CANNOT JUDGE — ${Number(a.ticks) === 0 ? slugA : slugB} has no snapshots in this window.` +
        ` A comparison needs BOTH arms alive; two silent protocols also "agree".`,
    );
  } else {
    const diff = Number(b.meanComposite) - Number(a.meanComposite);
    console.log(
      `\n  verdict: variant mean composite is ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} vs control ` +
        `over ${Math.min(Number(a.ticks), Number(b.ticks))} comparable tick window(s).`,
    );
    if (Number(a.ticks) !== Number(b.ticks)) {
      console.log('  ⚠️ the arms did not tick the same number of times — treat the mean as indicative, not exact.');
    }
  }
}

function report(findings) { return findings; }

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const smIdx = argv.indexOf('--stale-minutes');
  const staleMinutes = smIdx >= 0 ? Number(argv[smIdx + 1]) : 120;
  const conn = connect();

  // ── --compare: the control/variant report, then stop (it is a different question) ──
  const cmpIdx = argv.indexOf('--compare');
  if (cmpIdx >= 0) {
    const slugA = argv[cmpIdx + 1];
    const slugB = argv[cmpIdx + 2];
    if (!slugA || !slugB) {
      console.error('[protocol-health] --compare needs TWO protocol slugs: --compare <control> <variant>');
      process.exit(2);
    }
    const hrsIdx = argv.indexOf('--hours');
    printComparison(conn, slugA, slugB, hrsIdx >= 0 ? Number(argv[hrsIdx + 1]) : 24);
    return;
  }

  const out = { generatedAt: new Date().toISOString(), staleMinutes, sections: {} };

  // ── Q1 — data source ────────────────────────────────────────────────────────
  const providers = parseTsv(query(`
    SELECT b.provider AS provider, COUNT(*) AS nrows, COUNT(DISTINCT s.ticker) AS nsyms,
           MAX(b.timestamp) AS newest
    FROM marketbar b JOIN symbol s ON s.id = b.symbolId
    WHERE b.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
    GROUP BY b.provider ORDER BY nrows DESC`, conn));
  const nonMt5 = providers.filter((p) => !MT5_PROVIDERS.includes(String(p.provider).toLowerCase()));
  out.sections.q1 = {
    providers: providers.map((p) => ({ ...p, nrows: Number(p.nrows), nsyms: Number(p.nsyms), isMt5: MT5_PROVIDERS.includes(String(p.provider).toLowerCase()) })),
    nonMt5Providers: nonMt5.map((p) => p.provider),
  };

  // ── Q3 + Q1 per symbol: freshness and provider of the newest bar ────────────
  const symbols = parseTsv(query(`
    SELECT s.ticker AS ticker, b.provider AS provider,
           TIMESTAMPDIFF(MINUTE, MAX(b.timestamp), UTC_TIMESTAMP()) AS ageMin
    FROM marketbar b JOIN symbol s ON s.id = b.symbolId
    WHERE b.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
    GROUP BY s.ticker, b.provider
    ORDER BY s.ticker`, conn));
  const bestBySymbol = new Map();
  for (const s of symbols) {
    const cur = bestBySymbol.get(s.ticker);
    if (!cur || Number(s.ageMin) < Number(cur.ageMin)) bestBySymbol.set(s.ticker, s);
  }
  out.sections.q3 = [];
  for (const [ticker, s] of [...bestBySymbol].sort()) {
    out.sections.q3.push({
      symbol: ticker,
      provider: s.provider,
      ageMinutes: Number(s.ageMin),
      verdict: classifySource(s.provider, Number(s.ageMin), staleMinutes),
    });
  }

  // ── Q5/Q4 per active protocol ───────────────────────────────────────────────
  const protos = parseTsv(query(`
    SELECT pu.slug AS slug, pu.directionMode AS directionMode,
           (SELECT COUNT(*) FROM score sc WHERE sc.strategyId = pu.slug
              AND sc.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS scored,
           (SELECT COUNT(*) FROM score sc WHERE sc.strategyId = pu.slug
              AND sc.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
              AND sc.breakdown IS NOT NULL
              AND JSON_LENGTH(JSON_EXTRACT(sc.breakdown, '$.breakouts')) > 0) AS withBreakdown,
           (SELECT COUNT(*) FROM score_snapshot sn WHERE sn.protocolId = pu.slug
              AND sn.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS snapshotted,
           (SELECT COUNT(*) FROM symbol_protocol_assignment a WHERE a.protocolId = pu.id) AS assigned,
           (SELECT COUNT(*) FROM watchlist w WHERE w.protocolId = pu.id) AS watchlists
    FROM protocol pu WHERE pu.active = 1 ORDER BY pu.slug`, conn));

  out.sections.q5 = [];
  for (const p of protos) {
    const reachable = Number(p.assigned) > 0 || Number(p.watchlists) > 0;
    out.sections.q5.push({
      slug: p.slug,
      directionMode: p.directionMode,
      scored: Number(p.scored),
      withBreakdown: Number(p.withBreakdown),
      snapshotted: Number(p.snapshotted),
      assignedSymbols: Number(p.assigned),
      storage: classifyStorage({ scored: Number(p.scored) > 0, snapshotted: Number(p.snapshotted) > 0, reachable }),
    });
  }

  // ── Q2 — directives starved of bars, read from their own recorded reasons ───
  const starved = parseTsv(query(`
    SELECT strategyId AS slug, COUNT(*) AS ticks
    FROM score
    WHERE timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
      AND JSON_SEARCH(breakdown, 'one', '%Insufficient data%') IS NOT NULL
    GROUP BY strategyId ORDER BY ticks DESC`, conn));
  out.sections.q2 = { protocolsReportingShortfall: starved.map((s) => ({ slug: s.slug, ticks: Number(s.ticks) })) };

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  render(out);
}

function render(out) {
  const s = out.sections;
  const bar = (n, t) => console.log(`\n── ${n} ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

  bar('1', 'DATA SOURCE (is it MT5?)');
  for (const p of s.q1.providers) {
    console.log(`  ${p.isMt5 ? '✅' : '⚠️ '} ${String(p.provider).padEnd(12)} rows=${String(p.nrows).padStart(7)} symbols=${p.nsyms} newest=${p.newest}`);
  }
  if (s.q1.nonMt5Providers.length) {
    console.log(`  ⚠️  NOT an MT5 provider: ${s.q1.nonMt5Providers.join(', ')} — data for those symbols does not come from your MT5 accounts`);
  }

  bar('3', 'MARKET DATA STORED + FRESH');
  const byVerdict = {};
  for (const r of s.q3) (byVerdict[r.verdict] ||= []).push(r.symbol);
  console.log(`  ${s.q3.length} symbol(s) with bars in 7d — stale threshold ${out.staleMinutes}m`);
  for (const [v, syms] of Object.entries(byVerdict)) {
    const icon = v === 'ok' ? '✅' : v === 'not-mt5' ? '⚠️ ' : '🛑';
    console.log(`  ${icon} ${v}: ${syms.length}${v === 'ok' ? '' : ' -> ' + syms.slice(0, 12).join(', ') + (syms.length > 12 ? ' …' : '')}`);
  }

  bar('2', 'DIRECTIVE DATA (bars they declared)');
  if (!s.q2.protocolsReportingShortfall.length) console.log('  ✅ no directive reported a bar shortfall in 24h');
  for (const p of s.q2.protocolsReportingShortfall) console.log(`  🛑 ${p.slug.padEnd(24)} ${p.ticks} tick(s) with a shortfall`);

  bar('4/5', 'RESULTS + SCORE STORED (per active protocol)');
  const counts = {};
  for (const p of s.q5) (counts[p.storage] ||= []).push(p.slug);
  console.log(`  ${s.q5.length} active protocol(s)`);
  for (const [k, v] of Object.entries(counts)) {
    const icon = k === 'ok' ? '✅' : k === 'unreachable' ? '⚙️ ' : '🛑';
    console.log(`  ${icon} ${k.padEnd(16)} ${String(v.length).padStart(3)}${k === 'ok' ? '' : ' -> ' + v.slice(0, 10).join(', ') + (v.length > 10 ? ' …' : '')}`);
  }
  const scoreOnly = s.q5.filter((p) => p.storage === 'score-only');
  if (scoreOnly.length) {
    console.log('  🛑 score-only = the score is written but NO snapshot: analysis cannot be replayed from it');
    for (const p of scoreOnly) console.log(`       ${p.slug} (scored=${p.scored}, snapshots=0)`);
  }
}

function selfTest() {
  let bad = 0;
  const ok = (name, cond) => { if (!cond) bad++; console.log(`  ${cond ? '✅' : '✖ '} ${name}`); };

  // Q1: an MT5 provider that is fresh is OK; a non-MT5 provider is flagged even when fresh.
  ok('mt5 + fresh = ok', classifySource('mt5', 5, 120) === 'ok');
  ok('pepperstoneuk counts as MT5', classifySource('PepperstoneUK', 5, 120) === 'ok');
  ok('binance is NOT MT5, even when perfectly fresh', classifySource('binance', 5, 120) === 'not-mt5');
  ok('mt5 but old = stale', classifySource('mt5', 800, 120) === 'stale');
  ok('no provider = no-bars', classifySource('', null, 120) === 'no-bars');

  // Q2: the shortfall is read from the directive's own words.
  const st = classifyStarvation('Insufficient data: need 58 bars, have 56.');
  ok('parses a shortfall', st && st.needs === 58 && st.have === 56 && st.short === 2);
  ok('a healthy reason yields no shortfall', classifyStarvation('Vol: ATR=0.18% (p10)') === null);

  // Storage: an empty table on an UNREACHABLE protocol is a config gap, not a storage fault.
  ok('reachable + both = ok', classifyStorage({ scored: true, snapshotted: true, reachable: true }) === 'ok');
  ok('reachable + neither = nothing-written', classifyStorage({ scored: false, snapshotted: false, reachable: true }) === 'nothing-written');
  ok('score without snapshot is its own verdict', classifyStorage({ scored: true, snapshotted: false, reachable: true }) === 'score-only');
  ok('UNREACHABLE is never reported as a storage fault', classifyStorage({ scored: false, snapshotted: false, reachable: false }) === 'unreachable');

  // The signal-label constant: STRONG_* are separate values, not prefixes.
  ok('DIRECTIONAL_SQL covers all four labels', DIRECTIONAL_SQL === "('BUY','SELL','STRONG_BUY','STRONG_SELL')");

  // --compare interpolates protocol slugs into SQL, so escaping must be right.
  ok('sqlString quotes a slug', sqlString('mt5-technical-short') === "'mt5-technical-short'");
  ok("sqlString escapes an embedded quote", sqlString("a'b") === "'a''b'");

  console.log(bad === 0
    ? `\n[protocol-health] ✅ self-test passed — 12 checks\n`
    : `\n[protocol-health] ✖ self-test FAILED — ${bad}\n`);
  return bad === 0 ? 0 : 1;
}

if (require.main === module) main();

module.exports = { classifySource, classifyStarvation, classifyStorage, MT5_PROVIDERS };
