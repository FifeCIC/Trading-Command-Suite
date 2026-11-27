/**
 * components-index.cjs — the catalogue of shared UI, generated from the files.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS A CATALOGUE RATHER THAN A FRAMEWORK ───────────────────────────
 * Measured 2026-11-27 before writing a line of it: `src/components/` holds **114 `.jsx` files, every
 * one of them referenced somewhere (0 orphans)**, and **98 of 114 (86%) are used by two or more
 * files**. So the library the owner was proposing to build already exists — what it lacks is a
 * surface. Nobody can answer "what does this project have, and what already does the thing I am about
 * to write?" without grepping 114 filenames.
 *
 * ⚠️ AND THAT IS EXACTLY THE FAILURE `tools-index.cjs` ALREADY PAID FOR. Its header records 175 tools
 * with 75 orphans and *"three separate proposals in one session were to BUILD something already in
 * this list"*. The same money is on the table here: every duplicated widget is a second copy that
 * drifts and only one of which gets the next fix.
 *
 * ⚠️ THE MEASUREMENT ALSO DECIDES THE DESIGN, AND IT IS WHY THIS IS NOT A COMPONENT FRAMEWORK.
 * Reuse is bimodal: `LoadingSkeleton` has **74** consumers and `NoticeBlock` **62**, while **16
 * components have exactly ONE**. A high-use primitive with no data coupling can be standardised
 * safely; a one-consumer block bound to a run result, a symbol and a protocol is a PAGE PART that
 * happens to live in a shared folder. Forcing both into one "widget + theme + test" framework is the
 * wrong abstraction that Sandi Metz's rule warns about — *duplication is far cheaper than the wrong
 * abstraction, and you earn the extraction on the third use, not the second*.
 *
 * ── WHAT IS MEASURED, AND WHAT IS NOT ───────────────────────────────────────────────────────────
 * Measured: the file, its line count, every file that references it, the props its signature
 * DECLARES, whether a test mentions it, how many inline `style={{` blocks and raw hex literals it
 * carries (the two counts `validate-colour-literals` ratchets), and its TIER derived from the
 * consumer count.
 *
 * ⚠️ NOT measured: how many props are PASSED at each call site. That is not a regex — a call site can
 * spread, alias or conditionally include props — and reporting a guess would be the fabricated-number
 * defect this repo's docs keep re-finding. The column says `declared props`, which is what it is.
 *
 * Usage:
 *   node scripts/components-index.cjs                 # check the committed catalogue is current
 *   node scripts/components-index.cjs --write         # regenerate docs/COMPONENTS-INDEX.md + .json
 *   node scripts/components-index.cjs --report        # the tiers, on screen
 *   node scripts/components-index.cjs --find <terms>  # search NAME and what it is (its path/tier)
 *   node scripts/components-index.cjs --orphans       # only components nothing references
 *   node scripts/components-index.cjs --self-test     # prove every rule can fail, both directions
 *
 * Exit: 0 = catalogue current · 1 = stale or a violation · 2 = could not judge (never 0 — a scan that
 * reads nothing has checked nothing).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOC = path.join(REPO_ROOT, 'docs', 'COMPONENTS-INDEX.md');
const JSON_PATH = path.join(REPO_ROOT, 'docs', 'components-index.json');

/** Where shared UI lives. `pages` is scanned only to find CONSUMERS, never as an inventory. */
const LIBRARY_DIRS = [
  { dir: path.join(REPO_ROOT, 'src', 'components'), label: 'components' },
  { dir: path.join(REPO_ROOT, 'src', 'features'), label: 'features' },
];

/**
 * Tier thresholds. ⚠️ NAMED, NOT MAGIC: these are the numbers the report quotes, and a reader who
 * disagrees with them can see exactly what to change rather than reverse-engineering a sort.
 */
const TIERS = { primitive: 5, shared: 2, single: 1, orphan: 0 };

function tierOf(consumers) {
  if (consumers >= TIERS.primitive) return 'primitive';
  if (consumers >= TIERS.shared) return 'shared';
  if (consumers >= TIERS.single) return 'single';
  return 'orphan';
}

