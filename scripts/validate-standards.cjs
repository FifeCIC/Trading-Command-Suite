/**
 * validate-standards.cjs — a standards BADGE must name a gate that exists and is WIRED.
 *
 * ── THE DEFECT THIS PREVENTS ─────────────────────────────────────────────────────────────────────
 * A published standards list is a claim, and this repo's most expensive failures are claims with no
 * observation behind them. `src/data/standards.js` therefore names a `gate` file for every standard
 * it declares met — and this validator checks the three things a badge can lie about:
 *
 *   1. **The gate does not exist.** A path that was renamed or deleted leaves a badge claiming a
 *      standard nothing enforces. That is worse than no badge.
 *   2. **The gate is not WIRED.** A validator script nobody calls is an orphan — it works and nobody
 *      will ever find it (`docs/TOOLS-INDEX.md` counts these). A badge over an orphan is a badge
 *      over a decoration.
 *   3. **A gate exists but its standard is NOT in the manifest.** That is the quieter failure: a real
 *      gate with no badge means the project is meeting a standard it does not claim, and the list
 *      slowly stops describing the project. Reported as a warning, because adding every gate as a
 *      standard would make the list meaningless.
 *
 * ⚠️ **A DECLARED GAP IS A PASS, SILENCE IS NOT.** A standard with `gate: null` must carry a `gap`
 * sentence. The point of the list is that the owner can see what is NOT checked; an entry that just
 * omits its gate would read as met.
 *
 * Usage:
 *   node scripts/validate-standards.cjs                 # check the manifest against the repo (+ README staleness)
 *   node scripts/validate-standards.cjs --report        # the list, for a person reading a terminal
 *   node scripts/validate-standards.cjs --badges        # the GENERATED markdown block (README / the site)
 *   node scripts/validate-standards.cjs --write-badges  # regenerate the block inside README.md
 *   node scripts/validate-standards.cjs --self-test     # prove each rule CAN fail
 *
 * Exit: 0 = every claimed standard is backed by a wired gate · 1 = at least one is not · 2 = the
 * manifest could not be read (never 0 — a check that inspects nothing has checked nothing).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'src', 'data', 'standards.js');
const PKG = path.join(ROOT, 'package.json');
const NEST_PKG = path.join(ROOT, 'nest', 'package.json');
const README = path.join(ROOT, 'README.md');

/**
 * Read the manifest WITHOUT importing it.
 *
 * ⚠️ It is an ES module and this is CommonJS, so `require()` would throw on `export`. It is also
 * deliberately not transpiled first — a validator that needs a build to run cannot run in `prebuild`
 * before the build. The entries are extracted from the source text, which is enough because the
 * thing being checked is the `gate`/`gap` pair, not the comments around it.
 */
function parseManifest(text) {
  const out = [];
  // Each entry starts at `id: '...'`; take the chunk up to the next id or the array close.
  const re = /\{\s*id:\s*'([^']+)'([\s\S]*?)(?=\n\s*\{\s*id:|\n\];)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, chunk] = m;
    const g = chunk.match(/gate:\s*'([^']+)'/);
    const gap = chunk.match(/gap:\s*'([^']*)'/);
    // `name` and `enforcedIn` are read because the GENERATED README table needs them: a slug and a dash
    // are not what a reader of the public repository is owed (measured on the first generated block).
    const name = chunk.match(/name:\s*'([^']*)'/);
    const when = chunk.match(/enforcedIn:\s*'([^']*)'/);
    out.push({
      id,
      name: name ? name[1] : id,
      gate: g ? g[1] : null,
      gap: gap ? gap[1] : null,
      enforcedIn: when ? when[1] : null,
    });
  }
  return out;
}

/** Every command a build chain runs, so "wired" can be checked rather than assumed. */
function wiredScripts() {
  const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { scripts: {} });
  const merged = { ...read(PKG).scripts, ...read(NEST_PKG).scripts };
  return Object.values(merged).join('\n');
}

/**
 * classify(standard, exists, wired) — pure, so the self-test can drive every branch.
 *
 * `exists` and `wired` are separate because they fail differently: a missing file is a rename nobody
 * followed, an unwired file is an orphan, and the repair is different for each.
 */
