#!/usr/bin/env node
/**
 * validate-design-observations.cjs — an observation is only an observation if it can be CLOSED.
 * ==============================================================================================
 * Created 2026-09-24 with the design observation register (review row R21, issue #990).
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/data/design-observations.js` is now where a design tension is held open. Left unguarded it
 * would become a list of opinions that LOOK like findings — which is worse than no register, because
 * it lends a preference the authority of a record. The owner's own framing was *"for review and
 * consideration"*: a thing to be reconsidered, not a thing to be believed.
 *
 * So the file's own rules are enforced here:
 *
 *   1. Every observation must carry a **`reconsiderIf`** — the condition that should re-open the
 *      design. This is the direct analogue of a theory's falsification test. An observation without
 *      it is a complaint, and a complaint cannot be reviewed.
 *   2. A **closed** observation (`decided` / `rejected`) must carry a **`decision`**. An answer
 *      nobody acted on is trivia — the same rule the theory registry applies.
 *   3. `evidence.basis` is graded, and the grade is enforced:
 *        'measurement' → `n` MUST be a positive integer (we counted)
 *        'code-read'   → `n` MUST be null (there is no sample; the claim is about the SOURCE)
 *        'cited'       → `source` MUST name where it came from
 *      ⚠️ This is the rule that matters most. The repo has been bitten repeatedly by a number carried
 *      from another issue being reported as if it had been measured. A citation is a CLAIM, and this
 *      file forces it to say so.
 *   4. **A question is not an observation** — `observation` may not end in '?'. If it is a question,
 *      it belongs in the review queue, which is the surface for questions.
 *   5. `status` must be one of `OBSERVATION_STATUSES`, and `id` must be unique.
 *
 * ── ⚠️ THIS SCRIPT EVALUATES THE REAL `design-observations.js` ──────────────────────────────────
 * It does NOT re-implement the data or the status lists. An earlier guard in this repo
 * (`verify-view-meta-routes.cjs`) re-implemented the thing it guarded, and that made it blind —
 * breaking the real implementation changed nothing. Do not reintroduce a local copy of the rows.
 *
 * ── ⚠️ ON DEMAND, NOT IN `prebuild` ────────────────────────────────────────────────────────────
 * Deliberately, matching `validate-theories.cjs`. The register is data, and a gate that fires for
 * unrelated reasons gets allowlisted — which is worse than no gate, because it consumes attention
 * and provides no cover.
 *
 * Usage:
 *   node scripts/validate-design-observations.cjs              # validate; exit 1 on any violation
 *   node scripts/validate-design-observations.cjs --report     # also print every row and its status
 *   node scripts/validate-design-observations.cjs --self-test  # prove the rules CAN fail (the canary)
 */

const path = require('node:path');
const fs = require('node:fs');

const FILE = path.join(__dirname, '..', 'src', 'data', 'design-observations.js');

// ── Load the REAL module (ESM source, evaluated with exports stripped) ─────────────────────────
function loadObservations() {
  const src = fs.readFileSync(FILE, 'utf8');
  const body = src
    .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
    .replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${body}\nreturn { DESIGN_OBSERVATIONS, OBSERVATION_STATUSES, OBSERVATION_BASES };`);
  const out = factory();
  if (!Array.isArray(out.DESIGN_OBSERVATIONS)) throw new Error('design-observations.js did not expose DESIGN_OBSERVATIONS[]');
  if (!Array.isArray(out.OBSERVATION_STATUSES)) throw new Error('design-observations.js did not expose OBSERVATION_STATUSES[]');
  if (!Array.isArray(out.OBSERVATION_BASES)) throw new Error('design-observations.js did not expose OBSERVATION_BASES[]');
  return out;
}

const REQUIRED_STRINGS = ['id', 'raisedAt', 'raisedBy', 'area', 'title', 'observation', 'why', 'reconsiderIf'];

/** Closed states — these must carry a decision, because the answer is the durable part. */
const CLOSED_STATUSES = ['decided', 'rejected'];

/**
 * The rules, as data, so `--self-test` can canary each one by breaking a COPY.
 * Returns an array of violation strings. An empty array means the register is well-formed.
 */
function validateRows(rows, statuses, bases) {
  const problems = [];
  const seen = new Set();

  rows.forEach((r, i) => {
    const at = `row[${i}] (${r && r.id ? r.id : 'no id'})`;

    for (const key of REQUIRED_STRINGS) {
      if (typeof r[key] !== 'string' || r[key].trim() === '') {
        problems.push(`${at}: missing required string \`${key}\``);
      }
    }

    if (r.id) {
      if (seen.has(r.id)) problems.push(`${at}: duplicate id`);
      seen.add(r.id);
    }

    if (r.status && !statuses.includes(r.status)) {
      problems.push(`${at}: status \`${r.status}\` is not one of ${statuses.join(' | ')}`);
    }

    // Rule 2 — a closed row must record what was done.
    if (CLOSED_STATUSES.includes(r.status) && (typeof r.decision !== 'string' || r.decision.trim() === '')) {
      problems.push(`${at}: status \`${r.status}\` requires a \`decision\``);
    }

    // Rule 4 — a question is not an observation; questions live in the review queue.
    if (typeof r.observation === 'string' && r.observation.trim().endsWith('?')) {
      problems.push(`${at}: \`observation\` is a question — the review queue is the surface for questions`);
    }

    // Rule 3 — the evidence grade must match the evidence.
    const ev = r.evidence;
    if (ev) {
      if (!bases.includes(ev.basis)) {
        problems.push(`${at}: evidence.basis \`${ev.basis}\` is not one of ${bases.join(' | ')}`);
      } else if (ev.basis === 'measurement') {
        if (!Number.isInteger(ev.n) || ev.n <= 0) {
          problems.push(`${at}: basis 'measurement' requires a positive integer \`n\` (we counted it)`);
        }
      } else if (ev.basis === 'code-read') {
        if (ev.n !== null && ev.n !== undefined) {
          problems.push(`${at}: basis 'code-read' requires \`n: null\` — a fact about the source has no sample`);
        }
      } else if (ev.basis === 'cited') {
        if (typeof ev.source !== 'string' || ev.source.trim() === '') {
          problems.push(`${at}: basis 'cited' requires \`source\` — a citation must name where it came from`);
        }
      }
      if (typeof ev.detail !== 'string' || ev.detail.trim() === '') {
        problems.push(`${at}: evidence.detail is required`);
      }
    }
  });

  return problems;
}

