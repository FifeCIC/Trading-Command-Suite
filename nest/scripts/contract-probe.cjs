#!/usr/bin/env node
/**
 * contract-probe.cjs — LIVE checks for the pipeline invariants that cannot be verified statically.
 * =================================================================================================
 * Companion to `.github/instructions/meta-stack-contracts.instructions.md` and
 * `validate-pipeline-contracts.cjs`.
 *
 * WHY A SEPARATE SCRIPT
 * ---------------------
 * The build-time validator can prove a mechanism still *exists* and that no banned pattern has
 * been introduced. It cannot prove the running system is producing correct data — that needs the
 * live API, the bridges, and the database. Checks that lived only in an agent's terminal (e.g. the
 * arena-vs-database "asOf" comparison that verified #751) evaporated once the session ended, so
 * the next agent had to re-derive them. This script is that verification, made repeatable.
 *
 * Reads nest/.env for DATABASE_URL (Prisma does not load .env itself — the CLI does).
 * Uses the COMPILED cadence mapping from dist/ so it cannot drift from the app; run
 * `npm run build` first if dist/ is missing.
 *
 * Usage (from nest/):  node scripts/contract-probe.cjs [--symbol AUDUSD] [--stale BTCUSD]
 * Exit code: 1 if any check FAILS, 0 otherwise (skips are reported but not fatal).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const NEST_ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:3201';

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIVE_SYMBOL = argOf('--symbol', 'AUDUSD');       // a symbol with several cadences present

/**
 * INV-BAR-ALIGNED (#783) only judges bars newer than this instant.
 *
 * WHY A CUTOFF AND NOT "all rows". The 30-minute-offset rows written by the bulk
 * back-fill are known-bad and are purged by a separate cleanup. If this check counted
 * them forever it would be permanently red, and a guard that is never green is a guard
 * everyone learns to ignore — which is strictly worse than no guard, because it reports
 * a number nobody trusts. The cutoff makes the check mean "no NEW misaligned bar has
 * been written since the fix", which is the property that can actually regress.
 *
 * Override with `--aligned-since 2026-09-11T00:00:00Z` when validating a cleanup.
 */
const ALIGNED_SINCE = new Date(argOf('--aligned-since', '2026-09-11T00:00:00Z'));

// The symbol-derivation hints are the source of truth for INV-SYMBOL-HINTS-RESOLVE.
// Import lazily: the module is TypeScript-adjacent plain JS, and a failure to load it
// must skip the check rather than break the whole probe.
let allDerivedSymbolTargets = () => [];
try {
  ({ allDerivedSymbolTargets } = require(path.join(NEST_ROOT, 'dist', 'src', 'modules', 'scoring', 'protocol-db.service.js')));
} catch (err) {
  allDerivedSymbolTargets = () => { throw new Error(`could not load protocol-db.service: ${err.message}`); };
}

const results = [];
function record(invariant, name, ok, detail, skipped = false) {
  results.push({ invariant, name, ok, detail, skipped });
}

