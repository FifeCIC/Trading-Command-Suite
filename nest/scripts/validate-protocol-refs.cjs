#!/usr/bin/env node
/**
 * validate-protocol-refs.cjs — every table that NAMES a protocol must name it the SAME WAY.
 * =================================================================================================
 *
 * THE DEFECT THIS GUARDS (#800)
 * -----------------------------
 * `trading_strategy.protocolId` accepts **either a protocol slug or a protocol uuid** — the column is
 * `varchar(36)`, which is exactly a uuid's width, so both forms fit and nothing rejects either. A
 * lookup that assumes one form then sees the other rows as **non-existent**: `WHERE protocolId =
 * 'cac-speed-v1'` returned 0 bots while the bot was there under its uuid. Wrong answer, no error.
 *
 * Measured 2026-09-11 in the issue: 14 `forex-session-v1` bots on slug, 4 other protocols on uuid.
 * Measured again 2026-10-28 for this guard (see `--report`):
 *
 *     trading_strategy    40 rows   slug 40   uuid 0   unresolved 0   ✅ clean
 *     strategy_protocol   all       slug      uuid 0   unresolved 0   ✅ clean
 *     backtestrun          88 rows  slug 88   uuid 0   unresolved 0   ✅ clean
 *     watchlist            45 rows  uuid 29   slug 0   unresolved 16  ⚠️ the OTHER form (advisory)
 *     score_snapshot   369,229      slug-form 366,513, resolvable 352,939 — 16,290 rows name a
 *                                  protocol that does not exist at all (advisory, see below)
 *
 * THE CANONICAL FORM IS **SLUG** — decided 2026-10-28. It is what 40/40 bots and 88/88 runs already
 * use, it is what `protocol.slug` is unique on, and it is readable: a uuid in this column tells a
 * reader nothing. `watchlist.protocolId` is the KNOWN EXCEPTION (it holds protocol uuids, and its
 * readers expect that) — named here so the next reader does not "fix" one table and break the other.
 *
 * ── WHAT FAILS THE GATE ───────────────────────────────────────────────────────────────────────
 * A row in a CANONICAL table (`trading_strategy`, `strategy_protocol`, `backtestrun`,
 * `backtest_experiment`) whose `protocolId` does not resolve to a `protocol.slug`. That covers both
 * failure modes at once: the uuid form, and a slug that names no protocol.
 *
 * ── WHAT IS REPORTED BUT DOES NOT FAIL (state it, never hide it) ──────────────────────────────
 * `watchlist` (uuid by design) and `score_snapshot` (16,290 historical rows naming 8 protocols that no
 * longer exist — `xau-speed-*-copy` family, last written 2026-10-14, plus `default-short`,
 * `cad-sniper-v1`). Failing on those would make this gate permanently red for history, and a gate that
 * is always red gets allowlisted; they are printed with counts and dates so the state is visible.
 * ⚠️ The `-copy` rows stopped being written on 2026-10-14, so this is archaeology, not a live leak —
 * but nothing would have told us if it had continued, which is why the counts are printed every run.
 *
 * ⚠️ ERROR IS NOT PASS. If the database cannot be read this exits 1 and says it could not run.
 * ⚠️ `--self-test` proves the classifier can fail, in both directions, with no database.
 *
 * Usage:
 *   node nest/scripts/validate-protocol-refs.cjs            # gate
 *   node nest/scripts/validate-protocol-refs.cjs --report   # same, plus the advisory tables in full
 *   node nest/scripts/validate-protocol-refs.cjs --self-test
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which tables MUST hold a slug. `watchlist` is deliberately absent — it holds uuids by design. */
// ── DECISION (2026-10-28, primary) ──
// WHAT:      a protocol reference is a SLUG. `watchlist.protocolId` is the one declared exception
//            (it holds protocol uuids, and its readers expect that).
// WHY:       measured 2026-10-28 (#800) — `trading_strategy.protocolId` is varchar(36), exactly a
//            uuid's width, so both forms fitted and nothing rejected either. `WHERE protocolId =
//            'cac-speed-v1'` returned 0 bots while the bot existed under its uuid: wrong answer, no
//            error. Slug is what every canonical table already uses, it is what `protocol.slug` is
//            unique on, and it is the only form a human can read in this column.
// INSTEAD OF: resolving both forms at every call site. Two accepted forms everywhere is the ambiguity
//            being removed — `ProtocolDbService.resolveSymbols()` had to defend against it alone (#747).
// REVERSE BY: choosing a different canonical form, migrating all four canonical tables in one change,
//            then flipping CANONICAL_TABLES here and the exception list in the header.
// REGISTER:  docs/SETTLED-DECISIONS.md row 95
// GUARD:     this file — `npm run validate:protocol-refs`, plus `--self-test` for both directions.
const CANONICAL_TABLES = ['trading_strategy', 'strategy_protocol', 'backtestrun', 'backtest_experiment'];

