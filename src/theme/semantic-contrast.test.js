/**
 * semantic-contrast.test.js — every semantic colour token must meet WCAG AA in its own mode (#861).
 * ==================================================================================================
 * Run with: `node --test src/theme/semantic-contrast.test.js` (and in `prebuild`).
 *
 * ⚠️ THE DEFECT THIS PINS. The semantic tokens (`--color-profit`, `--color-loss`, `--color-warning`,
 * …) are tuned for a BLACK background and used as BODY TEXT app-wide. The theme runtime supports a
 * light mode, and the same values were then painted on white. Measured 2026-11-06:
 *
 *     --color-profit  #22c55e  →  2.28:1 on #ffffff   (AA needs 4.5:1)
 *     --color-loss    #f87171  →  2.77:1
 *     --color-warning #f59e0b  →  2.15:1
 *
 * **Eleven of fifteen failed** — the issue named the most visible one, not the only one.
 *
 * ⚠️ WHY A TEST AND NOT A NEW SCRIPT: the repo already has 211 tools and 80 orphans. This is a
 * property of two files that the suite can check exactly, so it runs in `prebuild` through the
 * existing `node --test` steps rather than adding a surface nobody will find again.
 *
 * ⚠️ WHY BOTH SURFACES. A token is only checked against what it is painted on. Two light surfaces
 * are in play — the PANEL (`#ffffff`) and the PAGE (`#f4f7fb`) — and a tile can sit on either, so
 * both are asserted. Checking only the panel would have passed `--color-muted` at 4.43:1 on the
 * page, which is exactly the case that was found and darkened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeTokens } from './tokens.js';

/** WCAG 2.x relative luminance. */
function luminance(hexColor) {
  const h = String(hexColor).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal text. These tokens are all used as text; none is a large-text or graphic alone. */
const AA_NORMAL_TEXT = 4.5;

/** Every semantic token the adapter emits, and the palette key it comes from. */
const TOKENS = [
  ['--color-profit', 'profit'],
  ['--color-loss', 'loss'],
  ['--color-buy', 'buy'],
  ['--color-sell', 'sell'],
  ['--color-accent-blue', 'accentBlue'],
  ['--color-warning', 'warning'],
  ['--color-neutral', 'neutral'],
  ['--color-muted', 'muted'],
  ['--color-text-dim', 'textDim'],
  ['--notice-success-text', 'noticeSuccess'],
  ['--notice-warning-text', 'noticeWarning'],
  ['--notice-critical-text', 'noticeCritical'],
  ['--notice-info-text', 'noticeInfo'],
];

test('both modes declare a semantic palette — an empty set must FAIL, not pass', () => {
  for (const mode of ['light', 'dark']) {
    const semantic = createThemeTokens(mode).palette.semantic;
    assert.ok(semantic, `${mode} has no semantic palette`);
    assert.ok(
      Object.keys(semantic).length >= TOKENS.length - 1,
      `${mode} declares only ${Object.keys(semantic).length} semantic keys`,
    );
  }
});

test('the token list covers the palette — a token added to the adapter is never silently unchecked', () => {
  for (const mode of ['light', 'dark']) {
    const semantic = createThemeTokens(mode).palette.semantic;
    const unchecked = Object.keys(semantic).filter((k) => !TOKENS.some(([, key]) => key === k));
    assert.deepEqual(unchecked, [], `${mode} declares unchecked semantic key(s): ${unchecked.join(', ')}`);
  }
});

test('every semantic token is AA-legible on the panel AND the page, in every mode', () => {
  const failures = [];
  for (const mode of ['light', 'dark']) {
    const { palette } = createThemeTokens(mode);
    // Surfaces come from the SAME palette, so changing a surface cannot leave this testing a stale one.
    const surfaces = [
      ['panel', palette.panel],
      ['page', palette.bg],
    ];
    for (const [tokenName, key] of TOKENS) {
      const value = palette.semantic[key];
      if (!value) { failures.push(`${mode}: ${tokenName} is undefined`); continue; }
      for (const [surfaceName, surface] of surfaces) {
        const ratio = contrast(value, surface);
        if (ratio < AA_NORMAL_TEXT) {
          failures.push(
            `${mode}: ${tokenName} ${value} on ${surfaceName} ${surface} = ${ratio.toFixed(2)}:1 (AA needs ${AA_NORMAL_TEXT})`,
          );
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('the measurement itself can fail — the OLD dark-tuned green on white is rejected', () => {
  // The literal value this issue reported. If the formula were wrong, or the surfaces mis-wired,
  // this would pass and every assertion above would be worthless.
  assert.ok(contrast('#22c55e', '#ffffff') < AA_NORMAL_TEXT);
  assert.ok(contrast('#22c55e', '#f4f7fb') < AA_NORMAL_TEXT);
  // …and the replacement is accepted.
  assert.ok(contrast('#15803d', '#ffffff') >= AA_NORMAL_TEXT);
});

/**
 * ⚠️ THE PACKS, NOT JUST THE BASE PALETTE (#861).
 *
 * Every pack builds `{ ...createThemeTokens(mode), palette: PACK_PALETTE }` — it REPLACES the
 * palette, so `semantic` is dropped unless the pack redeclares it. Measured on `void`: its panel is
 * `#111118` and its `--color-muted` resolved to the dark-tuned `#64748b` at **3.62:1**, i.e. the
 * base palette was fixed while the pack users actually select was still failing.
 *
 * This iterates the packs that a user can choose, runs the SAME adapter the runtime runs, and checks
 * the emitted values against that pack's OWN panel and page. A future pack is covered automatically
 * because the list comes from the registry, not from a literal.
 */
test('every selectable theme pack emits AA-legible semantic colours on its own surfaces', async () => {
  const packs = await Promise.all([
    import('./packs/core.js'),
    import('./packs/void.js'),
    import('./packs/terminal.js'),
    import('./packs/scifi.js'),
    import('./packs/oceanic.js'),
    import('./packs/slate.js'),
  ]);
  const { toCssVariables } = await import('./adapters/vanilla.js');

  const failures = [];
  let packsChecked = 0;

  for (const mod of packs) {
    const pack = mod.themePack;
    if (!pack) { failures.push('a pack module exports no `themePack`'); continue; }
    for (const mode of ['light', 'dark']) {
      const tokens = pack.createTokens(mode);
      const vars = toCssVariables(tokens);
      const resolvedMode = tokens.mode === 'light' ? 'light' : 'dark';
      const surfaces = [
        ['panel', tokens.palette?.panel],
        ['page', tokens.palette?.bg],
      ];
      packsChecked += 1;
      for (const [tokenName] of TOKENS) {
        const value = vars[tokenName];
        if (!value) { failures.push(`${pack.id}/${resolvedMode}: ${tokenName} not emitted at all`); continue; }
        for (const [surfaceName, surface] of surfaces) {
          if (!surface) { failures.push(`${pack.id}/${resolvedMode}: no ${surfaceName} colour`); continue; }
          // Translucent surfaces (`rgba(...)`) cannot be measured without compositing, so they are
          // reported rather than silently passed — a check that skips its subject must not look clean.
          if (surface.startsWith('rgba') || surface.startsWith('rgb')) {
            failures.push(`${pack.id}/${resolvedMode}: ${surfaceName} is ${surface} — not measurable as-is`);
            continue;
          }
          const ratio = contrast(value, surface);
          if (ratio < AA_NORMAL_TEXT) {
            failures.push(`${pack.id}/${resolvedMode}: ${tokenName} ${value} on ${surfaceName} ${surface} = ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
  }

  assert.ok(packsChecked >= 2, 'no packs were checked — the guard inspected nothing');
  assert.deepEqual(failures, []);
});
