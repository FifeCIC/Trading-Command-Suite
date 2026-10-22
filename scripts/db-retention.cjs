#!/usr/bin/env node
/**
 * db-retention.cjs — trim OPERATIONAL HISTORY, never measurement history.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * Measured 2026-10-22: the database is **1,233.6 MB across 133 tables**, and the owner's instinct was
 * that this slows the app. Part of that instinct is right — but the cause is not volume, and the
 * obvious fix (keep "2 weeks of data") would destroy the one thing that makes backtests comparable.
 *
 * ── ⚠️ WHAT THIS TOOL REFUSES TO TOUCH, AND WHY ─────────────────────────────────────────────────
 *   · `marketbar` (340 MB, 1.29M rows) — the MEASUREMENT SUBSTRATE. `dev-window-v1` is
 *     **2026-09-09 → 2026-10-20, six weeks**, and it is the canonical window every development
 *     comparison runs inside (SETTLED-DECISIONS row 89). Trimming bars to 14 days would leave every
 *     run measuring a shorter window than the period claims — and the period would still SAY six
 *     weeks. That is the silently-different-measurement defect, permanently.
 *   · `score`, `score_snapshot`, `directiveoutcome` — scoring history. Rarity needs 30+ snapshots per
 *     symbol; trimming changes what the scorer produces, i.e. a MATHS change with no A/B.
 *   · `marketbar_ts_backup_*` — the #750 repair safety net. Dropping it is a decision for the owner,
 *     not a retention policy.
 *
 * What is left is OPERATIONAL history: request logs, transport events, scheduler events, decision
 * traces. Nothing in a backtest run reads them.
 *
 * ── THE SLOWNESS MEASUREMENT, FOR THE RECORD ────────────────────────────────────────────────────
 * The perceived slowness was NOT the database:
 *   · `node -e 1` → 134 ms · `GET /api/version` → 98 ms · `GET system/settings/registry` → 17 ms
 *   · full jest suite → 23 s (199 suites / 1,901 tests) — that is the prebuild cost
 *   · `GET /api/backtest/data-inventory` → 2,350 ms
 *
 * ⚠️ **CORRECTION, because this file first carried a wrong cause.** It said the 2.35 s was a missing
 * `timeframe`-leading index, on the strength of `SELECT COUNT(*) FROM marketbar WHERE timeframe='1h'`
 * taking 759 ms with `type: index, rows: 1,286,788`. **That query was mine, not the app's.** The
 * endpoint does not filter on `timeframe` alone; it runs two covering aggregates:
 *
 *     SELECT symbolId, COUNT(*), MIN(timestamp), MAX(timestamp) FROM marketbar GROUP BY symbolId
 *     SELECT symbolId, timeframe, COUNT(*)                    FROM marketbar GROUP BY symbolId, timeframe
 *     → Extra: Using index · filtered: 100% · 1,221 ms and 1,230 ms
 *
 * `Extra: Using index` means the composite `(symbolId, timeframe, timestamp)` already covers both,
 * with no row lookup. There is no missing index and no index would help: this is the intrinsic cost
 * of aggregating 1.29M rows, and it is paid once per page load.
 *
 * The lesson is the repo's own rule, applied to itself: **measure the target, not your model of it.**
 * Timing a query you invented and then naming an index is not a diagnosis.
 *
 * Usage:
 *   node scripts/db-retention.cjs                 # DRY RUN, 14 days, every trim-able table
 *   node scripts/db-retention.cjs --days 30       # DRY RUN, 30 days
 *   node scripts/db-retention.cjs --apply         # actually delete
 *   node scripts/db-retention.cjs --self-test     # prove the guards can fail
 */
'use strict';

const path = require('node:path');

/**
 * ⚠️ AN ALLOWLIST, NOT A DENYLIST. A denylist lets a new table become trimmable by existing; an
 * allowlist means a table is only ever trimmed because someone wrote it here with a verified column.
 * The column names were read from `db-schema.cjs` on 2026-10-22 — not guessed.
 */
