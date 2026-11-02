#!/usr/bin/env node
/**
 * report-symbol-priority-ties.cjs — which symbols have MORE THAN ONE protocol at the same
 * priority, so that "which protocol wins" is storage order rather than intent (#1181).
 *
 * WHY THIS EXISTS
 * ---------------
 * `symbol_protocol_assignment` is unique on `(symbol, protocolId)`, **not** on `(symbol, priority)`.
 * So two protocols can claim one symbol at the same priority, and `resolveProtocolForSymbol()`
 * (speed-scan) used to order by `priority` alone — a stable-but-undefined pick that survives
 * review and then changes on a rebuild with no error. The resolver now carries a second, unique
 * sort key (register row 130), which makes the pick deterministic; this tool exists so the
 * AMBIGUITY ITSELF stays visible instead of being quietly resolved by a tiebreak.
 *
 * ⚠️ NOT IN `prebuild`, and that is deliberate: it needs a live database. Gates that need the DB
 * are on demand in this repo (`db:check`, `db:schema-drift`, `db:config-refs`) — a build must not
 * fail because MySQL is down. The deterministic half IS guarded in `prebuild` by
 * `single-scoring-path.spec.ts`, which needs no database.
 *
 * WHAT A TIE COSTS — the ranking below is not cosmetic
 * ---------------------------------------------------
 *   • A tie at the symbol's LOWEST priority is DECISIVE: it decides which protocol the Speed
 *     Trading screener ("Best Symbol" / Auto-Switch) reports for that symbol.
 *   • If that decisive tie includes an INACTIVE protocol, the consequence is worse than a wrong
 *     label: the resolver returns the row, then speed-scan skips the symbol because the protocol is
 *     inactive. A symbol that has an active protocol assigned can therefore be skipped entirely.
 *
 * Scope: speed-scan only. The canonical scoring path scores EVERY symbol a protocol is assigned to
 * and never calls the resolver, so no score, signal or gate depends on this ordering.
 *
 * USAGE
 * -----
 *   node nest/scripts/report-symbol-priority-ties.cjs            # report (exit 0 always)
 *   node nest/scripts/report-symbol-priority-ties.cjs --strict   # exit 1 when a DECISIVE tie exists
 *   node nest/scripts/report-symbol-priority-ties.cjs --json     # machine-readable
 *   node nest/scripts/report-symbol-priority-ties.cjs --self-test  # prove the classifier can fail
 */

const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'mysql-cli.cjs'));

/**
 * Classify raw tie rows. PURE — takes rows, returns findings. Extracted so `--self-test` can prove
 * the severity logic without a database (a self-test that needs prod data is not a self-test).
 *
 * @param {{symbol:string, priority:number|string, protocols:string, n:number|string,
 *          minActive:number|string, maxActive:number|string}[]} rows
 * @param {Record<string, number>} minPriorityBySymbol lowest priority assigned to each symbol
 */
function classify(rows, minPriorityBySymbol) {
  const findings = [];
  for (const r of rows) {
    const symbol = String(r.symbol);
    const priority = Number(r.priority);
    const n = Number(r.n);
    if (n < 2) continue;
    const decisive = priority === minPriorityBySymbol[symbol];
    const hasInactive = Number(r.minActive) === 0;
    const hasActive = Number(r.maxActive) === 1;
    findings.push({
      symbol,
      priority,
      protocols: String(r.protocols || '').split(',').filter(Boolean),
      count: n,
      decisive,
      severity: !decisive ? 'latent' : hasInactive && hasActive ? 'decisive-mixed' : 'decisive',
    });
  }
  // Worst first: a decisive tie that can skip a scoreable symbol outranks a decisive tie.
  const rank = { 'decisive-mixed': 0, decisive: 1, latent: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.symbol.localeCompare(b.symbol));
}

const SQL = `
SELECT t.symbol, t.priority, t.protocols, t.n, t.minActive, t.maxActive
FROM (
  SELECT a.symbol AS symbol,
         a.priority AS priority,
         GROUP_CONCAT(CONCAT(pu.slug, IF(pu.active = 1, '', ' [INACTIVE]')) ORDER BY pu.slug) AS protocols,
         COUNT(*) AS n,
         MIN(pu.active) AS minActive,
         MAX(pu.active) AS maxActive
  FROM symbol_protocol_assignment a
  JOIN protocol pu ON pu.id = a.protocolId
  GROUP BY a.symbol, a.priority
  HAVING COUNT(*) > 1
) t
ORDER BY t.symbol, t.priority
`;

