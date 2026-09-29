#!/usr/bin/env node
/**
 * canary-backtest-period.cjs — prove the #986 guards can FAIL. (#986)
 * ==================================================================
 *
 * WHAT THIS IS FOR
 * ----------------
 * "A guard that has never been observed to fail is not a guard. It is a decoration."
 * (`development-philosophy.instructions.md` §5)
 *
 * `backtest-period.service.spec.ts` asserts that a period import is idempotent, that an empty window
 * is reported as `no-bars` and not as a success, that a provider which cannot target a past window
 * is skipped rather than asked, and that a truncated window is reported. THIS script proves each of
 * those assertions can actually fail — by breaking the implementation, running the suite, and
 * checking the suite goes red.
 *
 * ⚠️ WHY IT LIVES IN `nest/scripts/` AND NOT IN `logs/`. It was first written as a one-off under
 * `logs/` — and a tool that works but is named nowhere is an ORPHAN (measured 2026-09-26: 75 of 141
 * tools). The point of a canary is that the NEXT person to change `importBars` runs it, and nobody
 * finds a file in `logs/`. It is indexed in `docs/TOOLS-INDEX.md`.
 *
 * ⚠️ IT REFUSES TO REPORT AN UNREADABLE RESULT. jest writes its summary to STDERR; the first version
 * of this script read only stdout, found no "Tests:" line and reported `failed=0` — i.e. it could
 * not read its own input. That is the failure mode `agent-environment.instructions.md` calls out
 * ("a verifier that cannot read its input must ERROR, never pass"), so an unreadable summary is
 * reported as CANARY INVALID rather than as a pass OR a miss.
 *
 * ⚠️ THE ASSERTION IS "THE GUARD FIRED", NOT A PREDICTED COUNT. An earlier version asserted an exact
 * number of failing tests per canary, guessed by reading the spec, and so reported two WORKING
 * guards as broken because they happened to break 4 and 3 tests against a predicted 2. A guard that
 * fires more broadly than expected is a stronger guard. The count is printed, never asserted.
 *
 * USAGE
 *   node nest/scripts/canary-backtest-period.cjs
 *   node nest/scripts/canary-backtest-period.cjs --self-test   # prove the canary can go INVALID
 *
 * EXIT: 0 = every canary fired and every restore was byte-for-byte. 1 = a guard did NOT fire, the
 *       restore did not match, or a result could not be read.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'nest/src/modules/backtest/backtest-period.service.ts');
const SPEC = 'backtest-period.service.spec';

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function runJest() {
  try {
    execSync(`npm --prefix nest test -- ${SPEC}`, { cwd: ROOT, stdio: 'pipe' });
    return { code: 0, out: '' };
  } catch (e) {
    // ⚠️ jest's summary goes to STDERR. Reading only stdout is how this script first reported
    // `failed=0` for four guards that had all genuinely failed.
    const out = (e.stdout ?? '').toString() + (e.stderr ?? '').toString();
    if (!/Tests:/.test(out)) {
      return { code: e.status ?? 1, out, unreadable: true };
    }
    return { code: e.status ?? 1, out };
  }
}

/**
 * Each canary names the guard it breaks, the exact text to replace, and the replacement.
 * The replacement is an INVALID implementation, never a comment — a canary must break behaviour.
 */
const CANARIES = [
  {
    label: 'idempotency — `inserted` ignores the before/after row counts',
    guard: 'a re-run of the same import must report inserted: 0',
    from: 'const inserted = input.barsAfter - input.barsBefore;',
    to: 'const inserted = input.fetched;',
  },
  {
    label: 'outcome — an empty window reported as a success',
    guard: 'no-bars must never be reported as imported',
    from: "outcome: sawEmptyAnswer ? 'no-bars' : 'provider-unavailable',",
    to: "outcome: 'imported',",
  },
  {
    label: 'provider selection — a range-less adapter is asked anyway',
    guard: 'an adapter with no getCandlesRange must be SKIPPED, never asked with getCandles()',
    from: 'if (!adapter?.getCandlesRange) {',
    to: 'if (false) {',
  },
  {
    label: 'truncation — the subtraction direction inverted',
    guard: 'a window whose coverage starts late must be reported as TRUNCATED',
    from: '(first?.timestamp.getTime() ?? 0) - period.fromDate.getTime() > 3_600_000,',
    to: 'period.fromDate.getTime() - (first?.timestamp.getTime() ?? 0) > 3_600_000,',
  },
  {
    // ⚠️ The measured defect this guard exists for: a provider that cannot answer used to write
    // `barCount: 0` without looking at `MarketBar`, so a window holding 289 mt5 bars was STORED as
    // empty — and the list a human picks from would have shown it that way.
    label: 'failed import — the stored count taken from the IMPORT instead of the TABLE',
    guard: 'a window that already holds bars must not be stored as empty when no provider answers',
    from: 'data: { barCount: existing.barCount, provider: null },',
    to: 'data: { barCount: 0, provider: null },',
  },
];

