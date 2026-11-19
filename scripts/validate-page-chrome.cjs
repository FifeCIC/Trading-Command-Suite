#!/usr/bin/env node
/**
 * validate-page-chrome.cjs — keeps page chrome OUT of pages.
 * =========================================================
 * Requirement (2026-11-18):
 *   "I don't like headers at the top of pages because I'm designing the UI in a manner that reduces
 *    screen clutter… I also don't like the pages primary ℹ being in different places: please ensure
 *    it is on the same location for all pages."
 *
 * Two rules, both about the same idea: a page supplies CONTENT, the shell supplies CHROME.
 *
 *   R1  page-h1            — a page renders its own `<h1>`. The title is the breadcrumb in
 *                            `.main-top-row`; `index.css` hides a page-level h1 because of this rule.
 *                            A heading that carries DATA (a ticker, a bot name) opts in with
 *                            `className="is-subject"` and is not counted.
 *   R2  page-info-popover  — a page renders its own `<PageInfoPopover>`. The ℹ is rendered once, by
 *                            the shell (`src/components/MainTopInfo.jsx`), at the top right of
 *                            `.main-top-row`. A second trigger is a second explanation in a second
 *                            place — measured 2026-11-18: **73 pages** had one.
 *
 * ⚠️ THIS IS A RATCHET, NOT A WALL. Measured when it was written: **131 of 152 pages** render an
 * `<h1>` and **73** render a popover. Failing the build on all of them would stop every agent until a
 * 200-file migration finished, so `scripts/page-chrome-baseline.json` records the current count per
 * file and the gate fails only when a file goes ABOVE its baseline. The baseline **may only go down**
 * — `--update-baseline` refuses to raise a number without `--force-raise`, so "record the regression"
 * cannot become the quiet way to pass.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. `index.css` already declared `.main-stage h1 { display: none }`. It did
 * not work: 34 page stylesheets re-declared `display` on their own `h1`, which matched the same
 * specificity and won on source order. `accounts.module.css` even carried the comment "the page title
 * is hidden app-wide (index.css)" directly above the rule that showed it — both statements looked
 * true, and nothing measured the difference. A design rule with no gate is a preference.
 *
 * Usage:
 *   node scripts/validate-page-chrome.cjs                 # gate (exit 1 on a regression)
 *   node scripts/validate-page-chrome.cjs --report        # every file's counts, baselined or not
 *   node scripts/validate-page-chrome.cjs --update-baseline   # record reductions
 *   node scripts/validate-page-chrome.cjs --self-test     # prove both directions can be observed
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(REPO, 'src', 'pages');
const BASELINE_PATH = path.join(__dirname, 'page-chrome-baseline.json');

/** R1 — `<h1` unless the tag opts out as data (`is-subject`) or as a screen-reader landmark (`sr-only`). */
const H1_RE = /<h1\b[^>]*>/g;

/**
 * Strips comments before counting, because a docblock that QUOTES the pattern is not the pattern.
 *
 * ⚠️ Measured 2026-11-18 on `RegisteredMoversPage.jsx`: the gate reported **3** `h1` where the markup
 * had **1**. The other two were the file's own comment — *"`<h1 className="sr-only">` keeps the
 * accessibility requirement (`Every page MUST have exactly one <h1>`)"*. A rule that punishes
 * documenting itself teaches the next agent to delete the explanation, which is the opposite of what
 * this repo wants. `/^\s*\/\// `-style line comments are stripped too, but a `//` inside a string
 * merely shortens that line for the purposes of counting a tag, which is harmless here.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** R2 — the page-owned info trigger. */
const POPOVER_RE = /<PageInfoPopover\b/g;

/**
 * R3 — a SECTION heading that carries its own ℹ.
 *
 * ⚠️ ADDED 2026-11-19, requirement: *"We still have pages with titles and the information icon
 * beside them which means it's placed in different places across the app."* R2 already forbids a page
 * rendering its own trigger, but it counts every trigger equally, so a `<h2>Title<PageInfoPopover/>`
 * looked the same as a legitimate card-level one. Measured on `/trading212/t212-portfolio` when this
 * was written: two sections had one each — "Account Summary" and "Positions (n)" — and both went.
 *
 * The distinction the rule encodes: the ℹ explains the VIEW, and the wrong place for it is inside a
 * heading, because then its position is decided by that section's markup and its stylesheet.
 */