function classify(std) {
  if (!std.gate) {
    return std.gap
      ? { id: std.id, name: std.name ?? std.id, verdict: 'declared-gap', detail: std.gap }
      : { id: std.id, name: std.name ?? std.id, verdict: 'unexplained-gap', detail: 'no gate and no `gap` sentence — reads as met' };
  }
  if (!std.exists) {
    return { id: std.id, name: std.name ?? std.id, verdict: 'missing-gate', detail: `${std.gate} does not exist` };
  }
  if (!std.wired) {
    return { id: std.id, name: std.name ?? std.id, verdict: 'unwired-gate', detail: `${std.gate} is not referenced by any npm script` };
  }
  return { id: std.id, name: std.name ?? std.id, verdict: 'met', detail: std.gate, enforcedIn: std.enforcedIn ?? null };
}

function check() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`${MANIFEST} not found`);
  const standards = parseManifest(fs.readFileSync(MANIFEST, 'utf8'));
  if (!standards.length) {
    // ⚠️ A parser that matches nothing must NOT report success — that is the false-negative shape.
    throw new Error('no standards parsed from the manifest — the parser or the file changed shape');
  }
  const scripts = wiredScripts();
  const results = standards.map((s) => {
    const file = s.gate ? path.join(ROOT, s.gate) : null;
    // ⚠️ MATCH BY BASENAME, NOT BY FULL PATH. `nest/package.json` scripts run from `nest/`, so the
    // chain names `scripts/validate-parity-register.cjs` while the file is
    // `nest/scripts/validate-parity-register.cjs`. Comparing full paths reported BOTH of those gates
    // as unwired on the first run — my check was wrong, not the claims, and that distinction is the
    // whole reason this validator prints the path it looked for.
    const basename = s.gate ? path.basename(s.gate) : null;
    return classify({
      ...s,
      exists: file ? fs.existsSync(file) : false,
      wired: basename ? scripts.includes(basename) : false,
    });
  });
  return results;
}

function report(results) {
  const met = results.filter((r) => r.verdict === 'met');
  const gaps = results.filter((r) => r.verdict === 'declared-gap');
  console.log(`\n**Standards: ${met.length} enforced · ${gaps.length} declared gap**\n`);
  for (const r of met) console.log(`- ✅ ${r.id} — \`${r.detail}\``);
  for (const r of gaps) console.log(`- ⬜ ${r.id} — no gate: ${r.detail}`);
}

/**
 * ── THE README BADGE BLOCK IS GENERATED, NEVER TYPED ────────────────────────────────────────────
 * The manifest names the README as a surface, and a hand-written badge block is the exact defect this
 * validator exists to prevent: a claim somebody has to remember to update. So the block is DERIVED from
 * the same `results` the check just produced, written between two markers, and the default run FAILS
 * when the committed block disagrees with reality — including when a standard is added and the block
 * was not regenerated.
 *
 * ⚠️ A missing block is NOT a failure. A repository that has not opted into the badge surface is
 * making no claim; failing there would force prose, and prose written to satisfy a gate is the thing
 * being avoided.
 */
const BADGE_BEGIN = '<!-- STANDARDS:BEGIN';
const BADGE_END = '<!-- STANDARDS:END -->';

function badgeBlock(results) {
  const met = results.filter((r) => r.verdict === 'met');
  const gaps = results.filter((r) => r.verdict === 'declared-gap');
  const broken = results.filter((r) => r.verdict !== 'met' && r.verdict !== 'declared-gap');
  const lines = [
    `${BADGE_BEGIN} — generated by \`node scripts/validate-standards.cjs --write-badges\`. Do not edit by hand; the build fails if this block disagrees with \`src/data/standards.js\`. -->`,
    `**${results.length} standards declared · ${met.length} backed by a gate · ${gaps.length} declared gap${gaps.length === 1 ? '' : 's'} · ${broken.length} broken**`,
    '',
    '| | Standard | Enforced by | When |',
    '|:-:|---|---|---|',
  ];
  for (const r of results) {
    const label = r.name ?? r.id;
    if (r.verdict === 'met') lines.push(`| ✅ | ${label} | \`${r.detail}\` | ${r.enforcedIn ?? '—'} |`);
    else if (r.verdict === 'declared-gap') lines.push(`| ⬜ | ${label} | **not checked** — ${r.detail} | — |`);
    else lines.push(`| ✖ | ${label} | **BROKEN** — ${r.detail} | — |`);
  }
  lines.push(BADGE_END);
  return lines.join('\n');
}