function canary(original, originalSha, c) {
  console.log(`\n${'='.repeat(78)}\nCANARY: ${c.label}`);
  console.log(`  guards: ${c.guard}`);

  if (!original.includes(c.from)) {
    // ⚠️ REFUSE, do not report a miss. A canary that cannot make its edit must not report
    // "the guard did not fire" — it never tested anything.
    console.log('  ✖ CANARY INVALID — the target text is not present, so no edit was made.');
    return false;
  }

  fs.writeFileSync(FILE, original.replace(c.from, c.to));
  console.log(`  edit landed: ${fs.readFileSync(FILE, 'utf8') !== original}`);

  const r = runJest();
  const m = r.out.match(/Tests:\s+(.*)/);
  console.log(`  jest exit=${r.code}  ${m ? m[1] : '(no summary)'}`);
  const failed = (m ? m[1] : '').match(/(\d+) failed/);
  const n = failed ? Number(failed[1]) : 0;
  console.log(`  failed=${n} (requires >=1)`);

  fs.writeFileSync(FILE, original);
  const restored = sha(FILE) === originalSha;
  console.log(`  restored byte-for-byte: ${restored}`);

  const ok = !r.unreadable && r.code !== 0 && n >= 1 && restored;
  console.log(
    `  ${
      r.unreadable
        ? '✖ CANARY INVALID (result unreadable)'
        : ok
          ? '✔ CANARY PASSED'
          : '✖ CANARY FAILED'
    }`,
  );
  return ok;
}

/** Prove the canary itself can fail: an absent target must be INVALID, never a silent pass. */
function selfTest(original, originalSha) {
  console.log('\nSELF-TEST — a canary whose target is ABSENT must refuse, not pass');
  const bogus = canary(original, originalSha, {
    label: 'SELF-TEST (deliberately absent target)',
    guard: 'must report CANARY INVALID',
    from: 'THIS TEXT DOES NOT EXIST IN THE FILE',
    to: 'irrelevant',
  });
  const refused = bogus === false;
  console.log(`  ${refused ? '✔ SELF-TEST PASSED — the canary refused' : '✖ SELF-TEST FAILED — it reported a result it never tested'}`);
  return refused;
}

function main() {
  const original = fs.readFileSync(FILE, 'utf8');
  const originalSha = sha(FILE);
  console.log(`canary-backtest-period — #986 guard canary`);
  console.log(`target: nest/src/modules/backtest/backtest-period.service.ts`);
  console.log(`original sha256 = ${originalSha}`);

  if (process.argv.includes('--self-test')) {
    const ok = selfTest(original, originalSha);
    process.exit(ok ? 0 : 1);
  }

  const results = CANARIES.map((c) => canary(original, originalSha, c));

  console.log(`\n${'='.repeat(78)}`);
  const restored = sha(FILE) === originalSha;
  console.log(`RESTORE CHECK: ${restored ? '✔ file is byte-for-byte identical' : '✖ FILE MODIFIED'}`);

  const allOk = results.every(Boolean) && restored;
  console.log(
    `${allOk ? '✔ ALL CANARIES PASSED' : '✖ SOME CANARIES FAILED'} (${results.filter(Boolean).length}/${results.length})`,
  );

  const final = runJest();
  const m = final.out.match(/Tests:\s+(.*)/);
  console.log(`final suite: exit=${final.code} ${m ? m[1] : '(no summary)'}`);

  process.exit(allOk && final.code === 0 ? 0 : 1);
}

main();
