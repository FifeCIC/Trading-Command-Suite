/**
 * validate-lint.cjs — a lint gate that is ALLOWED TO BE GREEN, frozen at today's count.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS ONLY TWO RULES ────────────────────────────────────────────────
 * The repo has a `lint` script and **no lint gate**. `eslint .` reports thousands of problems and OOMs
 * on the whole tree, so it cannot run in `prebuild` — and because the whole ruleset cannot be green,
 * *none* of it is enforced. A rule that never runs is decoration.
 *
 * ⚠️ **TWO RULES, EACH CHOSEN BECAUSE IT CAUGHT A LIVE DEFECT TODAY, NOT A PREFERENCE:**
 *
 *   · `src/pages/PositionsMonitorPage.jsx` declares `function OptionPosition({ pos })` — a whole
 *     component, ~40 lines, referenced nowhere.
 *   · `src/pages/BrokersPage.jsx` imports `BROKER_CATALOGUE_BY_ID` and never uses it.
 *
 * `no-unused-vars` finds both. `no-undef` finds the failure mode that hurts more — a name that looks
 * declared and is not, which in a page rendering trading figures is a blank cell or a crash.
 *
 * ── ⚠️ THE MEASUREMENT THAT CHANGED THIS GATE'S DESIGN ─────────────────────────────────────────
 * The first version froze **836** unused-variable findings. Almost none were real: **72 were
 * `LoadingSkeleton`, 70 `motion`, 58 `PageInfoSlotContent`, 54 `NoticeBlock`** — component identifiers
 * used INSIDE JSX, which core `no-unused-vars` cannot see without `react/jsx-uses-vars`. Baselining
 * that would have been this repo's most-repeated defect in a new form: *a guard that fires for the
 * wrong reason gets allowlisted, and an allowlisted guard is worse than none.*
 *
 * With `react/jsx-uses-vars` registered as a **helper** (it reports nothing; it only marks JSX
 * identifiers as used) the population is **88** — 87 unused, 1 undefined — and those are real. The gate
 * counts ONLY `GATE_RULES`; helpers exist to make that count honest.
 *
 * ⚠️ **THE CONFIG IS GENERATED, NOT THE REPO'S.** `--no-config-lookup` plus a config this script writes
 * and deletes: adding a rule to `eslint.config.js` must not silently change what `prebuild` enforces,
 * and removing one must not silently shrink this gate. If an UNDECLARED rule fires anyway it is
 * REPORTED, not counted — a leak in the isolation must not be invisible.
 *
 * ⚠️ **DISTINGUISH A LEAK FROM A DANGLING DISABLE DIRECTIVE — measured 2026-11-19, after I mislabelled
 * them.** `src/` carries 13 `eslint-disable-next-line react-hooks/exhaustive-deps` directives, and an
 * isolated config that does not load that plugin reports `Definition for rule … was not found` for each.
 * That is 13 findings, all the SAME non-event, and the first version printed them as *"fired without
 * being declared — the config is not isolated"*, which reads like a hole in the gate. It is not. The
 * messages are now split: a dangling directive is informational, anything else is a leak.
 *
 * ⚠️ **A RATCHET, NOT A TARGET.** A file that SHRINKS makes the baseline stale and must be re-baselined
 * in the same change, so slack is reclaimed rather than banked for ever.
 *
 * Usage:
 *   node scripts/validate-lint.cjs                 # check (the gate)
 *   node scripts/validate-lint.cjs --write-baseline
 *   node scripts/validate-lint.cjs --report        # by file, worst first
 *   node scripts/validate-lint.cjs --self-test     # prove both rules FIRE, and both ratchet directions
 *
 * Exit: 0 = no growth · 1 = growth or a stale baseline · 2 = could not judge (never 0).
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      ONE narrow lint gate — `no-unused-vars` + `no-undef` — over `src/`, ratcheted, run in
 *            `prebuild`. The repo's own `eslint.config.js` is deliberately NOT the config used.
 * WHY:       There was no lint gate, and `eslint .` cannot be one: it runs out of memory on this tree, so
 *            lint had never been a check and 88 real defects (a name never used, a name that does not
 *            exist) sat in 49 files. A narrow gate that stays green is worth more than a broad one that
 *            is switched off.
 * INSTEAD OF: Wiring `eslint .` into `prebuild` behind a huge ignore list, which is how a gate becomes a
 *            decoration — and gating the full rule set, which would have baselined 836 findings of which
 *            most were the react/jsx-uses-vars false positive.
 * REVERSE BY: Delete the `node scripts/validate-lint.cjs` step from root `prebuild`, drop
 *            `docs/lint-baseline.json`, and remove the `lint-gate` entry from `src/data/standards.js`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 306
 * GUARD:     node scripts/validate-lint.cjs --self-test
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { repoRelative, readBaseline, compareToBaseline, writeBaseline } = require('./lib/validator-ratchet.cjs');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'docs', 'lint-baseline.json');
const ESLINT_BIN = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
/** ⚠️ Inside the repo so `import globals from 'globals'` resolves. `logs/` is gitignored scratch. */
const CONFIG_PATH = path.join(ROOT, 'logs', 'lint-gate.config.mjs');

