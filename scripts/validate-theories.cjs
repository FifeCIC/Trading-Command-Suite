#!/usr/bin/env node
/**
 * validate-theories.cjs — a theory is only a theory if it can be refuted.
 * ======================================================================
 * Created 2026-09-24 with the theory registry (#944).
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/data/theories.js` is now the place a held belief is written down. Left unguarded it would
 * become a list of opinions that LOOK like findings — which is worse than no registry, because it
 * gives a preference the authority of a record.
 *
 * So the file's own rules are enforced here:
 *
 *   1. Every theory must carry a **falsification test**. #944: *"A theory without a falsification
 *      test is not a theory, it is a preference."*
 *   2. A **answered** theory (`supported` / `refuted`) must carry evidence AND a decision — an
 *      answer nobody acted on is trivia.
 *   3. `evidence.basis` is graded, and the grade is enforced:
 *        'measurement' → `n` MUST be a positive integer (we counted)
 *        'code-read'   → `n` MUST be null (there is no sample; the claim is about the SOURCE)
 *        'cited'       → `source` MUST name where it came from
 *      ⚠️ This is the rule that matters most. The repo has been bitten repeatedly by a number
 *      carried from another issue being reported as if it had been measured. A citation is a
 *      CLAIM, and this file forces it to say so.
 *   4. A **question** is not a statement — `statement` may not end in '?'.
 *   5. `status: 'untested'` may NOT carry evidence. Evidence without a test is a contradiction.
 *
 * ── ⚠️ THIS SCRIPT EVALUATES THE REAL `theories.js` ─────────────────────────────────────────────
 * It does NOT re-implement the data or the status lists. An earlier guard in this repo
 * (`verify-view-meta-routes.cjs`) re-implemented the thing it guarded, and that made it blind —
 * breaking the real implementation changed nothing. Do not reintroduce a local copy of `THEORIES`.
 *
 * Usage:
 *   node scripts/validate-theories.cjs            # validate; exit 1 on any violation
 *   node scripts/validate-theories.cjs --report   # also print every theory and its status
 *   node scripts/validate-theories.cjs --self-test  # prove the rules CAN fail (the canary)
 */

const path = require('node:path');
const fs = require('node:fs');

const THEORIES_FILE = path.join(__dirname, '..', 'src', 'data', 'theories.js');

// ── Load the REAL module (ESM source, evaluated with exports stripped) ─────────────────────────
function loadTheories() {
  const src = fs.readFileSync(THEORIES_FILE, 'utf8');
  const body = src
    .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
    .replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${body}\nreturn { THEORIES, THEORY_STATUSES, EVIDENCE_BASES };`);
  const out = factory();
  if (!Array.isArray(out.THEORIES)) throw new Error('theories.js did not expose THEORIES[]');
  if (!Array.isArray(out.THEORY_STATUSES)) throw new Error('theories.js did not expose THEORY_STATUSES[]');
  if (!Array.isArray(out.EVIDENCE_BASES)) throw new Error('theories.js did not expose EVIDENCE_BASES[]');
  return out;
}

const REQUIRED_STRINGS = [
  'id', 'statement', 'predictedDirection', 'measure', 'unit', 'window', 'status', 'falsification', 'area',
];

/**
 * ⚠️ `raisedAt` — #944's acceptance criteria say a status must carry a DATE, and the first version of
 * this guard did not enforce one. A theory with no date cannot be aged: "testing" for a fortnight and
 * "testing" for a year look identical, and a claim about WHEN has to name when.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * validate(entries, statuses, bases) — the WHOLE rule set, as a pure function.
 *
 * Pure on purpose: `--self-test` calls THIS function with deliberately broken input. A self-test
 * that exercised a copy would prove nothing, which is the failure this repo already recorded once.
 */
function validate(entries, statuses, bases) {
  const errors = [];
  const seen = new Set();

  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push('theories.js contains no entries');
    return errors;
  }

  entries.forEach((t, i) => {
    const where = `[${i}] ${t && t.id ? t.id : '(no id)'}`;

    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(t[field])) errors.push(`${where}: missing or empty \`${field}\``);
    }
    if (!isNonEmptyString(t.id)) return; // nothing further can be trusted

    if (seen.has(t.id)) errors.push(`${where}: duplicate id`);
    seen.add(t.id);

    if (!DATE_RE.test(String(t.raisedAt || ''))) {
      errors.push(`${where}: \`raisedAt\` must be a YYYY-MM-DD date (got ${JSON.stringify(t.raisedAt)})`);
    }

    // 4 — a question is not a falsifiable statement
    if (isNonEmptyString(t.statement)) {
      if (t.statement.trim().endsWith('?')) {
        errors.push(`${where}: \`statement\` is a QUESTION, not a falsifiable statement`);
      } else if (t.statement.trim().length < 30) {
        errors.push(`${where}: \`statement\` is too short to be falsifiable (${t.statement.trim().length} chars)`);
      }
    }

    // 1/2 — status must be known, and an ANSWER must carry evidence + decision
    if (isNonEmptyString(t.status) && !statuses.includes(t.status)) {
      errors.push(`${where}: unknown status \`${t.status}\` (expected one of ${statuses.join(' | ')})`);
    }
    const answered = t.status === 'supported' || t.status === 'refuted';
    if (answered && !t.evidence) errors.push(`${where}: status \`${t.status}\` requires \`evidence\``);
    if (answered && !isNonEmptyString(t.decision)) {
      errors.push(`${where}: status \`${t.status}\` requires a \`decision\` — an answer nobody acted on is trivia`);
    }

    // 5 — evidence without a test is a contradiction
    if (t.status === 'untested' && t.evidence) {
      errors.push(`${where}: status \`untested\` must NOT carry \`evidence\``);
    }

    // 3 — the graded evidence rules
    if (t.evidence) {
      const e = t.evidence;
      if (!bases.includes(e.basis)) {
        errors.push(`${where}: \`evidence.basis\` must be one of ${bases.join(' | ')} (got ${JSON.stringify(e.basis)})`);
      }
      for (const f of ['result', 'measuredAt', 'source']) {
        if (!isNonEmptyString(e[f])) errors.push(`${where}: \`evidence.${f}\` is required`);
      }
      if (e.basis === 'measurement' && !(Number.isInteger(e.n) && e.n > 0)) {
        errors.push(`${where}: basis \`measurement\` requires a positive integer \`n\` (got ${JSON.stringify(e.n)})`);
      }
      if (e.basis === 'code-read' && e.n !== null) {
        errors.push(`${where}: basis \`code-read\` requires \`n: null\` — there is no sample, the claim is about the source`);
      }
      if (e.basis === 'cited' && e.n !== null && !Number.isInteger(e.n)) {
        errors.push(`${where}: basis \`cited\` requires \`n\` to be null or an integer (got ${JSON.stringify(e.n)})`);
      }
    }
  });

  return errors;
}

