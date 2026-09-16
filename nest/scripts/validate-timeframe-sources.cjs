#!/usr/bin/env node
/**
 * validate-timeframe-sources.cjs — one cadence table, and it must agree everywhere.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * "How long is a 1h bar?" had **four independent answers** in this codebase:
 *
 *   1. `common/utils/timeframe.ts`   `barLengthMs()`            <- the canonical owner (ADR-014)
 *   2. `directives/market-status.ts` `TIMEFRAME_MS`             <- a second copy, no `1w`
 *   3. `scoring/outcome-tracker…`    `timeframeToMilliseconds()` <- a THIRD, and DERIVED
 *   4. `scripts/contract-probe.cjs`  `CADENCE_SECONDS`          <- a FOURTH, in a validator
 *
 * Measured (not assumed) behaviour, 2026-09-15:
 *
 *     tf      owner        market-status  outcome-tracker   contract-probe
 *     1m-1d   correct      same           same              same
 *     1w      604800000    undefined      3600000 (1h!)      same
 *     '1M'    86400000     undefined      60000 (1min!)      undefined
 *
 * ⚠️ HONEST SCOPE: they AGREE on the seven common lowercase cadences, so this is a LATENT
 * defect, not a live one. It is worth guarding anyway for two reasons that are not theoretical:
 *
 *   - **`1w` is already wrong** in outcome-tracker by a factor of **168**, and `1w` exists in the
 *     owner's own map, so a weekly protocol is not hypothetical.
 *   - **Case sensitivity is a landmine.** `barLengthMs` is a case-SENSITIVE map lookup, so `'1M'`
 *     silently falls back to ONE DAY. `timeframeToMilliseconds` is case-INSENSITIVE (`/i`), so the
 *     same string yields ONE MINUTE. A **1440× disagreement on identical input**, and three
 *     frontend pages already use uppercase arrays (`['1M','5M','15M','1H','4H','1D']`).
 *
 * A silent 1440× error in a staleness window produces plausible numbers describing the wrong
 * moment — the exact failure class this repo has paid for repeatedly (#780, #785, #832, #750).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE RULE
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 *   A timeframe→duration mapping may be DECLARED once (`barLengthMs`) and imported everywhere.
 *
 * This script calls the COMPILED owner as the oracle and asserts the other sites agree — or, once
 * they import it, that they no longer declare a map at all.
 *
 * USAGE (from nest/):
 *   node scripts/validate-timeframe-sources.cjs           # audit + exit code
 *   node scripts/validate-timeframe-sources.cjs --verbose # show the full comparison matrix
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NEST = path.join(ROOT, 'nest');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');

/** The canonical owner. Everything must agree with this, or import it. */
const OWNER_FILE = 'nest/src/common/utils/timeframe.ts';
const OWNER_EXPORT = 'barLengthMs';

/**
 * Declarations that must not exist. Each entry is a place that computes a duration from a
 * timeframe STRING — either as a literal map or as a derived calculation.
 *
 * ⚠️ Matched by shape, not by name, so renaming the variable does not evade the guard.
 */