/** ⚠️ THE CONTRACT — the only rules whose findings are COUNTED. */
const GATE_RULES = {
  'no-unused-vars': 'error',
  'no-undef': 'error',
};

/**
 * ⚠️ HELPERS, NOT GATE RULES. `react/jsx-uses-vars` reports nothing; it marks an identifier used inside
 * JSX so `no-unused-vars` does not fire on every imported component. Without it this gate measured 836
 * false positives (see the header) and would have been allowlisted by lunchtime.
 */
const HELPER_RULES = {
  'react/jsx-uses-vars': 'error',
  'react/jsx-uses-react': 'error',
};

const CONFIG_SOURCE = `// GENERATED by scripts/validate-lint.cjs — written, used, deleted. Do not edit.
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [{
  files: ['**/*.js', '**/*.jsx'],
  plugins: { react },
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: globals.browser,
  },
  rules: ${JSON.stringify({ ...HELPER_RULES, ...GATE_RULES }, null, 2)},
}];
`;

/** The inline config, identical to CONFIG_SOURCE, for `lintText` in the self-test. */
function inlineConfig() {
  return [
    {
      files: ['**/*.js', '**/*.jsx'],
      plugins: { react: require('eslint-plugin-react') },
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: require('globals').browser,
      },
      rules: { ...HELPER_RULES, ...GATE_RULES },
    },
  ];
}

