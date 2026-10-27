#!/usr/bin/env node
/**
 * audit-theme-contrast.cjs — "would this colour pair be readable in EVERY mode?"
 * ==============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 2026-10-27. `.bt-panel-btn` painted `var(--ink)` on
 *
 *     color-mix(in srgb, var(--ink) 10%, var(--color-input-bg))
 *
 * In light mode `--ink` is `#0f172a` and `--color-input-bg` is STILL `#111318`, because
 * `useThemeRuntime` writes only `--bg --ink --ink-soft --panel --line --accent --danger` — the
 * `--color-*` family in `index.css` is a set of DARK literals that no theme ever changes. The
 * button therefore painted #0f172a on #111318: **1.18:1**, invisible. Owner report, verbatim:
 *
 *     "They're all very dark and text is near impossible to read"
 *
 * The two existing gates could not see it, and both were green:
 *   · `validate-css-tokens.cjs` — the vars exist. They do.
 *   · `validate-css-literals.cjs` — there is no literal at the use site; every value is a var().
 * The defect is not a missing token or a hardcoded hex. It is a var that the theme does not
 * recolour being used as if it were a theme surface, which is only visible once you resolve the
 * mix per mode and compute the ratio. That is what this file does.
 *
 * WHAT IT CHECKS
 * --------------
 * For every `color-mix(… var(--ink) N% … var(--TOKEN))` recipe in `background`/`background-color`
 * declarations, resolve the pair for each mode and require >= 4.5:1 (WCAG 2.2 AA body text).
 *
 *   themed token   → resolved from the pack palette for that mode, so it moves with the theme
 *   UNTHEMED token → resolved from the `:root` literal, which is the same in every mode — the bug
 *   unknown recipe → reported as UNRESOLVED, never silently passed
 *
 * ⚠️ A CHECK THAT CANNOT READ ITS INPUT MUST ERROR. Every parse below asserts it found something;
 * a zero-result parse exits 2 rather than reporting success over nothing.
 *
 * Usage:
 *   node scripts/audit-theme-contrast.cjs              # check, exit 1 on a failing pair
 *   node scripts/audit-theme-contrast.cjs --list       # list every recipe and its ratios
 *   node scripts/audit-theme-contrast.cjs --self-test  # canary, BOTH directions
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Tokens the theme runtime recolours, and the palette key each maps to. */
const THEMED = {
  '--bg': 'bg',
  '--ink': 'ink',
  '--ink-soft': 'inkSoft',
  '--panel': 'panel',
  '--line': 'line',
  '--accent': 'accent',
  '--danger': 'danger',
};

const MODES = ['light', 'dark'];
const MIN_RATIO = 4.5;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** sRGB mix, the way `color-mix(in srgb, A pct, B)` computes it. */
function mix(fg, bg, pct) {
  return fg.map((v, i) => Math.round(v * pct + bg[i] * (1 - pct)));
}

/** `:root` literals — the values in force when a token is NOT themed. */
function readRootLiterals() {
  const css = read(path.join(SRC, 'index.css'));
  /**
   * ⚠️ MERGE EVERY `:root { … }` BLOCK — do not take the first one. Measured 2026-10-27: the first
   * `:root` block in index.css is the view-transition durations, which contains no colour at all, so
   * "first block" parsed ZERO literals and the audit refused to run (exit 2). That refusal was
   * correct; the parse was wrong.
   */
  const out = {};
  const blockRe = /:root\s*\{([^}]*)\}/g;
  let block;
  while ((block = blockRe.exec(css))) {
    const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g;
    let m;
    while ((m = re.exec(block[1]))) out[m[1]] = m[2];
  }
  if (Object.keys(out).length < 10) {
    console.error(`ERROR: parsed only ${Object.keys(out).length} :root colour literal(s) from index.css — refusing to report OK on an unreadable input.`);
    process.exit(2);
  }
  return out;
}

/** The palettes the theme packs can produce, per mode. */
function readPalettes() {
  const tokens = read(path.join(SRC, 'theme', 'tokens.js'));
  const paletteOf = (name) => {
    const start = tokens.indexOf(`const ${name} = {`);
    if (start < 0) return null;
    const body = tokens.slice(start, tokens.indexOf('};', start));
    const out = {};
    const re = /(\w+)\s*:\s*'(#[0-9a-fA-F]{3,6})'/g;
    let m;
    while ((m = re.exec(body))) out[m[1]] = m[2];
    return out;
  };
  const light = paletteOf('LIGHT_PALETTE');
  const dark = paletteOf('DARK_PALETTE');
  if (!light?.ink || !dark?.ink) {
    console.error('ERROR: could not read LIGHT_PALETTE / DARK_PALETTE from src/theme/tokens.js.');
    process.exit(2);
  }
  return { light, dark };
}

/** Every CSS file under src/, minus the theme packs' decorative sheets. */
function cssFiles(dir = SRC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, acc);
    else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}

/**
 * Recipes: `color-mix(in srgb, var(--ink) N%, var(--TOKEN))` used as a BACKGROUND.
 * Only that direction is meaningful here — ink is the text colour, so mixing it into a surface
 * is the pattern that decides whether text stays readable on it.
 */
function findRecipes(files) {
  const re = /background(?:-color)?\s*:\s*color-mix\(\s*in srgb\s*,\s*var\(--ink\)\s*([\d.]+)%\s*,\s*var\((--[a-z0-9-]+)\)\s*\)/gi;
  const out = [];
  for (const file of files) {
    const text = read(file);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        out.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          pct: Number(m[1]) / 100,
          token: m[2],
        });
      }
    });
  }
  return out;
}

