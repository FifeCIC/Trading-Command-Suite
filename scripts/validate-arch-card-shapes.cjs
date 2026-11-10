/**
 * validate-arch-card-shapes.cjs — a `*_CARDS` export must contain CARD OBJECTS, not prose.
 *
 * ⚠️ WHY THIS EXISTS (measured 2026-11-08, issue #1253). Three bare strings were appended to
 * `CONTRACT_CARDS` in `src/pages/architecture-framework.data.js`. Nothing failed: `vite build` was
 * green, `tsc` was green, and the repo's own architecture validator was green — because a JavaScript
 * array happily holds a string. The failure only appeared at RUNTIME, in the browser:
 *
 *     TypeError: item.items is not iterable
 *        at architecture-framework.data.js:2085  (CONTRACT_CARDS.flatMap(item => [...item.items]))
 *
 * …which replaced the entire app with "App Failed to Load". One prose append took down every page,
 * because the module is imported by the shell.
 *
 * A `*_CARDS` array is consumed in two ways that both require the object shape:
 *   • `<CardGrid cards={X} />`               — renders `title`, `summary`, `items`
 *   • `X.flatMap(item => [...item.items])`   — builds the section's search terms
 *
 * ⚠️ STATIC PARSE, NOT AN IMPORT. Importing the data module pulls in `architecture-route-contracts`
 * and two `.ts`-adjacent modules, so a validator that imported it would fail for reasons that have
 * nothing to do with shapes. The file is read as text and its top-level array entries are walked.
 *
 *   node scripts/validate-arch-card-shapes.cjs             # the gate
 *   node scripts/validate-arch-card-shapes.cjs --report    # what it saw, always exit 0
 *   node scripts/validate-arch-card-shapes.cjs --self-test # prove it can fail
 *
 * ⚠️ IT CANNOT PASS BY INSPECTING NOTHING. Zero `*_CARDS` exports found is exit 1, not OK — the
 * file may have been renamed, and "I checked nothing" must never read as a pass.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'src/pages/architecture-framework.data.js');

/** Fields `CardGrid` and the search-term flatMap both need on every entry. */
const REQUIRED_KEYS = ['title', 'summary', 'items'];

/**
 * Walk the INSIDE of a `[ … ]` block and return its top-level entries as raw text.
 *
 * ⚠️ SPLIT AT DEPTH 0, and the caller passes the block WITHOUT its outer brackets. Then an entry's
 * own `{` takes depth to 1, its internal commas stay at depth 1 (no split), its closing `}` returns
 * to 0, and the comma that separates two entries is the only one seen at depth 0. Getting this
 * convention wrong is not cosmetic: the first version split at depth 1 and chopped every card into
 * its own properties, reporting eight false positives in a file that was already correct.
 *
 * Tracks string literals (`, " and backticks) so a brace inside prose cannot unbalance the scan —
 * which matters, because the entries this guard exists to catch are long sentences.
 */
