/**
 * validate-colour-literals.cjs — a colour written into an inline style cannot follow a theme pack.
 *
 * ── THE DEFECT THIS PREVENTS ─────────────────────────────────────────────────────────────────────
 * `style={{ color: '#ef4444' }}` is a colour the CSS cascade never sees. No theme pack can override
 * it, and — the part that actually cost something — **the accessibility fix that replaced that hex in
 * the token set never reached it.** Measured 2026-11-26: `index.css` declares `--color-loss: #f87171`
 * with the note that it *was* `#ef4444` and was boosted for WCAG AA — and **50 inline styles still
 * hard-coded `#ef4444`**. The same shape for `--ink-soft`, whose note says it *was* `#94a3b8`, at 41
 * sites. So the AA remediation was applied to the tokens and left the literal call sites behind.
 *
 * ⚠️ **THE NUMBER THIS REPLACED WAS WRONG, AND THE BASIS IS WHY.** The carried figure was
 * *"2,487 hex literals across 112 page files"*. Re-measured with a stated basis: the population that
 * defeats theming is **hex inside `style={{ }}`, 6- or 8-digit only** — 263 occurrences in 48 files.
 * The 2,487 also counted (a) `#782`, `#1165` and friends — **issue references in prose**, matched by
 * a 3-digit branch, (b) `*.css` files, where tokens belong anyway, and (c) JS data/reference files
 * (`architecture-framework.data.js`, `qa-checklist.js`) and SVG diagram fills, which are content, not
 * styling. Two numbers were never in disagreement; one of them was measuring something else.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
 *   R1 MUST-MOVE  a hex inside an inline style that EXACTLY EQUALS a value carried by an `index.css`
 *                 token. The replacement is mechanical and unarguable, so there is no baseline and no
 *                 exemption: reintroducing an AA-boosted colour as a literal fails the build.
 *   R2 RATCHET    every other inline hex is bespoke (a heatmap ramp, an alpha-blended overlay, a chart
 *                 series) and is frozen per file in `docs/colour-literals-baseline.json`. A file may
 *                 not grow. A file that shrinks makes the baseline STALE and fails until the baseline
 *                 is regenerated in the same change — a ratchet whose slack is never reclaimed is a
 *                 ratchet with a hole in it.
 *
 * ⚠️ **NOT covered: hex in `*.css`.** There are ~990 of those and they are a stylesheet problem, not
 * an inline-style one — a token can be introduced next to them without crossing a JS boundary. Declared
 * here rather than implied, so nobody reads a passing run as "the app has no literal colours".
 *
 * ── DECISION (2026-11-26, primary) ──
 * WHAT:      a hex inside an inline style that equals a token value MUST move; every other inline hex
 *            is frozen per file rather than banned.
 * WHY:       the accessibility remediation that replaced `#ef4444` with `#f87171` in the token set
 *            never reached 50 inline styles, so they kept rendering the failing colour at 2.28:1 on
 *            `--color-profit` — the tokens were fixed and the call sites were not. A ban would have
 *            been unimplementable in one change (37 bespoke sites remain, all deliberate palettes);
 *            a ratchet freezes the debt while the unarguable half is enforced outright.
 * REVERSE BY: Delete the script, remove it from `prebuild` and from `src/data/standards.js`, and delete
 *            `docs/colour-literals-baseline.json`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 297
 * GUARD:     this file — R1 must-move, R2 ratchet, 12 self-test cases, canaried live five ways
 *
 * Usage:
 *   node scripts/validate-colour-literals.cjs                 # check R1 + R2
 *   node scripts/validate-colour-literals.cjs --report        # every remaining site, by file
 *   node scripts/validate-colour-literals.cjs --write-baseline # after a reduction, in the same change
 *   node scripts/validate-colour-literals.cjs --self-test      # prove BOTH rules can fail
 *
 * Exit: 0 = no must-move literal and the ratchet holds · 1 = a violation or a stale baseline ·
 *       2 = could not judge (never 0 — a scan that reads nothing has checked nothing).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TOKENS = path.join(SRC, 'index.css');
const BASELINE = path.join(ROOT, 'docs', 'colour-literals-baseline.json');

/** Files that legitimately hold a colour DEFINITION rather than a use. */
const DEFINES_COLOURS = new Set(['src/theme/tokens.js']);

/**
 * ⚠️ **6- AND 8-DIGIT FIRST, THEN 3 AND 4 — AND THE SHORT FORMS ARE ONLY SAFE HERE.**
 * The original measurement was inflated to 2,487 by a 3-digit branch matching `#782` and `#1165`,
 * which are ISSUE REFERENCES in prose. That trap only exists when you scan whole FILES. This scanner
 * scans the inside of a `style={{ }}` body, where prose cannot appear, so `#fff` is unambiguously a
 * colour and excluding it would be leaving 8 real literals behind. `(?![0-9a-fA-F])` stops a short
 * match from being a prefix of a longer run.
 */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const STYLE_BLOCK = /style=\{\{([\s\S]*?)\}\}/g;

