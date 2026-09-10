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
const STALE_SYMBOL = argOf('--stale', 'BTCUSD');        // a symbol whose feed is frozen

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
  if (prisma) {
    try {
      const now = new Date();
      const [bars, outcomes, positions, trades] = await Promise.all([
        prisma.marketBar.count({ where: { timestamp: { gt: now } } }),
        prisma.directiveOutcome.count({ where: { predictedAt: { gt: now } } }),
        prisma.position.count({ where: { openedAt: { gt: now } } }),
        prisma.trade.count({ where: { OR: [{ openedAt: { gt: now } }, { closedAt: { gt: now } }] } }),
      ]);
      const total = bars + outcomes + positions + trades;
      record('INV-NO-FUTURE-ROWS', 'no MT5-sourced row is dated in the future', total === 0,
        `marketbar=${bars} directiveoutcome=${outcomes} position=${positions} trade=${trades} (a future date means the server-clock skew is back — #750)`);
    } catch (err) {
      record('INV-NO-FUTURE-ROWS', 'no MT5-sourced row is dated in the future', false, `query failed: ${err.message}`);
    }
  } else {
    record('INV-NO-FUTURE-ROWS', 'no MT5-sourced row is dated in the future', true, 'skipped — no DB connection', true);
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
        if (!matched) problems.push(cadence);
      }
      record('INV-BAR-ORDER', `arena asOf equals the newest real bar per cadence (${LIVE_SYMBOL})`, problems.length === 0,
        observations.join('; '));
      record('INV-SINGLE-CADENCE', `each protocol is scored on a single cadence (${LIVE_SYMBOL})`, problems.length === 0,
        `${byCadence.size} cadences resolved: ${[...byCadence.keys()].join(', ')}`);
    } catch (err) {
      const why = err && err.message ? err.message : String(err);
      record('INV-BAR-ORDER', `arena asOf equals the newest real bar per cadence (${LIVE_SYMBOL})`, true, `skipped — ${why}`, true);
      record('INV-SINGLE-CADENCE', `each protocol is scored on a single cadence (${LIVE_SYMBOL})`, true, `skipped — ${why}`, true);
    }
  }

  // ── INV-GATE-FAILS-CLOSED ──────────────────────────────────────────────
  if (!apiUp) {
    record('INV-GATE-FAILS-CLOSED', `a frozen feed reads closed (${STALE_SYMBOL})`, true, `skipped — ${apiSkipReason}`, true);
  } else {
    try {
      const res = await request('POST', `${API}/api/scoring/arena/compare`, { symbols: [STALE_SYMBOL] }, 180000);
      if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status} ${res.body.slice(0, 120)}`);
      const comparison = JSON.parse(res.body).comparison || [];
      const scores = (comparison[0]?.protocolScores || []).filter((s) => s.marketStatus);
      const openCount = scores.filter((s) => s.marketStatus.open).length;
      record('INV-GATE-FAILS-CLOSED', `a frozen feed reads closed (${STALE_SYMBOL})`, scores.length > 0 && openCount === 0,
        scores.length === 0
          ? 'no protocols reported a marketStatus — cannot verify'
          : `${openCount}/${scores.length} protocols report open=true${openCount === 0 ? '' : ` — reason sample: ${scores.find((s) => s.marketStatus.open)?.marketStatus.reason || '(none)'}`}`);
    } catch (err) {
      record('INV-GATE-FAILS-CLOSED', `a frozen feed reads closed (${STALE_SYMBOL})`, true, `skipped — ${err.message}`, true);
    }
  }

  if (prisma) await prisma.$disconnect();

  // ── report ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped).length;
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