/** One eslint invocation, via its own binary, so the config is exactly CONFIG_SOURCE. */
function runEslint() {
  if (!fs.existsSync(ESLINT_BIN)) throw new Error(`${path.relative(ROOT, ESLINT_BIN)} not found — cannot judge`);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, CONFIG_SOURCE);
  try {
    /**
     * ⚠️ ESLINT EXITS NON-ZERO WHENEVER IT FINDS ANYTHING — and finding things is this gate's normal
     * state (88 of them). `execFileSync` throws on a non-zero exit, so the JSON on stdout is only
     * reachable from the thrown error. The first version treated that as "could not judge" and reported
     * exit 2 while eslint had answered perfectly.
     */
    let out;
    try {
      out = execFileSync(process.execPath, args(), { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      if (typeof err.stdout === 'string' && err.stdout.trim().startsWith('[')) out = err.stdout;
      else throw err;
    }
    return JSON.parse(out);
  } finally {
    // ⚠️ Removed even on failure: a generated config left behind would be read by the next `eslint .`.
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  }
}

function args() {
  return [
    ESLINT_BIN,
    'src',
    '--config',
    CONFIG_PATH,
    '--no-config-lookup',
    '--format',
    'json',
    '--no-warn-ignored',
  ];
}

function collect() {
  const results = runEslint();
  if (!results.length) throw new Error('eslint reported ZERO files — the target no longer matches anything');
  const counts = new Map();
  const leaked = new Map();
  const dangling = new Map();
  let total = 0;
  for (const r of results) {
    const file = repoRelative(ROOT, r.filePath);
    let mine = 0;
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      if (Object.prototype.hasOwnProperty.call(GATE_RULES, m.ruleId)) mine += 1;
      /**
       * ⚠️ Two different things land here, and merging them was a mistake worth correcting.
       *
       * `Definition for rule 'X' was not found.` is NOT a leak — it is the unavoidable consequence of
       * isolation. `src/` carries 13 `eslint-disable-next-line react-hooks/exhaustive-deps` directives,
       * and a config that does not load that plugin cannot resolve them. Measured 2026-11-19: all 13 are
       * this message, and none is a rule firing.
       *
       * Anything else with a foreign ruleId IS a leak. Reported either way, never counted — a silent
       * leak would make the number mean something other than what it says.
       */
      else if (m.ruleId) {
        const bucket = /^Definition for rule /.test(m.message) ? dangling : leaked;
        bucket.set(m.ruleId, (bucket.get(m.ruleId) ?? 0) + 1);
      }
    }
    if (mine) {
      counts.set(file, mine);
      total += mine;
    }
  }
  return {
    counts,
    total,
    filesLinted: results.length,
    leaked: [...leaked.entries()],
    dangling: [...dangling.entries()],
  };
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  console.log(`  gate rules: ${JSON.stringify(GATE_RULES)}`);
  console.log(`  helper rules (report nothing, make the count honest): ${JSON.stringify(HELPER_RULES)}`);

  // —— BOTH DIRECTIONS ON THE RULES THEMSELVES. A gate whose rules never fire reports 0 for ever and
  // looks perfect; these cases make the rules lint real text and assert they have teeth.
  const { ESLint } = require('eslint');
  const engine = new ESLint({ overrideConfigFile: true, overrideConfig: inlineConfig() });
  const lint = async (code) => {
    const [r] = await engine.lintText(code, { filePath: path.join(ROOT, 'src', 'lint-gate-probe.jsx') });
    return r.messages.filter((m) => m.severity === 2 && GATE_RULES[m.ruleId]).map((m) => m.ruleId).sort();
  };

  const cases = [
    ['an unused local IS reported', 'const unusedThing = 1;', ['no-unused-vars']],
    ['a whole unused component IS reported', 'function OptionPosition({ pos }) { return pos; }', ['no-unused-vars']],
    ['an undefined name IS reported', 'export const x = notDeclaredAnywhere;', ['no-undef']],
    ['clean code reports NOTHING', 'export const x = 1;', []],
    // ⚠️ THE FALSE-POSITIVE CASE THAT CHANGED THE DESIGN. An imported component used only in JSX must NOT
    // be reported — this is the assertion the 836-finding first version would have failed.
    [
      'a component used only in JSX is NOT reported',
      "import Widget from './Widget';\nexport default function P() { return <Widget />; }",
      [],
    ],
  ];
  let pending = cases.length;
  const results = [];
  for (const [name, code, want] of cases) {
    lint(code).then((got) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) failures += 1;
      console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      pending -= 1;
      if (pending === 0) finish();
    });
  }

  function finish() {
    // —— the ratchet, using the ONE shared comparison.
    const base = { total: 2, files: { 'src/a.js': 2 } };
    expect('growth fails', compareToBaseline(new Map([['src/a.js', 3]]), base).grown.length, 1);
    expect('a new file fails', compareToBaseline(new Map([['src/b.js', 1]]), base).newFiles.length, 1);
    expect('a shrink is stale, so slack is reclaimed', compareToBaseline(new Map([['src/a.js', 1]]), base).shrunk.length, 1);
    expect('matching is clean', compareToBaseline(new Map([['src/a.js', 2]]), base).grown.length, 0);

    console.log(
      failures === 0
        ? '\n✅ self-test: both rules fire, the JSX false positive is absent, and both ratchet directions report'
        : `\n❌ self-test: ${failures} case(s) failed`,
    );
    process.exit(failures === 0 ? 0 : 1);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(['--write-baseline', '--report', '--self-test', '--help']);
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`[lint-gate] ✖ unknown flag(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-lint.cjs [--write-baseline|--report|--self-test]');
    return;
  }

  let collected;
  try {
    collected = collect();
  } catch (err) {
    console.error(`[lint-gate] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }

  if (argv.includes('--write-baseline')) {
    writeBaseline(
      BASELINE,
      `The ONE lint gate: ${Object.keys(GATE_RULES).join(' + ')} over src/. Frozen so the count cannot grow; regenerate with \`node scripts/validate-lint.cjs --write-baseline\` when a file shrinks. The repo's FULL eslint ruleset is not gated - it cannot be green yet.`,
      collected.counts,
      ROOT,
    );
    return;
  }

  const baseline = readBaseline(BASELINE);
  const { total, grown, newFiles, shrunk } = compareToBaseline(collected.counts, baseline);

  if (argv.includes('--report')) {
    console.log(`\n${total} finding(s) across ${collected.counts.size} of ${collected.filesLinted} file(s)\n`);
    for (const [file, n] of [...collected.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`  ${String(n).padStart(3)}  ${file}`);
    }
  }

  console.log(
    `[lint-gate] ${collected.filesLinted} file(s) linted with ${Object.keys(GATE_RULES).join(' + ')}: ` +
      `${total} finding(s) in ${collected.counts.size} file(s) · ${grown.length} grown · ${newFiles.length} new · ${shrunk.length} shrunk`,
  );
  if (collected.leaked.length) {
    console.log(
      `  ⚠ ${collected.leaked.map(([r, n]) => `${r} ×${n}`).join(', ')} fired without being declared — NOT counted, but the config is not isolated`,
    );
  }
  if (collected.dangling.length) {
    console.log(
      `  · ${collected.dangling.reduce((n, [, c]) => n + c, 0)} disable directive(s) name a rule this gate does not load ` +
        `(${collected.dangling.map(([r]) => r).join(', ')}) — the repo's eslint.config.js still owns it`,
    );
  }
  for (const g of grown) console.log(`  ✖ ${g.file} — ${g.was} → ${g.count}`);
  for (const n of newFiles) console.log(`  ✖ ${n.file} — ${n.count} finding(s) in a file that had none`);
  for (const s of shrunk) console.log(`  ⚠ ${s.file} — ${s.was} → ${s.count}; baseline is stale, re-baseline in this change`);
  if (grown.length || newFiles.length || shrunk.length) {
    console.log('[lint-gate] fix the finding, or re-baseline deliberately: node scripts/validate-lint.cjs --write-baseline');
    process.exit(1);
  }
  console.log('[lint-gate] ✅ no unused name and no undefined name has been added');
}

if (require.main === module) main();

module.exports = { GATE_RULES, HELPER_RULES, collect };