function request(method, url, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      timeout: timeoutMs,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getJson(url) {
  const { status, body } = await request('GET', url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function loadCadenceMapper() {
  const compiled = path.join(NEST_ROOT, 'dist', 'src', 'common', 'utils', 'timeframe.js');
  if (!fs.existsSync(compiled)) return null;
  const mod = require(compiled);
  return mod.selectBaseTimeframe || null;
}

async function main() {
  loadEnv();
  let prisma = null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.log(`SKIP  database checks — could not connect via Prisma (${err.message.split('\n')[0]})`);
    prisma = null;
  }

  // Cheap reachability probe. If the API is not listening there is no point attempting the
  // heavier checks — and the SKIP reason will say so explicitly instead of being blank.
  // (An empty skip reason once made three checks look like they ran when they never did.)
  let apiUp = false;
  try {
    const res = await request('GET', `${API}/api/health`, null, 5000);
    apiUp = res.status === 200;
  } catch { apiUp = false; }
  const apiSkipReason = apiUp
    ? null
    : `the NestJS API is not answering at ${API} — start it (npm --prefix nest run start) and re-run; these checks need live scoring`;

  // ── INV-NO-FUTURE-ROWS ─────────────────────────────────────────────────
  //
  // ⚠️ THE CONTRACT IS NOT "no row is later than now" (#780, corrected 2026-09-10).
  //
  // A bar is stamped by its OPEN time. A currently-forming bar is therefore
  // LEGITIMATELY ahead of the wall clock — by up to one bar length:
  //
  //     a forming 15m bar opens at 19:15 while the clock reads 19:02  ->  +13 min, correct
  //     a forming  1m bar opens at 19:02 while the clock reads 19:01  ->  +1  min, correct
  //
  // The original check used a bare `> now` and so failed on healthy data: it counted
  // 41 marketbar + 136 directiveoutcome rows as violations when every one of them was a
  // forming bar or an outcome derived from one (discovered while investigating #780 —
  // it still failed immediately after 226 genuine orphans had been pruned).
  //
  // `directiveoutcome.predictedAt` inherits the EVALUATED BAR's open time, so it must be
  // judged by that bar's timeframe too. Measured: its maximum lead was 758s, exactly the
  // same as the forming 15m marketbar — i.e. derived, not independent.
  //
  // The real violation is a row ahead by MORE than one bar length: that cannot be a
  // forming bar, and because the refresh only upserts timestamps it fetched, such a row
  // can never be overwritten — it stays MAX(timestamp) for its symbol indefinitely.
  //
  // TODO(#780): positions/trades keep the strict `> now` test — an opened/closed trade
  // is a completed action, not a forming bar, so it has no legitimate reason to lead.
  if (prisma) {
    try {
      const now = new Date();
      // Lead, in seconds, allowed for a forming bar of each cadence. Anything beyond is
      // impossible by construction.
      //
      // ⚠️ WHY THIS IS `cadence × 2`, NOT JUST `cadence` (fixed 2026-09-11)
      // ----------------------------------------------------------------
      // A bar may legitimately exist for the NEXT period, not only the CURRENT one.
      // `BarRefreshService.doRefresh()` upserts whatever `getCandles()` returns, and a
      // provider publishes the just-opened bar as soon as the prior one closes. So at
      // 21:57:30 a `1m` bar stamped `21:59` is one whole cadence ahead of the clock and is
      // still legitimate.
      //
      // With the old allowance of exactly 60s for `1m`, that row was reported as an orphan:
      //     lead = 90s  >  allowed 60 + 1  ->  ORPHAN   (false positive)
      // It then **self-corrected the moment the clock passed 21:58:00**, so the check was
      // INTERMITTENT — it failed or passed depending on the second the probe happened to run.
      //
      // ⚠️ An intermittent guard is the worst kind: it looks like coverage, it burns
      // investigation time, and it teaches the reader to ignore the result. Measured live:
      // FAILED at 21:58:10 with `orphans=8 worst=1m @ 21:59:00`, PASSED at 21:58:34 with
      // `orphans=0`, same data, no writes between the two runs.
      //
      // What this check exists to catch (#750/#780) is a row skewed by HOURS (a broker
      // server/UTC mix-up produced ~3h leads), so `2 × cadence` still catches it by a wide
      // margin while removing the boundary race.
      //
      // ⚠️ SCOPE OF THE TOLERANCE — do not read this as "any lead up to 2 cadences is fine"
      // in a general sense. `<cadence?>` is only loosely bounded by the provider's own
      // lookback: `BarRefreshService.LIVE_LIMIT` defaults to 200 bars
      // (`BAR_REFRESH_LIVE_LIMIT`), so the practical window is generous for SLOW cadences
      // (200 × `1h` ≈ 8 days) and only ~3h for `1m`. The `2 ×` multiplier is chosen purely
      // to clear the ONE-cadence boundary race; it is not a claim that two cadences of lead
      // is normal.
      const CADENCE_SECONDS = {
        '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
      };
      const LEAD_FOR = (tf) => (CADENCE_SECONDS[tf] ?? 86400) * 2;

      // ⚠️ `now` is captured ONCE and passed to both halves of the UNION ALL, and it is also
      // used for the `positions`/`trades` counts below. If the query were re-evaluated with a
      // different `now`, a row could be classified against one instant and reported against
      // another. Keeping one instant makes the whole check internally consistent.
      const rows = await prisma.$queryRawUnsafe(`
        SELECT timeframe, timestamp FROM marketbar WHERE timestamp > ?
        UNION ALL
        SELECT timeframe, predictedAt FROM directiveoutcome WHERE predictedAt > ?
      `, now, now);

      const orphans = rows.filter((r) => {
        const lead = (new Date(r.timestamp).getTime() - now.getTime()) / 1000;
        return lead > LEAD_FOR(r.timeframe) + 1; // +1s tolerance for clock jitter
      });

      const [positions, trades] = await Promise.all([
        prisma.position.count({ where: { openedAt: { gt: now } } }),
        prisma.trade.count({ where: { OR: [{ openedAt: { gt: now } }, { closedAt: { gt: now } }] } }),
      ]);

      const formingBars = rows.length - orphans.length;
      const total = orphans.length + positions + trades;
      const worst = orphans.length
        ? ` worst=${orphans[0].timeframe} @ ${new Date(orphans[0].timestamp).toISOString()}`
        : '';
      record('INV-NO-FUTURE-ROWS',
        'no row is dated beyond its own bar length (forming bars excluded)',
        total === 0,
        `orphans=${orphans.length}${worst} position=${positions} trade=${trades}` +
        ` (ignored ${formingBars} legitimate forming bar/outcome row(s);` +
        ` a row beyond its bar length is unoverwritable and means the #750/#780 skew is back)`);
    } catch (err) {
      record('INV-NO-FUTURE-ROWS',
        'no row is dated beyond its own bar length (forming bars excluded)',
        false, `query failed: ${err.message}`);
    }
  } else {
    record('INV-NO-FUTURE-ROWS',
      'no row is dated beyond its own bar length (forming bars excluded)',
      true, 'skipped — no DB connection', true);
  }

  // ── INV-BAR-ALIGNED (#783) ─────────────────────────────────────────────
  //
  // ⚠️ THIS ONE IS DIFFERENT FROM EVERY OTHER BAR INVARIANT: it inspects DATA, not code.
  //
  // The pre-existing bar invariants are all marker-presence canaries —
  // `INV-BAR-ORDER` only asserts that `normalizeDirectiveBars`/`bars.sort(` EXIST, and
  // `INV-SINGLE-CADENCE` only asserts `selectBaseTimeframe` exists. Neither can see that
  // the rows themselves are duplicated. That is why ~27,376 phantom bars sat in the table
  // undetected (#783).
  //
  // THE DEFECT. `importBars()` stored timestamps verbatim and deduped solely on the exact
  // (symbolId, timeframe, timestamp) key. A re-import that stamped a bar 30 minutes
  // differently therefore wrote a SECOND row for the same period, because `13:30` and
  // `13:00` are genuinely different timestamps — `P2002` never fired, so the constraint
  // could not help itself. Measured: 1,227 of 1,256 mt5 `1d` rows at 21:30 were
  // byte-identical duplicates of the real 21:00 bar.
  //
  // WHY IT MATTERS BEYOND "duplicate rows". The phantom sits 30 minutes from the real bar,
  // so the series' MEDIAN INTERVAL becomes 30m on a daily series. `computeMarketStatus()`
  // derives `effectiveCadenceMs` from that median, so a fake cadence silently changes the
  // staleness window for every `1h`/`4h`/`1d` protocol — plausible numbers, no error.
  //
  // The fix floors each timestamp to its cadence boundary at import, which makes the
  // offset duplicate collapse onto the real bar so the unique key rejects it.
  //
  // This check asserts the OUTCOME: within one (symbol, timeframe, provider) series, every
  // timestamp must sit on a valid boundary for that cadence. `1d` is judged per-provider
  // (mt5 21:00, binance 00:00, yahoo 07:00) because the daily boundary is a property of
  // the market, not of UTC — a blanket 21:00 rule would misfire on binance.
  if (prisma) {
    try {
      // ── How `1d` is judged ──────────────────────────────────────────────
      //
      // NOT against a hardcoded boundary table. Two attempts at one were wrong on
      // healthy data:
      //   1. "must be 21:00 UTC"  -> failed for binance (00:00) and yahoo.
      //   2. per-provider table   -> still failed, because yahoo legitimately uses
      //      THREE different boundaries across its symbols (measured: 07:00, 13:30,
      //      00:00) depending on the exchange whose close it reports.
      //
      // The daily boundary is a property of the MARKET, and one provider can serve
      // several markets. So the rule is RELATIVE, per series: every daily bar for one
      // (symbol, provider) must share a SINGLE time-of-day. Two different time-of-day
      // stamps in one series is exactly the phantom signature — measured for mt5:
      // 21:00 (3,689 bars) alongside 21:30 (1,256 bars), where 1,227 of the 21:30 rows
      // are byte-identical duplicates of the real 21:00 bar.
      //
      // A guard that fires on correct code gets switched off, which is worse than no
      // guard at all. This rule passes mt5/binance/yahoo as they actually are.
      const dailyOffsets = new Map(); // "symbolId|provider" -> Map<minuteOfDay, count>

      // Only rows newer than this are judged. Historic rows written before the fix are
      // known-bad and are purged separately; counting them forever would make this check
      // permanently red and therefore ignored — a guard that is never green is a guard
      // nobody reads.
      const rows = await prisma.$queryRawUnsafe(`
        SELECT symbolId, timeframe, provider, timestamp
          FROM marketbar
         WHERE timeframe IN ('1h', '4h', '1d', '1w')
           AND timestamp > ?
      `, ALIGNED_SINCE);

      // Gather the per-series daily offsets. Queried without the time cutoff on purpose:
      // one series' boundary convention should be learned from ALL its history, not just
      // the recent slice, so a partially-migrated series is still judged coherently.
      const allDaily = await prisma.$queryRawUnsafe(`
        SELECT symbolId, provider, timestamp FROM marketbar WHERE timeframe = '1d'
      `);
      for (const r of allDaily) {
        const d = new Date(r.timestamp);
        const key = `${r.symbolId}|${r.provider}`;
        if (!dailyOffsets.has(key)) dailyOffsets.set(key, new Map());
        const mod = d.getUTCHours() * 60 + d.getUTCMinutes();
        const m = dailyOffsets.get(key);
        m.set(mod, (m.get(mod) ?? 0) + 1);
      }

      // ⚠️ `4h` is judged against its OWN series' stride, NOT an absolute UTC hour.
      //
      // First attempt hardcoded "must be a multiple of 4 hours from midnight UTC" and
      // immediately failed on HEALTHY data: mt5 4h bars sit at 01/05/09/13/17/21, a +1h
      // offset, because the broker server's day boundary is not UTC. Measured 696 rows
      // per offset — legitimate, not misaligned. So this rule is relative too: a 4h
      // series is fine as long as every bar is a whole number of 4h steps from the
      // series' own origin.
      const fourHourOffsets = new Map(); // "symbolId|provider" -> Set of hour-mod-4
      if (rows.some((r) => r.timeframe === '4h')) {
        const all4h = await prisma.$queryRawUnsafe(`
          SELECT symbolId, provider, timestamp FROM marketbar WHERE timeframe = '4h'
        `);
        for (const r of all4h) {
          const key = `${r.symbolId}|${r.provider}`;
          if (!fourHourOffsets.has(key)) fourHourOffsets.set(key, new Set());
          fourHourOffsets.get(key).add(new Date(r.timestamp).getUTCHours() % 4);
        }
      }

      const bad = [];
      for (const r of rows) {
        const tf = r.timeframe;
        const d = new Date(r.timestamp);
        const minute = d.getUTCMinutes();
        const second = d.getUTCSeconds();
        const msPart = d.getUTCMilliseconds();
        const prov = String(r.provider ?? '').toLowerCase();
        const seriesKey = `${r.symbolId}|${r.provider}`;

        if (tf === '1d') {
          const offsets = dailyOffsets.get(seriesKey);
          // One series, one boundary. A second distinct time-of-day is the phantom.
          if (offsets && offsets.size > 1) {
            // Name the DOMINANT offset as correct and flag the minority, so the detail
            // line points at the rows to delete rather than at the healthy majority.
            const ranked = [...offsets.entries()].sort((a, b) => b[1] - a[1]);
            const dominant = ranked[0][0];
            const mine = d.getUTCHours() * 60 + minute;
            if (mine !== dominant) {
              bad.push({ tf, provider: prov, ts: d.toISOString() });
            }
          }
          continue;
        }
        if (tf === '1w') {
          // Monday 00:00 UTC.
          if (minute !== 0 || second !== 0 || msPart !== 0
              || d.getUTCHours() !== 0 || d.getUTCDay() !== 1) {
            bad.push({ tf, provider: prov, ts: d.toISOString() });
          }
          continue;
        }
        if (tf === '4h') {
          // Must sit on the minute grid and agree modulo 4h with its series' origin.
          if (minute !== 0 || second !== 0 || msPart !== 0) {
            bad.push({ tf, provider: prov, ts: d.toISOString() });
            continue;
          }
          const mods = fourHourOffsets.get(seriesKey);
          if (mods && mods.size > 0 && !mods.has(d.getUTCHours() % 4)) {
            bad.push({ tf, provider: prov, ts: d.toISOString() });
          }
          continue;
        }
        // `1h` must sit on the hour — this one IS absolute and safe, since every
        // broker's hour grid coincides with UTC's (the offset is whole hours).
        if (minute !== 0 || second !== 0 || msPart !== 0) {
          bad.push({ tf, provider: prov, ts: d.toISOString() });
        }
      }

      const worst = bad.slice(0, 3)
        .map((b) => `${b.tf}/${b.provider}@${b.ts}`)
        .join(', ');
      record('INV-BAR-ALIGNED',
        'every 1h/4h/1d/1w bar timestamp sits on a valid cadence boundary (per provider)',
        bad.length === 0,
        bad.length
          ? `${bad.length} misaligned row(s) newer than ${ALIGNED_SINCE.toISOString().slice(0,10)} — `
            + `worst: ${worst}. An offset bar duplicates the real one and fakes the cadence (#783).`
          : `checked ${rows.length} row(s) newer than ${ALIGNED_SINCE.toISOString().slice(0,10)}; all on valid boundaries`);
    } catch (err) {
      record('INV-BAR-ALIGNED',
        'every 1h/4h/1d/1w bar timestamp sits on a valid cadence boundary (per provider)',
        false, `query failed: ${err.message}`);
    }
  } else {
    record('INV-BAR-ALIGNED',
      'every 1h/4h/1d/1w bar timestamp sits on a valid cadence boundary (per provider)',
      true, 'skipped — no DB connection', true);
  }

  // ── INV-UTC-TIMESTAMPS ─────────────────────────────────────────────────
  for (const port of [5000, 5001]) {
    try {
      const health = await getJson(`http://127.0.0.1:${port}/health`);
      const offset = health.serverUtcOffsetSeconds;
      const ok = typeof offset === 'number';
      record('INV-UTC-TIMESTAMPS', `bridge :${port} reports a measured clock offset`, ok,
        ok ? `serverUtcOffsetSeconds=${offset} (${(offset / 3600).toFixed(2)}h)` : 'serverUtcOffsetSeconds MISSING — pre-#750 bridge build, timestamps will run ~3h ahead');
    } catch (err) {
      record('INV-UTC-TIMESTAMPS', `bridge :${port} reports a measured clock offset`, true, `skipped — bridge not reachable (${err.message})`, true);
    }
  }

  // ── INV-BAR-ORDER / INV-SINGLE-CADENCE ─────────────────────────────────
  const mapCadence = loadCadenceMapper();
  const barOrderSkip = !apiUp ? apiSkipReason : !prisma ? 'no database connection' : !mapCadence ? 'dist/ missing — run `npm run build`' : null;
  if (barOrderSkip) {
    record('INV-BAR-ORDER', 'the newest bar the arena sees is really the newest bar', true, `skipped — ${barOrderSkip}`, true);
    record('INV-SINGLE-CADENCE', 'each protocol is scored on a single cadence', true, `skipped — ${barOrderSkip}`, true);
  } else {
    try {
      const res = await request('POST', `${API}/api/scoring/arena/compare`, { symbols: [LIVE_SYMBOL] }, 180000);
      if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status} ${res.body.slice(0, 120)}`);
      const comparison = JSON.parse(res.body).comparison || [];
      const scores = (comparison[0]?.protocolScores || []).filter((s) => s.marketStatus?.asOf);
      if (scores.length === 0) throw new Error('no scored protocols with a marketStatus');

      const symbol = await prisma.symbol.findFirst({ where: { ticker: LIVE_SYMBOL }, select: { id: true } });
      const byCadence = new Map();
      for (const s of scores) {
        const cadence = mapCadence(s.timeframe);
        if (!byCadence.has(cadence)) byCadence.set(cadence, new Set());
        byCadence.get(cadence).add(new Date(s.marketStatus.asOf).toISOString());
      }

      const problems = [];
      const observations = [];
      /** Lags that are explained by unavailable data, rather than by wrong scoring. */
      const explained = [];
      for (const [cadence, asOfSet] of byCadence) {
        const newest = await prisma.marketBar.findFirst({
          where: { symbolId: symbol.id, timeframe: cadence },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        });
        if (!newest) { observations.push(`${cadence}: no bars in DB`); continue; }
        const newestIso = newest.timestamp.toISOString();
        const asOfs = [...asOfSet];
        // The arena's asOf must be the newest bar for that cadence. A one-bar lag is allowed
        // (a bar can close between the arena scoring and this query).
        const matched = asOfs.some((a) => Math.abs(new Date(a) - newest.timestamp) <= 5 * 60_000);
        observations.push(`${cadence}: arena asOf=${asOfs.join('|')} newest bar=${newestIso}${matched ? ' ✓' : ' ✗'}`);
        if (matched) continue;

        // ⚠️ NOT EVERY LAG IS A BUG — AND TREATING ONE AS A BUG COSTS REAL TIME
        // -------------------------------------------------------------------
        // #795 (2026-09-11, filed as priority-high then closed as NOT-A-BUG) was exactly
        // this: a 15-minute bar gap that appeared for 29 of 30 symbols at once. The cause was
        // a **bridge restart at 20:52 from development activity**, and the gap then
        // **self-healed** over successive refresh cycles (0 → 5 → 10 symbols refilled) because
        // `BarRefreshService` re-fetches by COUNT (200 bars ≈ 16.7h at 5m), so it reaches back
        // past any plausible development gap.
        //
        // The arena's `asOf` was CORRECT in that case — it was the newest bar when scoring ran.
        // The lag was in the DATA, not in the scoring. Reporting it as a contract failure sends
        // an agent hunting a scoring bug that does not exist.
        //
        // So: a lag is only a CONTRACT VIOLATION if bars for those minutes exist and were
        // skipped. If no bars exist for the missing window, the lag is explained by absent
        // data — report it, do not fail on it.
        const laggingMinutes = Math.round(
          (newest.timestamp - new Date(asOfs[0])) / 60_000,
        );
        const lookbackStart = new Date(new Date(asOfs[0]).getTime() + 60_000);
        const barsInWindow = await prisma.marketBar.count({
          where: { symbolId: symbol.id, timeframe: cadence, timestamp: { gte: lookbackStart, lt: newest.timestamp } },
        });

        if (barsInWindow > 0) {
          // Bars DO exist between asOf and newest, yet the arena did not see them. That is the
          // real defect INV-BAR-ORDER names (#751): stale/ordered/mis-filtered reads.
          problems.push(`${cadence} (${barsInWindow} bar(s) exist between asOf and newest — arena did not see them)`);
        } else {
          // No bars to see. The lag is a DATA gap, which is expected when a bridge restarts
          // during development and which self-heals.
          explained.push(
            `${cadence}: ${laggingMinutes}min behind, but ZERO bars exist in that window ` +
              `(data gap, not a scoring bug — expected after a bridge restart; self-heals on re-fetch)`,
          );
        }
      }
      record('INV-BAR-ORDER', `arena asOf equals the newest real bar per cadence (${LIVE_SYMBOL})`, problems.length === 0,
        [observations.join('; '), ...explained.map((e) => `⚠ not a failure: ${e}`)].join(' | '));

      // ⚠️ INV-SINGLE-CADENCE — WHAT THIS CAN AND CANNOT PROVE
      // ------------------------------------------------------
      // It previously reported the SAME boolean as INV-BAR-ORDER, so it (a) failed whenever
      // bar-order failed — even when cadence was perfectly correct — and (b) never tested
      // cadence-mixing at all. Measured 2026-09-11: it reported
      // "5 cadences resolved: 15m, 5m, 1d, 1h, 1m" for AUDUSD as a FAILURE, but that is
      // CORRECT BEHAVIOUR — AUDUSD legitimately feeds per-timeframe protocols
      // (`xau-speed-m5` / `-m15` / `-1h` / `-4h` / `1d`), the design settled by the #751
      // arena-cadence decision. Grouping by SYMBOL means one symbol feeding several
      // per-timeframe protocols looks like a mixed-cadence array.
      //
      // ⚠️ A guard that fails on correct configuration gets switched off, which is worse than
      // no guard because it looks like coverage.
      //
      // ⚠️ AND AN HONEST LIMIT: the arena payload does NOT expose the per-protocol bar array
      // (`protocolScores[].timeframe` is a single string; there is no `timeframes[]`). So this
      // probe can verify that **every protocol resolves to a cadence** and that the resolved
      // cadence is one of the KNOWN cadences — it CANNOT see a protocol whose internal bar
      // array spliced several timeframes together. That #751 defect class is guarded
      // structurally by the `INV-SINGLE-CADENCE` marker canary in `timeframe.ts` plus
      // `timeframe.spec.ts`, and behaviourally by `INV-CADENCE-COVERAGE` below.
      //
      // Stating the limit is deliberate: a check that silently cannot fire is
      // indistinguishable from a check that passes. If a `timeframes[]` field is ever added to
      // the payload, tighten this to assert it has length <= 1.
      const protocols = comparison[0]?.protocolScores || [];
      const KNOWN_CADENCES = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
      const unresolved = protocols.filter((s) => !KNOWN_CADENCES.has(mapCadence(s.timeframe)));
      const cadenceCounts = [...new Set(protocols.map((s) => mapCadence(s.timeframe)).filter(Boolean))];
      const canSeeArrays = protocols.some((s) => Array.isArray(s.timeframes));
      record(
        'INV-SINGLE-CADENCE',
        `each protocol resolves to exactly one known cadence (${LIVE_SYMBOL})`,
        unresolved.length === 0,
        unresolved.length === 0
          ? `${protocols.length} protocol(s) each resolve to ONE known cadence — ${cadenceCounts.length} distinct cadence(s) across protocols (${cadenceCounts.sort().join(', ')}), which is the intended per-timeframe design.` +
            (canSeeArrays
              ? ''
              : ` ⚠️ LIMIT: the payload exposes no per-protocol \`timeframes[]\`, so a protocol whose bar array spliced multiple timeframes cannot be detected HERE — that class is covered by the INV-SINGLE-CADENCE marker in timeframe.ts + timeframe.spec.ts + INV-CADENCE-COVERAGE below.`)
          : `${unresolved.length} protocol(s) resolved to an UNKNOWN cadence: ${unresolved.map((s) => `${s.protocolId || '?'}→"${s.timeframe}"`).join(', ')} — cadence must resolve from recommendedTimeframe via selectBaseTimeframe(); an unresolved cadence means the protocol is being fed something the coverage guard does not know about (#758).`,
      );
    } catch (err) {
      const why = err && err.message ? err.message : String(err);
      record('INV-BAR-ORDER', `arena asOf equals the newest real bar per cadence (${LIVE_SYMBOL})`, true, `skipped — ${why}`, true);
      record('INV-SINGLE-CADENCE', `each protocol is scored on a single cadence (${LIVE_SYMBOL})`, true, `skipped — ${why}`, true);
    }
  }

  // ── INV-GATE-FAILS-CLOSED ──────────────────────────────────────────────
  //
  // The property under test: when a feed is frozen, every protocol reading it must
  // report the gate CLOSED. To test that we need a symbol that is genuinely frozen,
  // and we must NOT invent one by writing stale rows — that would test the fixture.
  //
  // So we discover one. If no active assigned symbol has a frozen feed, the premise
  // does not hold and the check SKIPS rather than passing — a pass would claim a
  // property it never exercised, which is the failure this whole probe exists to
  // avoid. Earlier this defaulted to a named symbol and went stale the moment that
  // symbol's feed was repaired (#761); discovery cannot rot that way.
  let staleSymbol = argOf('--stale', null);
  if (!staleSymbol && prisma) {
    try {
      const frozen = await prisma.$queryRawUnsafe(
        `SELECT s.ticker, MAX(b.timestamp) AS newest, COUNT(b.id) AS bars
           FROM symbol s
           JOIN marketbar b ON b.symbolId = s.id
          WHERE s.active = 1
            AND s.ticker IN (SELECT DISTINCT symbol FROM symbol_protocol_assignment)
          GROUP BY s.id, s.ticker
         HAVING TIMESTAMPDIFF(HOUR, MAX(b.timestamp), NOW()) > 24
          ORDER BY newest ASC
          LIMIT 1`,
      );
      if (frozen.length) staleSymbol = String(frozen[0].ticker);
    } catch { /* discovery is best-effort; fall through to the skip below */ }
  }

  if (!apiUp) {
    record('INV-GATE-FAILS-CLOSED', 'a frozen feed reads closed', true, `skipped — ${apiSkipReason}`, true);
  } else if (!staleSymbol) {
    record('INV-GATE-FAILS-CLOSED', 'a frozen feed reads closed', true,
      'skipped — no active protocol-assigned symbol currently has a feed older than 24h, so the premise cannot be exercised without fabricating stale rows (pass --stale <SYMBOL> to force one)', true);
  } else {
    try {
      const res = await request('POST', `${API}/api/scoring/arena/compare`, { symbols: [staleSymbol] }, 180000);
      if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status} ${res.body.slice(0, 120)}`);
      const comparison = JSON.parse(res.body).comparison || [];
      const scores = (comparison[0]?.protocolScores || []).filter((s) => s.marketStatus);
      const openCount = scores.filter((s) => s.marketStatus.open).length;
      record('INV-GATE-FAILS-CLOSED', `a frozen feed reads closed (${staleSymbol})`, scores.length > 0 && openCount === 0,
        scores.length === 0
          ? 'no protocols reported a marketStatus — cannot verify'
          : `${openCount}/${scores.length} protocols report open=true${openCount === 0 ? '' : ` — reason sample: ${scores.find((s) => s.marketStatus.open)?.marketStatus.reason || '(none)'}`}`);
    } catch (err) {
      record('INV-GATE-FAILS-CLOSED', `a frozen feed reads closed (${staleSymbol})`, true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-CADENCE-COVERAGE ───────────────────────────────────────────────
  //
  // The static validator proves the resolvable cadence set is a subset of the fetched
  // set. It CANNOT prove the fetched cadences are actually LANDING — a provider can
  // accept a request and return nothing, and an empty array is a legitimate state for
  // a new symbol. That is exactly how seven protocols spent six hours reporting
  // `scoring` with `symbolsScored: 2` while producing no rows: `1m` was never fetched,
  // so they received empty arrays and produced nothing, silently (#758).
  //
  // This check closes that gap by reconciling INTENT against DELIVERY:
  //   * which cadences do the ACTIVE protocols resolve to?   (intent)
  //   * which cadences does the DB actually hold bars for?   (delivery)
  // A cadence that is wanted but absent is a FAIL, because the protocols that want it
  // cannot score. It is reported per-cadence so the missing one is named.
  const coverageSkip = !prisma ? 'no database connection' : !mapCadence ? 'dist/ missing — run `npm run build`' : null;
  if (coverageSkip) {
    record('INV-CADENCE-COVERAGE', 'every cadence an active protocol resolves to has bars', true, `skipped — ${coverageSkip}`, true);
  } else {
    try {
      const active = await prisma.protocol.findMany({ where: { active: true }, select: { slug: true, recommendedTimeframe: true } });
      // What each active protocol WANTS, via the same mapper the app uses.
      const wanted = new Map();
      for (const p of active) {
        const cadence = mapCadence(p.recommendedTimeframe);
        if (!cadence) continue;
        if (!wanted.has(cadence)) wanted.set(cadence, []);
        wanted.get(cadence).push(p.slug);
      }

      // What the DB actually HOLDS, and how recent it is. Recency matters: a cadence
      // with 200 ancient bars satisfies "has bars" but cannot feed a live protocol.
      const FRESH_MS = { '1m': 2 * 3600_000, '5m': 4 * 3600_000, '15m': 8 * 3600_000, '1h': 24 * 3600_000, '4h': 48 * 3600_000, '1d': 96 * 3600_000 };
      const held = new Map();
      for (const cadence of wanted.keys()) {
        const newest = await prisma.marketBar.findFirst({
          where: { timeframe: cadence },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        });
        const count = await prisma.marketBar.count({ where: { timeframe: cadence } });
        const ageMs = newest ? Date.now() - newest.timestamp.getTime() : Infinity;
        held.set(cadence, { count, ageMs, newest: newest?.timestamp ?? null });
      }

      const missing = [];
      const stale = [];
      const observations = [];
      for (const [cadence, slugs] of wanted) {
        const h = held.get(cadence);
        if (!h || h.count === 0) {
          missing.push(`${cadence} (wanted by ${slugs.join(', ')})`);
          observations.push(`${cadence}: 0 bars but ${slugs.length} active protocol(s) resolve to it`);
          continue;
        }
        const fresh = h.ageMs <= (FRESH_MS[cadence] ?? 24 * 3600_000);
        observations.push(`${cadence}: ${h.count} bars, newest ${h.newest?.toISOString() ?? 'none'}${fresh ? ' ✓' : ' (stale)'}`);
        if (!fresh) stale.push(`${cadence} (newest ${h.newest?.toISOString()})`);
      }

      record('INV-CADENCE-COVERAGE', 'every cadence an active protocol resolves to has bars', missing.length === 0,
        missing.length > 0
          ? `MISSING: ${missing.join('; ')} — protocols resolving to these get empty arrays and score NOTHING while reporting "scoring". Add the cadence to TIMEFRAMES in bar-refresh.service.ts.`
          : `${observations.join('; ')}${stale.length ? ` | STALE: ${stale.join('; ')}` : ''}`);
    } catch (err) {
      record('INV-CADENCE-COVERAGE', 'every cadence an active protocol resolves to has bars', true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-PROVIDER-REACHABLE ─────────────────────────────────────────────
  //
  // Every ACTIVE symbol that a protocol depends on must be served by a provider that
  // can actually deliver it. Two distinct silent failures motivated this (#760):
  //
  //   1. A registry ticker the provider does not recognise. `SPX500`/`TECH100`/`DJI30`/
  //      `USOIL` had ZERO bars, ever, because those are not the provider's names —
  //      four active protocols could not score at all.
  //   2. A symbol whose provider adapter exists but is never called. Crypto was
  //      binance-sourced while the refresh loop hardcoded MT5, so BTC/ETH/DOGE aged out
  //      over 16–54 days without a single error.
  //
  // Both present identically: an empty result. This check reconciles assigned symbols
  // against delivered bars and names the ones that have never delivered anything.
  if (!prisma) {
    record('INV-PROVIDER-REACHABLE', 'every protocol-assigned active symbol has delivered bars', true, 'skipped — no database connection', true);
  } else {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT s.ticker,
                COUNT(b.id) AS bars,
                MAX(b.timestamp) AS newest
           FROM symbol s
           JOIN symbol_protocol_assignment a ON a.symbol = s.ticker
           LEFT JOIN marketbar b ON b.symbolId = s.id
          WHERE s.active = 1
          GROUP BY s.ticker
          ORDER BY bars ASC`,
      );
      const never = rows.filter((r) => Number(r.bars) === 0).map((r) => r.ticker);
      const total = rows.length;
      record('INV-PROVIDER-REACHABLE', `protocol-assigned active symbols have delivered bars (${total} checked)`, never.length === 0,
        never.length === 0
          ? `all ${total} have bars; oldest newest-bar: ${rows[0]?.ticker} @ ${rows[0]?.newest?.toISOString?.() ?? 'n/a'}`
          : `NEVER DELIVERED: ${never.join(', ')} — these are assigned to active protocols but no provider has ever produced a bar for them. Either the ticker is wrong for the provider, or no adapter is wired to fetch it.`);
    } catch (err) {
      record('INV-PROVIDER-REACHABLE', 'every protocol-assigned active symbol has delivered bars', true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-TRADEABLE-ROUTE ────────────────────────────────────────────────
  //
  // A symbol can be LISTED by a broker and still be REFUSED by it. The bridge's `/order`
  // pre-flight tests `tradeMode !== 4` and `volume < volumeMin` before it will send
  // anything, and the app could see neither — so US500 sat on the Signals ladder as a
  // fully actionable card while MetaQuotes reported `tradeMode 0`, and the refusal
  // ("US500 not tradeable (trade mode: 0)") appeared only AFTER the click.
  //
  // ⚠️ WHY THIS IS NOT SIMPLY "tradeMode MUST BE 4". `tradeMode` is a property of
  // BROKER × SYMBOL, and it drops to 0 whenever that market is shut — so the naive form
  // of this check is red every night and every weekend, and a guard that is never green
  // is one everyone learns to ignore (strictly worse than no guard).
  //
  // The SESSION-INDEPENDENT fault is: the routed broker refuses the symbol while ANOTHER
  // broker would accept it. That is a routing mistake, it is exactly what happened here,
  // and it is what this check fails on. When NO bridge accepts the symbol we cannot tell
  // "session closed" from "disabled" from here, so it is reported rather than failed.
  //
  // ⚠️ AND THE TWO READINGS OF "another broker accepts it" NEED DIFFERENT ACTIONS.
  // `symbol_route` chooses a broker for the FEED and for ORDERS at once, so a bridge that
  // accepts orders is not automatically the right route: if the only live FEED sits on the
  // broker that refuses orders, re-pointing would trade a live feed for tradability. The
  // discriminator is therefore the ALTERNATIVE broker's feed, not the routed one's.
  //
  // Worked example of the guard earning its keep (2026-09-15): it flagged US500 (no route
  // at all), then US30 and FRA40 — and on measuring both bridges, US30 and FRA40 turned out
  // to have live feeds on BOTH bridges with orders refused only on :5000, i.e. plain
  // mis-routes that were safe to re-point. ⚠️ An earlier 2-bar sample had made :5001's feed
  // look days stale; a 4-bar sample showed contiguous hourly bars. Measure the FEED before
  // deciding — a single narrow window is not enough to call a feed dead.
  if (!prisma) {
    record('INV-TRADEABLE-ROUTE', 'every traded symbol resolves to a broker that will accept it', true, 'skipped — no database connection', true);
  } else {
    try {
      const bridgePorts = [5000, 5001];
      const modesByPort = new Map(); // port -> Map(TICKER -> tradeMode)
      for (const port of bridgePorts) {
        try {
          const list = await getJson(`http://127.0.0.1:${port}/symbols`);
          modesByPort.set(port, new Map((list.symbols || []).map((s) => [String(s.name).toUpperCase(), s.tradeMode])));
        } catch {
          /* bridge down — it simply has no opinion below */
        }
      }
      if (modesByPort.size === 0) {
        record('INV-TRADEABLE-ROUTE', 'every traded symbol resolves to a broker that will accept it', true, 'skipped — no bridge reachable', true);
      } else {
        // Broker slot -> bridge port is declared by MT5_ACTIVE_BROKERS order (2 = :5000).
        const portByBroker = { 2: 5000, 3: 5001 };
        const rows = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT s.ticker AS ticker,
                  (SELECT sr.brokerId FROM symbol_route sr
                    WHERE sr.symbol = s.ticker AND sr.enabled = 1 AND sr.provider = 'mt5'
                    ORDER BY sr.priority ASC LIMIT 1) AS routedBroker
             FROM symbol s
             JOIN symbol_protocol_assignment a ON a.symbol = s.ticker
            WHERE s.active = 1`,
        );
        const primary = Number((process.env.MT5_ACTIVE_BROKERS || '2,3').split(',')[0]);
        const misrouted = [];
        const splits = [];
        const nowhere = [];
        /** Newest 1h bar a bridge can serve for a symbol — tells a LIVE feed from an absent one. */
        const newestBarAgeHours = async (port, ticker) => {
          try {
            const res = await getJson(`http://127.0.0.1:${port}/candles?symbol=${encodeURIComponent(ticker)}&timeframe=1h&limit=1`);
            const bars = res.bars || [];
            if (!bars.length) return null;
            const t = Date.parse(bars[bars.length - 1].timestamp);
            return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
          } catch {
            return null;
          }
        };
        const age = (h) => (h == null ? 'ABSENT' : `${h.toFixed(1)}h old`);
        for (const r of rows) {
          const ticker = String(r.ticker).toUpperCase();
          // An ABSENT route falls back to the primary broker — the silent fallback that
          // made this invisible in the first place, so it must be modelled, not ignored.
          const brokerId = r.routedBroker != null ? Number(r.routedBroker) : primary;
          const port = portByBroker[brokerId];
          const here = port != null ? modesByPort.get(port)?.get(ticker) : undefined;
          if (here === 4 || here === undefined) continue; // accepted here, or not served here (#719 covers that)
          const elsewhere = bridgePorts.filter((p) => p !== port && modesByPort.get(p)?.get(ticker) === 4);
          if (elsewhere.length === 0) {
            nowhere.push(`${ticker}(${here})`);
            continue;
          }
          // Two readings, and they need DIFFERENT actions, so they are reported apart.
          // The route serves the FEED as well as orders (one row, two jobs), so
          // "the other broker accepts orders" does not by itself mean re-route: for
          // FRA40 and US30 the routed broker is the only one with a live feed.
          const otherPort = elsewhere[0];
          const [routedAge, otherAge] = await Promise.all([
            newestBarAgeHours(port, ticker),
            newestBarAgeHours(otherPort, ticker),
          ]);
          // ⚠️ The discriminator is the ALTERNATIVE broker's feed, NOT the routed one's.
          // Re-pointing is only safe when the alternative can actually deliver the symbol;
          // that is the whole question. Measured 2026-09-15: US30 and FRA40 have live feeds
          // on BOTH bridges, so they are plain mis-routes (and were fixed). A symbol whose
          // live feed sits on the broker that refuses orders, while the broker that accepts
          // them cannot deliver it, is the genuine feed/trade split — re-pointing THAT one
          // would trade a live feed for tradability, so it needs a human decision.
          const altFeedLive = otherAge != null && otherAge < 6;
          if (altFeedLive) {
            misrouted.push(`${ticker}: :${port} REFUSES orders (tradeMode ${here}; feed ${age(routedAge)}) while :${otherPort} ACCEPTS them and feeds it live (${age(otherAge)}) — re-point the route`);
          } else {
            splits.push(`${ticker}: :${port} serves the LIVE feed (${age(routedAge)}) but REFUSES orders (tradeMode ${here}), and :${otherPort} accepts orders but its feed is ${age(otherAge)} — a DECISION is required`);
          }
        }
        const problems = [...misrouted, ...splits];
        record('INV-TRADEABLE-ROUTE', `traded symbols resolve to a broker that accepts them (${rows.length} checked)`,
          problems.length === 0,
          problems.length > 0
            ? `${misrouted.length ? `MIS-ROUTED (re-route safe): ${misrouted.join(' | ')}. ` : ''}${splits.length ? `FEED/TRADE SPLIT (decision required — symbol_route serves the FEED as well as orders, so re-pointing it trades a live feed for tradability): ${splits.join(' | ')}` : ''}`
            : (nowhere.length
              ? `all routes accepted; ${nowhere.length} symbol(s) not tradeable on ANY bridge at this instant (session shut or disabled — not distinguishable here): ${nowhere.slice(0, 8).join(', ')}`
              : 'every routed broker accepts its symbols'));
      }
    } catch (err) {
      record('INV-TRADEABLE-ROUTE', 'every traded symbol resolves to a broker that will accept it', true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-NO-SYMBOL-GUESSING ─────────────────────────────────────────────
  //
  // HISTORY: this check was INV-SYMBOL-HINTS-RESOLVE — "every target the hint tables can
  // produce resolves to a live, active, bar-delivering ticker". It caught the four stale
  // targets left by the #760 consolidation (#761: BTCUSD, USOIL, DOGEUSD, CHN50).
  //
  // #764 retired the tables entirely. The audit (scripts/audit-hint-dependency.cjs) showed
  // 20 protocols — 10 ACTIVE — resolved their symbols through them and nothing else, meaning
  // a protocol's symbols were being GUESSED from its slug text. Fixing the target list had
  // addressed the symptom; the practice itself was the defect.
  //
  // So the invariant inverts. The property worth asserting is no longer "the guesses are
  // accurate" but "nothing is guessed": the tables must be empty, and every protocol must
  // resolve through a declared relationship.
  if (!prisma) {
    record('INV-NO-SYMBOL-GUESSING', 'no protocol resolves its symbols by guessing', true, 'skipped — no database connection', true);
  } else {
    try {
      const hintCount = allDerivedSymbolTargets().length;

      // Every ACTIVE protocol must reach at least one symbol through an FK or a link —
      // never through the (now empty) hint tables.
      //
      // EXCEPTION: a SANDBOX protocol is deliberately unwired. `signals-workbench` says so
      // in its own `note` ("Sandbox protocol for signal testing — intentionally not wired
      // to live symbols"). Flagging that as a fault would be a false positive, and a guard
      // that cries wolf gets suppressed — which loses the real detections. So the opt-out
      // is explicit and must be declared in the protocol's note, not inferred.
      const unrounded = await prisma.$queryRawUnsafe(
        `SELECT p.slug, p.note
           FROM protocol p
          WHERE p.active = 1
            AND NOT EXISTS (SELECT 1 FROM symbol_protocol_assignment a WHERE a.protocolId = p.id)
            AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.protocolId = p.id)
          ORDER BY p.slug`,
      );
      const isSandbox = (note) => /sandbox|intentionally not wired|not wired to live symbols/i.test(String(note || ''));
      const sandboxes = unrounded.filter((r) => isSandbox(r.note)).map((r) => r.slug);
      const guessing = unrounded.filter((r) => !isSandbox(r.note)).map((r) => r.slug);

      const problems = [];
      if (hintCount > 0) {
        problems.push(
          `HINT TABLES REPOPULATED (${hintCount} target${hintCount === 1 ? '' : 's'}) — a protocol can be handed a GUESSED symbol from its slug. Wire the protocol instead: see docs/guides/symbol-onboarding-procedure.md`,
        );
      }
      if (guessing.length > 0) {
        problems.push(
          `WIRED TO NOTHING: ${guessing.join(', ')} — active with no assignment and no linked watchlist, so it resolves to no symbols at all (in the UI this is indistinguishable from a quiet market). If it is deliberately unwired, say so in the protocol's note (it must contain "sandbox" or "intentionally not wired").`,
        );
      }

      record('INV-NO-SYMBOL-GUESSING', 'every ACTIVE protocol resolves through a declared relationship',
        problems.length === 0,
        problems.length === 0
          ? `hint tables empty; all active protocols resolve by FK${sandboxes.length ? ` (declared sandbox: ${sandboxes.join(', ')})` : ''}`
          : problems.join(' | '));
    } catch (err) {
      record('INV-NO-SYMBOL-GUESSING', 'no protocol resolves its symbols by guessing', true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-WATCHLIST-IDENTITY ─────────────────────────────────────────────
  //
  // A protocol finds its watchlist through `watchlist.protocolId` (an FK), but the legacy
  // path matched on the watchlist NAME with `LIMIT 1` and no `ORDER BY`. Five watchlists
  // existed twice — once with a slug-shaped id, once with a UUID — and the pairs did NOT
  // hold identical content (`dxy-sensitive` carried 12 symbols under its UUID and 10 under
  // its slug, missing USDCNH/USDSEK). So a protocol reading the DXY basket had a coin-flip
  // chance of silently dropping two currency pairs.
  //
  // This asserts no watchlist name is ambiguous, because an ambiguous name is exactly the
  // condition under which name-matching cannot be deterministic.
  if (!prisma) {
    record('INV-WATCHLIST-IDENTITY', 'no watchlist name is ambiguous (duplicate name+shape rows)', true, 'skipped — no database connection', true);
  } else {
    try {
      const dupes = await prisma.$queryRawUnsafe(
        `SELECT LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) AS norm, COUNT(*) AS copies
           FROM watchlist
          GROUP BY norm
         HAVING copies > 1`,
      );
      const slugIds = await prisma.$queryRawUnsafe(
        `SELECT id, name FROM watchlist WHERE id NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-'`,
      );
      const names = dupes.map((d) => `${d.norm} (×${d.copies})`);
      record('INV-WATCHLIST-IDENTITY', 'no watchlist name resolves to more than one row', dupes.length === 0,
        dupes.length === 0
          ? `no ambiguous names; ${slugIds.length} slug-identified row(s) remain (tolerated only while they have no UUID twin)`
          : `AMBIGUOUS NAME(S): ${names.join(', ')} — a protocol resolving this watchlist by name gets an arbitrary row, so its symbol set can change without any edit. Consolidate onto the UUID-identified row.`);
    } catch (err) {
      record('INV-WATCHLIST-IDENTITY', 'no watchlist name is ambiguous (duplicate name+shape rows)', true, `skipped — ${err.message}`, true);
    }
  }

  // ── INV-SEED-DB-CONSISTENT (GATE 3: STATE) ─────────────────────────────
  //
  // ⚠️ ADDED 2026-09-11 — this is the check the build gates CANNOT make.
  //
  // Gates 1 and 2 (`tsc`, eslint, the `prebuild` validators) are CODE checks.
  // They pass while the LIVE SYSTEM is unchanged. That is exactly how 30 orphan
  // rows sat in `protocol_directive_entry` with every build green: the seed file
  // was corrected, the seeder is UPSERT-ONLY so it could not delete the old rows,
  // and nothing compared the two.
  //
  // The visible symptom was `rsi-overbought` — a `directionBias: 'bearish'`,
  // 140-point directive left live in 28 `LONG_ONLY` protocols where it is excluded
  // from BOTH numerator and denominator. So it never read as a zero; it silently
  // lowered the REACHABLE CEILING by 3,920 points (#792).
  //
  // This check asks the question the build cannot: **does the running system agree
  // with the config that describes it?**
  //
  // Scope note: this compares PLACEMENT COUNTS per protocol, not full set equality.
  // Full comparison lives in `scripts/diff-seed-vs-db.cjs` (repo root), which parses
  // per-group membership. Counts are the cheap invariant that catches the class
  // here, without duplicating that parser — ADR-014 (one implementation per concept).
  if (prisma) {
    try {
      const protoRows = await prisma.$queryRawUnsafe(
        `SELECT p.slug, COUNT(e.id) AS entries
           FROM protocol p
           LEFT JOIN protocol_directive_group g
                  ON g.protocolId COLLATE utf8mb4_unicode_ci = p.id COLLATE utf8mb4_unicode_ci
           LEFT JOIN protocol_directive_entry e
                  ON e.groupId COLLATE utf8mb4_unicode_ci = g.id COLLATE utf8mb4_unicode_ci
          GROUP BY p.slug`,
      );
      const dbBySlug = new Map(protoRows.map((r) => [r.slug, Number(r.entries)]));

      // Parse the seed's per-protocol placement count.
      const seedSrc = fs.readFileSync(
        path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts'),
        'utf8',
      );
      const seedBySlug = new Map();
      let cur = null;
      let inIds = false;
      for (const line of seedSrc.split(/\r?\n/)) {
        const proto = line.match(/^ {2}"([^"]+)":\s*\{/);
        if (proto) {
          cur = proto[1];
          if (!seedBySlug.has(cur)) seedBySlug.set(cur, 0);
          inIds = false;
          continue;
        }
        if (!cur) continue;
        if (/^\s*"directiveIds":\s*\[/.test(line)) { inIds = true; continue; }
        if (inIds) {
          if (/^\s*\]/.test(line)) { inIds = false; continue; }
          if (/^\s*"[^"]+"\s*,?\s*$/.test(line)) seedBySlug.set(cur, seedBySlug.get(cur) + 1);
        }
      }

      const seedTotal = [...seedBySlug.values()].reduce((a, b) => a + b, 0);
      const dbTotal = [...dbBySlug.values()].reduce((a, b) => a + b, 0);

      // Compare only protocols present on BOTH sides. A protocol in the DB but not
      // the seed is a different (and legitimate) situation — e.g. `signals-workbench`,
      // a workbench protocol populated by SignalEnvelopeService, deliberately unseeded.
      const drift = [];
      for (const [slug, dbCount] of dbBySlug) {
        if (!seedBySlug.has(slug)) continue;
        const seedCount = seedBySlug.get(slug);
        if (seedCount !== dbCount) drift.push(`${slug}: seed ${seedCount} vs db ${dbCount}`);
      }

      record(
        'INV-SEED-DB-CONSISTENT',
        'seed placement counts match the database (Gate 3: state)',
        drift.length === 0,
        drift.length === 0
          ? `seed and DB agree — ${seedTotal} placements across ${seedBySlug.size} protocols. (DB total ${dbTotal}; any difference is a protocol absent from the seed, which is a separate question.)`
          : `${drift.length} protocol(s) disagree: ${drift.slice(0, 8).join(' | ')}${drift.length > 8 ? ` … +${drift.length - 8}` : ''}. The seeder is UPSERT-ONLY, so a removal/move in the seed is a SILENT no-op in the DB. Run \`node scripts/diff-seed-vs-db.cjs\` from the repo root for the full per-group picture, then reconcile with explicit SQL — NEVER \`prisma db push\` (it drops 10 raw-managed tables, #769).`,
      );
    } catch (err) {
      record('INV-SEED-DB-CONSISTENT', 'seed placement counts match the database (Gate 3: state)', true, `skipped — ${err.message}`, true);
    }
  }

  if (prisma) await prisma.$disconnect();

  // ── report ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);  const skipped = results.filter((r) => r.skipped).length;
  console.log('\n[pipeline-contracts] live probe\n');
  for (const r of results) {
    const mark = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  [${r.invariant}] ${r.name}`);
    console.log(`        ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length - skipped} passed, ${failed.length} failed, ${skipped} skipped`);
  if (failed.length) {
    console.error('\nSee .github/instructions/meta-stack-contracts.instructions.md\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[pipeline-contracts] probe crashed: ${err.message}`);
  process.exit(1);
});
