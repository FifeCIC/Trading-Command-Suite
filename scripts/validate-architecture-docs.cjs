#!/usr/bin/env node
/**
 * validate-architecture-docs.cjs — does the CHIPBOARD still agree with the page it was generated from?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * `src/core/architecture-reference.js` declares itself, in its own header:
 *
 *     @generated — extracted from architecture-framework.data.js
 *
 * Two surfaces, one subject matter. The reference is the ~23K-token "chipboard" an AI agent
 * reads; the framework page is the ~38K human-facing page. They diverged once already (handoff
 * batch #17) and were reconciled by hand, because **nothing failed the build when one was
 * updated and not the other**.
 *
 * ⚠️ AND THIS IS NOT WHAT `validate-duplication.cjs` DOES — and the reason is subtle enough that
 * it was got wrong TWICE, so it is written down properly here.
 *
 * That guard DOES track this pair, at 1023 windows. Reading only that fact, the conclusion "so the
 * pair is already protected" looks sound. **It is wrong, and the guard's own annotation says so:**
 *
 *     "What is still UNGUARDED is the agreement itself: nothing fails the build if one surface is
 *      updated and the other is not. They diverged once already (batch #17 ...)."
 *
 * The pair is in the ALLOWANCE, and an allowance does the opposite of protecting a number — it
 * LICENSES it to vary. Its own note records the growth as expected and banked: +51 windows at
 * batch #22, +125 at batch #23, "banked deliberately, not silently". So a divergence is
 * *permitted* by design, and that guard cannot fire on it. Two facts pointed in opposite
 * directions and the weaker reading was the more comfortable one.
 *
 * The general lesson, which is why this comment is long: **an entry in an allowance list is not a
 * guard on the thing the list counts.** Read what the allowance MEANS before concluding a value is
 * protected — a name in a config is a claim, not a definition.
 *
 * ── THE TWO INVARIANTS ───────────────────────────────────────────────────────────────────────
 *
 *  INV-ARCH-DOCS-1  The section index must be the SAME SET on both surfaces.
 *                   `ARCHITECTURE_INDEX` is one index rendered twice. A section added to one
 *                   surface and not the other means an agent reading the chipboard cannot see a
 *                   section the page has (or vice versa) — a silent capability gap.
 *                   Measured 2026-09-30: 25 names in each, 25 shared, 0 one-sided.
 *
 *  INV-ARCH-DOCS-2  Every export the REFERENCE has must exist on the framework page.
 *                   This is the `@generated` direction only, and it is deliberately one-way:
 *                   the page legitimately carries extra sections (DECISION_WORKFLOW,
 *                   FEATURE_MATRIX, INTAKE_TEMPLATE ...) that the chipboard omits for token
 *                   budget. An export in the reference with no counterpart means the reference
 *                   was HAND-EDITED — it can no longer be regenerated from its own source, and
 *                   the next regeneration silently deletes it.
 *
 * ── WHY THE PREMISE WAS MEASURED BEFORE BUILDING ─────────────────────────────────────────────
 *
 * A guard on an unsound premise is a false-positive generator, and an allowlisted guard is
 * worse than none. So the key space was measured first: 25 names each, 25 shared, 0 one-sided —
 * a clean contract, not a coincidence. The first probe returned 0 keys for the 310 KB reference
 * because it looked for `id|slug|key` and this file uses `name`; that 0 was a PROBE DEFECT and
 * drawing a verdict from it would have been the exact failure this repo names —
 * "a verifier that cannot read its input must ERROR, never pass."
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/validate-architecture-docs.cjs              # check, exit 1 on violation
 *   node scripts/validate-architecture-docs.cjs --report     # what it compared, always exit 0
 *   node scripts/validate-architecture-docs.cjs --self-test  # 10 cases, pure functions only
 *
 *   npm run validate:arch-docs   /   report:arch-docs   /   test:arch-docs   /   canary:arch-docs
 *
 * The `--self-test` drives the two invariants with SYNTHETIC inputs — fast, and it proves each
 * rule can fail in both directions. It cannot prove the EXTRACTOR works on the real 310 KB file,
 * because that is the one thing synthetic input cannot show. So there is a second, slower proof:
 *
 *   node scripts/canary-architecture-docs.cjs
 *
 * It edits a REAL section into one surface, runs this guard, asserts it fails and NAMES the
 * section, restores the file byte-for-byte, and repeats for the other surface — then re-checks
 * the green baseline. Measured 2026-09-30: A and B both fired, both restored clean, git reported
 * both files identical to HEAD.
 *
 * ⚠️ NOT wired into `prebuild` yet — deliberately, and stated rather than implied.
 *
 * The check passes today (25/25 sections, 0 orphan exports), so wiring it costs nothing. It was
 * left out because `prebuild` is shared by every agent in this repo, and a brand-new gate that
 * has run exactly once is not yet a gate — it is a gate-shaped thing that has passed once. The
 * precedent is explicit: `validate-decisions.cjs` and `validate-theories.cjs` are both on demand
 * for exactly this reason. Wire it once a divergence has been caught in the wild; until then
 * `npm run validate:arch-docs` is the entry point.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REFERENCE = 'src/core/architecture-reference.js';
const FRAMEWORK = 'src/pages/architecture-framework.data.js';

const TAG = 'architecture-docs';

// ── Extraction ───────────────────────────────────────────────────────────────────────────────
//
// ⚠️ These files are ESM and frontend-adjacent, so they are READ AS TEXT, never `require()`d —
// executing them would drag in the bundle. The extraction is therefore deliberately narrow and
// MUST fail loudly rather than return an empty set: an extractor that silently finds zero keys
// makes every downstream check pass, which is the "inspected nothing, reported OK" defect.

/** Thrown when a file cannot be read or yields nothing — never swallowed into a pass. */
class ExtractionError extends Error {}