function main() {
  const { DESIGN_OBSERVATIONS: rows, OBSERVATION_STATUSES: statuses, OBSERVATION_BASES: bases } = loadObservations();
  const argv = process.argv.slice(2);

  // ── The canary: break a COPY and prove every rule fires ───────────────────────────────────────
  // ⚠️ It mutates only the in-memory copy, so the working tree is never touched. A canary that can
  // leave the tree modified is worse than no canary.
  if (argv.includes('--self-test')) {
    const checks = [
      ['missing reconsiderIf', (r) => { delete r[0].reconsiderIf; }],
      ['closed without a decision', (r) => { r[1].status = 'decided'; delete r[1].decision; }],
      ['measurement with no n', (r) => { r[2].evidence = { basis: 'measurement', detail: 'x', n: null }; }],
      ['code-read carrying an n', (r) => { r[3].evidence = { basis: 'code-read', detail: 'x', n: 5 }; }],
      ['cited with no source', (r) => { r[3].evidence = { basis: 'cited', detail: 'x', n: null, source: '' }; }],
      ['observation phrased as a question', (r) => { r[0].observation = 'Is this right?'; }],
      ['an unknown status', (r) => { r[0].status = 'maybe'; }],
      ['a duplicate id', (r) => { r[1].id = r[0].id; }],
    ];

    let failures = 0;
    for (const [name, mutate] of checks) {
      const copy = JSON.parse(JSON.stringify(rows));
      if (copy.length < 4) {
        console.error(`CANARY INVALID — need at least 4 rows to canary, found ${copy.length}`);
        process.exit(1);
      }
      mutate(copy);
      const found = validateRows(copy, statuses, bases);
      if (found.length === 0) {
        console.error(`CANARY MISSED — rule "${name}" did not fail on a broken copy`);
        failures += 1;
      } else {
        console.log(`  ✓ ${name}`);
      }
    }

    // The baseline must be CLEAN, or the canary is proving a broken register is fine.
    const baseline = validateRows(JSON.parse(JSON.stringify(rows)), statuses, bases);
    if (baseline.length > 0) {
      console.error('CANARY INVALID — the REAL register does not pass its own rules:');
      for (const p of baseline) console.error(`   ${p}`);
      process.exit(1);
    }

    console.log(failures === 0
      ? `\n✅ self-test: all ${checks.length} rules can fail, and the real register passes.`
      : `\n❌ self-test: ${failures} rule(s) could not be made to fail.`);
    process.exit(failures === 0 ? 0 : 1);
  }

  const problems = validateRows(rows, statuses, bases);

  if (argv.includes('--report')) {
    console.log(`design-observations.js — ${rows.length} observation(s)\n`);
    for (const r of rows) {
      const basis = r.evidence ? r.evidence.basis : 'no evidence';
      console.log(`  [${String(r.status).padEnd(12)}] ${String(r.id).padEnd(42)} ${basis}`);
    }
    console.log('');
  }

  if (problems.length > 0) {
    console.error(`\n❌ ${problems.length} problem(s) in ${path.relative(process.cwd(), FILE)}:\n`);
    for (const p of problems) console.error(`   ${p}`);
    console.error('');
    process.exit(1);
  }

  console.log(`✅ design observations OK — ${rows.length} row(s), every one with a \`reconsiderIf\`.`);
}

main();
