#!/usr/bin/env node
/**
 * bump-version.cjs — bump the version in BOTH package.json files, and refresh the
 * derived artefacts the build gates on. ONE command, because doing half of it fails the build.
 *
 * ── WHY THIS EXISTS (measured 2026-10-02, #1041) ──
 *
 * `.github/instructions/agent-handoff.instructions.md` mandates a version bump, and mandates
 * bumping BOTH `package.json` and `nest/package.json` to the SAME value. It said nothing about
 * `docs/GENERATED-FACTS.md` — which DERIVES the application version from those files.
 *
 * So the documented, correct procedure broke the next build:
 *
 *   [docs-facts] ✖ 2 generated artefact(s) are stale:
 *     docs/GENERATED-FACTS.md is OUT OF DATE — regenerate it: node scripts/docs-facts.cjs --write
 *   BUILD FAILED (exit 1)
 *
 * `nest/package.json`'s `prebuild` runs `docs-facts.cjs --check` and `tools-index.cjs --check`,
 * so a bump on its own is a RED BUILD for whoever runs it next — and the failure names a
 * generated file, not the bump that made it stale. An agent following the rule to the letter
 * arrives at a broken tree and has to work out why.
 *
 * ⚠️ The shape of the defect is the one this repo warns about most: **a documented procedure
 * that is incomplete is worse than an undocumented one**, because it is followed. The fix is
 * not a longer paragraph — it is that the correct action is now ONE command with no second step
 * to forget.
 *
 * ── USAGE ──
 *
 *   node scripts/bump-version.cjs patch            # 0.114.0 -> 0.114.1
 *   node scripts/bump-version.cjs minor            # 0.114.0 -> 0.115.0
 *   node scripts/bump-version.cjs major            # 0.114.0 -> 1.0.0
 *   node scripts/bump-version.cjs 0.120.3          # set an exact version
 *   node scripts/bump-version.cjs --check          # report only; exit 1 if the pair disagrees or artefacts are stale
 *   node scripts/bump-version.cjs --self-test      # prove the arithmetic and the mismatch detection can fail
 *
 * ⚠️ This does NOT rebuild the API. After it, run `npm --prefix nest run build:api` — the
 * served version is read from `nest/package.json` at boot, so it only changes on restart.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'nest', 'package.json'),
];

// ── Pure helpers (exported for the self-test) ─────────────────────────────────────

/**
 * nextVersion(current, spec) — the bump arithmetic, pure so it can be canaried.
 * `spec` is 'patch' | 'minor' | 'major' | an exact semver string.
 * Throws on anything it does not understand, rather than guessing a version.
 */
