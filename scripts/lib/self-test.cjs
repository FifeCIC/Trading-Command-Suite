/**
 * self-test.cjs — the shared self-test harness for validator scripts.
 *
 * WHY THIS IS A MODULE AND NOT COPIED
 * -----------------------------------
 * Every `validate-*.cjs` in this repo ships a `--self-test` (the rule: *a guard that has never been
 * observed to fail is a decoration*). The harness that runs the canaries — a list of
 * `{ name, fn }` cases, each asserted to return exactly `true` — is identical in all of them.
 *
 * `validate-duplication.cjs` caught two new guards sharing that block as a 6-block NEW pair
 * (INV-NO-NEW-DUPLICATION, #966). The message names the fix: **extract it, do not copy it.** This
 * is that extraction, so the next validator gets the harness for free instead of re-typing it and
 * tripping the same guard.
 *
 * CONTRACT
 * --------
 * A canary's `fn` must return **exactly `true`**. Anything else — `false`, `undefined`, a truthy
 * object — is a failure, and so is throwing. That strictness is deliberate: a canary whose
 * assertion is left out returns `undefined` and would otherwise pass silently.
 *
 * @param {Array<{ name: string, fn: () => boolean }>} cases
 * @param {string} label  the `[label]` prefix used in the summary line
 * @returns {number} 0 when every case passed, 1 otherwise
 */
'use strict';

function runCases(cases, label) {
  let passed = 0;
  for (const c of cases) {
    let ok = false;
    let err = null;
    try {
      ok = c.fn() === true;
    } catch (e) {
      err = e.message;
    }
    if (ok) {
      passed++;
      console.log(`   ✓ ${c.name}`);
    } else {
      console.error(`   ✗ ${c.name}${err ? ` — threw: ${err}` : ''}`);
    }
  }
  console.log(`\n[${label}] --self-test ${passed}/${cases.length} passed`);
  return passed === cases.length ? 0 : 1;
}

/** Collect cases declaratively: `const t = collector(cases); t('name', () => true)`. */
function collector(cases) {
  return function t(name, fn) {
    cases.push({ name, fn });
    return cases;
  };
}

module.exports = { runCases, collector };