/** `#fff` and `#ffffff` are the same colour; `#0000` and `#00000000` likewise. */
function expand(hex) {
  const h = hex.toLowerCase();
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (h.length === 5) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}${h[4]}${h[4]}`;
  return h;
}

/** The `--name: #value` pairs index.css declares. A value may be carried by several names. */
function tokenValues(css) {
  const byValue = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const value = expand(m[2]);
    if (!byValue.has(value)) byValue.set(value, []);
    const names = byValue.get(value);
    if (!names.includes(m[1])) names.push(m[1]);
  }
  // ⚠️ Ordering matters because the first name is the one the failure message recommends. Several
  // tokens share a value (`#22c55e` is profit AND buy AND notice-success), and a `--notice-*` token is
  // the wrong advice for a P&L cell — so the general semantic names are offered before the notice ones.
  for (const names of byValue.values()) {
    names.sort((a, b) => Number(a.startsWith('--notice-')) - Number(b.startsWith('--notice-')) || a.localeCompare(b));
  }
  return byValue;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.(jsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every inline-style hex in one source, in order, with the style body it came from. */
function inlineHex(text) {
  const out = [];
  STYLE_BLOCK.lastIndex = 0;
  let block;
  while ((block = STYLE_BLOCK.exec(text)) !== null) {
    const body = block[1];
    HEX.lastIndex = 0;
    let hit;
    while ((hit = HEX.exec(body)) !== null) out.push({ hex: hit[0].toLowerCase(), body });
  }
  return out;
}

/**
 * analyse(sources, byValue, baseline) — pure, so the self-test can drive every branch.
 * `sources` is [{ file, text }]; `baseline` is { files: { path: count } }.
 */
function analyse(sources, byValue, baseline) {
  const mustMove = [];
  const counts = new Map();
  for (const { file, text } of sources) {
    const hits = inlineHex(text);
    if (!hits.length) continue;
    counts.set(file, hits.length);
    for (const { hex } of hits) {
      const names = byValue.get(expand(hex));
      if (names && names.length) {
        mustMove.push({ file, hex, token: names[0], others: names.slice(1) });
      }
    }
  }
  const grown = [];
  const newFiles = [];
  const shrunk = [];
  const known = baseline && baseline.files ? baseline.files : {};
  const claimedTotal = baseline && typeof baseline.total === 'number' ? baseline.total : null;
  for (const [file, n] of counts) {
    const was = known[file];
    if (was === undefined) newFiles.push({ file, count: n });
    else if (n > was) grown.push({ file, was, count: n });
    else if (n < was) shrunk.push({ file, was, count: n });
  }
  for (const [file, was] of Object.entries(known)) {
    if (!counts.has(file)) shrunk.push({ file, was, count: 0 });
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { mustMove, counts, total, grown, newFiles, shrunk, claimedTotal };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return { total: 0, files: {} };
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function check() {
  if (!fs.existsSync(TOKENS)) throw new Error(`${path.relative(ROOT, TOKENS)} not found — cannot judge`);
  const byValue = tokenValues(fs.readFileSync(TOKENS, 'utf8'));
  if (byValue.size === 0) {
    // ⚠️ Zero token values means index.css changed shape, NOT that nothing must move. Reporting a pass
    // here would be the false negative this repo keeps re-finding.
    throw new Error('no colour token values parsed from src/index.css — the file changed shape');
  }
  const files = walk(SRC).map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).filter((f) => !DEFINES_COLOURS.has(f));
  const sources = files.map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') }));
  if (!sources.some((s) => s.text.includes('style={{'))) {
    throw new Error('no inline style blocks found in src/ — the scanner matched nothing');
  }
  return { ...analyse(sources, byValue, readBaseline()), scanned: files.length, tokens: byValue.size };
}

function selfTest() {
  const byValue = tokenValues(':root { --color-loss: #f87171; --color-profit: #22c55e; --ink-soft: #a1a9b5; --ink: #ffffff; }');
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = String(got) === String(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${want}, got ${got}`);
  };
  const run = (sources, baseline = { total: 0, files: {} }) => analyse(sources, byValue, baseline);

  // —— the token parser must actually see values, or every R1 result below is a false pass.
  expect('the token parser reads 4 values', byValue.size, 4);

  // —— R1, both directions.
  expect(
    'R1: a AA-boosted colour written back as a literal MUST MOVE',
    run([{ file: 'a.jsx', text: "const s = { style={{ color: '#f87171' }} };" }]).mustMove[0]?.token,
    '--color-loss',
  );
  expect(
    'R1: an unrelated colour is NOT a must-move (it is bespoke)',
    run([{ file: 'a.jsx', text: "style={{ background: '#1e2a45' }}" }]).mustMove.length,
    0,
  );
  expect(
    'R1: a hex in a CSS variable is NOT a must-move',
    run([{ file: 'a.jsx', text: "style={{ color: 'var(--color-loss)' }}" }]).mustMove.length,
    0,
  );
  // ⚠️ The 3-digit trap that inflated the original measurement: `#782` is an ISSUE REFERENCE.
  expect(
    'R1: an issue reference in prose is not a colour',
    run([{ file: 'a.jsx', text: "style={{ color: x }} // see #782 and #1165" }]).mustMove.length,
    0,
  );

  // —— R2, three directions.
  expect(
    'R2: a file that GROWS past its baseline fails',
    run([{ file: 'a.jsx', text: "style={{ a: '#1e2a45' }} style={{ b: '#334155' }}" }], { total: 1, files: { 'a.jsx': 1 } }).grown.length,
    1,
  );
  expect(
    'R2: a NEW file with a bespoke hex fails (it has no allowance)',
    run([{ file: 'a.jsx', text: "style={{ a: '#1e2a45' }}" }]).newFiles.length,
    1,
  );
  expect(
    'R2: a file that SHRINKS makes the baseline stale, so the slack is reclaimed',
    run([{ file: 'a.jsx', text: "style={{ a: '#1e2a45' }}" }], { total: 5, files: { 'a.jsx': 5 } }).shrunk[0]?.count,
    1,
  );
  expect(
    'R2: matching the baseline exactly is clean',
    (() => {
      const r = run([{ file: 'a.jsx', text: "style={{ a: '#1e2a45' }}" }], { total: 1, files: { 'a.jsx': 1 } });
      return r.grown.length + r.newFiles.length + r.shrunk.length;
    })(),
    0,
  );

  // ⚠️ The scanner must be able to SEE a style block, or every pass above is unearned.
  expect(
    'the scanner reads hex inside a style block (2 hits)',
    inlineHex("style={{ a: '#1e2a45', b: '#334155' }}").length,
    2,
  );
  // A 3-digit hex is safe to treat as a colour INSIDE a style body, and must be, or `#fff` on a
  // filled button — white on `--color-profit` is 2.2:1 — stays invisible.
  expect(
    'the scanner reads a 3-digit hex inside a style block',
    inlineHex("style={{ color: '#fff' }}")[0]?.hex,
    '#fff',
  );
  expect(
    'R1: #fff is caught because #ffffff is a token value',
    run([{ file: 'a.jsx', text: "style={{ color: '#fff' }}" }]).mustMove[0]?.token,
    '--ink',
  );

  console.log(failures === 0 ? '\n✅ self-test: R1 and R2 each report both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function writeBaseline(result) {
  const files = {};
  for (const [file, n] of [...result.counts.entries()].sort()) files[file] = n;
  const body = {
    note: 'Inline-style hex literals that are BESPOKE (no token carries the value). Frozen so the count cannot grow; regenerate with `node scripts/validate-colour-literals.cjs --write-baseline` when a file shrinks.',
    total: result.total,
    files,
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`[colour-literals] wrote ${path.relative(ROOT, BASELINE)} — ${result.total} site(s) in ${Object.keys(files).length} file(s)`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-colour-literals.cjs [--report] [--write-baseline] [--self-test]');
    return;
  }
  let result;
  try {
    result = check();
  } catch (err) {
    console.error(`[colour-literals] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }
  if (argv.includes('--write-baseline')) return writeBaseline(result);

  if (argv.includes('--report')) {
    console.log(`\n${result.total} bespoke inline hex in ${result.counts.size} file(s) · ${result.tokens} token value(s) in index.css\n`);
    for (const [file, n] of [...result.counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${file}`);
    }
  }

  const failed = result.mustMove.length > 0 || result.grown.length > 0 || result.newFiles.length > 0 || result.shrunk.length > 0;
  console.log(
    `[colour-literals] ${result.scanned} file(s): ${result.mustMove.length} must-move · ${result.total} bespoke (baseline ${result.claimedTotal ?? 'none'}) · ${result.grown.length} grown · ${result.newFiles.length} new · ${result.shrunk.length} shrunk`,
  );
  for (const v of result.mustMove) {
    const also = v.others.length ? ` (also carried by ${v.others.join(', ')})` : '';
    console.log(`  ✖ R1 ${v.hex} in ${v.file} — equals ${v.token}${also}; use var(${v.token})`);
  }
  for (const g of result.grown) console.log(`  ✖ R2 ${g.file} — ${g.was} → ${g.count} inline hex; a literal cannot follow a theme pack`);
  for (const n of result.newFiles) console.log(`  ✖ R2 ${n.file} — ${n.count} inline hex in a file with no allowance`);
  for (const s of result.shrunk) console.log(`  ⚠ R2 ${s.file} — ${s.was} → ${s.count}; baseline is stale, run --write-baseline in this change`);
  if (failed) {
    console.log('[colour-literals] a hex in an inline style is invisible to every theme pack and to every CSS remediation.');
    process.exit(1);
  }
  console.log('[colour-literals] ✅ no token value is written as a literal, and the ratchet holds');
}

if (require.main === module) main();

module.exports = { analyse, tokenValues, inlineHex };