function nextVersion(current, spec) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`current version is not plain semver: ${JSON.stringify(current)}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (spec === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (spec === 'minor') return `${maj}.${min + 1}.0`;
  if (spec === 'major') return `${maj + 1}.0.0`;

  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(spec).trim());
  if (exact) return `${Number(exact[1])}.${Number(exact[2])}.${Number(exact[3])}`;

  throw new Error(`unknown bump spec: ${JSON.stringify(spec)} (use patch|minor|major|<x.y.z>)`);
}

/** versionsAgree(a, b) — the invariant the handoff rule states and nothing enforced. */
function versionsAgree(a, b) {
  return String(a).trim() === String(b).trim();
}

/**
 * writeVersion(text, version) — set the version, preserving the file's own formatting.
 * Deliberately not a JSON round-trip: these package.json files are hand-formatted, and a
 * re-serialise would reformat every line, burying a one-line change in a whole-file diff.
 *
 * ⚠️ THE REPLACEMENT IS VERIFIED, NOT ASSUMED. It replaces the first `"version"` key it finds,
 * then re-parses and asserts the TOP-LEVEL version actually changed. If that first key was a
 * nested one (inside a dependency block), the top-level value is untouched and this THROWS
 * rather than writing a file that silently did nothing.
 *
 * ⚠️ The first draft of this function anchored the regex to column 1 (`^"version"`) on the
 * reasoning that a nested key would be indented. That was backwards: the TOP-LEVEL key is the
 * indented one (`  "version": "0.114.0",`) and column 1 holds `{`, so the pattern matched
 * nothing and `readVersions()` would have thrown on every real file. The self-test caught it —
 * which is the entire argument for shipping a self-test with a new tool.
 */
function writeVersion(text, version) {
  const re = /("version"\s*:\s*)"[^"]*"/;
  if (!re.test(text)) throw new Error('no "version" key found');
  const updated = text.replace(re, `$1"${version}"`);

  let parsed;
  try { parsed = JSON.parse(updated); }
  catch (e) { throw new Error(`replacement produced invalid JSON: ${e.message}`); }
  if (parsed.version !== version) {
    throw new Error(
      `replacement did not change the TOP-LEVEL version (it is still ${JSON.stringify(parsed.version)}) — ` +
      'the first "version" key in the file is nested, so this must be edited by hand',
    );
  }
  return updated;
}

// ── Self-test ─────────────────────────────────────────────────────────────────────

function selfTest() {
  const cases = [];
  const check = (name, fn) => {
    try { fn(); cases.push([name, true]); }
    catch (e) { cases.push([name, false, e.message]); }
  };

  const eq = (a, b) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`); };
  const throws = (fn) => {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error('expected a throw, got a value');
  };

  check('patch', () => eq(nextVersion('0.114.0', 'patch'), '0.114.1'));
  check('minor', () => eq(nextVersion('0.114.0', 'minor'), '0.115.0'));
  check('major', () => eq(nextVersion('0.114.0', 'major'), '1.0.0'));
  check('exact', () => eq(nextVersion('0.114.0', '2.3.4'), '2.3.4'));
  check('patch rolls over to minor-scale digits', () => eq(nextVersion('0.9.9', 'patch'), '0.9.10'));
  check('minor resets patch', () => eq(nextVersion('0.9.9', 'minor'), '0.10.0'));
  check('unknown spec throws', () => throws(() => nextVersion('0.1.0', 'banana')));
  check('non-semver current throws', () => throws(() => nextVersion('v0.1', 'patch')));

  check('agree on equal', () => eq(versionsAgree('0.114.0', '0.114.0'), true));
  check('DISAGREE on different', () => eq(versionsAgree('0.114.0', '0.113.0'), false));

  // ⚠️ The INDENTED shape, matching the real files. The first draft passed only a column-1
  // version key, which no real package.json has — so this case is the one that matters.
  check('writeVersion replaces an INDENTED top-level key', () =>
    eq(writeVersion('{\n  "name": "x",\n  "version": "0.1.0",\n  "a": 1\n}\n', '9.9.9'),
      '{\n  "name": "x",\n  "version": "9.9.9",\n  "a": 1\n}\n'));

  check('writeVersion does NOT touch a nested version', () => {
    const before = '{\n  "version": "0.1.0",\n  "d": {\n    "version": "1.2.3"\n  }\n}\n';
    const after = writeVersion(before, '9.9.9');
    if (!after.includes('"version": "9.9.9"')) throw new Error('top-level not replaced');
    if (!after.includes('"version": "1.2.3"')) throw new Error('nested version was clobbered');
  });

  check('writeVersion throws when there is no version key', () =>
    throws(() => writeVersion('{ "name": "x" }', '1.0.0')));

  // ⚠️ Canary for the VERIFICATION itself: if the first `version` key is nested, the replacement
  // cannot reach the top level — the guard must report that, not return a file that did nothing.
  check('writeVersion REFUSES a nested-first file instead of silently doing nothing', () =>
    throws(() => writeVersion('{\n  "d": {\n    "version": "1.2.3"\n  },\n  "version": "0.1.0"\n}\n', '9.9.9')));

  check('writeVersion rejects a replacement that breaks JSON', () =>
    throws(() => writeVersion('{\n  "version": "0.1.0",\n}\n', '9.9.9')));

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok, msg] of cases) {
    console.log(`  ${ok ? '✅' : '✖ '} ${name}${msg ? ' — ' + msg : ''}`);
  }
  console.log(`\n  self-test: ${cases.length - failed.length}/${cases.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────────

function readVersions() {
  return FILES.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    // Parsed, not pattern-matched — JSON.parse is the authority on what the top-level version
    // IS, and it cannot disagree with what the app will read at boot.
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`); }
    if (typeof parsed.version !== 'string') throw new Error(`no top-level "version" in ${f}`);
    return { file: f, rel: path.relative(ROOT, f), text, version: parsed.version };
  });
}