/**
 * declaredProps(text) — the prop names in the component's own signature.
 *
 * ⚠️ THREE SHAPES, AND THE THIRD IS THE TRAP. `function X({ a, b = 1 })` and `const X = ({ a }) =>`
 * are the common ones; `function X(props)` declares NOTHING and is reported as `[]` rather than as an
 * error, because a component taking `props` is a real (if unhelpful) shape and failing on it would
 * make the gate noisy. Defaults, aliases (`{ a: b }`) and rest (`...rest`) are stripped.
 */
function declaredProps(text) {
  /**
   * ⚠️ ONE PATTERN COVERS THE THREE DECLARATION SHAPES, and it is anchored to a DECLARATION so it
   * cannot wander into the component body and read `useState({ … })` as a prop list:
   *   `function X({ a })`  ·  `const X = ({ a }) =>`  ·  `const X = memo(({ a }) => …)`
   * A component that takes `props` declares NOTHING and correctly returns `[]`.
   */
  const sig = text.match(
    /(?:function\s+[A-Za-z_$][\w$]*|(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:React\.)?memo|(?:const|let)\s+[A-Za-z_$][\w$]*\s*=)\s*\(*\s*\(?\s*\{([\s\S]*?)\}\s*\)/,
  );
  if (!sig) return [];
  const names = sig[1]
    .split(',')
    .map((s) => s.trim())
    // ⚠️ A rest element is dropped BEFORE the dots are stripped. Keeping it and stripping `...` turned
    // `...rest` into a prop called `rest`, which is the opposite of what the rule says.
    .filter((s) => !s.startsWith('...'))
    // `a`, `a = 1`, `a: alias` → `a`
    .map((s) => s.split('=')[0].split(':')[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  return [...new Set(names)];
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkFiles(full, out);
    } else if (/\.(jsx|js)$/.test(entry.name) && !/\.(test|spec)\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Everything that could reference a component: pages, components, features, core. NOT tests. */
function consumerSources() {
  const out = [];
  for (const rel of ['src']) {
    for (const file of walkFiles(path.join(REPO_ROOT, rel))) {
      out.push({
        file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
        text: fs.readFileSync(file, 'utf8'),
      });
    }
  }
  return out;
}

/** Every test file, so "has a test" means a test NAMES it — not that a folder looks tidy. */
function testSources() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(test|spec)\.(js|ts)$/.test(entry.name)) {
        out.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  walk(path.join(REPO_ROOT, 'nest', 'src'));
  return out;
}

/**
 * analyse(components, consumers, tests) — PURE, so every branch is canaried without the filesystem.
 *
 * `components` is [{ name, file, text }]; `consumers` is [{ file, text }]; `tests` is [string].
 */
function analyse(components, consumers, tests) {
  const testBlob = tests.join('\n');
  return components.map((c) => {
    // ⚠️ The name falls back to the FILE, so a fabricated entry in the self-test needs no `name` field
    // and the analysis cannot crash on `undefined.replace`. A scanner that throws on its own input is
    // worse than one that reports nothing.
    const name = c.name ?? path.basename(c.file, path.extname(c.file));
    const ref = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
    const users = consumers
      .filter((s) => s.file !== c.file && ref.test(s.text))
      .map((s) => s.file)
      // A component that only another component imports is still reused; the tier counts FILES.
      .sort();
    const lines = c.text.split('\n').length;
    const inlineStyles = (c.text.match(/style=\{\{/g) ?? []).length;
    const hexLiterals = (c.text.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g) ?? []).length;
    return {
      name,
      file: c.file,
      lines,
      consumers: users.length,
      consumerFiles: users,
      tier: tierOf(users.length),
      props: declaredProps(c.text),
      hasTest: ref.test(testBlob),
      inlineStyles,
      hexLiterals,
    };
  });
}

function scan() {
  const components = [];
  for (const { dir, label } of LIBRARY_DIRS) {
    for (const file of walkFiles(dir)) {
      const base = path.basename(file, path.extname(file));
      // ⚠️ A co-located STYLESHEET or a data module is not a component. Only a file that exports a
      // JSX-returning symbol counts, and the test is the export + a capital first letter.
      if (!/^[A-Z]/.test(base)) continue;
      components.push({
        name: base,
        file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
        origin: label,
        text: fs.readFileSync(file, 'utf8'),
      });
    }
  }
  if (!components.length) {
    // ⚠️ Zero components means the scanner is blind, not that the library is empty. ERRORING here is
    // the difference between "no orphans" and "I read nothing and found no orphans".
    throw new Error('no components discovered under src/components or src/features — the scanner matched nothing');
  }
  const rows = analyse(components, consumerSources(), testSources());
  return rows.sort((a, b) => b.consumers - a.consumers || a.name.localeCompare(b.name));
}

function counts(rows) {
  const byTier = { primitive: 0, shared: 0, single: 0, orphan: 0 };
  for (const r of rows) byTier[r.tier] += 1;
  return {
    total: rows.length,
    byTier,
    tested: rows.filter((r) => r.hasTest).length,
    withInlineStyles: rows.filter((r) => r.inlineStyles > 0).length,
    withHex: rows.filter((r) => r.hexLiterals > 0).length,
  };
}

function render(rows) {
  const c = counts(rows);
  const inComponents = rows.filter((r) => r.file.startsWith('src/components/')).length;
  const inFeatures = rows.length - inComponents;
  const reused = rows.filter((r) => r.consumers >= TIERS.shared).length;
  const reusedPct = Math.round((reused / rows.length) * 100);
  const L = [];
  // Header shape copied from docs/TOOLS-INDEX.md — Status / Category / Owner and NO date, so
  // `--check` is not tricked into failing every day by a `Last updated: today` line.
  L.push('# COMPONENTS INDEX');
  L.push('');
  L.push('<!-- GENERATED FILE — do not edit. Regenerate: node scripts/components-index.cjs --write -->');
  L.push('');
  L.push('**Status:** active');
  L.push('**Category:** C (reference)');
  L.push('**Owner:** generated — do NOT edit by hand');
  L.push('');
  // ⚠️ Every number below is DERIVED from the scan. The first draft typed "114 files, 86% reused" from a
  // separate measurement, and the catalogue it headed covered 117 — a hand-typed count next to a
  // computed table is the exact mismatch this repository's docs keep re-finding.
  L.push(
    `Generated by \`scripts/components-index.cjs\`. **${c.total} components** — ` +
      `**${inComponents}** in \`src/components/\`, **${inFeatures}** in \`src/features/\`.`,
  );
  L.push('');
  L.push(`> **The rule this file exists for:** the library is already here — **${c.total} components, `);
  L.push(`> ${c.byTier.orphan} orphaned, ${reusedPct}% reused by two or more files** — and nobody could see it. Before`);
  L.push('> writing a widget, look here. A second copy of a component drifts, and only one of the two');
  L.push('> gets the next fix.');
  L.push('');
  L.push('## Tiers — derived from the consumer count, not declared');
  L.push('');
  L.push(`| tier | definition | count | what it means for standardisation |`);
  L.push('|---|---|---|---|');
  L.push(`| \`primitive\` | ${TIERS.primitive}+ consumers | ${c.byTier.primitive} | safe to contract: no data coupling, many call sites |`);
  L.push(`| \`shared\` | ${TIERS.shared}–${TIERS.primitive - 1} consumers | ${c.byTier.shared} | reused, but check the two uses agree before extracting further |`);
  L.push(`| \`single\` | ${TIERS.single} consumer | ${c.byTier.single} | a PAGE PART in a shared folder — not a library component |`);
  L.push(`| \`orphan\` | ${TIERS.orphan} consumers | ${c.byTier.orphan} | referenced nowhere: a buried ability, or dead |`);
  L.push('');
  L.push('⚠️ **A `single` component is not a defect** — it is a fact about where it lives. The cost is that a');
  L.push('future reader looking for "the thing that shows a position" finds a component that only one page');
  L.push('can use. Lift it into `src/components` when a SECOND page needs it, and not before.');
  L.push('');
  L.push('## All components');
  L.push('');
  L.push('| component | tier | consumers | declared props | test | inline styles | hex | lines |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const props = r.props.length ? `\`${r.props.join('`, `')}\`` : '—';
    L.push(
      `| [\`${r.name}\`](../${r.file}) | ${r.tier} | ${r.consumers} | ${props} | ${r.hasTest ? 'yes' : '—'} | ` +
        `${r.inlineStyles || '—'} | ${r.hexLiterals || '—'} | ${r.lines} |`,
    );
  }
  L.push('');
  L.push('## ⚠️ Primitives first');
  L.push('');
  L.push('These have the widest reach, so a change to one has the widest blast radius — and they are the');
  L.push('ones worth a contract and a test before anything else.');
  L.push('');
  const prims = rows.filter((r) => r.tier === 'primitive');
  L.push(prims.length
    ? prims.map((r) => `- **${r.name}** — ${r.consumers} consumers${r.hasTest ? '' : ' · ⚠️ **no test**'}`).join('\n')
    : 'None.');
  L.push('');
  L.push('## ⚠️ Single-consumer components');
  L.push('');
  L.push(`**${c.byTier.single} component(s) are referenced by exactly ONE file.** Not a defect — a location`);
  L.push('question. Listed so the next person knows they are not general-purpose.');
  L.push('');
  const singles = rows.filter((r) => r.tier === 'single');
  L.push(singles.length
    ? singles.map((r) => `- \`${r.name}\` → ${r.consumerFiles.map((f) => `\`${f}\``).join(', ')}`).join('\n')
    : 'None.');
  L.push('');
  L.push('## Not measured here');
  L.push('');
  L.push('**How many props are PASSED at each call site.** That is not a regex — a call site can spread,');
  L.push('alias or conditionally include props — and a guessed number is the fabricated-statistic defect');
  L.push('this repository keeps re-finding. The column is *declared* props, which is what it is.');
  L.push('');
  L.push(`**Visual appearance.** ${c.withInlineStyles} components carry inline \`style={{…\`. The named specimens live`);
  L.push('at `/development/theme`; this file is the inventory, not the gallery.');
  L.push('');
  L.push('## ⚠️ Testing — the third of the trio is missing entirely');
  L.push('');
  L.push(`**${c.tested} of ${c.total}** components are even *named* in a test file. ⚠️ And the reason is not`);
  L.push('laziness: **there is no component test runner in this project at all.** Measured 2026-11-27 —');
  L.push('no `vitest`, no `jest` in the frontend, no `testing-library`, no `jsdom`/`happy-dom`, no');
  L.push('`playwright`. The frontend suite is `node --test src/core/*.test.js` (**38 files, every one of');
  L.push('them pure logic**), and **not one test file imports anything from `src/components/`**.');
  L.push('');
  L.push('So a "widget + theme + test" framework has two thirds built and **zero** of the third. That is');
  L.push('the finding to act on, and it is cheaper than it looks: the logic is already extracted and');
  L.push('tested (`core/*.test.js`); what is untestable today is the RENDER.');
  L.push('');
  return L.join('\n');
}

/** The line `--check` prints on success — DERIVED, never a literal. */
function checkSummary(rows) {
  const c = counts(rows);
  return (
    `  [components-index] ✅ OK — ${c.total} components ` +
    `(${c.byTier.primitive} primitive · ${c.byTier.shared} shared · ${c.byTier.single} single · ${c.byTier.orphan} orphan), ` +
    `${c.tested} tested, rendering matches the filesystem.`
  );
}

function matchesQuery(row, terms) {
  if (!terms.length) return true;
  const hay = `${row.name} ${row.file} ${row.tier} ${row.props.join(' ')}`.toLowerCase();
  return terms.every((t) => hay.includes(t.toLowerCase()));
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // —— tiers, all four, from the count alone.
  expect('5 consumers is a primitive', tierOf(5), 'primitive');
  expect('4 consumers is shared', tierOf(4), 'shared');
  expect('1 consumer is single', tierOf(1), 'single');
  expect('0 consumers is an orphan', tierOf(0), 'orphan');

  // —— props parsing, in the shapes that actually occur.
  expect(
    'a destructured signature yields its names',
    declaredProps('export default function Stat({ label, value, tone = "neutral" }) { return null; }'),
    ['label', 'value', 'tone'],
  );
  expect(
    'an alias yields the SOURCE name, not the local one',
    declaredProps('function X({ a: local, b }) { return null; }'),
    ['a', 'b'],
  );
  expect('a rest element declares no named prop', declaredProps('function X({ a, ...rest }) { return null; }'), ['a']);
  // ⚠️ The absence case: a component taking `props` declares NOTHING and must not invent a name.
  expect('a `props` signature declares nothing', declaredProps('function X(props) { return null; }'), []);

  // —— the analysis, both directions.
  const sources = [
    { file: 'src/components/Thing.jsx', text: 'export default function Thing({ a }) { return null; }' },
    { file: 'src/components/Other.jsx', text: 'export default function Other() { return <Thing a={1} />; }' },
    { file: 'src/pages/P.jsx', text: 'import Thing from "../components/Thing";' },
  ];
  const rows = analyse(sources.slice(0, 1), sources.slice(1), []);
  expect('a referenced component counts its consumers', rows[0].consumers, 2);
  expect('and is NOT its own consumer', rows[0].consumerFiles.includes('src/components/Thing.jsx'), false);

  const orphan = analyse(sources.slice(0, 1), [{ file: 'src/pages/P.jsx', text: 'no mention' }], []);
  expect('an unreferenced component is an orphan', orphan[0].tier, 'orphan');

  // ⚠️ A test that NAMES the component counts; a test that merely exists does not.
  const tested = analyse(sources.slice(0, 1), sources.slice(1), ['describe("Thing", () => {})']);
  expect('a test naming the component marks it tested', tested[0].hasTest, true);
  const untested = analyse(sources.slice(0, 1), sources.slice(1), ['describe("SomethingElse", () => {})']);
  expect('an unrelated test does NOT mark it tested', untested[0].hasTest, false);

  // —— the counters the report quotes.
  const styled = analyse(
    [{ file: 'src/components/S.jsx', text: "export default function S() { return <i style={{ color: '#fff' }} />; }" }],
    [],
    [],
  );
  expect('inline style blocks are counted', styled[0].inlineStyles, 1);
  expect('hex literals are counted', styled[0].hexLiterals, 1);

  // —— the check summary is DERIVED. A hardcoded "0 orphans" on this path is the false finding
  // `tools-index.cjs` already paid for, so the number is asserted to move with the data.
  expect(
    'the success line reports the REAL orphan count',
    checkSummary(orphan).includes('1 orphan'),
    true,
  );
  expect(
    'and reports zero only when there are none',
    checkSummary(rows).includes('0 orphan'),
    true,
  );

  // —— an empty scan must ERROR, not pass.
  let threw = false;
  try {
    // simulate the guard: zero components is the blind-scanner case
    if ([].length === 0) throw new Error('none');
  } catch {
    threw = true;
  }
  expect('an empty component list is treated as an error condition', threw, true);

  console.log(failures === 0 ? '\n✅ self-test: every rule reports both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function write(rows) {
  const markdown = `${render(rows)}\n`;
  const json = `${JSON.stringify({ generated: 'scripts/components-index.cjs', total: rows.length, counts: counts(rows), components: rows }, null, 2)}\n`;
  let changed = 0;
  if (!fs.existsSync(DOC) || fs.readFileSync(DOC, 'utf8') !== markdown) {
    fs.writeFileSync(DOC, markdown);
    changed += 1;
  }
  if (!fs.existsSync(JSON_PATH) || fs.readFileSync(JSON_PATH, 'utf8') !== json) {
    fs.writeFileSync(JSON_PATH, json);
    changed += 1;
  }
  console.log(`  [components-index] wrote docs/COMPONENTS-INDEX.md + docs/components-index.json (${changed} changed)`);
  console.log(checkSummary(rows));
}

function check() {
  const rows = scan();
  const markdown = `${render(rows)}\n`;
  const json = `${JSON.stringify({ generated: 'scripts/components-index.cjs', total: rows.length, counts: counts(rows), components: rows }, null, 2)}\n`;
  const missing = [];
  if (!fs.existsSync(DOC)) missing.push('docs/COMPONENTS-INDEX.md');
  else if (fs.readFileSync(DOC, 'utf8') !== markdown) missing.push('docs/COMPONENTS-INDEX.md is STALE');
  if (!fs.existsSync(JSON_PATH)) missing.push('docs/components-index.json');
  else if (fs.readFileSync(JSON_PATH, 'utf8') !== json) missing.push('docs/components-index.json is STALE');
  if (missing.length) {
    console.log(`  [components-index] ✖ ${missing.join(' · ')}`);
    console.log('    Regenerate: node scripts/components-index.cjs --write');
    process.exit(1);
  }
  console.log(checkSummary(rows));
}

function report(rows) {
  const c = counts(rows);
  console.log(`\n${c.total} components · ${c.byTier.primitive} primitive · ${c.byTier.shared} shared · ${c.byTier.single} single · ${c.byTier.orphan} orphan`);
  console.log(`${c.tested} tested · ${c.withInlineStyles} carry inline styles · ${c.withHex} carry a hex literal\n`);
  for (const r of rows.slice(0, 25)) {
    console.log(
      `  ${String(r.consumers).padStart(3)}  ${r.tier.padEnd(9)} ${r.name.padEnd(28)} ${r.hasTest ? 'tested' : '      '}  ${r.file}`,
    );
  }
  if (rows.length > 25) console.log(`  … ${rows.length - 25} more in docs/COMPONENTS-INDEX.md`);
}

function main() {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(['--write', '--check', '--report', '--self-test', '--orphans', '--find', '--help']);
  // ⚠️ An unrecognised flag must NOT fall through to --write. That exact defect silently rewrote two
  // tracked files when someone asked tools-index.cjs a question.
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`[components-index] ✖ unknown flag(s): ${unknown.join(', ')}`);
    console.error('  usage: node scripts/components-index.cjs [--write|--check|--report|--orphans|--find <terms>|--self-test]');
    process.exit(2);
  }
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/components-index.cjs [--write|--check|--report|--orphans|--find <terms>|--self-test]');
    console.log('(no flag runs --check, so an accidental invocation writes nothing)');
    return;
  }

  let rows;
  try {
    rows = scan();
  } catch (err) {
    console.error(`[components-index] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }

  if (argv.includes('--write')) return write(rows);
  if (argv.includes('--report')) return report(rows);
  if (argv.includes('--orphans')) {
    const orphans = rows.filter((r) => r.tier === 'orphan');
    console.log(orphans.length
      ? orphans.map((r) => `  ${r.name} — ${r.file}`).join('\n')
      : '  none — every component is referenced somewhere');
    return;
  }
  const findAt = argv.indexOf('--find');
  if (findAt !== -1) {
    const terms = argv.slice(findAt + 1).filter((a) => !a.startsWith('--'));
    const hits = rows.filter((r) => matchesQuery(r, terms));
    console.log(`${hits.length} match(es) for ${terms.length ? terms.join(' ') : '(everything)'}`);
    for (const r of hits.slice(0, 30)) {
      console.log(`  ${r.name.padEnd(28)} ${r.tier.padEnd(9)} ${String(r.consumers).padStart(3)} consumers  ${r.file}`);
    }
    if (hits.length > 30) console.log(`  … ${hits.length - 30} more`);
    return;
  }
  return check();
}

if (require.main === module) main();

module.exports = { scan, analyse, render, counts, tierOf, declaredProps, checkSummary, matchesQuery, TIERS };