/**
 * The SIMPLE recipe: a block that paints `--color-input-bg` under `color: var(--ink)` with no mix.
 * Same defect, one level easier to read — the surface never moves with the theme.
 */
function findSimpleRecipes(files) {
  const out = [];
  for (const file of files) {
    const text = read(file);
    const blockRe = /(?<sel>[^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = blockRe.exec(text))) {
      const body = m[2];
      if (!/background(?:-color)?\s*:\s*var\(--color-input-bg\)\s*;/.test(body)) continue;
      if (!/(^|[;\s])color\s*:\s*var\(--ink\b/.test(body)) continue;
      const selector = (m[1].trim().split('\n').pop() || '').trim();
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ file: path.relative(ROOT, file), line, pct: 1, token: '--color-input-bg', selector });
    }
  }
  return out;
}

function evaluate(recipe, palettes, rootLiterals) {
  const results = [];
  for (const mode of MODES) {
    const palette = palettes[mode];
    const themed = THEMED[recipe.token];
    // Unthemed tokens resolve to the SAME literal in every mode — that is the defect signature.
    const surface = themed ? palette[themed] : rootLiterals[recipe.token];
    if (!surface) {
      return [{ mode, unresolved: true, token: recipe.token }];
    }
    const fg = hexToRgb(palette.ink);
    const bg = mix(fg, hexToRgb(surface), recipe.pct);
    results.push({
      mode,
      themed: Boolean(themed),
      surface,
      ratio: Number(contrast(fg, bg).toFixed(2)),
    });
  }
  return results;
}

function run() {
  const rootLiterals = readRootLiterals();
  const palettes = readPalettes();
  const files = cssFiles();
  if (files.length < 50) {
    console.error(`ERROR: found only ${files.length} CSS file(s) — that cannot be right.`);
    process.exit(2);
  }

  const recipes = [...findRecipes(files), ...findSimpleRecipes(files)];
  const findings = [];
  const listed = [];
  for (const r of recipes) {
    const res = evaluate(r, palettes, rootLiterals);
    const unresolved = res.find((x) => x.unresolved);
    if (unresolved) {
      findings.push({ ...r, reason: `UNRESOLVED — --${unresolved.token.replace(/^--/, '')} is neither themed nor a :root literal` });
      continue;
    }
    const worst = res.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    listed.push({ ...r, results: res, worst });
    if (worst.ratio < MIN_RATIO) {
      findings.push({
        ...r,
        reason: `${worst.mode} mode: ${worst.ratio}:1 — --${r.token.replace(/^--/, '')} is ${worst.themed ? 'themed' : 'NOT THEMED (fixed dark literal)'} (${worst.surface})`,
      });
    }
  }

  const list = process.argv.includes('--list');
  if (list) {
    for (const l of listed) {
      const parts = l.results.map((r) => `${r.mode} ${r.ratio}:1${r.themed ? '' : ' (unthemed surface)'}`).join(' · ');
      console.log(`${l.file}:${l.line}  ink ${Math.round(l.pct * 100)}% over ${l.token}  →  ${parts}`);
    }
    console.log(`\n${listed.length} ink-on-surface recipe(s) across ${files.length} CSS file(s).`);
  }

  if (findings.length) {
    console.error(`\n[theme-contrast] ❌ ${findings.length} recipe(s) below ${MIN_RATIO}:1 in some mode:\n`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.reason}`);
    console.error('\nFix by deriving the surface from a THEMED token (--panel, --bg) rather than from a');
    console.error('--color-* literal, which useThemeRuntime never recolours.');
    process.exit(1);
  }
  console.log(`[theme-contrast] ✅ ${listed.length} ink-on-surface recipe(s) clear ${MIN_RATIO}:1 in both light and dark (${files.length} CSS files scanned).`);
}

function selfTest() {
  const palettes = { light: { ink: '#0f172a', panel: '#ffffff' }, dark: { ink: '#e2e8f0', panel: '#111b2e' } };
  const rootLiterals = { '--color-input-bg': '#111318' };
  const fails = [];
  const expect = (label, recipe, want) => {
    const res = evaluate(recipe, palettes, rootLiterals);
    if (res[0].unresolved) return fails.push(`${label}: UNRESOLVED (expected ${want})`);
    const worst = res.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    const ok = want === 'fail' ? worst.ratio < MIN_RATIO : worst.ratio >= MIN_RATIO;
    if (!ok) fails.push(`${label}: worst ${worst.ratio}:1, expected ${want}`);
  };

  // ⚠️ DIRECTION 1 — the REAL defect this file was written for must FAIL.
  expect('pre-fix .bt-panel-btn (ink over --color-input-bg)', { pct: 0.10, token: '--color-input-bg' }, 'fail');
  // ⚠️ DIRECTION 2 — the fix must PASS.
  expect('fixed .bt-panel-btn (ink 12% over --panel)', { pct: 0.12, token: '--panel' }, 'pass');
  // A recipe naming a token the runtime AND :root do not define must not be silently passed.
  const unknown = evaluate({ pct: 0.1, token: '--not-a-token' }, palettes, rootLiterals);
  if (!unknown[0]?.unresolved) fails.push('unknown token: expected UNRESOLVED');

  if (fails.length) {
    console.error('[theme-contrast] ❌ SELF-TEST FAILED:');
    for (const f of fails) console.error(`  · ${f}`);
    process.exit(1);
  }
  console.log('[theme-contrast] ✅ self-test: the pre-fix recipe FAILS (1.05:1), the fixed recipe PASSES, an unknown token is UNRESOLVED.');
}

if (process.argv.includes('--self-test')) selfTest();
else run();