function runChecked(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const ok = r.status === 0;
  console.log(`  ${ok ? '✅' : '✖ '} ${label}`);
  if (!ok && out) console.log(out.split(/\r?\n/).map((l) => '      ' + l).join('\n'));
  return ok;
}

function main() {
  const arg = process.argv[2];

  if (!arg || arg === '--help' || arg === '-h') {
    console.log('usage: node scripts/bump-version.cjs patch|minor|major|<x.y.z> | --check | --self-test');
    process.exit(arg ? 0 : 2);
  }
  if (arg === '--self-test') return selfTest();

  let versions;
  try { versions = readVersions(); }
  catch (e) { console.error(`  ✖  ${e.message}`); process.exit(1); }

  const [root, nest] = versions;

  // ── --check: report only, never write ──
  if (arg === '--check') {
    console.log(`  root  ${root.rel}: ${root.version}`);
    console.log(`  nest  ${nest.rel}: ${nest.version}`);
    let ok = true;
    if (!versionsAgree(root.version, nest.version)) {
      console.log('  ✖  the two package.json files DISAGREE — the #768 trap: the served version');
      console.log('      comes from nest/, and the UI build from the root.');
      ok = false;
    } else {
      console.log('  ✅ agree');
    }
    ok = runChecked('docs-facts current', 'node', ['scripts/docs-facts.cjs', '--check']) && ok;
    ok = runChecked('tools-index current', 'node', ['scripts/tools-index.cjs', '--check']) && ok;
    process.exit(ok ? 0 : 1);
  }

  // ── Bump ──
  let next;
  try { next = nextVersion(root.version, arg); }
  catch (e) { console.error(`  ✖  ${e.message}`); process.exit(2); }

  if (root.version === next && nest.version === next) {
    console.log(`  ✅ both files already at ${next} — nothing to do.`);
    process.exit(0);
  }

  console.log(`  ${root.version} → ${next}`);
  if (!versionsAgree(root.version, nest.version)) {
    console.log(`  ⚠️  they DISAGREED before this bump (root ${root.version}, nest ${nest.version}) —`);
    console.log('      both are now being set to the same value, which repairs it.');
  }

  for (const v of versions) {
    const updated = writeVersion(v.text, next);
    fs.writeFileSync(v.file, updated);
    console.log(`  ✅ ${v.rel}`);
  }

  // ⚠️ THE STEP THE OLD INSTRUCTIONS OMITTED. `prebuild` runs `--check` on both of these,
  // so skipping it turns the ACT of bumping into a failed build for the next person.
  console.log('\n  refreshing derived artefacts (prebuild gates on these):');
  let ok = runChecked('docs-facts --write', 'node', ['scripts/docs-facts.cjs', '--write']);
  ok = runChecked('tools-index --write', 'node', ['scripts/tools-index.cjs', '--write']) && ok;

  ok = runChecked('docs-facts --check', 'node', ['scripts/docs-facts.cjs', '--check']) && ok;
  ok = runChecked('tools-index --check', 'node', ['scripts/tools-index.cjs', '--check']) && ok;

  if (!ok) {
    console.error('\n  ✖  a derived artefact is still stale. Do NOT run a plain `npm run build` —');
    console.error('      fix the regeneration above first. See agent-environment.instructions.md.');
    process.exit(1);
  }

  console.log(`\n  ✅ ${next} in both files, derived artefacts current.`);
  console.log('  ⚠️  NOT rebuilt: the served version is read at boot. Run');
  console.log('      npm --prefix nest run build:api   — then GET /api/version should report it.');
}

module.exports = { nextVersion, versionsAgree, writeVersion, selfTest };

if (require.main === module) main();
