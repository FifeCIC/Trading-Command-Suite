#!/usr/bin/env node
/**
 * audit-data-health.cjs — the guard for the class that cost 5 days of trading and 16,673
 * unusable measurement rows.
 * =====================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The project owner asked (2026-09-15): *"Clearly we need to question why any column in any
 * table is currently empty after all this time."*
 *
 * The answer is that **a missing value and a not-yet-populated value look identical in a
 * database.** The row count grows, the insert succeeds, nothing errors, and the dashboard
 * shows a healthy table. Every instance below produced *plausible numbers with no error* —
 * this repo's documented signature of its worst bugs:
 *
 *   #733  `MarketBar.timeframe` holds `15m`, outcomes written as `M15`. Equality filter
 *         never matched -> 35,472 of 40,120 rows matured to NULL FOREVER.
 *   #821  `directiveoutcome.strategyId` never set -> 16,673/16,673 NULL, so NO per-protocol
 *         statistic was ever computable. `edge-statistics.service.ts` groups by that column.
 *   P&L   82 unrecoverable rows made the win rate read 8.77% instead of the true 31.3%.
 *
 * And the SAME shape produced the outage:
 *
 *   2026-09-10 -> 09-15  ADR-011 changed the percentage DENOMINATOR from the observed
 *         directional sum (~130) to the configured capacity (~725-815), ~6.3x larger.
 *         Every trade threshold stayed on the old scale, so `ENTRY_THRESHOLD = 40`
 *         classified every tick as HOLD and NO TRADE EXECUTED FOR FIVE DAYS.
 *
 * **Three code comments carried that diagnosis. Nobody could SEE the numbers.** Row counts
 * and dashboards all looked fine.
 *
 * Only an explicit expectation can tell "absent" from "not yet filled". This script is that
 * expectation, written down and executed.
 *
 * USAGE (from nest/):
 *     npm run audit:data-health
 *     node scripts/audit-data-health.cjs
 *
 * EXIT CODE: 1 if any check fails, 0 otherwise.
 *
 * ⚠️ NOT IN `prebuild` — DELIBERATELY.
 * This reads the LIVE DATABASE. Putting it in `prebuild` would make every build fail on a
 * cold or absent database, which is a different (and worse) problem than the one being
 * solved. The static source-level guard for #821's class lives in the test suite; this is
 * the STATE check, and state checks are run on demand — same reasoning as `db:check`.
 */