const FORBIDDEN = [
  {
    file: 'nest/src/modules/directives/market-status.ts',
    // A local timeframe->ms object literal.
    test: /const\s+TIMEFRAME_MS\s*:\s*Record<string,\s*number>\s*=\s*\{/,
    why: 'Local cadence map. Duplicates barLengthMs and omits `1w` (returns undefined).',
  },
  {
    file: 'nest/src/modules/scoring/outcome-tracker.service.ts',
    // A local function that parses a timeframe string into ms.
    test: /function\s+timeframeToMilliseconds\s*\(/,
    why: 'Derived cadence parser. Case-INSENSITIVE, so "1M" -> 1 minute while the owner says 1 day (1440x); no `1w`, so it returns 1 HOUR instead of 1 week (168x).',
  },
];

/** Files that may keep a local copy because they run standalone (a probe must not import app code). */
const ALLOWED_STANDALONE = [
  {
    file: 'nest/scripts/contract-probe.cjs',
    why: 'Standalone probe — deliberately avoid importing app code so it can validate a broken build. Values VERIFIED below instead.',
  },
];

/**
 * Parse a cadence map written either as milliseconds or as seconds.
 *
 * `contract-probe.cjs` stores SECONDS (`CADENCE_SECONDS`), so a ms-only parser silently found
 * nothing and reported "no map found" — i.e. it FAILED OPEN and vouched for a file it never
 * checked. A verifier that silently passes is worse than no verifier, so this handles both
 * shapes and scales seconds to ms before comparing.
 */
function parseMsMap(src) {
  const m = /const\s+(?:TIMEFRAME_MS|CADENCE_SECONDS)\s*(?::\s*Record<string,\s*number>)?\s*=\s*\{([\s\S]*?)\}/.exec(src);
  if (!m) return null;
  const isSeconds = /CADENCE_SECONDS/.test(m[0]);
  const out = {};
  for (const pair of m[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*([\d_\s*]+)/g)) {
    const key = pair[1];
    // Values are written as `60_000` or `15 * 60_000` — evaluate the arithmetic safely.
    const raw = pair[2].replace(/_/g, '').replace(/\s/g, '');
    if (!/^[\d*]+$/.test(raw)) continue;
    const val = raw.split('*').reduce((a, b) => a * Number(b), 1);
    out[key] = isSeconds ? val * 1000 : val;
  }
  return out;
}

/** Evaluate the standard cadence list, both cases, to prove the frontend has no canonical source. */
function listFrontendTimeframeArrays() {
  const dirs = [path.join(ROOT, 'src')];
  const found = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      const m = /const\s+TIMEFRAMES\s*=\s*\[([^\]]*)\]/.exec(src);
      if (m) {
        const items = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
        if (items.length) found.push({ file: path.relative(ROOT, full).split(path.sep).join('/'), items });
      }
    }
  };
  for (const d of dirs) walk(d);
  return found;
}