const HEADING_SPAN_RE = /<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/g;

/**
 * R4 — more than one `PageInfoSlotContent` on a page.
 *
 * ⚠️ ADDED 2026-11-19 because this slot is SINGLE-WINNER: `top-row-slot.jsx` keeps the last children
 * registered, so a second slot does not merge — it silently replaces the first, and the text that
 * disappeared leaves no trace anywhere. A page that needs to say two things puts both in ONE slot.
 * (Deliberately a threshold rather than a count: one is the correct number.)
 */
const SLOT_RE = /<PageInfoSlotContent\b/g;
const MAX_INFO_SLOTS = 1;

const RULES = [
  { id: 'page-h1', what: 'renders its own <h1> — the title is the breadcrumb', match: countH1 },
  { id: 'page-info-popover', what: 'renders its own <PageInfoPopover> — the shell owns the ℹ', match: countPopover },
  { id: 'section-title-info', what: 'puts an ℹ inside a section heading — the ℹ explains the VIEW', match: countHeadingInfo },
  { id: 'multi-info-slot', what: 'renders more than one PageInfoSlotContent — only the last survives', match: countExcessSlots },
];

function countMatches(src, re) {
  return (src.match(re) || []).length;
}

function countH1(src) {
  // `sr-only` is a SCREEN-READER LANDMARK, not visible chrome — the accessibility requirement that a
  // page has exactly one `h1` is satisfied by it, and hiding it visually is the design decision. The
  // rule forbids a VISIBLE page title, so a landmark passes.
  const tags = stripComments(src).match(H1_RE) || [];
  return tags.filter((tag) => !/\bis-subject\b/.test(tag) && !/\bsr-only\b/.test(tag)).length;
}

function countPopover(src) {
  return countMatches(stripComments(src), POPOVER_RE);
}

/** R3 — popovers nested inside an `<h2>`/`<h3>` span. */
function countHeadingInfo(src) {
  const code = stripComments(src);
  let total = 0;
  for (const heading of code.match(HEADING_SPAN_RE) || []) total += countMatches(heading, POPOVER_RE);
  return total;
}

/** R4 — slots beyond the first, which the single-winner slot would discard. */
function countExcessSlots(src) {
  return Math.max(0, countMatches(stripComments(src), SLOT_RE) - MAX_INFO_SLOTS);
}

/** Counts every rule for one file's source. */
function scanSource(src) {
  const out = {};
  for (const rule of RULES) out[rule.id] = rule.match(src);
  return out;
}

/** Scans a directory of `.jsx` files. Returns `{ file: { ruleId: count } }`, zero counts omitted. */
function scanDir(dir) {
  const result = {};
  if (!fs.existsSync(dir)) return result;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsx')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const counts = scanSource(src);
    const nonZero = {};
    for (const [k, v] of Object.entries(counts)) if (v > 0) nonZero[k] = v;
    if (Object.keys(nonZero).length) result[name] = nonZero;
  }
  return result;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    // ⚠️ An unreadable baseline must not pass. Returning {} would read every count as new and fail
    // loudly — which is the safe direction here, so say so rather than crash.
    console.error('[page-chrome] baseline is unreadable — treating every count as new');
    return {};
  }
}

/**
 * Compares a scan against a baseline.
 * Returns { regressions: [...], reductions: [...], stale: [...] }.
 */
function compare(scan, baseline) {
  const regressions = [];
  const reductions = [];
  for (const [file, counts] of Object.entries(scan)) {
    for (const [ruleId, count] of Object.entries(counts)) {
      const allowed = baseline[file]?.[ruleId] ?? 0;
      if (count > allowed) regressions.push({ file, ruleId, count, allowed });
      else if (count < allowed) reductions.push({ file, ruleId, count, allowed });
    }
  }
  const stale = [];
  for (const [file, counts] of Object.entries(baseline)) {
    for (const [ruleId, allowed] of Object.entries(counts)) {
      if (!scan[file]?.[ruleId]) stale.push({ file, ruleId, allowed });
    }
  }
  return { regressions, reductions, stale };
}

// ── Modes ────────────────────────────────────────────────────────────────────────────────────────