const TRIMMABLE = Object.freeze([
  { table: 'apiactivitylog', column: 'timestamp', what: 'HTTP request log — observability only.' },
  { table: 'bridge_event', column: 'createdAt', what: 'MT5 bridge transport events.' },
  { table: 'decision_log', column: 'timestamp', what: 'Decision-chain traces.' },
  { table: 'automation_event', column: 'timestamp', what: 'Scheduler / automation events.' },
]);

/** Refused by name, with the reason — so a future reader does not have to re-derive it. */
const PROTECTED = Object.freeze({
  marketbar: 'MEASUREMENT SUBSTRATE — dev-window-v1 is 6 weeks (2026-09-09 → 2026-10-20). Trimming bars breaks every comparison.',
  marketbar_ts_backup_20260910: 'The #750 timestamp-repair backup. Dropping it is an owner decision, not retention.',
  score: 'Scoring history — reading it drives research percentiles.',
  score_snapshot: 'Scoring history — rarity needs 30+ snapshots per symbol; trimming is a maths change.',
  directiveoutcome: 'Directive outcome history — the direction-eligibility evidence lives here.',
});

/**
 * The guard: a table may be trimmed only if it is on the allowlist AND is not in the protected set.
 * Kept separate and pure so `--self-test` can drive it in both directions without a database.
 */
function trimDecision(table, allowlist = TRIMMABLE, protectedSet = PROTECTED) {
  if (protectedSet[table]) return { allowed: false, reason: protectedSet[table] };
  const entry = allowlist.find((a) => a.table === table);
  if (!entry) return { allowed: false, reason: 'NOT ON THE ALLOWLIST — add it deliberately, with its timestamp column read from db-schema.cjs.' };
  return { allowed: true, reason: entry.what, column: entry.column };
}

function parseArgs(argv) {
  const out = { days: 14, apply: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a.startsWith('--days=')) out.days = Number(a.slice(7));
  }
  if (!Number.isFinite(out.days) || out.days < 1) out.days = 14;
  return out;
}