const MIN_SQL = `
SELECT symbol, MIN(priority) AS minPriority
FROM symbol_protocol_assignment
GROUP BY symbol
`;

/** Parse `mysql --batch --raw` TSV (header line then rows). */
function parseTsv(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);
  if (lines.length < 1) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i];
    });
    return row;
  });
}

function report(findings) {
  if (findings.length === 0) {
    console.log('[symbol-priority-ties] ✅ no symbol has two protocols at the same priority');
    return;
  }
  const decisive = findings.filter((f) => f.severity !== 'latent');
  console.log(
    `[symbol-priority-ties] ${findings.length} tie(s): ${decisive.length} decisive, ` +
      `${findings.length - decisive.length} latent (below the winning priority — no effect)`,
  );
  console.log('');
  console.log('severity'.padEnd(16), 'symbol'.padEnd(10), 'pri', 'protocols');
  for (const f of findings) {
    console.log(
      f.severity.padEnd(16),
      f.symbol.padEnd(10),
      String(f.priority).padStart(3),
      f.protocols.join(' | '),
    );
  }
  const mixed = findings.filter((f) => f.severity === 'decisive-mixed');
  if (mixed.length) {
    console.log('');
    console.log(
      'ℹ️  decisive-mixed = the tied protocols differ in `active`. Since #1181 the resolver PREFERS',
    );
    console.log(
      '   the active one, so the symbol is NOT skipped — but `priority` still fails to express which',
    );
    console.log(
      '   protocol you meant, and the pick is made for you. Give these distinct priorities: ' +
        mixed.map((m) => m.symbol).join(', '),
    );
  }
}

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // Direction 1: a decisive tie between two active protocols.
  let f = classify(
    [{ symbol: 'AAA', priority: 0, protocols: 'p1,p2', n: 2, minActive: 1, maxActive: 1 }],
    { AAA: 0 },
  );
  ok('a tie at the winning priority is DECISIVE', f.length === 1 && f[0].severity === 'decisive');

  // Direction 2: a tie BELOW the winning priority must not be called decisive.
  f = classify(
    [{ symbol: 'AAA', priority: 2, protocols: 'p1,p2', n: 2, minActive: 1, maxActive: 1 }],
    { AAA: 0 },
  );
  ok('a tie below the winning priority is LATENT, not decisive', f.length === 1 && f[0].severity === 'latent');

  // Direction 3: decisive + one inactive member outranks a plain decisive tie.
  f = classify(
    [
      { symbol: 'ZZZ', priority: 0, protocols: 'a,b', n: 2, minActive: 1, maxActive: 1 },
      { symbol: 'AAA', priority: 0, protocols: 'a,b [INACTIVE]', n: 2, minActive: 0, maxActive: 1 },
    ],
    { AAA: 0, ZZZ: 0 },
  );
  ok('a decisive tie touching an inactive protocol sorts FIRST', f[0].severity === 'decisive-mixed');

  // Direction 4: a single row is never a tie — the guard must not fire on healthy data.
  f = classify(
    [{ symbol: 'AAA', priority: 0, protocols: 'p1', n: 1, minActive: 1, maxActive: 1 }],
    { AAA: 0 },
  );
  ok('one assignment is NOT a tie', f.length === 0);

  // Direction 5: the TSV parser must read the client's real output shape, not a guess.
  const parsed = parseTsv('symbol\tpriority\tprotocols\nEURUSD\t0\tp1,p2\n');
  ok('parses the mysql --batch TSV shape', parsed.length === 1 && parsed[0].symbol === 'EURUSD');

  for (const r of results) console.log(`  ${r.pass ? '✅' : '✖ '} ${r.name}`);
  const failed = results.filter((r) => !r.pass).length;
  if (failed) {
    console.error(`\n[symbol-priority-ties] ✖ self-test FAILED — ${failed}/${results.length}\n`);
    return 1;
  }
  console.log(`\n[symbol-priority-ties] ✅ self-test passed — ${results.length}/${results.length} checks\n`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const conn = connect();
  const rows = parseTsv(query(SQL, conn));
  const mins = parseTsv(query(MIN_SQL, conn));
  const minPriorityBySymbol = {};
  for (const m of mins) minPriorityBySymbol[String(m.symbol)] = Number(m.minPriority);

  const findings = classify(
    rows.map((r) => ({ ...r, n: Number(r.n) })),
    minPriorityBySymbol,
  );

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ties: findings, scannedAt: new Date().toISOString() }, null, 2) + '\n');
  } else {
    report(findings);
  }

  if (argv.includes('--strict') && findings.some((f) => f.severity !== 'latent')) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { classify, parseTsv };
