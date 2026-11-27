/**
 * validate-test-wiring.cjs — a test that nothing runs is a decoration.
 *
 * ── THE DEFECT THIS WAS BUILT FOR, MEASURED 2026-11-27 ──────────────────────────────────────────
 * The frontend had **38 `node --test` files and the build ran exactly ONE of them**
 * (`src/theme/semantic-contrast.test.js`, named literally in `prebuild`). The other 37 were reachable
 * only through individually-named npm scripts — `test:backtest-totals`, `test:movers-steps`,
 * `test:decision-score` and 14 more — which nothing invokes and nobody remembers. Measured by running
 * the whole set at once: **385 tests, 385 passing, 7.1 s**. So 378 tests existed, passed, and gated
 * nothing. That is the same shape as a validator that prints "does not fail the build": it reads as
 * coverage and provides none.
 *
 * The fix was one line in `prebuild`: `node --test` with a src-wide test glob. This script is the guard that
 * the line stays true — because the next person to add a test in a new folder will get no feedback at
 * all, and the failure mode is silence, not an error.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 * **T1** — every `*.test.{js,jsx}` under `src/` is matched by at least one command in the root
 * `package.json` scripts. `.js` is matched by a `node --test <glob|path>` token; `.jsx` by the
 * `include` patterns in `vitest.config.js`, because that is the runner that collects them.
 *
 * ⚠️ **IT READS THE SCRIPTS, NOT THE INTENT.** A test named in a script that nothing invokes is still
 * an orphan in spirit — `tools-index.cjs` reports reachability separately and this script does not try
 * to duplicate it. What this catches is the case that actually happened: a whole FOLDER of tests with
 * no glob covering it.
 *
 * Usage:
 *   node scripts/validate-test-wiring.cjs            # the gate
 *   node scripts/validate-test-wiring.cjs --report   # every test file and the command that runs it
 *   node scripts/validate-test-wiring.cjs --self-test
 *
 * Exit: 0 = every test is wired · 1 = at least one is not · 2 = could not judge (never 0).
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      `prebuild` runs a src-wide `node --test` glob instead of one named file, and this script
 *            fails the build when any `*.test.{js,jsx}` under `src/` is matched by no command.
 * WHY:       `prebuild` named `semantic-contrast.test.js` literally and ran nothing else — 38 test files
 *            existed, 385 tests passed, 378 gated nothing. Nothing failed, which is why it lasted.
 * INSTEAD OF: Adding 8 more npm scripts for the movers folder. Individually-named scripts LOOK like a
 *            wired suite and are the exact mechanism that let 17 of them go unrun.
 * REVERSE BY: Restore the single-file `node --test` argument in `prebuild` and delete this script, its
 *            npm scripts, and the `test-wiring` entry in `src/data/standards.js`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 310
 * GUARD:     npm run test:wiring:canary
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'src');
const TEST_RE = /\.test\.(js|jsx)$/;

/**
 * A command token may be a literal path or a glob. `**​/` matches ZERO or more directories, which is the
 * one glob semantic this script depends on — `src/**​/*.test.js` has to match `src/x.test.js` as well as
 * `src/core/x.test.js`, or a test placed at the top of `src/` reads as an orphan.
 *
 * ⚠️ Written as a general matcher rather than three special cases, because the third case is always the
 * one that gets forgotten. Canaried in both directions in `--self-test`.
 */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      out += '(?:[^/]+/)*';
      i += 2;
    } else if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Every `*.test.{js,jsx}` under `src/`, repo-relative, forward slashes. */
