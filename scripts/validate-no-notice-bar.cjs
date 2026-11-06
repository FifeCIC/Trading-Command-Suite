#!/usr/bin/env node
/**
 * validate-no-notice-bar — the owner has asked REPEATEDLY for the thick coloured left-hand bar to be
 * removed from notice / callout / status surfaces (last: 2026-11-06, *"remove all existence of the
 * notice styling that has the left side border thicker and coloured"*).
 *
 * Each time, one instance was fixed and the style came back somewhere else — because a rule that is
 * only fixed by hand is indistinguishable from a rule that was never touched. This is the guard: any
 * NEW `border-left` / `border-inline-start` of 3px or more fails the build, so the style cannot be
 * re-introduced by accident.
 *
 * WHY 3px AND NOT "any left border": a 1px left edge is part of the ordinary table/card vocabulary and
 * is used everywhere. The owner's objection is to the BAR — a left edge drawn heavier than the other
 * three sides.
 *
 * DELIBERATE EXCEPTIONS live in `scripts/notice-bar-allowlist.json`, each with a reason. The list is
 * for the exceptions that are genuinely NOT notice chrome; adding to it to silence a real failure is
 * the same defect as allowlisting any other guard.
 *
 * Skips automatically:
 *   - CSS triangles (`width: 0` + a transparent top/bottom border) — the breadcrumb chevron is drawn
 *     this way and has nothing to do with notices
 *   - pseudo-elements (::before / ::after), same reason
 *
 * Usage:
 *   node scripts/validate-no-notice-bar.cjs             # gate: exit 1 on any finding
 *   node scripts/validate-no-notice-bar.cjs --report    # exit 0, print findings
 *   node scripts/validate-no-notice-bar.cjs --self-test # prove it can fail in both directions
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ALLOWLIST_FILE = path.join(__dirname, 'notice-bar-allowlist.json');
const MIN_PX = 3;

/** Rules that are not notice chrome. `match` is a RegExp source tested against the selector. */
const DEFAULTS = [
  {
    match: '\\.pm-pos-card\\.pm-win',
    reason: 'Position card WIN state. A keep/stop-loss edge is not notice chrome — it is the position\'s outcome, and the pair is symmetric.',
  },
  {
    match: '\\.pm-pos-card\\.pm-lose',
    reason: 'Position card LOSE state. Symmetric with pm-win above; removing one of the pair would make a losing card look identical to a winning one.',
  },
];

function loadAllowlist() {
  const extra = [];
  if (fs.existsSync(ALLOWLIST_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
      if (Array.isArray(parsed.exceptions)) extra.push(...parsed.exceptions);
    } catch (err) {
      console.error(`✖ ${path.relative(ROOT, ALLOWLIST_FILE)} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }
  return [...DEFAULTS, ...extra];
}

function cssFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(p, out);
    else if (entry.name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Blank out comments while preserving offsets, so line numbers stay correct. */
function maskComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Returns every offending rule. `source` lets the self-test run the same logic over synthetic CSS
 * instead of requiring a real file to be broken.
 */
function scan(source, { allow = [] } = {}) {
  const masked = maskComments(source);
  const findings = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(masked))) {
    const selector = m[1].split('\n').pop().trim().replace(/\s+/g, ' ');
    const body = masked.slice(m.index + m[0].indexOf('{') + 1, m.index + m[0].length - 1);
    const rawBody = source.slice(m.index + m[0].indexOf('{') + 1, m.index + m[0].length - 1);
    if (!selector || selector.startsWith('@')) continue;
    if (/::?(before|after)/.test(selector)) continue;

    const isTriangle = /(^|;)\s*width\s*:\s*0(px)?\s*;/.test(rawBody)
      || (/border-top\s*:[^;]*transparent/.test(rawBody) && /border-bottom\s*:[^;]*transparent/.test(rawBody));
    if (isTriangle) continue;

    const decl = /border-(?:left|inline-start)\s*:\s*(\d+)px[^;]*;/.exec(rawBody);
    if (!decl) continue;
    if (parseInt(decl[1], 10) < MIN_PX) continue;

    if (allow.some((a) => new RegExp(a.match).test(selector))) continue;

    findings.push({ selector, line: lineOf(masked, m.index), decl: decl[0].trim() });
  }
  return findings;
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [];
  const ok = (name, cond) => cases.push({ name, pass: !!cond });

  const offending = `.a-notice { padding: 4px; border-left: 3px solid var(--danger); }`;
  ok('a 3px coloured left bar is FOUND', scan(offending).length === 1);

  const onePx = `.a-card { padding: 4px; border-left: 1px solid var(--line); }`;
  ok('a 1px left edge is NOT flagged', scan(onePx).length === 0);

  const rule = `.a-card { border: 1px solid var(--line); border-left: 4px solid var(--accent); }`;
  ok('a 4px bar beside a full border is FOUND', scan(rule).length === 1);

  const triangle = `.crumb::after { width: 0; height: 0; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 7px solid var(--line); }`;
  ok('a CSS triangle is NOT flagged', scan(triangle).length === 0);

  const allowed = `.pm-pos-card.pm-win { border-left: 3px solid var(--color-profit); }`;
  ok('an allowlisted positional edge is NOT flagged', scan(allowed, { allow: DEFAULTS }).length === 0);

  const inlineStart = `.a-notice { border-inline-start: 3px solid red; }`;
  ok('border-inline-start is FOUND', scan(inlineStart).length === 1);

  const commented = `/* border-left: 3px solid red; */ .ok { padding: 2px; }`;
  ok('a bar inside a comment is NOT flagged', scan(commented).length === 0);

  const failed = cases.filter((c) => !c.pass);
  for (const c of cases) console.log(`  ${c.pass ? '✔' : '✖'} ${c.name}`);
  if (failed.length) {
    console.error(`\n✖ self-test FAILED (${failed.length} of ${cases.length} cases)`);
    process.exit(1);
  }
  console.log(`\n✔ self-test passed — ${cases.length} cases, both directions covered`);
  process.exit(0);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) selfTest();

const reportOnly = process.argv.includes('--report');
const allow = loadAllowlist();
const all = [];
for (const file of cssFiles(SRC)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const f of scan(source, { allow })) all.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), ...f });
}

if (!all.length) {
  console.log('✔ no thick coloured left bars in src/**/*.css');
  process.exit(0);
}

for (const f of all) console.log(`  ${f.file}:${f.line}  ${f.selector}  —  ${f.decl}`);
const noun = all.length === 1 ? 'rule' : 'rules';
if (reportOnly) {
  console.log(`\n⚠ ${all.length} ${noun} carry a thick left bar (report only)`);
  process.exit(0);
}
console.error(`\n✖ ${all.length} ${noun} carry a thick coloured left bar.`);
console.error('  The owner has asked for this styling to be removed everywhere. Replace it with a');
console.error('  uniform 1px border plus a background tint, or add an entry with a reason to');
console.error('  scripts/notice-bar-allowlist.json if it is genuinely NOT notice chrome.');
process.exit(1);