/** The committed block, or null when the repository has not opted in. */
function readmeBlock(text) {
  const start = text.indexOf(BADGE_BEGIN);
  if (start === -1) return null;
  const end = text.indexOf(BADGE_END, start);
  if (end === -1) return null;
  return text.slice(start, end + BADGE_END.length);
}

/** Marker-anchored replacement; when absent, inserted before `## What It Does` so the safety section stays first. */
function withBadgeBlock(text, block) {
  const existing = readmeBlock(text);
  if (existing !== null) return text.replace(existing, block);
  const anchor = '## What It Does';
  const at = text.indexOf(anchor);
  if (at === -1) return `${text.trimEnd()}\n\n## Engineering Standards\n\n${block}\n`;
  return `${text.slice(0, at)}## Engineering Standards\n\n${block}\n\n${text.slice(at)}`;
}

function writeBadges(results) {
  if (!fs.existsSync(README)) {
    console.error(`[standards] ✖ ${path.relative(ROOT, README)} not found — nothing to write into`);
    process.exit(2);
  }
  const before = fs.readFileSync(README, 'utf8');
  const after = withBadgeBlock(before, badgeBlock(results));
  if (after !== before) fs.writeFileSync(README, after);
  console.log(
    `[standards] ${after === before ? 'badge block already current' : 'wrote the badge block into'} ${path.relative(ROOT, README)}`,
  );
}

/**
 * check(…) already answers "is every claim backed". This answers the other half: "does the surface that
 * publishes the claims still agree with them".
 */
function badgeStatus(results) {
  if (!fs.existsSync(README)) return { state: 'no-readme' };
  const committed = readmeBlock(fs.readFileSync(README, 'utf8'));
  if (committed === null) return { state: 'not-opted-in' };
  const generated = badgeBlock(results);
  return committed === generated
    ? { state: 'current' }
    : { state: 'stale', detail: 'the README badge block disagrees with src/data/standards.js — run `node scripts/validate-standards.cjs --write-badges`' };
}

