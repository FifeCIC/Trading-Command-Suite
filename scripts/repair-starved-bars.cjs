#!/usr/bin/env node
/**
 * repair-starved-bars.cjs — force a provider import for symbols the refresh service reports as starved (#1179).
 *
 * WHY THIS EXISTS
 * ---------------
 * `GET /api/market-data/bars/refresh/status` runs every 5 minutes and reports `lastUpserted`
 * in the thousands — it looks healthy — while listing 12 symbols whose newest bar is 400+
 * hours old. A protocol whose symbols are all starved is exactly as silent as one with
 * `active = 0`: no score row, no error, no stale badge. Measured 2026-11-01: QQQ 459h,
 * WTI 1,257h, eight FX crosses 445h.
 *
 * `POST /api/imports/refresh/:symbolId` bypasses the queue and calls the adapters directly.
 * Measured the same day: it returned `{barsImported: 60, source: 'real'}` for QQQ, so the
 * starvation is a scheduling gap, not a provider failure — which is why this is a repair and
 * not a `catch`.
 *
 * ⚠️ `marketbar` is keyed (symbolId, timeframe, timestamp) and the endpoint de-duplicates, so
 * running this twice is safe and adds nothing the second time.
 *
 * 🛑 `barsImported` IS NOT EVIDENCE THE STARVATION IS FIXED — measured 2026-11-01.
 * The endpoint reports the number of rows WRITTEN. For WTI it returned
 * `{barsImported: 300, source: 'real'}` on all six timeframes while the newest stored bar stayed
 * at **2026-09-10** — the provider's intraday WTI feed ends there, so 300 bars from "its latest"
 * are all old, and every one of them was a valid new row. A count that large reads as success and
 * measures the wrong thing. So this script **verifies the newest stored bar after each import**
 * and treats "wrote bars, newest still stale" as a FAILURE. That is the whole reason it queries
 * the table at all instead of printing the API's answer.
 *
 * USAGE
 *   node scripts/repair-starved-bars.cjs --dry-run
 *   node scripts/repair-starved-bars.cjs
 */

/** A timeframe counts as repaired when its newest bar is younger than this many hours. */
const MAX_AGE_HOURS = { '1m': 2, '5m': 2, '15m': 3, '1h': 4, '4h': 12, '1d': 96 };

const ROOT = require('path').resolve(__dirname, '..');
const API = 'http://localhost:3201/api';

/**
 * Only symbols with a live consumer. UK100 / FRA40 / GER40 were on the starved list too, but
 * their protocols were retired in the same change, so repairing their bars buys nothing —
 * stated here rather than silently omitted.
 */