/**
 * HISTORICAL rows that name no protocol, baselined with a reason — the same ratchet shape as
 * `validate-protocol-slugs.cjs` and `validate-duplication.cjs`.
 *
 * ⚠️ WHY NOT REPAIR THEM: their protocol is genuinely unknowable. Guessing which protocol was in force
 * in June would FABRICATE attribution, which is worse than a row that is honestly unreachable. They are
 * counted, dated and printed instead.
 *
 * ⚠️ THE ALLOWANCE CANNOT ROT: a baselined entry that no longer appears ALSO fails, so a permission
 * nobody remembers granting cannot sit here forever.
 */
const BASELINED = [
  {
    table: 'backtestrun',
    protocolId: 'default',
    count: 11,
    reason:
      'MEASURED 2026-10-28: 11 runs written 2026-06-24 → 2026-08-04, BEFORE `run()` required a canonical ' +
      'protocol ("Backtest requires protocolId for canonical META.Stack scoring"). No current code path ' +
      'writes "default", so these cannot recur; their real protocol is not recorded and guessing it would ' +
      'fabricate attribution. Left unreachable and COUNTED rather than invented.',
  },
];

/**
 * classifyRefs — pure, so the rule can be tested without a database.
 *
 * @param {Record<string, Array<{ id?: string, label?: string, protocolId: string | null }>>} rowsByTable
 * @param {Array<{ id: string, slug: string }>} protocols
 */
function classifyRefs(rowsByTable, protocols) {
  const bySlug = new Map();
  const byId = new Map();
  for (const p of protocols ?? []) {
    bySlug.set(p.slug, p);
    byId.set(p.id, p);
  }

  const tables = {};
  const failures = [];
  for (const [table, rows] of Object.entries(rowsByTable ?? {})) {
    const stats = {
      table,
      total: rows.length,
      slugForm: 0,
      uuidForm: 0,
      resolvesAsSlug: 0,
      resolvesAsUuid: 0,
      unresolved: [],
      canonical: CANONICAL_TABLES.includes(table),
    };
    for (const row of rows) {
      const ref = row?.protocolId ?? null;
      if (!ref) {
        stats.unresolved.push({ id: row?.id, label: row?.label, protocolId: ref, why: 'empty' });
        continue;
      }
      if (UUID_RE.test(ref)) stats.uuidForm += 1;
      else stats.slugForm += 1;
      const asSlug = bySlug.has(ref);
      const asId = byId.has(ref);
      if (asSlug) stats.resolvesAsSlug += 1;
      if (asId) stats.resolvesAsUuid += 1;
      if (!asSlug) {
        stats.unresolved.push({
          id: row?.id,
          label: row?.label,
          protocolId: ref,
          why: asId ? 'uuid-form (resolves only as protocol.id)' : 'names no protocol at all',
        });
      }
    }
    tables[table] = stats;
  }

  /**
   * Apply the baselined allowance: a known-historical `protocolId` is excused up to its recorded count,
   * and the allowance is checked for ROT (an entry that no longer appears is as much a failure as a new
   * one — otherwise it silently becomes a permanent permission).
   */
  const staleAllowances = [];
  for (const entry of BASELINED ?? []) {
    const stats = tables[entry.table];
    const present = (stats?.unresolved ?? []).filter((r) => r.protocolId === entry.protocolId);
    if (present.length === 0) {
      staleAllowances.push(entry);
      continue;
    }
    if (present.length > entry.count) {
      // More than was baselined — the excess is a NEW occurrence and must fail.
      stats.unresolved = stats.unresolved.filter(
        (r) => r.protocolId !== entry.protocolId || present.indexOf(r) >= entry.count,
      );
      stats.baselined = (stats.baselined ?? 0) + entry.count;
    } else {
      stats.unresolved = stats.unresolved.filter((r) => r.protocolId !== entry.protocolId);
      stats.baselined = (stats.baselined ?? 0) + present.length;
    }
  }

  for (const [table, stats] of Object.entries(tables)) {
    if (stats.canonical && stats.unresolved.length > 0) {
      failures.push({ table, count: stats.unresolved.length, rows: stats.unresolved.slice(0, 10) });
    }
  }
  return { tables, failures, staleAllowances };
}

