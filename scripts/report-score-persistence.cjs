#!/usr/bin/env node
/**
 * report-score-persistence.cjs — does "scoring" mean it WROTE anything?
 *
 * WHY THIS EXISTS (#1236, measured 2026-11-07)
 * ────────────────────────────────────────────
 * `protocol_score_status` is what the Protocols page renders, and `state: 'scoring'` with
 * `symbolsScored: 79` reads as "this protocol is producing scores". `leverage-v2-long` reported
 * exactly that, on a Saturday, while `momentum-stock-v1-long` correctly reported
 * `standby — US listed closed`. And `score_snapshot` held **zero** rows for `leverage-v2-long`
 * — not for an hour, not for a day: **ever**, with 440,207 rows in the table overall.
 *
 * A status that says "scoring" beside two empty history tables is the repo's signature defect:
 * plausible output, no error. Nothing failed, nothing logged, and every downstream reader —
 * the ceiling analysis (#1184), the directive-count experiment (#1234), outcome tracking, the
 * Strategies view — silently sees a protocol with no history and concludes it has not been tuned.
 *
 * This is a SYMPTOM guard, deliberately. The cause of #1236 is NOT isolated (a missing venue
 * gate would explain the closed-market half; a silent write refusal would explain the persistence
 * half; both remain candidates). A guard on the symptom fires without needing the cause to be
 * right — see `.github/instructions/development-philosophy.instructions.md` §4.
 *
 * WHAT IT CHECKS
 * ──────────────
 * For every protocol whose persisted status says it is scoring:
 *   MISMATCH   `symbolsScored > 0` but NEITHER `score` nor `score_snapshot` received a row
 *              inside the window. The status and the history disagree — this is the #1236 shape.
 *   RARITY-GAP `score` received rows but `score_snapshot` did not. ⚠️ NOT automatically a fault:
 *              the NO_READING path deliberately passes `skipRaritySnapshot` so zero-composite
 *              rows cannot pollute the rarity distribution (see `storeSnapshot()`). Reported
 *              separately and never counted as a failure.
 *
 * ⚠️ An UNREACHABLE DATABASE is exit 2 ("cannot judge"), never exit 0. A checker that inspects
 * nothing and reports OK is worse than no checker.
 *
 * USAGE
 *   node scripts/report-score-persistence.cjs               # 30-minute window
 *   node scripts/report-score-persistence.cjs --minutes 120
 *   node scripts/report-score-persistence.cjs --json
 *   node scripts/report-score-persistence.cjs --self-test   # prove the classifier can fail
 *
 * EXIT  0 = no mismatch · 1 = at least one MISMATCH · 2 = could not read the database
 */

const { query, connect } = require('./lib/mysql-cli.cjs');

/** Classify one protocol row. Pure, so the self-test can exercise it without a database. */
function classify(row) {
  const scored = Number(row.symbolsScored || 0);
  const scoreRows = Number(row.scoreRows || 0);
  const snapshotRows = Number(row.snapshotRows || 0);
  // A protocol that is not claiming to have scored anything cannot be inconsistent.
  if (!(scored > 0)) return 'IDLE';
  if (scoreRows === 0 && snapshotRows === 0) return 'MISMATCH';
  if (scoreRows > 0 && snapshotRows === 0) return 'RARITY-GAP';
  return 'OK';
}