const PIPELINES = [
  { tickers: ['QQQ'], why: 'qqq-speed-v1 + qqq-day-v1 (both active)', weekendGapOk: true, timeframes: ['1m', '5m', '15m', '1h', '4h'] },
  { tickers: ['WTI'], why: 'oil-speed-v1 (active, 1 bot)', weekendGapOk: false, timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'] },
  {
    tickers: ['AUDJPY', 'EURCAD', 'EURCHF', 'EURGBP', 'EURJPY', 'GBPCAD', 'GBPJPY', 'NZDJPY'],
    why: 'forex-session-v1 (active) — 8 of its 15 pairs',
    weekendGapOk: false,
    timeframes: ['5m', '1h', '1d'],
  },
];

const LIMIT = { '1m': 300, '5m': 300, '15m': 300, '1h': 300, '4h': 300, '1d': 120 };

/**
 * Newest stored bar for one symbol+timeframe. `ageHours` is `null` when there are no bars at all —
 * kept distinct from a large number, because "no data" and "old data" need different responses.
 * `weekday` comes back too: an equity ETF that last traded on a Friday is *closed*, not stale.
 */
async function newestBar(symbolId, timeframe) {
  const { PrismaClient } = require(`${ROOT}/nest/node_modules/@prisma/client`);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT MAX(timestamp) last FROM marketbar WHERE symbolId = ? AND timeframe = ?`,
      symbolId, timeframe,
    );
    const last = rows[0] && rows[0].last;
    if (!last) return { ageHours: null, weekday: null };
    const at = new Date(last);
    return { ageHours: (Date.now() - at.getTime()) / 3_600_000, weekday: at.getUTCDay() };
  } finally {
    await prisma.$disconnect();
  }
}

/** Friday 17:00 UTC onward, or a Saturday/Sunday, is outside a US equity session. */
const WEEKEND_GAP_MAX_HOURS = 80;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { PrismaClient } = require(`${ROOT}/nest/node_modules/@prisma/client`);
  const prisma = new PrismaClient();

  const all = PIPELINES.flatMap((p) => p.tickers);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, ticker FROM symbol WHERE ticker IN (${all.map(() => '?').join(',')})`,
    ...all,
  );
  const byTicker = new Map(rows.map((r) => [r.ticker, r.id]));
  await prisma.$disconnect();

  const missing = all.filter((t) => !byTicker.has(t));
  if (missing.length) {
    console.error(`❌ no symbol row for: ${missing.join(', ')} — refusing to guess an id`);
    process.exit(1);
  }

  const results = [];
  for (const pipe of PIPELINES) {
    for (const ticker of pipe.tickers) {
      for (const timeframe of pipe.timeframes) {
        const url = `${API}/imports/refresh/${byTicker.get(ticker)}?timeframe=${timeframe}&limit=${LIMIT[timeframe] || 200}`;
        if (dryRun) {
          console.log(`would POST ${ticker} ${timeframe}`);
          continue;
        }
        let out = { barsImported: 0, source: '-', error: null };
        try {
          const res = await fetch(url, { method: 'POST' });
          const body = await res.json();
          out = {
            barsImported: Number(body.barsImported ?? 0),
            source: body.source ?? (body.error ? 'error' : '-'),
            error: body.error ?? body.message ?? null,
          };
        } catch (e) {
          out.error = e && e.message ? e.message : String(e);
        }

        // The API's count is a claim. The stored newest bar is the observation.
        const { ageHours, weekday } = await newestBar(byTicker.get(ticker), timeframe);
        const limitH = MAX_AGE_HOURS[timeframe] ?? 6;
        const fresh = ageHours !== null && ageHours <= limitH;
        // Friday(5)/Saturday(6)/Sunday(0) with a modest gap = the market is shut, not a broken feed.
        const closedForWeekend =
          !fresh && pipe.weekendGapOk && ageHours !== null &&
          ageHours <= WEEKEND_GAP_MAX_HOURS && [5, 6, 0].includes(weekday);
        const verdict = out.error ? 'error' : fresh ? 'repaired' : closedForWeekend ? 'closed' : 'STILL STALE';
        results.push({ ticker, timeframe, ...out, ageHours, verdict });

        const flag = out.error ? '✖' : fresh || closedForWeekend ? '✔' : '⚠';
        const age = ageHours === null ? 'no bars' : `${ageHours.toFixed(1)}h`;
        console.log(
          `${flag} ${ticker.padEnd(8)} ${timeframe.padEnd(4)} wrote=${String(out.barsImported).padStart(4)} newest=${age.padStart(9)} ${verdict}${out.error ? '  ' + out.error : ''}`,
        );
      }
    }
  }

  if (dryRun) return;

  const wrote = results.reduce((a, r) => a + r.barsImported, 0);
  const repaired = results.filter((r) => r.verdict === 'repaired');
  const closed = results.filter((r) => r.verdict === 'closed');
  const stillStale = results.filter((r) => r.verdict === 'STILL STALE');
  const errored = results.filter((r) => r.verdict === 'error');

  console.log(
    `\n${results.length} request(s) · ${wrote} row(s) written · ` +
      `✔ ${repaired.length} fresh · ✔ ${closed.length} closed for the weekend · ` +
      `⚠ ${stillStale.length} still stale · ✖ ${errored.length} error(s)`,
  );

  if (stillStale.length) {
    console.log('\nSTILL STALE — the provider returned no bar inside the window, so the feed itself is stale:');
    for (const s of stillStale) {
      console.log(`  ${s.ticker} ${s.timeframe}: wrote ${s.barsImported}, newest ${s.ageHours === null ? 'none' : s.ageHours.toFixed(1) + 'h'} old`);
    }
  }
  for (const e of errored) console.log(`  ${e.ticker} ${e.timeframe}: ${e.error}`);

  if (stillStale.length || errored.length) process.exit(1);
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