(async () => {
  // ── Oracle: the REAL owner. ────────────────────────────────────────────────────────────────
  //
  // ⚠️ BUILD-ORDER INDEPENDENCE IS MANDATORY HERE.
  //
  // The first version of this guard loaded `dist/src/common/utils/timeframe.js`. That is fine
  // standalone and FATAL in `prebuild`, because prebuild runs `npx rimraf dist` a few steps
  // earlier — so the oracle was always missing and the guard always exited 1, breaking every
  // build. A guard that only works when run by hand is not a build gate.
  //
  // So: compiled output if present (fast, and exactly what ships), otherwise transpile the TS
  // source in-process via ts-node (available — the seed scripts use it). Either way the oracle is
  // the REAL owner, never a hand-copied expectation — a copied expectation is itself a second
  // owner, which is the defect this guard exists to prevent.
  let owner = null;
  const distPath = path.join(NEST, 'dist', 'src', 'common', 'utils', 'timeframe.js');
  const srcPath = path.join(NEST, 'src', 'common', 'utils', 'timeframe.ts');
  try {
    owner = require(distPath);
  } catch {
    try {
      require(path.join(NEST, 'node_modules', 'ts-node')).register({
        transpileOnly: true,
        compilerOptions: { module: 'commonjs', target: 'es2021' },
      });
      owner = require(srcPath);
    } catch (e2) {
      console.log(`\n⚠️  cannot load the owner from dist OR source: ${String(e2.message).slice(0, 90)}`);
      console.log('    Refusing to report OK for an axis it could not check.\n');
      process.exit(1);
    }
  }
  if (typeof owner.barLengthMs !== 'function') {
    console.log('\n⚠️  loaded the owner module but `barLengthMs` is not a function — shape changed.\n');
    process.exit(1);
  }
  const oracleSource = fs.existsSync(distPath) ? 'dist (compiled)' : 'src (ts-node)';

  const problems = [];

  // ── 1. Forbidden re-declarations. ─────────────────────────────────────────────────────────
  for (const f of FORBIDDEN) {
    const p = path.join(ROOT, f.file);
    let src;
    try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (f.test.test(src)) {
      problems.push({ level: 'error', file: f.file, why: f.why });
    }
  }

  // ── 2. Standalone copies: VERIFY their values agree with the owner. ───────────────────────
  const vouched = [];
  for (const a of ALLOWED_STANDALONE) {
    const p = path.join(ROOT, a.file);
    let src;
    try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const map = parseMsMap(src);
    if (!map) { vouched.push({ file: a.file, note: 'no map found (shape may have changed — re-check)' }); continue; }
    const diffs = [];
    for (const [tf, ms] of Object.entries(map)) {
      const oracle = owner.barLengthMs(tf);
      if (oracle !== ms) diffs.push(`${tf}: local=${ms} owner=${oracle}`);
    }
    vouched.push({
      file: a.file,
      note: diffs.length ? `DISAGREES with owner -> ${diffs.join(', ')}` : `agrees with owner on ${Object.keys(map).length} cadences`,
      diffs,
    });
    if (diffs.length) {
      problems.push({ level: 'error', file: a.file, why: `standalone map disagrees with the owner: ${diffs.join(', ')}` });
    }
  }

  // ── 3. Frontend: how many arrays, how many conventions? ───────────────────────────────────
  const feArrays = listFrontendTimeframeArrays();
  const conventions = new Map();
  for (const a of feArrays) {
    const conv = a.items.every((t) => /^\d+[smhdw]$/.test(t)) ? 'lowercase (canonical)'
      : a.items.every((t) => /^\d+[SMHDW]$/.test(t)) ? 'UPPERCASE (1M/5M/1H)'
        : a.items.every((t) => /^[MSHDW]\d+$/.test(t)) ? 'MT5-style (M5/H1/D1)'
          : a.items.every((t) => /^\d+[smhdw]$/i.test(t)) ? 'mixed-case'
            : 'other';
    conventions.set(conv, (conventions.get(conv) || 0) + 1);
  }

  // ── Report ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nTimeframe / cadence axis — one duration table, or it drifts\n');
  console.log(`OWNER: ${OWNER_FILE}  ->  ${OWNER_EXPORT}()`);
  console.log('       (ADR-014: probe and writers share ONE definition)\n');

  if (VERBOSE) {
    const cases = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M', 'M15', 'H1', ''];
    console.log('  oracle output:');
    for (const c of cases) {
      console.log(`     ${(c === '' ? "(empty)" : c).padEnd(8)} -> ${owner.barLengthMs(c)}`);
    }
    console.log('');
  }

  if (problems.length) {
    console.log(`✖ ${problems.length} problem(s):\n`);
    for (const p of problems) {
      console.log(`  ${p.file}`);
      console.log(`     → ${p.why}\n`);
    }
  }

  if (vouched.length) {
    console.log('Standalone copies (allowed to exist, but must AGREE):');
    for (const v of vouched) console.log(`  ${v.file}\n     ${v.note}`);
    console.log('');
  }

  console.log(`Frontend TIMEFRAMES arrays: ${feArrays.length}`);
  for (const [conv, n] of [...conventions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${conv}`);
  }
  if (conventions.size > 1) {
    console.log('\n   ⚠️  More than one convention. Case matters: `barLengthMs("1M")` falls back to');
    console.log('       ONE DAY (case-sensitive map) while a `/i` parser reads ONE MINUTE. Do not pass');
    console.log('       an uppercase label into a duration path — pass the canonical lowercase value.');
  }

  if (problems.length) {
    console.log(`\nFIX: import \`${OWNER_EXPORT}\` from '${OWNER_FILE}' instead of declaring a map.\n`);
    process.exit(1);
  }

  console.log('\n✅ OK — one canonical cadence table; every other site imports or demonstrably agrees.\n');
  process.exit(0);
})();