/** All `name: '...'` values, in file order. */
function sectionNames(src, label) {
  const out = [];
  for (const m of src.matchAll(/\bname:\s*'([^']{2,120})'/g)) out.push(m[1]);
  if (out.length === 0) {
    throw new ExtractionError(`${label}: found 0 \`name:\` values — the extractor is wrong, not the file`);
  }
  return out;
}

/** All `export const NAME` identifiers. */
function exportNames(src, label) {
  const out = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)/g)) out.push(m[1]);
  if (out.length === 0) {
    throw new ExtractionError(`${label}: found 0 \`export const\` names — the extractor is wrong, not the file`);
  }
  return out;
}

function readAll() {
  const refPath = path.join(ROOT, REFERENCE);
  const fwPath = path.join(ROOT, FRAMEWORK);
  for (const p of [refPath, fwPath]) {
    if (!fs.existsSync(p)) throw new ExtractionError(`missing file: ${path.relative(ROOT, p)}`);
  }
  const refSrc = fs.readFileSync(refPath, 'utf8');
  const fwSrc = fs.readFileSync(fwPath, 'utf8');
  return {
    ref: { sections: sectionNames(refSrc, REFERENCE), exports: exportNames(refSrc, REFERENCE) },
    fw: { sections: sectionNames(fwSrc, FRAMEWORK), exports: exportNames(fwSrc, FRAMEWORK) },
  };
}

// ── The two invariants, as pure functions over extracted sets ─────────────────────────────────
//
// Kept pure and exported so the self-test can drive them with synthetic input in BOTH directions.
// A check that can only ever be run against the real files cannot be proven to fail.

/** INV-ARCH-DOCS-1 — the section index is one index; both surfaces must list the same names. */
function checkSectionParity(refSections, fwSections) {
  const a = new Set(refSections);
  const b = new Set(fwSections);
  const onlyRef = [...a].filter((x) => !b.has(x));
  const onlyFw = [...b].filter((x) => !a.has(x));
  return {
    id: 'INV-ARCH-DOCS-1',
    ok: onlyRef.length === 0 && onlyFw.length === 0,
    detail: `section index: ${a.size} in reference, ${b.size} on the page, ${onlyRef.length + onlyFw.length} one-sided`,
    onlyRef,
    onlyFw,
  };
}

/** INV-ARCH-DOCS-2 — one-way: an export in the reference must exist on the page. */
function checkReferenceIsDerived(refExports, fwExports) {
  const b = new Set(fwExports);
  const orphans = [...new Set(refExports)].filter((x) => !b.has(x));
  return {
    id: 'INV-ARCH-DOCS-2',
    ok: orphans.length === 0,
    detail: `reference exports: ${new Set(refExports).size}, of which ${orphans.length} have no counterpart on the page`,
    orphans,
  };
}

// ── Self-test — a guard never observed to fail is a decoration ────────────────────────────────