// ── Self-test: the classifier must fail AND pass, or it is a decoration. ────────────────────────
function selfTest() {
  const protocols = [
    { id: 'd6386512-acfc-11f1-951d-9c6b00b28963', slug: 'cac-speed-v1' },
    { id: 'aaaa1111-acfc-11f1-951d-9c6b00b28963', slug: 'xau-speed-v1' },
  ];
  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`   ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) failures += 1;
  };

  // 1. A clean slug set passes.
  const clean = classifyRefs(
    { trading_strategy: [{ protocolId: 'cac-speed-v1' }, { protocolId: 'xau-speed-v1' }] },
    protocols,
  );
  check('slug-form bots PASS', clean.failures.length, 0);

  // 2. THE CITED DEFECT: a bot storing the uuid must FAIL.
  const uuidBot = classifyRefs(
    { trading_strategy: [{ protocolId: 'd6386512-acfc-11f1-951d-9c6b00b28963' }] },
    protocols,
  );
  check('uuid-form bot FAILS', uuidBot.failures.length, 1);
  check('…and the reason names the form', uuidBot.failures[0].rows[0].why, 'uuid-form (resolves only as protocol.id)');

  // 3. A slug naming no protocol also FAILS (a rename that was not migrated).
  const ghost = classifyRefs({ strategy_protocol: [{ protocolId: 'xau-speed-v1-copy' }] }, protocols);
  check('ghost slug FAILS', ghost.failures.length, 1);
  check('…and says so', ghost.failures[0].rows[0].why, 'names no protocol at all');

  // 4. An EMPTY canonical table passes — "no rows" is not a failure.
  check('empty table PASSES', classifyRefs({ backtestrun: [] }, protocols).failures.length, 0);

  // 5. An ADVISORY table with uuids does NOT fail (watchlist holds uuids by design).
  const advisory = classifyRefs({ watchlist: [{ protocolId: 'd6386512-acfc-11f1-951d-9c6b00b28963' }] }, protocols);
  check('watchlist uuids are reported, not failed', advisory.failures.length, 0);
  check('…but still counted as uuid form', advisory.tables.watchlist.uuidForm, 1);

  // 6. A null reference is unresolved, not silently skipped.
  check('null protocolId is unresolved', classifyRefs({ trading_strategy: [{ protocolId: null }] }, protocols).failures.length, 1);

  // 7. THE BASELINED ALLOWANCE: exactly 11 `default` runs pass…
  const eleven = Array.from({ length: 11 }, () => ({ protocolId: 'default' }));
  const baselined = classifyRefs({ backtestrun: eleven }, protocols);
  check('11 baselined `default` runs PASS', baselined.failures.length, 0);

  // 8. …a TWELFTH fails (a new occurrence must not hide behind the allowance)…
  const twelve = classifyRefs({ backtestrun: [...eleven, { protocolId: 'default' }] }, protocols);
  check('a 12th `default` run FAILS', twelve.failures.length, 1);
  check('…and only the EXCESS is reported', twelve.failures[0].count, 1);

  // 9. …and the allowance going STALE fails, so it cannot rot into a permanent permission.
  const stale = classifyRefs({ backtestrun: [] }, protocols);
  check('a stale allowance FAILS', stale.staleAllowances.length, 1);

  console.log(failures === 0 ? '\n[self-test] ✅ PASS\n' : `\n[self-test] ❌ ${failures} case(s) failed\n`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    console.error(`\n❌ Cannot load @prisma/client: ${String(err.message).split('\n')[0]}\n`);
    return 1;
  }
  const prisma = new PrismaClient();

  let rowsByTable;
  let protocols;
  let snapshots;
  let watchlists;
  try {
    const [bots, subs, runs, experiments, protocolRows, snapshotGroups, watchlistRows] = await Promise.all([
      prisma.tradingStrategy.findMany({ select: { id: true, name: true, protocolId: true } }),
      prisma.strategyProtocol.findMany({ select: { strategyId: true, protocolId: true } }),
      prisma.backtestRun.findMany({ select: { id: true, protocolId: true } }),
      prisma.backtestExperiment.findMany({ select: { id: true, label: true, protocolId: true } }),
      prisma.protocol.findMany({ select: { id: true, slug: true } }),
      prisma.$queryRawUnsafe(
        `SELECT s.protocolId AS protocolId, COUNT(*) AS n, MAX(s.snappedAt) AS lastTs
           FROM score_snapshot s LEFT JOIN protocol p ON p.slug = s.protocolId
          WHERE p.id IS NULL GROUP BY s.protocolId ORDER BY n DESC`,
      ),
      prisma.$queryRawUnsafe(`SELECT protocolId, COUNT(*) AS n FROM watchlist GROUP BY protocolId`),
    ]);
    protocols = protocolRows;
    snapshots = snapshotGroups;
    watchlists = watchlistRows;
    rowsByTable = {
      trading_strategy: bots.map((b) => ({ id: b.id, label: b.name, protocolId: b.protocolId })),
      strategy_protocol: subs.map((s) => ({ id: s.strategyId, protocolId: s.protocolId })),
      backtestrun: runs.map((r) => ({ id: r.id, protocolId: r.protocolId })),
      backtest_experiment: experiments.map((e) => ({ id: e.id, label: e.label, protocolId: e.protocolId })),
    };
  } catch (err) {
    // ⚠️ ERROR, never pass — a check that inspects nothing and reports OK is worse than no check.
    console.error(`\n❌ Cannot read the database: ${String(err.message).split('\n')[0]}`);
    console.error('   This check needs `trading_strategy`, `strategy_protocol`, `backtestrun`,');
    console.error('   `backtest_experiment`, `protocol`, `score_snapshot` and `watchlist`.');
    console.error('   It did NOT pass — it could not run.\n');
    await prisma.$disconnect();
    return 1;
  }
  await prisma.$disconnect();

  const { tables, failures, staleAllowances } = classifyRefs(rowsByTable, protocols);

  console.log('\n[protocol-refs] canonical form is SLUG (decided 2026-10-28, #800)');
  for (const table of CANONICAL_TABLES) {
    const s = tables[table];
    if (!s) continue;
    const mark = s.unresolved.length === 0 ? '✅' : '❌';
    const excused = s.baselined ? ` · ${s.baselined} baselined` : '';
    console.log(
      `   ${mark} ${table.padEnd(20)} ${String(s.total).padStart(5)} row(s) · slug ${s.slugForm} · uuid ${s.uuidForm} · unresolved ${s.unresolved.length}${excused}`,
    );
  }

  if (staleAllowances.length > 0) {
    console.error('\n❌ A baselined allowance no longer matches the database — remove it, or it is a');
    console.error('   permission nobody remembers granting:');
    for (const s of staleAllowances) console.error(`   • ${s.table}.protocolId = "${s.protocolId}" (baselined ${s.count})`);
  }

  // Advisory: reported every run so a live leak would be visible, never a gate.
  const watchlistUuids = (watchlists ?? []).filter((w) => UUID_RE.test(String(w.protocolId))).length;
  const snapshotRows = (snapshots ?? []).reduce((sum, s) => sum + Number(s.n), 0);
  console.log(`   ℹ️  watchlist             ${(watchlists ?? []).length} row(s), ${watchlistUuids} in uuid form — the KNOWN EXCEPTION, not a failure`);
  if (snapshotRows > 0) {
    console.log(`   ℹ️  score_snapshot        ${snapshotRows} row(s) name a protocol that does not exist (${(snapshots ?? []).length} distinct id(s)), newest ${String(snapshots[0]?.lastTs ?? '').slice(0, 19)}`);
    if (args.includes('--report')) {
      for (const s of snapshots) console.log(`        • ${s.protocolId} — ${s.n} row(s), last ${String(s.lastTs).slice(0, 19)}`);
    }
  }

  if (failures.length === 0 && staleAllowances.length === 0) {
    console.log('\n✅ OK — every canonical table names protocols by slug, and every name resolves\n');
    return 0;
  }
  if (failures.length === 0) return 1;

  console.error(`\n❌ ${failures.length} table(s) hold a protocolId that is not a resolvable SLUG —`);
  console.error('   any lookup that assumes a slug sees these rows as non-existent (wrong answer, no error).\n');
  for (const f of failures) {
    console.error(`   ${f.table} — ${f.count} row(s):`);
    for (const r of f.rows) console.error(`     • ${r.protocolId} — ${r.why}${r.label ? ` (${r.label})` : ''}`);
  }
  console.error('');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n❌ validate-protocol-refs crashed: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
