#!/usr/bin/env node
/**
 * audit-future-rows.cjs — INV-NO-FUTURE-ROWS: is any stored timestamp IMPOSSIBLE? (#1214)
 * ==========================================================================================
 * Enumerates, and fails on, rows whose timestamp is ahead of the clock by more than the same
 * tolerance the trading path uses (`FUTURE_TOLERANCE_SECONDS = 120` in
 * `nest/src/common/trading/quote-freshness.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (measured 2026-11-06)
 * ─────────────────────────────────────────────────────────────────────────
 * The MetaQuotes bridge served EURCAD a tick at `2026-11-17T13:59:08Z` — 10.7 days ahead — while
 * EURUSD, GBPUSD and USDJPY on the SAME bridge were seconds old. A quote the app cannot price means
 * the per-symbol exposure cap cannot be evaluated for that symbol.
 *
 * ⚠️ THIS HAS HAPPENED BEFORE. `marketbar_future_orphan_backup_780` holds 226 rows kept from an
 * earlier future-timestamp event.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ THE PROBE MUST ASK THE RIGHT VENUE, WITH THE RIGHT NAME (#1221)
 * ─────────────────────────────────────────────────────────────────────────
 * Two false positives were produced by the first version of `--probe`, and both are the router's own
 * documented hazard ("a bare ticker means whatever the venue you ask thinks it means"):
 *
 *   1. it asked ONE default bridge for every symbol, so `UK100` — routed to broker 3 (:5001), where
 *      it answers with a current tick — was read from broker 2 (:5000), which serves a DIFFERENT
 *      `UK100` whose last tick was 2026-05-15. Reported as a frozen instrument. It was not.
 *   2. it sent the APP-LEVEL ticker, so `JP225` (JPN225 on the bridge) and `USTEC` (NAS100) came
 *      back `not available`. Reported as unservable symbols. They are served fine.
 *
 * The probe therefore resolves, per symbol, the bridge from `symbol_route.brokerId` and the wire
 * name from `symbol_route.brokerSymbol`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A TABLE LIST AND NOT "ALL TABLES"
 * ─────────────────────────────────────────────────────────────────────────
 * Scanning every date column of 136 tables would flag legitimate future dates (an earnings date, a
 * calendar event, a contract expiry). This checks only tables whose timestamp means "this happened".
 *
 *   node scripts/audit-future-rows.cjs                # the gate
 *   node scripts/audit-future-rows.cjs --report       # same, but always exit 0
 *   node scripts/audit-future-rows.cjs --probe        # ALSO probe the bridge for live tick times
 *   node scripts/audit-future-rows.cjs --self-test    # prove the comparison can fail
 *
 * @created 2026-11-06 — #1214
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/** The same tolerance the trading path uses. Two thresholds would let one path accept what another refuses. */
const FUTURE_TOLERANCE_SECONDS = 120;

/**
 * Tables whose timestamp column means "this event occurred at".
 *
 * ⚠️ THESE WERE INTROSPECTED, NOT REMEMBERED (`node scripts/db-schema.cjs <table>`). The first
 * version guessed `score.createdAt` and `decision_log.createdAt`; neither column exists and the tool
 * died with `Unknown column 'createdAt' in 'field list'`, which reads as a broken tool rather than a
 * wrong list.
 */
const WATCHED = [
  { table: 'marketbar', column: 'timestamp' },
  { table: 'score', column: 'timestamp' },
  { table: 'score_snapshot', column: 'snappedAt' },
  { table: 'position', column: 'openedAt' },
  { table: 'trade', column: 'closedAt', nullable: true },
  { table: 'bridge_event', column: 'createdAt' },
  { table: 'directiveoutcome', column: 'createdAt' },
  { table: 'decision_log', column: 'timestamp' },
];

/** Pure: is `when` ahead of `now` by more than the tolerance? Mirrors `screenTickTime()`. */
function isFuture(when, now, tolerance = FUTURE_TOLERANCE_SECONDS) {
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return false;
  const leadSeconds = Math.round((now.getTime() - when.getTime()) / 1000) * -1;
  return leadSeconds > tolerance;
}

function loadEnv() {
  const envPath = path.join(ROOT, 'nest', '.env');
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
}