function selfTest() {
  const cases = [];
  const expect = (name, actual, wanted) => {
    const ok = actual === wanted;
    cases.push({ name, ok, actual, wanted });
  };

  expect('marketbar is REFUSED', trimDecision('marketbar').allowed, false);
  expect('the repair backup is REFUSED', trimDecision('marketbar_ts_backup_20260910').allowed, false);
  expect('score_snapshot is REFUSED', trimDecision('score_snapshot').allowed, false);
  expect('an unknown table is REFUSED', trimDecision('some_new_table').allowed, false);
  expect('apiactivitylog is ALLOWED', trimDecision('apiactivitylog').allowed, true);
  expect('bridge_event is ALLOWED', trimDecision('bridge_event').allowed, true);
  // ⚠️ The second direction: the refusal must carry a REASON, not just a boolean. A refusal with no
  // reason gets overridden by the next person in a hurry.
  expect('a refusal states why', trimDecision('marketbar').reason.length > 20, true);
  // And adding a protected table to the allowlist must STILL be refused — the two sets are checked
  // in order precisely so a copy-paste into the allowlist cannot unlock `marketbar`.
  expect(
    'protected wins over allowlist',
    trimDecision('marketbar', [{ table: 'marketbar', column: 'timestamp', what: 'oops' }]).allowed,
    false,
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✔' : '✖'} ${c.name}${c.ok ? '' : ` — got ${c.actual}, wanted ${c.wanted}`}`);
  console.log(failed.length === 0
    ? `\n[db-retention] ✅ self-test — ${cases.length} case(s), guards hold in both directions`
    : `\n[db-retention] ✖ self-test — ${failed.length} of ${cases.length} failed`);
  return failed.length === 0 ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  // ⚠️ USES THE PROJECT'S OWN DRIVER (Prisma), not a new one. `mysql2` is not installed here, and
  // adding a dependency to delete rows would be a poor trade. Prisma also does NOT auto-load
  // `nest/.env`, so the URL is read from that file explicitly — the same trap the instruction files
  // warn about for `npx prisma`.
  const fs = require('node:fs');
  const envPath = path.join(__dirname, '..', 'nest', '.env');
  let url = process.env.DATABASE_URL;
  if (!url && fs.existsSync(envPath)) {
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL\s*=/.test(l));
    if (line) url = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  if (!url) {
    console.error('[db-retention] No DATABASE_URL (checked env and nest/.env) — cannot run.');
    return 2;
  }

  const { PrismaClient } = require(path.join(__dirname, '..', 'nest', 'node_modules', '@prisma', 'client'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cutoff = new Date(Date.now() - args.days * 86400000);
  console.log(`[db-retention] ${args.apply ? 'APPLY' : 'DRY RUN'} — keeping ${args.days} day(s); deleting rows older than ${cutoff.toISOString()} UTC\n`);

  let totalMb = 0;
  let totalRows = 0;
  for (const entry of TRIMMABLE) {
    const decision = trimDecision(entry.table);
    if (!decision.allowed) {
      console.log(`  ⛔ ${entry.table} — REFUSED: ${decision.reason}`);
      continue;
    }
    // Identifiers cannot be bound as parameters, so they are interpolated — and they can only be the
    // two strings written in this file, both verified against `db-schema.cjs`.
    const [size] = await prisma.$queryRawUnsafe(
      `SELECT table_rows AS rows_, ROUND((data_length+index_length)/1024/1024,1) AS mb
         FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?`, entry.table,
    );
    const [doomed] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM \`${entry.table}\` WHERE \`${entry.column}\` < ?`, cutoff,
    );
    const totalRowCount = Number(size?.rows_ ?? 0);
    const deadRows = Number(doomed?.n ?? 0);
    const share = totalRowCount > 0 ? deadRows / totalRowCount : 0;
    const mb = Math.round(Number(size?.mb ?? 0) * share * 10) / 10;
    totalMb += mb;
    totalRows += deadRows;
    console.log(`  · ${entry.table.padEnd(18)} ${String(deadRows).padStart(9)} of ${String(totalRowCount).padStart(9)} row(s)  ≈ ${String(mb).padStart(6)} MB  — ${entry.what}`);

    if (args.apply && deadRows > 0) {
      // Batched, so a large delete cannot hold one long transaction over a live table.
      let deleted = 0;
      for (;;) {
        const n = await prisma.$executeRawUnsafe(
          `DELETE FROM \`${entry.table}\` WHERE \`${entry.column}\` < ? LIMIT 20000`, cutoff,
        );
        deleted += n;
        if (n < 20000) break;
        process.stdout.write(`      …${deleted} deleted\r`);
      }
      console.log(`      → deleted ${deleted}`);
    }
  }

  totalMb = Math.round(totalMb * 10) / 10;
  console.log(`\n[db-retention] ${args.apply ? 'Deleted' : 'Reclaimable'}: ${totalRows.toLocaleString()} row(s), ≈ ${totalMb} MB`);
  if (!args.apply) console.log('[db-retention] Nothing was changed. Re-run with --apply to delete.');
  console.log('\n⚠️  `marketbar` is NOT in this list and must not be: dev-window-v1 is six weeks, and a\n'
    + '    two-week bar trim would leave every run measuring less than the period it reports.\n'
    + '    Note: the slow `data-inventory` query (2.4 s) is NOT a missing index — EXPLAIN shows\n'
    + '    `Extra: Using index` on both aggregates. It is the intrinsic cost of summing 1.29M rows.');

  await prisma.$disconnect();
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('[db-retention] failed:', err.message);
    process.exit(2);
  });
}

module.exports = { trimDecision, TRIMMABLE, PROTECTED, parseArgs };