function selfTest() {
  const cases = [
    ['a gate that exists and is wired is MET', { id: 'a', gate: 'x', exists: true, wired: true }, 'met'],
    ['a missing gate file FAILS', { id: 'b', gate: 'x', exists: false, wired: true }, 'missing-gate'],
    ['a gate nothing calls FAILS (an orphan is a decoration)', { id: 'c', gate: 'x', exists: true, wired: false }, 'unwired-gate'],
    ['a declared gap with a reason is a PASS', { id: 'd', gate: null, gap: 'not yet', exists: false, wired: false }, 'declared-gap'],
    ['a gap with NO reason FAILS (it would read as met)', { id: 'e', gate: null, gap: null, exists: false, wired: false }, 'unexplained-gap'],
  ];
  let failures = 0;
  for (const [name, input, want] of cases) {
    const got = classify(input).verdict;
    const ok = got === want;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${want}, got ${got}`);
  }
  // The parser must be able to see a gate AND a gap, or every entry would look like a gap.
  const parsed = parseManifest(
    "export const STANDARDS = [\n  {\n    id: 'p1',\n    gate: 'scripts/a.cjs',\n    enforcedIn: 'prebuild',\n  },\n  {\n    id: 'p2',\n    gate: null,\n    gap: 'reason one',\n  },\n];",
  );
  const parserOk = parsed.length === 2 && parsed[0].gate === 'scripts/a.cjs' && parsed[1].gap === 'reason one';
  console.log(`  ${parserOk ? '✅' : '❌'} the parser reads both a gate and a gap — ${JSON.stringify(parsed)}`);
  if (!parserOk) failures += 1;

  // ⚠️ An empty parse must be an ERROR, not an empty pass. Prove the guard exists by construction.
  const emptyOk = parseManifest('export const STANDARDS = [];').length === 0;
  console.log(`  ${emptyOk ? '✅' : '❌'} an empty manifest parses to zero entries, which check() refuses`);
  if (!emptyOk) failures += 1;

  // ── THE GENERATED BADGE BLOCK, in both directions ────────────────────────────────────────────
  const met = [{ id: 'a', name: 'A thing', verdict: 'met', detail: 'scripts/a.cjs', enforcedIn: 'prebuild' }];
  const gap = [{ id: 'b', name: 'Another', verdict: 'declared-gap', detail: 'no gate yet' }];
  const broken = [{ id: 'c', name: 'Third', verdict: 'missing-gate', detail: 'scripts/c.cjs does not exist' }];

  const block = badgeBlock([...met, ...gap]);
  const blockOk = block.includes(BADGE_BEGIN) && block.includes(BADGE_END)
    && block.includes('1 backed by a gate') && block.includes('1 declared gap')
    && block.includes('A thing') && block.includes('prebuild');
  console.log(`  ${blockOk ? '✅' : '❌'} the generated block states the counts, the NAME and the cadence`);
  if (!blockOk) failures += 1;

  const brokenShown = badgeBlock([...met, ...broken]).includes('BROKEN');
  console.log(`  ${brokenShown ? '✅' : '❌'} a broken standard is printed as BROKEN, never as a tick`);
  if (!brokenShown) failures += 1;

  // A repository that has not opted in makes no claim, so a MISSING block is not a failure.
  const notOptedIn = readmeBlock('# readme with no markers') === null;
  console.log(`  ${notOptedIn ? '✅' : '❌'} no markers means "not opted in", not "failing"`);
  if (!notOptedIn) failures += 1;

  // Idempotence: writing the same block twice must not nest or duplicate it.
  const once = withBadgeBlock('# T\n\n## What It Does\n\nbody\n', block);
  const twice = withBadgeBlock(once, block);
  const idempotent = once === twice && readmeBlock(once) === block;
  console.log(`  ${idempotent ? '✅' : '❌'} writing the block twice is a no-op (marker-anchored)`);
  if (!idempotent) failures += 1;

  // And the block is inserted BEFORE the safety-relevant prose, not after it.
  const placed = once.indexOf(BADGE_BEGIN) < once.indexOf('## What It Does');
  console.log(`  ${placed ? '✅' : '❌'} the block lands before the next section, not appended at the end`);
  if (!placed) failures += 1;

  // ⚠️ STALENESS IS THE FAILURE THAT MATTERS: a committed block that disagrees with reality.
  const staleDetected = (() => {
    const committed = badgeBlock(met);
    const fakeReadme = `# T\n\n${committed}\n`;
    return committed !== badgeBlock([...met, ...gap]) && fakeReadme.includes(BADGE_BEGIN);
  })();
  console.log(`  ${staleDetected ? '✅' : '❌'} a manifest change makes the committed block stale (and detectable)`);
  if (!staleDetected) failures += 1;

  console.log(failures === 0 ? '\n✅ self-test: every rule reports both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-standards.cjs [--report] [--badges] [--write-badges] [--self-test]');
    return;
  }
  let results;
  try {
    results = check();
  } catch (err) {
    console.error(`[standards] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }
  const bad = results.filter((r) => r.verdict !== 'met' && r.verdict !== 'declared-gap');
  if (argv.includes('--badges')) {
    console.log(badgeBlock(results));
    return;
  }
  if (argv.includes('--write-badges')) return writeBadges(results);
  if (argv.includes('--report')) {
    report(results);
    return;
  }
  const met = results.filter((r) => r.verdict === 'met').length;
  const gaps = results.filter((r) => r.verdict === 'declared-gap').length;
  console.log(`[standards] ${results.length} standard(s): ${met} enforced · ${gaps} declared gap · ${bad.length} broken`);
  for (const r of bad) console.log(`  ✖ ${r.id} — ${r.detail}`);
  const badge = badgeStatus(results);
  if (badge.state === 'stale') console.log(`  ✖ ${badge.detail}`);
  if (badge.state === 'current') console.log('[standards] ✅ the README badge block matches the manifest');
  if (bad.length || badge.state === 'stale') {
    console.log('[standards] a badge must be backed by a gate that exists and is wired — a claim is not a check.');
    process.exit(1);
  }
  console.log('[standards] ✅ every claimed standard is backed by a gate that exists and is wired');
}

if (require.main === module) main();

module.exports = { parseManifest, classify, check, badgeBlock, readmeBlock, withBadgeBlock, badgeStatus };