function topLevelEntries(block) {
  const entries = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    const prev = block[i - 1];

    if (quote) {
      current += c;
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    if (c === '}' || c === ']' || c === ')') depth--;

    if (c === ',' && depth === 0) {
      if (current.trim()) entries.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) entries.push(current.trim());
  return entries.filter((e) => e.length > 0);
}

/** Every `export const X_CARDS = [ … ];` block in the source, with its entries. */
function extractCardArrays(source) {
  const out = [];
  const re = /export const ([A-Z0-9_]+_CARDS)\s*=\s*\[/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length - 1; // at the '['
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      const prev = source[i - 1];
      if (quote) {
        if (c === quote && prev !== '\\') quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) continue;
    out.push({ name, block: source.slice(start, end + 1) });
  }
  return out;
}

/** Which entries in one cards array are not card objects? Returns human-readable problems. */
function checkEntries(name, block) {
  const problems = [];
  // ⚠️ KEEP THE OUTER BRACKETS. Stripping them puts each entry's own `{` at depth 1, where its
  // INTERNAL commas also sit — so the splitter chopped every card into its own properties, and the
  // first self-test run reported eight false positives in a file that was correct.
  const entries = topLevelEntries(block.slice(1, -1)); // drop the outer [ ]
  entries.forEach((entry, i) => {
    const where = `${name}[${i}]`;
    if (!entry.startsWith('{')) {
      const preview = entry.replace(/\s+/g, ' ').slice(0, 70);
      problems.push(`${where} is NOT an object — it starts with "${preview}…"`);
      return;
    }
    for (const key of REQUIRED_KEYS) {
      // A key at the entry's own top level, not one nested in a child object.
      if (!new RegExp(`(^|[{,\\s])${key}\\s*:`).test(entry)) {
        problems.push(`${where} has no \`${key}\``);
      }
    }
  });
  return { problems, count: entries.length };
}

function run(source, { report = false } = {}) {
  const arrays = extractCardArrays(source);
  if (!arrays.length) {
    return { ok: false, arrays: 0, problems: ['no `export const *_CARDS = [` block found — nothing was inspected'] };
  }
  const problems = [];
  let total = 0;
  for (const { name, block } of arrays) {
    const r = checkEntries(name, block);
    total += r.count;
    problems.push(...r.problems);
    if (report) console.log(`  ${name}: ${r.count} entr(ies)`);
  }
  return { ok: problems.length === 0, arrays: arrays.length, entries: total, problems };
}

function selfTest() {
  const cases = [
    ['a well-formed card array passes', "export const A_CARDS = [\n  { title: 't', summary: 's', items: ['a'] },\n];", true],
    ['a bare string entry fails (the #1253 shape)', "export const A_CARDS = [\n  { title: 't', summary: 's', items: ['a'] },\n  'prose appended by hand',\n];", false],
    ['an entry missing items fails', "export const A_CARDS = [\n  { title: 't', summary: 's' },\n];", false],
    ['an entry missing title fails', "export const A_CARDS = [\n  { summary: 's', items: [] },\n];", false],
    ['an empty array passes (no entries to get wrong)', 'export const A_CARDS = [];', true],
    // ⚠️ The one that matters for false negatives: a brace INSIDE prose must not unbalance the scan.
    ['prose containing braces still reads as a non-object', "export const A_CARDS = [\n  'a sentence with { braces } and [brackets]',\n];", false],
    ['a nested items array does not confuse the walker', "export const A_CARDS = [\n  { title: 't', summary: 's', items: ['x', 'y'] },\n  { title: 'u', summary: 'v', items: [] },\n];", true],
  ];

  let failures = 0;
  for (const [label, src, expectOk] of cases) {
    const r = run(src);
    const ok = r.ok === expectOk;
    if (!ok) failures++;
    console.log(`  ${ok ? '✔' : '✖'} ${label} — expected ok=${expectOk}, got ${r.ok}`);
  }

  // ⚠️ A file with NO cards block must be a FAILURE, not a pass. A guard that inspects nothing and
  // reports OK is worse than no guard — it converts "cannot judge" into "fine".
  const nothing = run('export const somethingElse = 1;');
  const nothingOk = nothing.ok === false && nothing.problems.length === 1;
  if (!nothingOk) failures++;
  console.log(`  ${nothingOk ? '✔' : '✖'} a file with no *_CARDS block FAILS rather than passing silently`);

  console.log(failures === 0 ? '\n✅ self-test passed' : `\n❌ ${failures} self-test case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  if (!fs.existsSync(TARGET)) {
    console.error(`❌ INV-ARCH-CARD-SHAPES — ${path.relative(ROOT, TARGET)} does not exist; nothing was inspected.`);
    process.exit(2); // cannot judge, never a pass
  }

  const source = fs.readFileSync(TARGET, 'utf8');
  const report = args.includes('--report');
  const r = run(source, { report });

  if (r.problems.length) {
    console.error('❌ INV-ARCH-CARD-SHAPES — a `*_CARDS` export must contain card objects:\n');
    for (const p of r.problems) console.error(`   ${p}`);
    console.error(
      '\n   `*_CARDS` is consumed by <CardGrid> and by a `flatMap(item => [...item.items])` search-term\n' +
        '   builder. A bare string in that array is a RUNTIME crash (`item.items is not iterable`) that\n' +
        '   replaces the whole app with "App Failed to Load" — and `vite build` stays green.\n' +
        '   Prose belongs in its own array. Measured 2026-11-08, #1253.',
    );
    process.exit(1);
  }

  if (report) {
    console.log(`\n✅ ${r.arrays} \`*_CARDS\` array(s), ${r.entries} entr(ies), all card-shaped`);
    process.exit(0);
  }
  console.log(`✅ INV-ARCH-CARD-SHAPES — ${r.arrays} array(s), ${r.entries} entr(ies), all card-shaped`);
}

main();
