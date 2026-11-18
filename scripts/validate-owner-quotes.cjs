#!/usr/bin/env node
/**
 * validate-owner-quotes.cjs — keeps private conversation out of a PUBLIC repository.
 * =================================================================================
 * Owner, 2026-11-18: *"Do other developers allow their conversation and quotes to be published?
 * I'm not keen on it."*
 *
 * They do not, and it is not a close call. Publishing verbatim conversation is a transcript; what a
 * public repository should carry is the RATIONALE. "Check the broker — rate not verified here" is a
 * fact about the product. "Owner: *«check the broker…»*" is a private message with a date on it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 * A tracked file in this repository must not contain a QUOTED OWNER MESSAGE — the `Owner, <date>:
 * *"…"*` form, or `owner: '"…"'` in data. Attribution without quotation is fine and encouraged:
 *
 *   ✅ "Decided 2026-11-18: the two are separate strategies."       (rationale)
 *   ✅ "From the Page Walkthrough: this table was scored 7/10."     (finding)
 *   ❌ Owner, 2026-11-18: *"one for shorting and one for going long"*   (transcript)
 *
 * ── WHY A RATCHET AND NOT A WALL ────────────────────────────────────────────────────────────────
 * Measured before this gate existed: **793 occurrences across 174 tracked files** — 345 alone in
 * `src/core/architecture-route-contracts.js`, 41 in `docs/SETTLED-DECISIONS.md`, 30 in
 * `src/data/ui-patterns.js`. Failing the build on all of them would block every agent until a
 * 174-file rewrite finished. So `scripts/owner-quotes-baseline.json` records the current count per
 * file and the gate fails only when a file goes ABOVE it. The baseline **may only go down**.
 *
 * ⚠️ REMOVAL IS NOT ALWAYS PURE DELETION. In `ui-patterns.js` the `owner` field documents why a
 * pattern was approved; blanking it loses the justification. The correct edit keeps the reasoning and
 * drops the quotation. In `docs/SETTLED-DECISIONS.md` the quotes are decision provenance — same
 * treatment. Only a human should judge that, so this gate never rewrites anything.
 *
 * ⚠️ ONLY TRACKED FILES COUNT. `.github/{instructions,agents,skills,prompts}/` and `logs/` are
 * gitignored and are where working method and transcripts legitimately live — they are not published,
 * so quoting there is not a leak. This gate reads `git ls-files`, so it judges exactly what a stranger
 * can read.
 *
 * Usage:
 *   node scripts/validate-owner-quotes.cjs                 # gate
 *   node scripts/validate-owner-quotes.cjs --report        # every file's count
 *   node scripts/validate-owner-quotes.cjs --update-baseline   # record reductions (never raises)
 *   node scripts/validate-owner-quotes.cjs --self-test
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'owner-quotes-baseline.json');
const TEXT_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|css|md|json|yml|yaml)$/;

/**
 * What counts as a quoted owner message.
 *
 * ⚠️ `attribution` ALONE IS NOT A HIT. "Owner, 2026-11-18" followed by prose is a decision record;
 * the leak is the QUOTATION MARK, because that is the part that reproduces a private message.
 */