function testFiles(dir = TEST_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      testFiles(full, out);
    } else if (TEST_RE.test(e.name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** The include patterns vitest collects, read from its config — never guessed. */
function vitestIncludes(configPath = path.join(ROOT, 'vitest.config.js')) {
  if (!fs.existsSync(configPath)) return [];
  const text = fs.readFileSync(configPath, 'utf8');
  const m = text.match(/include:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
}

/**
 * The path-like tokens a script command contributes. A token is considered only if it ends in a test
 * extension or contains a glob, so `vitest run` and `--reporter=dot` contribute nothing.
 */
function pathTokens(commands) {
  const tokens = new Set();
  for (const command of commands) {
    for (const raw of String(command).split(/[\s"']+/)) {
      const token = raw.replace(/^['"]|['"]$/g, '');
      if (!token) continue;
      if (!TEST_RE.test(token) && !token.includes('*')) continue;
      if (!/\.(js|jsx)$/.test(token)) continue;
      tokens.add(token.replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  }
  return [...tokens];
}

function wiring({ scripts, includes, files }) {
  const jsPatterns = pathTokens(Object.values(scripts).filter((c) => /node\s+--test/.test(c))).map(globToRegExp);
  const jsxPatterns = includes.map(globToRegExp);
  return files.map((file) => {
    const patterns = file.endsWith('.jsx') ? jsxPatterns : jsPatterns;
    const hit = patterns.find((re) => re.test(file));
    return { file, wired: Boolean(hit), via: hit ? hit.source : null };
  });
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  const glob = (g, p) => globToRegExp(g).test(p);
  expect('** matches a nested file', glob('src/**/*.test.js', 'src/core/x.test.js'), true);
  expect('** matches a file at the root of the base', glob('src/**/*.test.js', 'src/x.test.js'), true);
  expect('** does not match another folder', glob('src/**/*.test.js', 'nest/src/x.test.js'), false);
  expect('a single * does not cross folders', glob('src/*/*.test.js', 'src/core/x.test.js'), true);
  expect('a single * stops at a slash', glob('src/*.test.js', 'src/core/x.test.js'), false);
  expect('a literal path matches itself', glob('src/core/a.test.js', 'src/core/a.test.js'), true);
  expect('a literal path does not match a sibling', glob('src/core/a.test.js', 'src/core/b.test.js'), false);

  const base = { includes: ['src/**/*.test.jsx'] };
  const one = wiring({ ...base, scripts: { x: 'node --test "src/core/**/*.test.js"' }, files: ['src/core/a.test.js'] });
  expect('a glob in a script wires the file', one[0].wired, true);

  const orphan = wiring({ ...base, scripts: { x: 'node --test "src/core/**/*.test.js"' }, files: ['src/features/f/a.test.js'] });
  expect('▶ CANARY — a file outside every glob is an ORPHAN', orphan[0].wired, false);

  const jsx = wiring({ ...base, scripts: { x: 'vitest run' }, files: ['src/components/A.test.jsx'] });
  expect('a .jsx test is wired by the vitest include, not by a node glob', jsx[0].wired, true);

  const noInclude = wiring({ includes: [], scripts: { x: 'vitest run' }, files: ['src/components/A.test.jsx'] });
  expect('▶ CANARY — no vitest include means every .jsx test is an orphan', noInclude[0].wired, false);

  const noise = pathTokens(['vitest run --config vitest.config.js --reporter=dot']);
  expect('non-path flags contribute no tokens', noise, []);

  console.log('');
  console.log(failures === 0 ? '✅ self-test: the matcher works, and both orphan directions are observed' : `❌ self-test: ${failures} case(s) wrong`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  if (args.length && !args.includes('--report')) {
    console.error(`[test-wiring] unknown argument: ${args[0]}  (try --report or --self-test)`);
    return 2;
  }

  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  } catch (err) {
    console.error(`[test-wiring] ✖ cannot read package.json — ${err.message}`);
    return 2;
  }

  const files = testFiles();
  if (!files.length) {
    console.error('[test-wiring] ✖ found no test files under src/ — a check that reads nothing has checked nothing');
    return 2;
  }
  const includes = vitestIncludes();
  const rows = wiring({ scripts, includes, files });
  const orphans = rows.filter((r) => !r.wired);

  if (args.includes('--report')) {
    for (const r of rows) console.log(`  ${r.wired ? '✅' : '✖'} ${r.file}  ← ${r.via ?? 'NOTHING RUNS IT'}`);
    console.log('');
  }

  console.log(`[test-wiring] ${files.length} test file(s) · ${rows.length - orphans.length} wired · ${orphans.length} orphan(s)`);
  if (orphans.length) {
    for (const o of orphans) {
      console.log(`  ✖ ${o.file}`);
      console.log('      no npm script or vitest include matches this file, so it is never executed.');
      console.log('      Fix by widening the glob in `prebuild`/`test:frontend`, not by adding another named script.');
    }
    console.error('\n[test-wiring] ✖ a test nothing runs is a decoration, not a guard.');
    return 1;
  }
  console.log('[test-wiring] ✅ every test file under src/ is matched by the command that should run it');
  return 0;
}

process.exit(main());