const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(NEST_ROOT, '.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const N = (v) => (typeof v === 'bigint' ? Number(v) : v);

/**
 * FAIL is decided on the MOST RECENT rows, using a zero-NULL invariant.
 *
 * ⚠️ WHY A ZERO INVARIANT AND NOT A PERCENTAGE OR A TIME WINDOW
 * A writer that is correctly wired produces **zero** NULLs. So the honest check is "are any
 * of the newest rows unset?" — not "what fraction of the last N hours is unset?".
 *
 * Both alternatives are worse, and both were tried on 2026-09-15:
 *
 *   - **All-time percentage**: fails forever on known-unrecoverable history. #821 left
 *     16,815 permanently-NULL rows (attribution cannot be reconstructed — a directive
 *     participates in many protocols, so any backfill would silently mislabel). A guard that
 *     always fails is a guard people learn to ignore.
 *   - **Fixed time window (24h)**: spans a deployment, so it reports the *transition* as a
 *     failure. Measured here: 16% for 24h and 45% for 4h, when the true post-fix rate was
 *     **100%** over 346 rows. It reads as "the fix did not work" when it worked perfectly.
 *
 * The newest-rows invariant has neither problem: it is independent of when the fix shipped
 * and of how much history is broken. It asks only "is the writer correct right now?".
 *
 * History is still reported (24h and all-time) so the gap stays VISIBLE without being
 * mistaken for an active defect.
 */
const RECENT_SAMPLE_ROWS = 200;

const failures = [];
const warnings = [];

/**
 * Columns that MUST be populated, with the reason. An empty reason is a bug in this file.
 *
 * ⚠️ Adding a column here to silence a failure is the ONE thing you must not do. If a
 * column is legitimately nullable, say WHY in `allowNull` — a green audit that hides a
 * dead column is worse than no audit (this is how #733 and #821 survived).
 */
const MUST_POPULATE = [
  { table: 'directiveoutcome', column: 'strategyId', reason: '#821 — protocol attribution. NULL here disables every per-protocol statistic.' },
  { table: 'directiveoutcome', column: 'directiveId', reason: 'Without it an outcome cannot be attributed to any directive.' },
  { table: 'directiveoutcome', column: 'symbol', reason: 'Outcome cannot be joined to price data.' },
  { table: 'directiveoutcome', column: 'timeframe', reason: '#733 — MT5-style labels (M15) broke bar lookups and rows never matured.' },
  { table: 'score', column: 'strategyId', reason: 'Protocol slug — the key every per-protocol query groups by.' },
  { table: 'score', column: 'breakdown', reason: 'The whole reading lives here; a NULL row is unattributable and unreplayable.' },
  { table: 'trade', column: 'symbol', reason: 'A trade with no symbol cannot be reconciled.' },
];

/**
 * Columns where NULL is LEGITIMATE, each with its reason. Recorded so the distinction is
 * explicit rather than assumed — that assumption is the defect this script addresses.
 */
const ALLOW_NULL = [
  { table: 'directiveoutcome', column: 'priceT24h', reason: 'Only filled once 24h has elapsed since predictedAt.' },
  { table: 'directiveoutcome', column: 'priceT4h', reason: 'Only filled once 4h has elapsed.' },
  { table: 'directiveoutcome', column: 'directionCorrect', reason: 'Only resolved once T+1h is known.' },
  { table: 'directiveoutcome', column: 'outcomeComputedAt', reason: 'NULL means still maturing, by design.' },
  // NOTE: `trade.side` is NOT in MUST_POPULATE. 21 Trading212 share holdings carry NULL
  // side and are genuinely not MT5 positions — see #811 (investments vs positions).
];

async function checkMustPopulate() {
  console.log('\n[1/4] must-populate columns');
  console.log(`      FAIL = any NULL among the ${RECENT_SAMPLE_ROWS} newest rows (a correct writer emits none).`);
  console.log('      24h and all-time rates are CONTEXT, not verdicts — they span deployments.');
  console.log('      ' + 'table.column'.padEnd(40) + 'allNull%'.padStart(9) + '24hNull%'.padStart(9) + 'newestNull'.padStart(11) + '  verdict');
  console.log('      ' + '-'.repeat(92));

  for (const { table, column, reason } of MUST_POPULATE) {
    let total, nulls, nulls24 = 0, total24 = 0, recentNull = null, recentN = 0, tsCol = null;
    try {
      const t = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM \`${table}\``);
      total = N(t[0].n);
      if (total === 0) {
        console.log('      ' + `${table}.${column}`.padEnd(40) + String(total).padStart(9) + '        -          -   (empty table)');
        continue;
      }
      const r = await prisma.$queryRawUnsafe(`SELECT SUM(\`${column}\` IS NULL) n FROM \`${table}\``);
      nulls = N(r[0].n ?? 0);

      // Find the table's own ordering column rather than assuming one.
      const cols = (await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM \`${table}\``)).map((c) => c.Field);
      tsCol = ['createdAt', 'timestamp', 'predictedAt'].find((c) => cols.includes(c));
      const pk = cols.includes('id') ? 'id' : null;

      if (tsCol) {
        const r24 = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) n, SUM(\`${column}\` IS NULL) nul FROM \`${table}\`
           WHERE \`${tsCol}\` >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
        total24 = N(r24[0].n);
        nulls24 = N(r24[0].nul ?? 0);
      }

      // THE INVARIANT: the newest rows must be clean. Ordered by time when available,
      // otherwise by insertion order.
      const orderBy = tsCol ? `\`${tsCol}\` DESC` : pk ? `\`${pk}\` DESC` : null;
      if (orderBy) {
        const rr = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) n, SUM(\`${column}\` IS NULL) nul FROM (
             SELECT \`${column}\` FROM \`${table}\` ORDER BY ${orderBy} LIMIT ${RECENT_SAMPLE_ROWS}
           ) t`);
        recentN = N(rr[0].n);
        recentNull = N(rr[0].nul ?? 0);
      }
    } catch (e) {
      failures.push(`${table}.${column}: could not read — ${e.message.split('\n')[0]}`);
      continue;
    }

    const allPct = (100 * nulls) / total;
    const pct24 = total24 === 0 ? null : (100 * nulls24) / total24;
    const bad = recentNull != null && recentNull > 0;

    const verdict = bad
      ? `FAIL — ${recentNull}/${recentN} newest are NULL`
      : allPct >= 50 ? 'ok — historical gap only' : 'ok';

    console.log('      ' + `${table}.${column}`.padEnd(40) + allPct.toFixed(1).padStart(9) +
      (pct24 == null ? '        -' : pct24.toFixed(1).padStart(9)) +
      (recentNull == null ? '          -' : `${recentNull}/${recentN}`.padStart(11)) +
      '  ' + verdict);

    if (bad) {
      failures.push(
        `${table}.${column}: ${recentNull} of the ${recentN} newest rows are NULL.\n` +
        `        Why it must be populated: ${reason}\n` +
        `        ⚠️ CHECK THE WRITER BEFORE ASSUMING THE DATA IS MISSING — #733 and #821 were\n` +
        `        both a silently omitted field in a create/insert call, not absent data.`,
      );
    } else if (allPct >= 50) {
      warnings.push(
        `${table}.${column} is ${allPct.toFixed(1)}% NULL all-time but CLEAN on its newest ` +
        `${recentN} rows — a known historical gap (e.g. #821's 16,815 rows before the fix), ` +
        `not an active defect.`,
      );
    }
  }
}