const PATTERNS = [
  // Owner, 2026-11-18: *"…"*  /  Owner (2026-11-18) "…"
  { id: 'owner-quote', re: /Owner\s*[,:]?\s*\(?\d{4}-\d{2}-\d{2}\)?\s*:?\s*\*?["'“]/gi },
  // owner: '"…"' — the data field used by src/data/ui-patterns.js
  { id: 'owner-field-quote', re: /\bowner:\s*['"]\s*['"“]/gi },
  // owner said "…" / owner asked "…"
  { id: 'owner-said', re: /owner\s+(?:said|asked|wrote|replied)\s*[,:]?\s*["'“]/gi },
];

function countQuotes(src) {
  let n = 0;
  for (const p of PATTERNS) n += (src.match(p.re) || []).length;
  return n;
}

function trackedTextFiles() {
  const out = execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && TEXT_FILE.test(f))
    // ⚠️ ONE EXEMPTION: this file. Its self-test requires a POSITIVE fixture — an example that must be
    // counted — so it cannot avoid containing the pattern it looks for. Exempting it is a blind spot,
    // and it is the narrowest possible one: the file contains fixtures, not a real message. Every other
    // file, including this one's own documentation examples, is judged normally.
    .filter((f) => f.replace(/\\/g, '/') !== 'scripts/validate-owner-quotes.cjs');
}

/** Scans tracked files and returns `{ file: count }` for counts above zero. */
function scan(files) {
  const result = {};
  for (const file of files) {
    const abs = path.join(REPO, file);
    if (!fs.existsSync(abs)) continue;
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const n = countQuotes(src);
    if (n > 0) result[file] = n;
  }
  return result;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    console.error('[owner-quotes] baseline unreadable — treating every hit as new');
    return {};
  }
}

function compare(current, baseline) {
  const regressions = [];
  const reductions = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) regressions.push({ file, count, allowed });
    else if (count < allowed) reductions.push({ file, count, allowed });
  }
  const stale = Object.keys(baseline).filter((f) => !current[f]);
  return { regressions, reductions, stale };
}

function gitFiles() {
  try {
    return trackedTextFiles();
  } catch (err) {
    // ⚠️ A gate that cannot read its input must ERROR, never pass.
    console.error(`[owner-quotes] cannot list tracked files: ${err.message}`);
    return null;
  }
}

function gate() {
  const files = gitFiles();
  if (!files) return 2;
  const { regressions, reductions, stale } = compare(scan(files), loadBaseline());
  if (regressions.length) {
    console.error(`[owner-quotes] ✖ ${regressions.length} file(s) now publish quoted conversation:\n`);
    for (const r of regressions) console.error(`    ${r.file}  ${r.allowed} → ${r.count}`);
    console.error(
      '\n  Keep the REASONING, drop the QUOTATION. Attribution without quotes is fine:\n' +
        '    ✅ "Decided 2026-11-18: separate strategies, because the asymmetry differs."\n' +
        '    ❌ Owner, 2026-11-18: *"one for shorting and one for going long"*\n',
    );
    return 1;
  }
  const total = Object.values(scan(files)).reduce((a, b) => a + b, 0);
  console.log(`[owner-quotes] ✅ no new quoted conversation — ${total} baselined finding(s) remain`);
  if (reductions.length || stale.length) {
    console.log('  improved — record it: node scripts/validate-owner-quotes.cjs --update-baseline');
  }
  return 0;
}

function report() {
  const files = gitFiles();
  if (!files) return 2;
  const current = scan(files);
  const baseline = loadBaseline();
  const rows = Object.entries(current).sort((a, b) => b[1] - a[1]);
  for (const [file, count] of rows) console.log(`  ${String(count).padStart(4)}  ${file}${baseline[file] ? '' : '  (NOT BASELINED)'}`);
  console.log(`\n  ${rows.length} file(s), ${rows.reduce((a, [, c]) => a + c, 0)} quoted message(s)`);
  return 0;
}

function updateBaseline(allowRaise) {
  const files = gitFiles();
  if (!files) return 2;
  const current = scan(files);
  const baseline = loadBaseline();
  const seeded = Object.keys(baseline).length === 0;
  const { regressions } = compare(current, baseline);
  if (regressions.length && !allowRaise && !seeded) {
    console.error('[owner-quotes] ✖ refusing to raise the baseline — remove the quote instead.');
    for (const r of regressions) console.error(`    ${r.file}: ${r.allowed} → ${r.count}`);
    return 1;
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`[owner-quotes] baseline ${seeded ? 'SEEDED' : 'updated'}: ${Object.keys(current).length} file(s)`);
  return 0;
}

function selfTest() {
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (got ${JSON.stringify(actual)})`);
    return ok ? 0 : 1;
  };
  let f = 0;
  f += t('counts the owner-quote form', countQuotes(' * Owner, 2026-11-18: *"x"*'), 1);
  f += t('counts the data-field form', countQuotes(`owner: '"something"'`), 1);
  f += t('counts owner said', countQuotes('the owner said "x"'), 1);
  f += t('attribution WITHOUT a quote is clean', countQuotes(' * Decided 2026-11-18: separate strategies.'), 0);
  f += t('a date alone is clean', countQuotes(' * Owner, 2026-11-18 decided this.'), 0);
  const cmp = compare({ 'a.js': 3, 'b.js': 1 }, { 'a.js': 2, 'b.js': 1 });
  f += t('above baseline is a regression', cmp.regressions.length, 1);
  f += t('at baseline is clean', cmp.regressions[0].file, 'a.js');
  console.log(f ? `\n[owner-quotes] self-test FAILED (${f})` : '\n[owner-quotes] self-test passed');
  return f ? 1 : 0;
}

function main(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has('--self-test')) return selfTest();
  if (flags.has('--report')) return report();
  if (flags.has('--update-baseline')) return updateBaseline(flags.has('--force-raise'));
  if (flags.has('--help')) {
    console.log('usage: validate-owner-quotes.cjs [--report|--update-baseline|--self-test]');
    return 0;
  }
  const unknown = [...flags].filter((x) => !['--report', '--update-baseline', '--force-raise', '--self-test', '--help'].includes(x));
  if (unknown.length) {
    console.error(`[owner-quotes] unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  return gate();
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { countQuotes, scan, compare };