function loadDbUrl() {
  const m = loadEnv().match(/DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/);
  return m ? m[1] : null;
}

/**
 * The bridge URL for a broker id — the SAME rule the app uses (`Mt5ConnectionManager`):
 * `MT5_BROKER_URL_{id}`, else `5000 + index in MT5_ACTIVE_BROKERS`.
 */
function bridgeUrls() {
  const env = loadEnv();
  const raw = (env.match(/^MT5_ACTIVE_BROKERS=([^\r\n]+)/m)?.[1]
    ?? env.match(/^MT5_ACTIVE_ACCOUNT=([^\r\n]+)/m)?.[1]
    ?? '2');
  const active = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
  const explicit = {};
  for (const m of env.matchAll(/^MT5_BROKER_URL_(\d+)=([^\r\n]+)/gm)) explicit[m[1]] = m[2].trim();
  const byId = new Map();
  active.forEach((id, idx) => byId.set(id, explicit[id] ?? `http://localhost:${5000 + idx}`));
  return { byId, active };
}

async function probeBridge() {
  const { byId, active } = bridgeUrls();
  const defaultBridge = process.env.MT5_BRIDGE_URL
    ?? byId.get(active[0])
    ?? 'http://localhost:5000';

  // symbol -> { brokerId, brokerSymbol }: the venue AND the name that venue knows it by.
  const routeOf = new Map();
  const url = loadDbUrl();
  if (url) {
    try {
      const { PrismaClient } = require(path.join(ROOT, 'nest', 'node_modules', '@prisma', 'client'));
      const prisma = new PrismaClient({ datasources: { db: { url } } });
      const rows = await prisma.$queryRawUnsafe(
        "SELECT symbol, brokerId, brokerSymbol FROM symbol_route WHERE enabled = 1 AND (provider IS NULL OR provider = 'mt5') ORDER BY symbol",
      );
      await prisma.$disconnect();
      for (const r of rows) {
        routeOf.set(r.symbol, { brokerId: Number(r.brokerId), brokerSymbol: r.brokerSymbol || r.symbol });
      }
    } catch (err) {
      console.warn(`  (could not read symbol_route: ${err.message}) — every symbol will be probed on the default bridge`);
    }
  }

  const symbolsArg = process.env.AUDIT_PROBE_SYMBOLS;
  const requested = symbolsArg ? symbolsArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const symbols = requested.length ? requested : [...routeOf.keys()];
  const probeList = symbols.length ? symbols : ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

  const now = new Date();
  const results = [];
  for (const symbol of probeList) {
    const route = routeOf.get(symbol);
    const brokerId = route?.brokerId;
    const wireSymbol = route?.brokerSymbol ?? symbol;
    const base = brokerId === undefined ? defaultBridge : (byId.get(brokerId) ?? defaultBridge);
    try {
      const res = await fetch(`${base}/quote?symbol=${encodeURIComponent(wireSymbol)}`);
      if (!res.ok) {
        results.push({ symbol, wireSymbol, brokerId, base, error: `HTTP ${res.status}` });
        continue;
      }
      const body = await res.json();
      const tickTime = body.tickTime ? new Date(body.tickTime) : null;
      const leadSeconds = tickTime && !Number.isNaN(tickTime.getTime())
        ? Math.round((now.getTime() - tickTime.getTime()) / 1000) * -1
        : null;
      results.push({ symbol, wireSymbol, brokerId, base, tickTime, leadSeconds, future: tickTime ? isFuture(tickTime, now) : false });
    } catch (err) {
      results.push({ symbol, wireSymbol, brokerId, base, error: err.message });
    }
  }
  return results;
}