/**
 * A column that USED to populate and now does not is a REGRESSION, and a raw NULL count
 * cannot see it. Newest non-null per column makes the difference visible.
 */
async function checkStaleness(windowHours = 48) {
  console.log(`\n[2/4] freshness — newest non-null, must be within ${windowHours}h for live tables`);
  for (const { table, column } of [
    { table: 'directiveoutcome', column: 'createdAt' },
    { table: 'score', column: 'timestamp' },
  ]) {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT MAX(\`${column}\`) newest FROM \`${table}\``);
      const newest = r[0].newest;
      const ageH = newest ? (Date.now() - new Date(newest).getTime()) / 3_600_000 : Infinity;
      const stale = ageH > windowHours;
      console.log('      ' + `${table}.${column}`.padEnd(42) + String(newest).padEnd(28) + (stale ? 'STALE  <-- WARN' : 'fresh'));
      if (stale) {
        warnings.push(`${table}.${column} newest is ${Number.isFinite(ageH) ? ageH.toFixed(1) + 'h' : 'never'} old. A writing pipeline may have stopped — a stale writer looks identical to a healthy table.`);
      }
    } catch { /* table absent in this environment */ }
  }
}

/**
 * THE OUTAGE GUARD.
 *
 * An active bot whose bar exceeds the highest score its protocol has EVER produced cannot
 * fire. That is exactly the 2026-09-10 -> 09-15 condition, and it was invisible.
 *
 * ⚠️ `no-data` is reported as a WARNING, never a failure. "Unmeasured" and "structurally
 * blocked" are different problems with different fixes; conflating them either panics over
 * a quiet protocol or ignores a dead one.
 */
async function checkThresholdReachability(windowDays = 7) {
  console.log(`\n[3/4] threshold reachability — active bots whose bar exceeds their achieved ceiling`);
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(`
      SELECT ts.name, ts.symbol, ts.protocolId, ts.minComposite,
             MAX(s.breakdown->>'$.rawComposite' / NULLIF(s.breakdown->>'$.configuredSignalMax', 0) * 100) AS achieved,
             COUNT(s.id) AS samples
      FROM trading_strategy ts
      LEFT JOIN score s
        ON s.strategyId COLLATE utf8mb4_unicode_ci = ts.protocolId COLLATE utf8mb4_unicode_ci
       AND s.timestamp >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      WHERE ts.active = 1
      GROUP BY ts.id, ts.name, ts.symbol, ts.protocolId, ts.minComposite
      ORDER BY ts.minComposite ASC`);
  } catch (e) {
    warnings.push(`threshold reachability could not run: ${e.message.split('\n')[0]}`);
    return;
  }

  const cannotFire = rows.filter((r) => r.achieved != null && Number(r.achieved) < Number(r.minComposite));
  const noData = rows.filter((r) => r.achieved == null);

  console.log('      active bots: ' + rows.length + '   clearing: ' + (rows.length - cannotFire.length - noData.length) +
              '   CANNOT FIRE: ' + cannotFire.length + '   no data: ' + noData.length);

  for (const r of cannotFire) {
    console.log(`      CANNOT FIRE  ${String(r.name).padEnd(34)} bar=${r.minComposite}%  achieved=${Number(r.achieved).toFixed(1)}%`);
  }
  if (cannotFire.length) {
    failures.push(
      `${cannotFire.length} active bot(s) have a bar ABOVE the highest score their protocol has produced.\n` +
      `        These can NEVER trade. This is the 2026-09-10 -> 09-15 outage condition.\n` +
      `        Most likely cause: a denominator/scale change orphaned the thresholds. See\n` +
      `        common/utils/style-thresholds.ts for the rescale derivation.`,
    );
  }
  for (const r of noData) {
    console.log(`      no data      ${String(r.name).padEnd(34)} bar=${r.minComposite}%  (no scores in ${windowDays}d)`);
  }
  if (noData.length) {
    warnings.push(
      `${noData.length} active bot(s) have produced no scores in ${windowDays} days — UNMEASURED, not blocked.\n` +
      `        Check the protocol resolves (a slug-or-UUID mismatch produces exactly this, #801).`,
    );
  }
}