function argvFlag(name) {
  return process.argv.includes(name);
}
function argvValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function selfTest() {
  const cases = [
    // [description, row, expected]
    ['scoring with rows in both tables is OK', { symbolsScored: 79, scoreRows: 40, snapshotRows: 40 }, 'OK'],
    ['scoring with NOTHING written is a MISMATCH (the #1236 shape)', { symbolsScored: 79, scoreRows: 0, snapshotRows: 0 }, 'MISMATCH'],
    ['score written but no rarity snapshot is a RARITY-GAP, not a failure', { symbolsScored: 8, scoreRows: 8, snapshotRows: 0 }, 'RARITY-GAP'],
    ['zero scored symbols cannot be inconsistent', { symbolsScored: 0, scoreRows: 0, snapshotRows: 0 }, 'IDLE'],
    // ⚠️ The next two exist because the obvious implementation gets them wrong: a protocol
    // legitimately parked by the venue gate reports symbolsScored 0, and must NOT be flagged.
    ['standby protocol (0 scored) is IDLE even with no rows', { state: 'standby', symbolsScored: 0, scoreRows: 0, snapshotRows: 0 }, 'IDLE'],
    ['a string "0" from the CLI is not truthy', { symbolsScored: '0', scoreRows: '0', snapshotRows: '0' }, 'IDLE'],
  ];
  let failures = 0;
  for (const [desc, row, expected] of cases) {
    const got = classify(row);
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '✖ '} ${desc} → ${got}${ok ? '' : ` (expected ${expected})`}`);
  }
  // Canary in the OTHER direction: the classifier must be able to FAIL. If every case above
  // returned 'OK' the suite would pass trivially; assert a known-bad row really is bad.
  const canary = classify({ symbolsScored: 1, scoreRows: 0, snapshotRows: 0 });
  if (canary !== 'MISMATCH') {
    failures++;
    console.log(`  ✖  CANARY INVALID — a known-bad row classified as ${canary}, the detector cannot fail`);
  } else {
    console.log('  ✅ canary: a known-bad row IS detected (the detector can fail)');
  }
  console.log(failures === 0
    ? `✅ self-test: ${cases.length + 1} cases — both directions observed.`
    : `✖ self-test: ${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (argvFlag('--self-test')) return selfTest();

  const minutes = argvValue('--minutes', 30);
  const asJson = argvFlag('--json');

  let conn;
  try {
    conn = connect();
  } catch (err) {
    console.error(`🛑 cannot judge — ${err.message}`);
    process.exit(2);
  }

  // One round trip. `score` is keyed by strategyId = protocol slug (not a UUID); `score_snapshot`
  // is keyed by protocolId = slug. Both facts are from `node scripts/db-schema.cjs`, not memory.
  const sql = `
    SELECT s.protocolId,
           s.state,
           s.symbolsScored,
           s.symbolsResolved,
           s.lastTickAt,
           (SELECT COUNT(*) FROM score x
              WHERE x.strategyId = s.protocolId
                AND x.timestamp >= NOW() - INTERVAL ${minutes} MINUTE) AS scoreRows,
           (SELECT COUNT(*) FROM score_snapshot y
              WHERE y.protocolId = s.protocolId
                AND y.snappedAt >= NOW() - INTERVAL ${minutes} MINUTE) AS snapshotRows
      FROM protocol_score_status s
     ORDER BY s.state, s.protocolId`;

  let raw;
  try {
    raw = query(sql, conn);
  } catch (err) {
    console.error(`🛑 cannot judge — the database query failed: ${err.message}`);
    process.exit(2);
  }

  const lines = String(raw).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    console.error('🛑 cannot judge — the status query returned no rows (not the same as "nothing is wrong").');
    process.exit(2);
  }
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });

  const results = rows.map((r) => ({ ...r, verdict: classify(r) }));
  const mismatches = results.filter((r) => r.verdict === 'MISMATCH');
  const gaps = results.filter((r) => r.verdict === 'RARITY-GAP');
  const scoring = results.filter((r) => Number(r.symbolsScored || 0) > 0);

  if (asJson) {
    console.log(JSON.stringify({ windowMinutes: minutes, mismatches, rarityGaps: gaps, scoring }, null, 2));
    process.exit(mismatches.length > 0 ? 1 : 0);
  }

  console.log(`\nSCORE PERSISTENCE — window ${minutes} min · ${scoring.length} protocol(s) report symbolsScored > 0\n`);
  console.log('protocol                        state      scored  score  snapshot  verdict');
  console.log('─'.repeat(78));
  for (const r of results) {
    if (r.verdict === 'IDLE') continue;
    const mark = r.verdict === 'MISMATCH' ? '🛑' : r.verdict === 'RARITY-GAP' ? '⚠️ ' : '✅';
    console.log(
      `${String(r.protocolId).padEnd(31)} ${String(r.state).padEnd(10)} ${String(r.symbolsScored).padStart(6)} ` +
      `${String(r.scoreRows).padStart(6)} ${String(r.snapshotRows).padStart(9)}  ${mark} ${r.verdict}`,
    );
  }

  console.log('');
  if (gaps.length) {
    console.log(`⚠️  ${gaps.length} RARITY-GAP — \`score\` written, no rarity snapshot. Usually the NO_READING path`);
    console.log('    (deliberate: zero composites must not pollute the rarity distribution). Not a failure.\n');
  }
  if (mismatches.length) {
    console.log(`🛑 ${mismatches.length} MISMATCH — the status says these protocols are scoring and NOTHING was written:`);
    for (const m of mismatches) console.log(`     ${m.protocolId} (${m.symbolsScored}/${m.symbolsResolved} symbols, lastTick ${m.lastTickAt})`);
    console.log('\n    Cause is NOT asserted here. A MISMATCH means the status and the history disagree;');
    console.log('    the writer may be refusing silently, or the venue gate may be missing. See #1236.\n');
    process.exit(1);
  }
  console.log('✅ no MISMATCH — every protocol claiming to score wrote at least one row in the window.\n');
  process.exit(0);
}

main();