function selfTest() {
  const cases = [
    ['INV-1 passes when both surfaces list the same sections', () => {
      return checkSectionParity(['a', 'b'], ['b', 'a']).ok === true;
    }],
    ['INV-1 FAILS when a section is added to the reference only', () => {
      // The measured batch-#17 shape: one surface gains a section, the other does not.
      return checkSectionParity(['a', 'b', 'NEW'], ['a', 'b']).ok === false;
    }],
    ['INV-1 FAILS when a section is added to the page only', () => {
      // The opposite direction — proves the check is not one-sided.
      return checkSectionParity(['a', 'b'], ['a', 'b', 'NEW']).ok === false;
    }],
    ['INV-1 names WHICH side is missing the section', () => {
      const r = checkSectionParity(['a', 'gone'], ['a']);
      return r.onlyRef.includes('gone') && r.onlyFw.length === 0;
    }],
    ['INV-2 passes when every reference export exists on the page', () => {
      return checkReferenceIsDerived(['A', 'B'], ['A', 'B', 'C']).ok === true;
    }],
    ['INV-2 FAILS when the reference carries an export the page lacks', () => {
      return checkReferenceIsDerived(['A', 'HAND_EDITED'], ['A']).ok === false;
    }],
    ['INV-2 is ONE-WAY: extra page exports are NOT a violation', () => {
      // This is the boundary that decides whether the guard is usable. The page legitimately
      // carries DECISION_WORKFLOW / FEATURE_MATRIX / INTAKE_TEMPLATE that the chipboard omits
      // for token budget. If this case ever fails, the guard has become a false-positive
      // generator and would be allowlisted — which is worse than not having it.
      return checkReferenceIsDerived(['A'], ['A', 'DECISION_WORKFLOW', 'FEATURE_MATRIX']).ok === true;
    }],
    ['EXTRACTOR refuses to pass on an empty read', () => {
      // The "inspected nothing and reported OK" defect. Must THROW, never return [].
      try {
        sectionNames('export const X = [1];', 'synthetic');
        return false; // no throw = the guard would silently pass on a broken read
      } catch (e) {
        return e instanceof ExtractionError;
      }
    }],
    ['EXTRACTOR refuses to pass when there are no exports', () => {
      try {
        exportNames("const A = 1;\nname: 'x';", 'synthetic');
        return false;
      } catch (e) {
        return e instanceof ExtractionError;
      }
    }],
    ['EXTRACTOR reads a REAL name: value', () => {
      return sectionNames("{ name: 'Architecture index', status: 'done' }", 'synthetic').length === 1;
    }],
  ];

  let failed = 0;
  console.log('=== self-test: every rule must be able to FIRE, in both directions ===');
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch { ok = false; }
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${name}`);
  }
  console.log(`\n  ${failed === 0 ? 'SELF-TEST VALID' : `SELF-TEST INVALID — ${failed} case(s) failed`}`);
  return failed;
}

// ── Entry ────────────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() === 0 ? 0 : 1);
  const reportOnly = process.argv.includes('--report');

  let data;
  try {
    data = readAll();
  } catch (e) {
    // ⚠️ Fail CLOSED and loudly. A read failure is not a pass.
    console.error(`\n[${TAG}] \u2716 ${e.message}`);
    console.error(`[${TAG}]   A verifier that cannot read its input must ERROR, never pass.`);
    process.exit(reportOnly ? 0 : 1);
  }

  const checks = [
    checkSectionParity(data.ref.sections, data.fw.sections),
    checkReferenceIsDerived(data.ref.exports, data.fw.exports),
  ];

  console.log(`\n[${TAG}] comparing ${REFERENCE}  <->  ${FRAMEWORK}`);
  for (const c of checks) {
    console.log(`  ${c.ok ? '\u2714' : '\u2716'} ${c.id}  ${c.detail}`);
    for (const n of c.onlyRef ?? []) console.log(`      in the REFERENCE only : ${n}`);
    for (const n of c.onlyFw ?? []) console.log(`      on the PAGE only      : ${n}`);
    for (const n of c.orphans ?? []) console.log(`      reference export with no page counterpart: ${n}`);
  }

  const failures = checks.filter((c) => !c.ok);
  if (failures.length > 0 && !reportOnly) {
    console.error(`\n[${TAG}] \u2716 ${failures.length} violation(s) — the chipboard and the page have diverged.`);
    console.error(`[${TAG}]   Fix by making the two surfaces agree, NOT by widening an allowance here.`);
    process.exit(1);
  }
  console.log(
    failures.length === 0
      ? `\n[${TAG}] \u2714 OK — ${checks.length} invariant(s) hold; the reference is still derivable from the page.\n`
      : `\n[${TAG}] ${failures.length} violation(s) reported (--report: exiting 0).\n`,
  );
  process.exit(0);
}

module.exports = {
  sectionNames,
  exportNames,
  checkSectionParity,
  checkReferenceIsDerived,
  ExtractionError,
  REFERENCE,
  FRAMEWORK,
};

/**
 * ⚠️ NOT YET IN `prebuild` — stated rather than implied.
 *
 * The check passes today (25/25 sections, 0 orphan exports), so wiring it costs nothing. It was
 * left out of this change on purpose: `prebuild` is shared by every agent in this repo, and a
 * brand-new gate that has run exactly once is not yet a gate — it is a gate-shaped thing that
 * has passed once. The precedent is explicit: `validate-decisions.cjs` and
 * `validate-theories.cjs` are both on demand for exactly this reason.
 *
 * Wire it when it has been observed to fail on a real divergence, by running `--self-test` and
 * then deliberately breaking one of the two files:
 *
 *     node scripts/validate-architecture-docs.cjs --self-test   # 10/10
 *     # add a section to ARCHITECTURE_INDEX in architecture-reference.js only
 *     node scripts/validate-architecture-docs.cjs              # exit 1, names the orphan
 */
