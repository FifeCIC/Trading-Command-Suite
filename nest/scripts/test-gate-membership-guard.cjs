#!/usr/bin/env node
/**
 * test-gate-membership-guard.cjs — proves INV-GATE-MEMBERSHIP actually bites.
 * =========================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A guard that has never been observed to fail is a hope, not a guard. The
 * contracts doc states the principle; this test enforces it for the
 * gate-membership rule.
 *
 * `validate-directive-group-kind.cjs` was written precisely because a real
 * defect (#789) sat undetected: `session-open-effect`, a directional `pattern`
 * voter, was placed in the `risk` gate of 14 protocols, where the scorer
 * silently discards its reading. Nothing failed. The only symptom was a
 * duplicate-directive warning — which is a DIFFERENT fault that happens to
 * produce the same message.
 *
 * So this test reconstructs that exact defect against a TEMP COPY of the seed
 * and asserts the guard rejects it. It also asserts the guard still PASSES on
 * the real seed, so a future over-tightening of the rule (which would make the
 * guard fire on correct code and get switched off) fails here first.
 *
 * ⚠️ THE FIRST VERSION OF THIS GUARD WAS TOO BROAD — see the test
 * `too-broad-rule-rejected` below. Requiring `category === 'risk'` reported 68
 * violations on a healthy tree, 62 of them genuine `structural` gates. That is
 * the failure mode "a guard that fires on correct code gets switched off, which
 * is worse than no guard because it looks like coverage." The regression test
 * for that is the `structural-in-risk-gate-is-correct` case.
 *
 * Read-only — uses a temp copy, never mutates the real seed.
 *
 * USAGE
 *   node scripts/test-gate-membership-guard.cjs
 * Exit code: 0 = guard behaved correctly in every case, 1 = it did not.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NEST_ROOT = path.resolve(__dirname, '..');
const SEED_REL = path.join('src', 'modules', 'scoring', 'protocols-seed-data.ts');
const SEED_ABS = path.join(NEST_ROOT, SEED_REL);
const GUARD_REL = path.join('scripts', 'validate-directive-group-kind.cjs');
const GUARD_ABS = path.join(NEST_ROOT, GUARD_REL);

let failures = 0;

function report(name, ok, detail) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`       ${detail.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

/**
 * Run the guard against an arbitrary seed file.
 *
 * The guard resolves the seed from its own `__dirname`, so to test against a
 * modified seed we copy BOTH the guard and the seed into a temp tree that
 * mirrors the real layout. That keeps the guard itself unmodified — testing a
 * patched guard would prove nothing about the shipped one.
 */
function runGuardWithSeed(seedSource, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gate-membership-${label}-`));

  // Mirror the layout the guard expects, including the directive classes it
  // reads (they are the source of truth for `category`).
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'modules', 'scoring'), { recursive: true });
  fs.cpSync(path.join(NEST_ROOT, 'src', 'modules', 'directives'), path.join(tmp, 'src', 'modules', 'directives'), {
    recursive: true,
  });
  fs.copyFileSync(GUARD_ABS, path.join(tmp, GUARD_REL));
  fs.writeFileSync(path.join(tmp, SEED_REL), seedSource, 'utf8');

  try {
    const out = execFileSync(process.execPath, [path.join(tmp, GUARD_REL)], {
      cwd: tmp,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    return { exitCode: 0, output: out };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

console.log('\n[gate-membership-test] proving the guard bites\n');

const realSeed = fs.readFileSync(SEED_ABS, 'utf8');

// ── 1. the guard passes on the real (correct) seed ──────────────────────────
{
  const { exitCode, output } = runGuardWithSeed(realSeed, 'real');
  report(
    'passes on the real seed (no false positives)',
    exitCode === 0 && output.includes('OK'),
    exitCode === 0 ? `expected OK marker, got:\n${output}` : `exit ${exitCode}:\n${output}`,
  );
}

// ── 2. the guard REJECTS the #789 defect it was written for ─────────────────
// Reconstruct it exactly: put a directional `pattern` voter back into a risk
// gate. `session-open-effect` is the measured case; `liquidity-check` is the
// genuine gate that must stay.
{
  const before = `        "directiveIds": [
          "liquidity-check"
        ]
      }
    ]
  },
  "xau-speed-v1": {`;

  // Fall back to a generic injection if the anchor above ever moves.
  let broken = realSeed;
  if (realSeed.includes(before)) {
    broken = realSeed.replace(
      before,
      `        "directiveIds": [
          "liquidity-check",
          "session-open-effect"
        ]
      }
    ]
  },
  "xau-speed-v1": {`,
    );
  } else {
    // Generic: inject a known `pattern` directive into the FIRST risk gate found.
    broken = realSeed.replace(
      /("isRiskGate": true,\s*\n\s*"minMultiplier": [\d.]+,\s*\n\s*"maxMultiplier": [\d.]+,\s*\n\s*"directiveIds": \[\s*\n)/,
      `$1          "session-open-effect",\n`,
    );
  }

  report('fixture actually modified the seed', broken !== realSeed, 'injection anchor did not match — test is vacuous');

  if (broken !== realSeed) {
    const { exitCode, output } = runGuardWithSeed(broken, 'defect');
    report(
      'REJECTS a directional voter placed in a risk gate (#789)',
      exitCode === 1 && output.includes('INV-GATE-MEMBERSHIP'),
      exitCode === 1 ? `expected the INV-GATE-MEMBERSHIP message, got:\n${output}` : `guard PASSED a real defect (exit ${exitCode})`,
    );
    report(
      'names the offending protocol and directive',
      output.includes('session-open-effect') && /protocol "\S+", risk gate/.test(output),
      `diagnostic did not name the site:\n${output}`,
    );
  }
}

// ── 3. regression: a genuine `structural` gate must NOT be flagged ──────────
// This is the "too broad" regression. The first rule version required
// `category === 'risk'` and flagged 62 correct `structural` gates. If someone
// narrows GATE_CATEGORIES again (or invents a stricter test), this fails.
{
  const structuralGate = `        "directiveIds": [
          "liquidity-check",
          "rollover-risk",
          "budget-gate",
          "position-size-kelly",
          "market-regime"
        ]
      }`;

  let fixture = realSeed;
  const m = realSeed.match(/        "directiveIds": \[\n          "liquidity-check"\n        \]/);
  if (m) {
    fixture = realSeed.replace(m[0], structuralGate);
  }

  report('structural-gate fixture built', fixture !== realSeed, 'could not build the structural fixture');

  if (fixture !== realSeed) {
    const { exitCode, output } = runGuardWithSeed(fixture, 'structural');
    report(
      'accepts genuine `structural` gates in a risk gate (no false positives)',
      exitCode === 0,
      `guard flagged correct code (exit ${exitCode}) — the rule has been over-tightened and will be switched off:\n${output}`,
    );
  }
}

// ── 4. the parser must not silently find nothing ────────────────────────────
// An empty parse would disable every membership check while reporting green.
{
  const { exitCode, output } = runGuardWithSeed('export const SEED = {};\n', 'empty');
  report(
    'refuses to pass when the seed parses to nothing',
    exitCode === 1,
    `guard passed an unparseable seed — every membership check is disabled:\n${output}`,
  );
}

console.log(
  failures === 0
    ? '\n[gate-membership-test] ✅ the guard bites on the defect and stays quiet on correct code\n'
    : `\n[gate-membership-test] ❌ ${failures} expectation(s) failed\n`,
);

process.exit(failures === 0 ? 0 : 1);