/**
 * Protocol references must use the SLUG, never the UUID.
 *
 * ⚠️ #801 — WHY THIS IS A SILENT DEFECT AND NOT A COSMETIC ONE
 * `score.strategyId` and `strategy_protocol.protocolId` both hold the SLUG. A
 * `trading_strategy` row referencing the UUID does NOT fail — **it just never matches**.
 *
 * Measured 2026-09-15: 4 of 26 bots carried a UUID. All 4 resolved to real protocols, so
 * nothing errored, but any join of `score.strategyId = trading_strategy.protocolId` returned
 * NOTHING for them. The thresholds endpoint reported CAC/DAX/FTSE as `no-data` when
 * `dax-speed-v1` had produced **170 scores** — a false negative that reads as "a quiet
 * protocol" rather than "a broken key". After normalising, 13 bots with data became **16**.
 *
 * That is the same class as #733 and #821: a plausible-looking result with no error.
 */
async function checkProtocolRefs() {
  console.log('\n[4/4] protocol references — must be SLUGS, never UUIDs (#801)');
  let protos, rows;
  try {
    protos = await prisma.$queryRawUnsafe(`SELECT id, slug FROM protocol`);
    rows = await prisma.$queryRawUnsafe(`
      SELECT 'trading_strategy' AS src, name AS label, protocolId FROM trading_strategy
      UNION ALL
      SELECT 'strategy_protocol' AS src, CONCAT('strategy ', strategyId) AS label, protocolId FROM strategy_protocol`);
  } catch (e) {
    warnings.push(`protocol reference check could not run: ${e.message.split('\n')[0]}`);
    return;
  }

  const slugSet = new Set(protos.map((x) => x.slug));
  const slugById = new Map(protos.map((x) => [x.id, x.slug]));

  const useUuid = rows.filter((r) => !slugSet.has(r.protocolId) && slugById.has(r.protocolId));
  const unresolvable = rows.filter((r) => !slugSet.has(r.protocolId) && !slugById.has(r.protocolId));

  console.log(`      references: ${rows.length}   by slug: ${rows.length - useUuid.length - unresolvable.length}   by UUID: ${useUuid.length}   unresolvable: ${unresolvable.length}`);

  for (const r of useUuid) {
    console.log(`      UUID  ${r.src}.${String(r.label).padEnd(34)} ${r.protocolId} -> ${slugById.get(r.protocolId)}`);
  }
  for (const r of unresolvable) {
    console.log(`      DEAD  ${r.src}.${String(r.label).padEnd(34)} ${r.protocolId}`);
  }

  if (useUuid.length) {
    failures.push(
      `${useUuid.length} reference(s) use a protocol UUID where every other table uses the SLUG.\n` +
      `        These RESOLVE but never JOIN — per-bot statistics silently return nothing for them\n` +
      `        (#801: 3 bots appeared as "no data" while holding 380 scores between them).\n` +
      `        Fix: UPDATE ... SET protocolId = '<slug>'.`,
    );
  }
  if (unresolvable.length) {
    failures.push(
      `${unresolvable.length} reference(s) resolve to NO protocol by slug or UUID.\n` +
      `        These can never score, queue or trade.`,
    );
  }
}

(async () => {
  console.log('='.repeat(72));
  console.log('  DATA HEALTH AUDIT');
  console.log('  Guards the silent-failure class: #733, #821, #801, and the 2026-09-15 outage.');
  console.log('='.repeat(72));

  try {
    await checkMustPopulate();
    await checkStaleness();
    await checkThresholdReachability();
    await checkProtocolRefs();
  } catch (e) {
    console.error('\nFATAL: ' + e.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\n' + '='.repeat(72));
  if (warnings.length) {
    console.log(`  WARNINGS (${warnings.length}) — investigate, do not assume broken:`);
    for (const w of warnings) console.log('   ⚠️  ' + w);
  }
  if (failures.length) {
    console.log(`\n  ❌ FAILURES (${failures.length}):`);
    for (const f of failures) console.log('   ✗  ' + f);
    console.log('\n  A failure here is a SILENT defect made visible. Do not allow-list a column to');
    console.log('  make this pass — that is how the last two survived for weeks.');
    console.log('='.repeat(72));
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('  ✅ OK — every must-populate column is populated and no active bot is');
  console.log('     structurally unable to fire.');
  console.log('='.repeat(72));
  await prisma.$disconnect();
  process.exit(0);
})();