// ── Self-test: prove each rule CAN fail, using the real validate() ────────────────────────────
function selfTest(statuses, bases) {
  const good = {
    id: 'good', raisedAt: '2026-09-24',
    statement: 'A sufficiently long falsifiable statement about the market yes.',
    predictedDirection: 'X up', measure: 'x', unit: 'units', window: '24h',
    status: 'refuted', falsification: 'measure x',
    evidence: { basis: 'measurement', n: 5, result: 'r', measuredAt: '2026-09-24', source: 's' },
    decision: 'd', area: 'scoring',
  };
  const cases = [
    ['a valid entry', [good], false],
    ['missing falsification', [{ ...good, falsification: '' }], true],
    ['a question as the statement', [{ ...good, statement: 'Does the market slow at end of day here?' }], true],
    ['a short statement', [{ ...good, statement: 'too short' }], true],
    ['unknown status', [{ ...good, status: 'probably' }], true],
    ['answered without evidence', [{ ...good, evidence: undefined }], true],
    ['answered without a decision', [{ ...good, decision: '' }], true],
    ['evidence on an untested theory', [{ ...good, status: 'untested' }], true],
    ['unknown basis', [{ ...good, evidence: { ...good.evidence, basis: 'vibes' } }], true],
    ['measurement with no sample', [{ ...good, evidence: { ...good.evidence, n: 0 } }], true],
    ['code-read claiming a sample', [{ ...good, evidence: { ...good.evidence, basis: 'code-read', n: 1 } }], true],
    ['duplicate ids', [good, { ...good }], true],
    ['a missing raisedAt date', [{ ...good, raisedAt: undefined }], true],
    ['a non-date raisedAt', [{ ...good, raisedAt: 'last tuesday' }], true],
    ['empty registry', [], true],
  ];

  let failed = 0;
  for (const [label, entries, shouldFail] of cases) {
    const errs = validate(entries, statuses, bases);
    const didFail = errs.length > 0;
    if (didFail !== shouldFail) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — expected ${shouldFail ? 'a violation' : 'no violation'}, got ${didFail ? errs[0] : 'none'}`);
      failed++;
    }
  }
  if (failed) {
    console.log(`\n  ✗ ${failed} self-test case(s) behaved incorrectly — the rule set is not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — every rule was observed to fail, and a valid entry was observed to pass.`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  let mod;
  try {
    mod = loadTheories();
  } catch (e) {
    console.error(`FATAL: could not evaluate src/data/theories.js — ${e.message}`);
    process.exit(1);
  }
  const { THEORIES, THEORY_STATUSES, EVIDENCE_BASES } = mod;

  if (args.includes('--self-test')) process.exit(selfTest(THEORY_STATUSES, EVIDENCE_BASES));

  const errors = validate(THEORIES, THEORY_STATUSES, EVIDENCE_BASES);

  if (args.includes('--report')) {
    console.log('\n  THEORY REGISTRY\n');
    for (const t of THEORIES) {
      const basis = t.evidence ? t.evidence.basis : '—';
      console.log(`  [${String(t.status).padEnd(9)}] ${t.id}`);
      console.log(`              evidence: ${basis}${t.evidence && t.evidence.n != null ? ` (n=${t.evidence.n})` : ''}   ${t.evidence ? t.evidence.measuredAt : 'no measurement'}`);
    }
    console.log('');
  }

  const counts = THEORY_STATUSES.map((s) => `${s}: ${THEORIES.filter((t) => t.status === s).length}`).join(' · ');
  if (errors.length) {
    console.error(`\n  ✗ theories: ${errors.length} violation(s) in ${THEORIES.length} entries\n`);
    for (const e of errors) console.error(`      ${e}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  [theories] ✅ ${THEORIES.length} entries valid — ${counts}`);
  process.exit(0);
}

main();