function selfTest() {
  const now = new Date('2026-11-06T21:54:00Z');
  const cases = [
    ['the measured EURCAD tick (10.7 days ahead) is future', new Date('2026-11-17T13:59:08Z'), true],
    ['a tick 121s ahead is future', new Date(now.getTime() + 121000), true],
    ['the boundary: exactly 120s ahead is NOT future', new Date(now.getTime() + 120000), false],
    ['a tick 60s ahead is NOT future', new Date(now.getTime() + 60000), false],
    ['an hour-old tick is NOT future (age is a different question)', new Date(now.getTime() - 3600000), false],
    ['an invalid date is NOT treated as future', new Date('nope'), false],
  ];
  let failures = 0;
  for (const [label, when, expected] of cases) {
    const got = isFuture(when, now);
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '[OK]  ' : '[FAIL]'} ${label} — expected ${expected}, got ${got}`);
  }
  console.log(failures === 0 ? '\nself-test passed' : `\n${failures} self-test case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const reportOnly = args.includes('--report');
  const probe = args.includes('--probe');

  let exitCode = 0;

  if (probe) {
    console.log('Probing each symbol on the bridge its ROUTE names, with the name that bridge uses …\n');
    const results = await probeBridge();
    const bad = results.filter((r) => r.future);
    for (const r of results) {
      if (r.error) {
        console.log(`  ?   ${r.symbol.padEnd(10)} ${String(r.wireSymbol).padEnd(10)} ${r.base.replace(/^https?:\/\//, '').padEnd(18)} ${r.error}`);
        continue;
      }
      const lead = r.leadSeconds === null ? 'n/a' : `${r.leadSeconds > 0 ? '+' : ''}${r.leadSeconds}s`;
      const venue = r.brokerId === undefined ? 'no route' : `broker ${r.brokerId}`;
      const wire = r.wireSymbol === r.symbol ? '' : ` as ${r.wireSymbol}`;
      console.log(`  ${r.future ? '✖' : '✔'}  ${r.symbol.padEnd(10)}${wire} · ${venue} · ${r.base.replace(/^https?:\/\//, '')} · lead ${lead}`);
    }
    console.log(`\n${results.length} probed · ${bad.length} AHEAD of the clock`);
    if (bad.length) {
      exitCode = 1;
      console.log('\nA symbol whose tick is ahead of the clock cannot be PRICED, so its per-symbol');
      console.log('exposure cap cannot be evaluated. The app refuses the order (correct) but the cap');
      console.log('is blind for that symbol until the broker serves a real tick.');
    }
    console.log('');
  }

  const url = loadDbUrl();
  if (!url) {
    console.error('[FAIL] no DATABASE_URL in nest/.env — cannot audit stored rows');
    process.exit(reportOnly ? 0 : 1);
  }

  const { PrismaClient } = require(path.join(ROOT, 'nest', 'node_modules', '@prisma', 'client'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const findings = [];
  let scanned = 0;

  try {
    for (const { table, column, nullable } of WATCHED) {
      const where = nullable ? `\`${column}\` IS NOT NULL AND ` : '';
      const rows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS n, MAX(\`${column}\`) AS latest
           FROM \`${table}\`
          WHERE ${where}\`${column}\` > UTC_TIMESTAMP() + INTERVAL ${FUTURE_TOLERANCE_SECONDS} SECOND`,
      );
      const n = Number(rows?.[0]?.n ?? 0);
      scanned += 1;
      if (n > 0) findings.push({ table, column, n, latest: rows[0].latest });
    }
  } catch (err) {
    console.error(`[FAIL] audit failed: ${err.message}`);
    await prisma.$disconnect();
    process.exit(reportOnly ? 0 : 1);
  }
  await prisma.$disconnect();

  if (findings.length) {
    exitCode = 1;
    console.error(`[FAIL] INV-NO-FUTURE-ROWS — ${findings.length} table(s) hold timestamps more than ${FUTURE_TOLERANCE_SECONDS}s ahead:\n`);
    for (const f of findings) {
      console.error(`   ${f.table}.${f.column}: ${f.n} row(s), latest ${f.latest?.toISOString?.() ?? f.latest}`);
    }
    console.error('\n   A future row is invisible to every "latest" query until the calendar catches up,');
    console.error('   and makes a freshness check report the symbol as current while nothing arrives.');
    console.error('   See #1214 and marketbar_future_orphan_backup_780 (226 rows from a prior occurrence).');
  } else {
    console.log(`[OK] INV-NO-FUTURE-ROWS — ${scanned} watched table(s), 0 rows more than ${FUTURE_TOLERANCE_SECONDS}s ahead${probe ? ' (probe result above)' : ''}`);
  }

  process.exit(reportOnly ? 0 : exitCode);
}

main().catch((err) => {
  console.error(`[FAIL] audit crashed: ${err.message}`);
  process.exit(1);
});