function report() {
  const scan = scanDir(PAGES_DIR);
  const baseline = loadBaseline();
  const rows = Object.entries(scan).sort(
    (a, b) => (b[1]['page-h1'] ?? 0) - (a[1]['page-h1'] ?? 0) || a[0].localeCompare(b[0]),
  );
  console.log(`[page-chrome] ${rows.length} page(s) carry page chrome that the shell should own\n`);
  for (const [file, counts] of rows) {
    const parts = Object.entries(counts).map(([ruleId, n]) => {
      const allowed = baseline[file]?.[ruleId] ?? 0;
      return `${ruleId}=${n}${allowed ? ` (baselined ${allowed})` : ''}`;
    });
    console.log(`  ${file.padEnd(42)} ${parts.join(' · ')}`);
  }
  return 0;
}

function gate() {
  const scan = scanDir(PAGES_DIR);
  const baseline = loadBaseline();
  const { regressions, reductions, stale } = compare(scan, baseline);

  if (regressions.length) {
    console.error(`[page-chrome] ✖ ${regressions.length} regression(s) — page chrome belongs to the shell:\n`);
    for (const r of regressions) {
      const rule = RULES.find((x) => x.id === r.ruleId);
      console.error(`    ${r.file} ${rule.what}`);
      console.error(`      count ${r.count}, baseline allows ${r.allowed}`);
    }
    console.error(
      '\n  Page title  → the breadcrumb in `.main-top-row` (never an <h1> in a page; a heading that\n' +
        '                carries DATA takes className="is-subject").\n' +
        '  Page info ℹ → the shell renders it once, top right of `.main-top-row`. A page contributes\n' +
        '                text via VIEW_EXPLANATIONS and live figures via <PageInfoSlotContent>.\n',
    );
    return 1;
  }

  const total = Object.values(scan).reduce(
    (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(
    `[page-chrome] ✅ no new page chrome — ${total} baselined finding(s) still to migrate ` +
      `(the baseline may only go down)`,
  );
  if (reductions.length || stale.length) {
    console.log(
      `  ${reductions.length + stale.length} file(s) improved — record it: ` +
        'node scripts/validate-page-chrome.cjs --update-baseline',
    );
  }
  return 0;
}

function updateBaseline(allowRaise) {
  const scan = scanDir(PAGES_DIR);
  const baseline = loadBaseline();
  const seeded = Object.keys(baseline).length === 0;
  const { regressions } = compare(scan, baseline);

  // ⚠️ A FIRST SEED IS NOT A RAISE. With no baseline there is nothing to ratchet from, so recording
  // every current finding is the only way to start. Every later run is a ratchet and refuses to go up.
  if (regressions.length && !allowRaise && !seeded) {
    console.error(
      `[page-chrome] ✖ refusing to raise the baseline for ${regressions.length} file(s).\n` +
        '  The baseline is a RATCHET: fix the page, or pass --force-raise and say why in the commit.',
    );
    for (const r of regressions) console.error(`    ${r.file} ${r.ruleId}: ${r.allowed} → ${r.count}`);
    return 1;
  }

  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(scan, null, 2)}\n`);
  const total = Object.values(scan).reduce(
    (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(
    `[page-chrome] baseline ${seeded ? 'SEEDED' : 'updated'}: ${Object.keys(scan).length} file(s), ` +
      `${total} finding(s) recorded — this number may only go down`,
  );
  return 0;
}

function selfTest() {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-chrome-'));
  let failures = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (got ${JSON.stringify(actual)})`);
    if (!ok) failures += 1;
  };

  // Fixture A — a page that violates both rules.
  fs.writeFileSync(
    path.join(dir, 'BadPage.jsx'),
    'export default function Bad() { return (<div><h1>Bad</h1><PageInfoPopover>x</PageInfoPopover></div>); }\n',
  );
  // Fixture B — a data heading that opts out, and no popover.
  fs.writeFileSync(
    path.join(dir, 'GoodPage.jsx'),
    'export default function Good() { return (<div><h1 className="is-subject">{ticker}</h1></div>); }\n',
  );
  // Fixture C — a page title heading whose CLASS is not the opt-out.
  fs.writeFileSync(
    path.join(dir, 'ClassedPage.jsx'),
    'export default function Classed() { return (<div><h1 className="header-title">Brokers</h1></div>); }\n',
  );

  // Fixture D — a docblock that QUOTES the pattern must not be counted.
  fs.writeFileSync(
    path.join(dir, 'DocumentedPage.jsx'),
    '/** The rule says: never write `<h1>Title</h1>` in a page. */\nexport default function D() { return (<div><h1 className="sr-only">Hidden landmark</h1></div>); }\n',
  );

  const scan = scanDir(dir);
  check('R1 counts a page title', scan['BadPage.jsx'], { 'page-h1': 1, 'page-info-popover': 1 });
  check('R1 skips is-subject data heading', scan['GoodPage.jsx'], undefined);
  check('R1 counts a classed page title', scan['ClassedPage.jsx'], { 'page-h1': 1 });
  check('R1 skips sr-only landmark and ignores comment mentions', scan['DocumentedPage.jsx'], undefined);

  // Fixture E — a SECTION heading carrying its own ℹ (R3). The same popover is counted by R2 as well,
  // deliberately: "a page renders a trigger" and "the trigger is inside a heading" are different facts.
  fs.writeFileSync(
    path.join(dir, 'SectionInfoPage.jsx'),
    'export default function E() { return (<div><section><h2>Positions<PageInfoPopover>x</PageInfoPopover></h2></section></div>); }\n',
  );
  // Fixture F — a card-level popover NOT in a heading is R2 only, so R3 must stay 0.
  fs.writeFileSync(
    path.join(dir, 'CardInfoPage.jsx'),
    'export default function F() { return (<div><h2>Positions</h2><PageInfoPopover>x</PageInfoPopover></div>); }\n',
  );
  // Fixture G — two slots, only one of which survives.
  fs.writeFileSync(
    path.join(dir, 'TwoSlotsPage.jsx'),
    'export default function G() { return (<div><PageInfoSlotContent>a</PageInfoSlotContent><PageInfoSlotContent>b</PageInfoSlotContent></div>); }\n',
  );

  const scan2 = scanDir(dir);
  check('R3 counts an ℹ inside a section heading', scan2['SectionInfoPage.jsx']?.['section-title-info'], 1);
  check('R3 ignores an ℹ beside a heading', scan2['CardInfoPage.jsx']?.['section-title-info'], undefined);
  check('R4 counts the excess slot', scan2['TwoSlotsPage.jsx']?.['multi-info-slot'], 1);

  // Baseline behaviour: an allowed count passes, one above it fails.
  const baseline = {
    'BadPage.jsx': { 'page-h1': 1, 'page-info-popover': 1 },
    'ClassedPage.jsx': { 'page-h1': 1 },
  };
  check('compare: at baseline = no regression', compare(scan, baseline).regressions.length, 0);
  check('compare: above baseline = regression', compare(scan, {}).regressions.length, 3);
  // A file that fixes ONE of two findings: a reduction for the one that remains non-zero.
  check(
    'compare: partial fix = reduction',
    compare({ 'BadPage.jsx': { 'page-h1': 0, 'page-info-popover': 1 } }, baseline).reductions.length,
    1,
  );
  // A file that fixes its LAST finding: the count drops out of the scan entirely, so it is 'stale'
  // rather than 'reduced'. Both mean "improved", and gate() must report both or the baseline keeps
  // an allowance for a page that no longer needs one.
  check(
    'compare: complete fix = stale entry',
    compare({ 'ClassedPage.jsx': {} }, baseline).stale.length,
    3, // every baseline entry has no live count left: 2 for BadPage + 1 for ClassedPage
  );

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n[page-chrome] self-test FAILED (${failures})` : '\n[page-chrome] self-test passed');
  return failures ? 1 : 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────────────────────────

function main(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has('--self-test')) return selfTest();
  if (flags.has('--report')) return report();
  if (flags.has('--update-baseline')) return updateBaseline(flags.has('--force-raise'));
  if (flags.has('--help')) {
    console.log('usage: validate-page-chrome.cjs [--report|--update-baseline [--force-raise]|--self-test]');
    return 0;
  }
  const unknown = [...flags].filter((f) => !['--report', '--update-baseline', '--force-raise', '--self-test', '--help'].includes(f));
  if (unknown.length) {
    console.error(`[page-chrome] unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  return gate();
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scanSource, scanDir, compare, countH1, countPopover };
