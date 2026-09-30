#!/usr/bin/env node
/**
 * validate-signal-column-width.cjs — INV-SIGNAL-COLUMN-FITS-A-CLASS (build-time)
 * ==============================================================================
 *
 * Fails the build when a column that holds a SIGNAL CLASS is too narrow to store the longest one.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT (#1028, measured 2026-09-30)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `decision_log.signal` and `score_snapshot.trading_signal` were both `VarChar(10)`.
 * **`STRONG_SELL` is ELEVEN characters**, so MySQL truncated it to `STRONG_SEL` on write:
 *
 *     726 rows  decision_log.signal
 *   1,081 rows  score_snapshot.trading_signal
 *
 * ⚠️ `STRONG_BUY` is exactly 10, so it fitted — which is WHY the defect hid for so long. Only the
 * highest-conviction BEARISH signal the system can produce was corrupted, and it was corrupted into
 * a value that is not a signal class at all: `STRONG_SEL` matches no counter, no direction test and
 * no `classifySignal()` branch.
 *
 * The same week, `#1029` found the OTHER half of this class — a column that is wide enough but read
 * by prefix. Both are needed: a correct classifier cannot repair a value corrupted at the storage
 * layer, and a wide column cannot repair a prefix test. Guarded separately, deliberately.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS PARSES `schema.prisma` AND NOT THE DATABASE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * The build must not require a running database. `schema.prisma` is the declaration, and the
 * repo-wide consistency between it and the real schema is checked by `db:check` + the raw-managed
 * registry. ⚠️ KNOWN BLIND SPOT, stated rather than implied: a table that is NOT modelled here —
 * `strategy_signal_queue` is one — cannot be checked by this gate at all. That table's `signal`
 * column was widened by hand on 2026-09-30 for the same reason; a raw-managed table has no
 * declaration to guard.
 *
 * Usage:
 *   node nest/scripts/validate-signal-column-width.cjs              # check (build gate)
 *   node nest/scripts/validate-signal-column-width.cjs --self-test  # prove it can fail
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');

/**
 * The signal classes, as the system defines them. `signal-direction.ts` is the authority; this list
 * exists ONLY so the minimum width below is derived rather than typed twice.
 */
const SIGNAL_CLASSES = ['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL', 'HOLD'];

/** The narrowest legal width for a class-bearing column, DERIVED from the vocabulary. */
const MIN_LEN = Math.max(...SIGNAL_CLASSES.map((c) => c.length));

/**
 * ⚠️ DECLARED EXCEPTIONS, each with the reason it is not a signal class. This is deliberately a short
 * list with evidence, not an allowlist — an allowlisted guard is worse than none.
 */
const EXCEPTIONS = [
  // Holds `bearish | bullish | neutral` (measured: 51,065 bearish, 21,167 bullish, max length 7).
  // A different vocabulary that happens to share the word "signal".
  'DirectiveOutcome.signalClass',
];

/** A field declaration whose NAME names a signal. */
const FIELD = /^\s+(\w*[Ss]ignal\w*)\s+String\??\s+.*?@db\.VarChar\((\d+)\)/;

/** Findings for a schema source string. Exported shape so the self-test can drive it directly. */
function scanSchema(src, modelHint) {
  const out = [];
  let model = modelHint || null;
  for (const line of src.split(/\r?\n/)) {
    const mModel = /^model\s+(\w+)\s*\{/.exec(line);
    if (mModel) { model = mModel[1]; continue; }
    const m = FIELD.exec(line);
    if (!m) continue;
    const [, field, width] = m;
    const key = `${model}.${field}`;
    if (EXCEPTIONS.includes(key)) continue;
    if (Number(width) < MIN_LEN) {
      out.push({ key, width: Number(width), line: line.trim().slice(0, 110) });
    }
  }
  return out;
}

function selfTest() {
  const cases = [
    // ── the SHIPPED defect ────────────────────────────────────────────────────────────────────
    ['flags the decision_log.signal width that shipped (#1028)', () => {
      const src = 'model DecisionLog {\n  signal      String?  @db.VarChar(10)\n}';
      const f = scanSchema(src);
      return f.length === 1 && f[0].key === 'DecisionLog.signal';
    }],
    ['flags the score_snapshot.trading_signal width that shipped (#1028)', () => {
      const src = 'model ScoreSnapshot {\n  tradingSignal String @map("trading_signal") @db.VarChar(10)\n}';
      const f = scanSchema(src);
      return f.length === 1 && f[0].key === 'ScoreSnapshot.tradingSignal';
    }],

    // ── must NOT fire ────────────────────────────────────────────────────────────────────────
    ['accepts the widened width', () =>
      scanSchema('model DecisionLog {\n  signal String? @db.VarChar(16)\n}').length === 0],
    ['accepts exactly 11 — the minimum that fits STRONG_SELL', () =>
      scanSchema('model X {\n  signal String @db.VarChar(11)\n}').length === 0],
    ['accepts the DECLARED exception, and only that one', () => {
      const ok = scanSchema('model DirectiveOutcome {\n  signalClass String @db.VarChar(10)\n}').length === 0;
      // The same width on the SAME FIELD NAME in another model must still fail — the exception is
      // keyed on model+field, not on the name, so it cannot silently cover a second column.
      const stillFlagged = scanSchema('model Other {\n  signalClass String @db.VarChar(10)\n}').length === 1;
      return ok && stillFlagged;
    }],
    ['does NOT flag a non-string or non-signal field', () =>
      scanSchema('model X {\n  composite Float\n  name String @db.VarChar(10)\n  signalCount Int\n}').length === 0],

    // ── the guarantee this gate rests on ─────────────────────────────────────────────────────
    ['MIN_LEN is derived from the vocabulary and fits STRONG_SELL', () => MIN_LEN === 11 && MIN_LEN >= 'STRONG_SELL'.length],
    ['the REAL schema.prisma is clean', () =>
      scanSchema(fs.readFileSync(SCHEMA, 'utf8')).length === 0],
  ];

  const { runCases } = require('../../scripts/lib/validator-helpers.cjs');
  process.exit(runCases(cases) ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const findings = scanSchema(fs.readFileSync(SCHEMA, 'utf8'));
if (findings.length) {
  console.log(`[signal-column-width] ✖ ${findings.length} signal column(s) too narrow for a signal class:\n`);
  for (const f of findings) {
    console.log(`  ${f.key}  VarChar(${f.width}) — needs at least ${MIN_LEN}`);
    console.log(`    ${f.line}\n`);
  }
  console.log(`  The longest signal class is STRONG_SELL (${MIN_LEN} chars). A narrower column TRUNCATES`);
  console.log('  it silently on write: MySQL stores STRONG_SEL, which is not a signal class at all.');
  console.log('  ⚠️ This shipped once (#1028) and corrupted 1,807 rows. Widen the column, then');
  console.log('    ALTER the real table with the SAME charset/collation, then repair any truncated rows.');
  process.exit(1);
}
console.log(`[signal-column-width] ✅ OK — every signal column can hold STRONG_SELL (${MIN_LEN} chars)`);
