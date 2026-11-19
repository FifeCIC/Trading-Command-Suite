#!/usr/bin/env node
/**
 * validate-table-enrolment.cjs — every table in the app uses the ONE arrangement.
 * ==============================================================================
 * `src/core/tables.css` opens with: *"ONE ARRANGEMENT, APPLIED TO EVERY TABLE CLASS IN THE APP."*
 * It lists 60+ family classes, and that file is the design standard the requirement keeps pointing at:
 *
 *   *"The table on the page … is terrible. Columns aren't under their headers, the styling doesn't
 *    match the tables we have already opted as suitable designs … There are lots of good styles
 *    already in the plugin for re-using and agentic AI seems to come up with a slightly different set
 *    of styles per page."*
 *
 * ── WHY THIS GATE EXISTS ────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-18: **16 table classes were rendered by pages and enrolled in nothing** — they
 * inherited the browser default, so those views sat outside the theme entirely and nobody noticed,
 * because a plain table still looks like a table. A file can be styled, compiling and "nearly right"
 * while ignoring every design decision the app has made.
 *
 * ⚠️ IT IS A HARD WALL, NOT A RATCHET, BECAUSE THE COUNT IS ZERO. All 67 used classes are enrolled
 * (2026-11-18), so there is no legacy to grandfather. A new table either joins the arrangement or the
 * build stops — which is the only version of this rule that survives the next page.
 *
 * ⚠️ A `-table` class that is styled ONLY inside its own page stylesheet is exactly the defect this
 * looks for: it means the page re-invented padding, borders and header treatment rather than using
 * the shared ones. If a table genuinely needs a bespoke look, add its class to the canonical list and
 * put only its SPECIFIC rules in the page sheet (colour, mono figures, width of one column).
 *
 * Usage:
 *   node scripts/validate-table-enrolment.cjs              # gate
 *   node scripts/validate-table-enrolment.cjs --report      # every class, enrolled or not
 *   node scripts/validate-table-enrolment.cjs --self-test
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const TABLES_CSS = path.join(REPO, 'src', 'core', 'tables.css');
const SCAN_DIRS = [path.join(REPO, 'src', 'pages'), path.join(REPO, 'src', 'components')];

/** Table family classes: `mm-table`, `tj-eq-table`, `bs-table` … */
const CLASS_RE = /\b([a-z0-9]+(?:-[a-z0-9]+)*-table)\b/g;

/** Every class enrolled in the canonical list, from the selector lines of tables.css. */
function enrolledClasses(css) {
  const set = new Set();
  for (const m of css.matchAll(/\.([a-z0-9-]+-table)\b/g)) set.add(m[1]);
  return set;
}

/**
 * `{ className: [files…] }` for table classes referenced on a real `<table>` element.
 *
 * ⚠️ ONLY `<table>` TAGS COUNT (2026-11-18). The first version matched any `className` containing a
 * `…-table` string and flagged `ls-table` — which is a LOADING SKELETON built from `<div>`s
 * (`LoadingSkeleton.jsx`: `<div className="ls-table" role="status">`). Enrolling that in the table
 * arrangement would have applied table borders and padding to a placeholder. "A table must use the
 * arrangement" is a rule about `<table>`; the shape of a class NAME is not evidence of what it is.
 *
 * CSS-module classes (`className={styles.foo}`) are deliberately NOT matched: they hash, so they are
 * not part of the global family list and cannot be enrolled.
 */
function usedClasses(files) {
  const used = {};
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Grab each <table …> opening tag, allowing attributes across lines.
    for (const tag of src.matchAll(/<table\b[^>]*>/gis)) {
      const opening = tag[0];
      const attr = opening.match(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/i);
      const text = attr ? attr[1] ?? attr[2] ?? '' : '';
      for (const m of text.matchAll(CLASS_RE)) {
        const cls = m[1];
        (used[cls] ??= new Set()).add(path.relative(REPO, file).replace(/\\/g, '/'));
      }
    }
  }
  return used;
}

function jsxFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx|tsx|js|ts)$/.test(e.name)) out.push(p);
    }
  };
  SCAN_DIRS.forEach(walk);
  return out;
}

/** Pure comparison, so the self-test can exercise it without the filesystem. */
function analyse(used, enrolled) {
  const missing = [];
  for (const [cls, files] of Object.entries(used)) {
    if (!enrolled.has(cls)) missing.push({ cls, files: [...files] });
  }
  return missing.sort((a, b) => a.cls.localeCompare(b.cls));
}

function report() {
  const enrolled = enrolledClasses(fs.readFileSync(TABLES_CSS, 'utf8'));
  const used = usedClasses(jsxFiles());
  const missing = analyse(used, enrolled);
  console.log(`[table-enrolment] ${Object.keys(used).length} table class(es) used · ${enrolled.size} enrolled\n`);
  for (const cls of Object.keys(used).sort()) {
    const mark = enrolled.has(cls) ? 'ok  ' : 'MISS';
    console.log(`  ${mark}  ${cls.padEnd(24)} ${[...used[cls]].join(', ')}`);
  }
  console.log(`\n  ${missing.length} not enrolled`);
  return 0;
}

function gate() {
  const enrolled = enrolledClasses(fs.readFileSync(TABLES_CSS, 'utf8'));
  const used = usedClasses(jsxFiles());
  const missing = analyse(used, enrolled);

  if (missing.length) {
    console.error(`[table-enrolment] ✖ ${missing.length} table class(es) are NOT in the canonical arrangement:\n`);
    for (const m of missing) console.error(`    .${m.cls}  ← ${m.files.join(', ')}`);
    console.error(
      '\n  A table rendered with a class that `src/core/tables.css` does not list inherits the BROWSER\n' +
        '  default — it is outside the theme and nothing reports it, because a plain table still looks\n' +
        '  like a table. Fix by adding the class to every selector group in tables.css, and move any\n' +
        '  page-local padding/border/header rules out of the page stylesheet.\n',
    );
    return 1;
  }

  console.log(`[table-enrolment] ✅ all ${Object.keys(used).length} table class(es) use the canonical arrangement`);
  return 0;
}

function selfTest() {
  let f = 0;
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (got ${JSON.stringify(actual)})`);
    if (!ok) f += 1;
  };

  const enrolled = enrolledClasses('.brk-table,\n.mm-table th,\n.sl-table td.num,');
  t('reads enrolled classes from selector lines', [...enrolled].sort(), ['brk-table', 'mm-table', 'sl-table']);

  const fakeUsed = {
    'brk-table': new Set(['a.jsx']),
    'made-up-table': new Set(['b.jsx']),
  };
  const missing = analyse(fakeUsed, enrolled);
  t('flags a class that is not enrolled', missing.map((m) => m.cls), ['made-up-table']);
  t('does not flag an enrolled class', missing.some((m) => m.cls === 'brk-table'), false);

  console.log(f ? `\n[table-enrolment] self-test FAILED (${f})` : '\n[table-enrolment] self-test passed');
  return f ? 1 : 0;
}

function main(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has('--self-test')) return selfTest();
  if (flags.has('--report')) return report();
  if (flags.has('--help')) {
    console.log('usage: validate-table-enrolment.cjs [--report|--self-test]');
    return 0;
  }
  const unknown = [...flags].filter((x) => !['--report', '--self-test', '--help'].includes(x));
  if (unknown.length) {
    console.error(`[table-enrolment] unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  return gate();
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { enrolledClasses, usedClasses, analyse };
