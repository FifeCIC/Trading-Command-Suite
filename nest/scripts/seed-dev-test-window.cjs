/**
 * seed-dev-test-window.cjs — write the canonical development window as `backtest_period` rows (#1132).
 *
 * ⚠️ WHY A SEEDER AND NOT A HAND-WRITTEN ROW. A direct database write that is not in the repo is lost
 * on reinstall (`database-seed-discipline.instructions.md`). The window is configuration, so each of
 * its rows must be recreatable from source.
 *
 * ⚠️ `backtest_period` is PER SYMBOL and PER TIMEFRAME — `symbolId` and `timeframe` are NOT NULL. A
 * global development window cannot be one row, so this writes one row per (symbol, timeframe) that
 * the window is defined for. `POST /api/backtest/run` already resolves a `periodId`, so nothing else
 * needs to change to use it.
 *
 * ⚠️ THERE IS NO UNIQUE KEY on (name, symbolId, timeframe) — only an index. So this cannot use an
 * upsert; it finds the row first and updates it, and reports which rows it created versus updated.
 * Two concurrent runs could both miss and both create; that is acceptable for a development seeder
 * and is stated rather than hidden. `--check` reports duplicates if it ever happens.
 *
 * USAGE (from nest/):
 *   node scripts/seed-dev-test-window.cjs            # dry run — prints what it would do
 *   node scripts/seed-dev-test-window.cjs --apply    # write
 *   node scripts/seed-dev-test-window.cjs --check    # verify the rows exist and match (exit 1 if not)
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

/**
 * The constants come from the COMPILED module so there is exactly one source of truth. A hand-copied
 * date here would be a second place to drift — and the whole point of a frozen window is that nobody
 * moves it by accident.
 */
let W;
try {
  W = require('../dist/src/modules/backtest/dev-test-window.js');
} catch {
  // A stale or missing build must be a loud, actionable failure, not a silent fallback to hard-coded
  // dates that could disagree with what the API serves.
  console.error('[dev-window-seed] ✖ cannot load the compiled constants.');
  console.error('                 Run first:  npm --prefix nest run build:api');
  console.error('                 (this seeder deliberately does not carry its own copy of the dates)');
  process.exit(2);
}

const { DEV_TEST_WINDOW: WIN, DEV_TEST_TIMEFRAMES: TFS, DEV_TEST_SYMBOLS: SYMBOLS } = W;
const NAME = W.devTestPeriodName();

const NOTE =
  `CANONICAL DEVELOPMENT TESTING WINDOW (${WIN.version}). Frozen: ${WIN.from} to ${WIN.to}. ` +
  'Development comparisons must run inside this window so past and future work is measured on the ' +
  'same data. The start is COMPUTED, not chosen: it is the first date every traded symbol has bars ' +
  'at every development timeframe (2026-10-22 measurement; US500 at 5m is the binding symbol — ' +
  '15m common from 2026-09-08, 1h from 2026-08-28, 5m from 2026-09-09). The END is fixed too: ' +
  '"to today" would move every midnight and yesterday\'s result would stop being comparable. ' +
  '⚠️ DO NOT EDIT THESE DATES IN PLACE — bump the version, extend the dates, re-seed. Moving a ' +
  'frozen window silently invalidates every earlier comparison. See #1132.';

const fromDate = new Date(`${WIN.from}T00:00:00Z`);
const toDate = new Date(`${WIN.to}T23:59:59Z`);

(async () => {
  console.log(`[dev-window-seed] ${NAME} · ${WIN.from} → ${WIN.to}`);
  console.log(`[dev-window-seed] ${SYMBOLS.length} symbol(s) × ${TFS.length} timeframe(s) = ${SYMBOLS.length * TFS.length} row(s)`);
  console.log(`[dev-window-seed] mode: ${CHECK ? 'CHECK' : APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const symbols = await prisma.symbol.findMany({
    where: { ticker: { in: SYMBOLS } },
    select: { id: true, ticker: true },
  });
  const byTicker = new Map(symbols.map((s) => [s.ticker, s.id]));

  const missingSymbols = SYMBOLS.filter((t) => !byTicker.has(t));
  if (missingSymbols.length) {
    // A missing symbol is a finding: the window's coverage claim names these tickers, so a gap means
    // the measurement and the database disagree.
    console.error(`[dev-window-seed] ✖ ABORT: symbol(s) not found: ${missingSymbols.join(', ')}`);
    console.error('                 The coverage measurement names these tickers; refusing to seed a');
    console.error('                 partial window that would look complete.');
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let duplicates = 0;
  const problems = [];

  for (const ticker of SYMBOLS) {
    const symbolId = byTicker.get(ticker);
    for (const timeframe of TFS) {
      const existing = await prisma.backtestPeriod.findMany({
        where: { name: NAME, symbolId, timeframe },
        select: { id: true, fromDate: true, toDate: true, note: true },
      });
      if (existing.length > 1) {
        duplicates++;
        console.warn(`  ⚠️ ${ticker} ${timeframe}: ${existing.length} rows named ${NAME} — duplicates`);
      }
      const row = existing[0];
      if (!row) {
        const matches = await prisma.backtestPeriod.count({
          where: { name: NAME, symbolId, timeframe },
        });
        // Re-count so a duplicate cannot be reported as a create.
        if (matches > 0) { unchanged++; continue; }
        if (CHECK) { problems.push(`${ticker} ${timeframe}: MISSING`); continue; }
        if (APPLY) {
          await prisma.backtestPeriod.create({
            data: { name: NAME, note: NOTE, symbolId, timeframe, fromDate, toDate },
          });
        }
        created++;
        console.log(`  ${APPLY ? 'created' : 'would create'}  ${ticker.padEnd(7)} ${timeframe}`);
        continue;
      }
      const sameDates =
        row.fromDate.toISOString().slice(0, 10) === WIN.from &&
        row.toDate.toISOString().slice(0, 10) === WIN.to;
      if (sameDates && row.note === NOTE) {
        unchanged++;
        if (CHECK) console.log(`  ok       ${ticker.padEnd(7)} ${timeframe}`);
        continue;
      }
      if (CHECK) {
        problems.push(`${ticker} ${timeframe}: ${row.fromDate.toISOString().slice(0, 10)}→${row.toDate.toISOString().slice(0, 10)} (expected ${WIN.from}→${WIN.to})`);
        continue;
      }
      if (APPLY) {
        await prisma.backtestPeriod.update({
          where: { id: row.id },
          data: { fromDate, toDate, note: NOTE },
        });
      }
      updated++;
      console.log(`  ${APPLY ? 'updated' : 'would update'}  ${ticker.padEnd(7)} ${timeframe}  (was ${row.fromDate.toISOString().slice(0, 10)}→${row.toDate.toISOString().slice(0, 10)})`);
    }
  }

  console.log(`\n[dev-window-seed] created ${created} · updated ${updated} · unchanged ${unchanged}`
    + `${duplicates ? ` · ⚠️ ${duplicates} duplicate group(s)` : ''}`);
  if (CHECK && problems.length) {
    console.error(`[dev-window-seed] ✖ ${problems.length} row(s) do not match the declared window:`);
    for (const p of problems) console.error(`                   ${p}`);
    process.exit(1);
  }
  if (CHECK) console.log('[dev-window-seed] ✅ every declared row exists and matches the constant');
  if (!APPLY && !CHECK) console.log('[dev-window-seed] dry run — nothing written. Re-run with --apply.');
})().catch((err) => {
  console.error(`[dev-window-seed] ✖ ABORT: ${err?.message ?? err}`);
  process.exit(2);
}).finally(() => prisma.$disconnect());
