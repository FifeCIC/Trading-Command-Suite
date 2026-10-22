/**
 * audit-dev-window-coverage.cjs — what date window can a DEVELOPMENT test actually use?
 *
 * ⚠️ WHY THIS EXISTS. A fixed development testing window is only scientific if every run inside it
 * has the same data. It is not a preference: the window is bounded by when bars EXIST for every
 * symbol and timeframe the active protocols use. Measured 2026-10-22 for the seven traded symbols:
 *
 *     timeframe   earliest ANY symbol   ALL SEVEN covered from
 *     15m         2026-08-05            2026-09-08
 *     1h          2026-08-05            2026-08-28
 *     5m          2026-08-05            2026-09-09
 *
 * A window chosen from taste ("the last 6 months") silently gives some symbols a shorter history than
 * others, which is the same two-bases defect the scoring work keeps finding: two runs look comparable
 * and are not. So the start of the window is COMPUTED, not chosen.
 *
 * ⚠️ `backtest_period` rows are PER SYMBOL and PER TIMEFRAME (`symbolId` + `timeframe` are NOT NULL),
 * so a global development window cannot be one stored period. This reports the per-timeframe window
 * that WOULD be common, which is what a seeder or a config constant should carry.
 *
 *   node scripts/audit-dev-window-coverage.cjs
 *   node scripts/audit-dev-window-coverage.cjs --self-test
 *   node scripts/audit-dev-window-coverage.cjs --symbols=XAUUSD,VIX --timeframes=1h,15m
 */
const { execFileSync } = require('node:child_process');

const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysql.exe';
const DB_ARGS = ['--user=tradingcs', '--password=tradingcs_dev_2026', '--host=127.0.0.1', '--database=tradingcs', '--skip-column-names', '--raw'];
const DEFAULT_SYMBOLS = ['XAUUSD', 'XAGUSD', 'VIX', 'SPY', 'US500', 'BTC', 'EURUSD'];
const DEFAULT_TIMEFRAMES = ['5m', '15m', '1h'];

/**
 * Pure: given per-(symbol,timeframe) first-bar dates, what is the latest common start and the
 * earliest any symbol has? Returned per timeframe so a caller can pick the one that suits it.
 *
 * `rows` is an array of { timeframe, symbol, first } where `first` is an ISO date string.
 */
function commonWindow(rows) {
  const byTf = new Map();
  for (const r of rows) {
    if (!byTf.has(r.timeframe)) byTf.set(r.timeframe, new Map());
    byTf.get(r.timeframe).set(r.symbol, r.first);
  }
  const out = new Map();
  for (const [tf, perSymbol] of byTf) {
    const dates = [...perSymbol.values()].sort();
    if (dates.length === 0) continue;
    out.set(tf, {
      // Latest of the per-symbol starts = the first date EVERY symbol has.
      commonStart: dates[dates.length - 1],
      earliestAny: dates[0],
      symbols: dates.length,
      // Named so a reader can see WHICH symbol is the constraint, not just the date.
      boundedBy: [...perSymbol.entries()].filter(([, d]) => d === dates[dates.length - 1]).map(([s]) => s).sort(),
    });
  }
  return out;
}

function selfTest() {
  let failures = 0;
  const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? '✔' : '✖'} ${label}`); };

  const rows = [
    { timeframe: '1h', symbol: 'A', first: '2026-08-05' },
    { timeframe: '1h', symbol: 'B', first: '2026-08-28' },
    { timeframe: '1h', symbol: 'C', first: '2026-08-10' },
    { timeframe: '5m', symbol: 'A', first: '2026-08-05' },
    { timeframe: '5m', symbol: 'B', first: '2026-08-05' },
  ];
  const w = commonWindow(rows);
  check('common start is the LATEST per-symbol start, not the earliest', w.get('1h').commonStart === '2026-08-28');
  check('the constraining symbol is NAMED', w.get('1h').boundedBy.join(',') === 'B');
  check('a fully-covered timeframe reports its own start', w.get('5m').commonStart === '2026-08-05');
  check('earliest-any is reported separately from the common start', w.get('1h').earliestAny === '2026-08-05');

  // The failure this guards: taking the MIN instead of the MAX gives a window that silently
  // truncates the symbols that start later.
  const wrong = [...rows.filter((r) => r.timeframe === '1h').map((r) => r.first)].sort()[0];
  check('MIN would have been wrong (proves the direction matters)', wrong === '2026-08-05' && wrong !== w.get('1h').commonStart);

  check('one symbol yields its own start', commonWindow([{ timeframe: '1h', symbol: 'A', first: '2026-01-01' }]).get('1h').commonStart === '2026-01-01');
  check('an empty population yields no timeframe entry', commonWindow([]).size === 0);

  console.log(failures === 0
    ? '[dev-window] ✅ self-test passed (7 checks)'
    : `[dev-window] ✖ self-test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : fallback;
};
const symbols = arg('symbols', DEFAULT_SYMBOLS);
const timeframes = arg('timeframes', DEFAULT_TIMEFRAMES);

const inList = (xs) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
const sql = `
  SELECT DATE_FORMAT(MIN(b.timestamp), '%Y-%m-%d'), b.timeframe, s.ticker
  FROM marketbar b JOIN symbol s ON s.id = b.symbolId
  WHERE s.ticker IN (${inList(symbols)}) AND b.timeframe IN (${inList(timeframes)})
  GROUP BY b.timeframe, s.ticker`;

let out;
try {
  out = execFileSync(MYSQL, [...DB_ARGS, '--execute=' + sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  console.error(`[dev-window] ✖ ABORT: could not read marketbar — ${err?.message ?? err}`);
  process.exit(2);
}

const rows = [];
for (const line of out.split('\n')) {
  if (!line.includes('\t')) continue;
  const [first, timeframe, symbol] = line.split('\t');
  rows.push({ timeframe, symbol, first });
}
if (rows.length === 0) {
  console.error('[dev-window] ✖ ABORT: no bars found for the requested symbols/timeframes.');
  console.error('              Refusing to recommend a window from an empty measurement.');
  process.exit(2);
}

const windows = commonWindow(rows);
console.log(`[dev-window] symbols: ${symbols.join(', ')}`);
console.log(`[dev-window] timeframes: ${timeframes.join(', ')}\n`);
console.log('  timeframe   symbols   earliest any   ALL covered from   bounded by');
for (const tf of timeframes) {
  const w = windows.get(tf);
  if (!w) { console.log(`  ${tf.padEnd(11)} 0 — NO COVERAGE`); continue; }
  const short = w.symbols < symbols.length ? `  ⚠️ only ${w.symbols} of ${symbols.length}` : '';
  console.log(`  ${tf.padEnd(11)} ${String(w.symbols).padStart(7)}   ${w.earliestAny}      ${w.commonStart}         ${w.boundedBy.join(',')}${short}`);
}

const common = [...windows.values()].map((w) => w.commonStart).sort();
const strictest = common[common.length - 1];
console.log(`\n[dev-window] STRICTEST window (every symbol, every requested timeframe): from ${strictest}`);
console.log('             A development test window starting earlier than this gives some symbols less');
console.log('             history than others, and the comparison reads as like-for-like when it is not.');
console.log('\n⚠️ `backtest_period` rows are per SYMBOL and per TIMEFRAME — a global window is not one');
console.log('   stored period. This is the number a constant or seeder should carry, not a row.');
