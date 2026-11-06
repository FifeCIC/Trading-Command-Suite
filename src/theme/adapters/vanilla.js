import { getSemanticPalette } from '../tokens.js';

/**
 * Is this surface dark? WCAG relative luminance, thresholded at the midpoint.
 *
 * ⚠️ Only opaque hex is measured. A translucent surface (`rgba(...)`) cannot be evaluated without
 * compositing, so it is treated as DARK — the app's default look — rather than silently assuming
 * either answer. The contrast TEST reports such packs instead of passing them quietly, so an
 * unmeasurable surface is a visible finding and never a false pass.
 */
function isDarkSurface(color) {
  if (typeof color !== 'string') return true;
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return true;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.5;
}

export function toCssVariables(tokens) {
  const p = tokens.palette || {};
  // ⚠️ A theme PACK replaces the palette wholesale (`{ ...base, palette: PACK_PALETTE }`), so a pack
  // that does not redeclare `semantic` would emit nothing and fall through to the dark-tuned values
  // in `index.css`. Measured on `void`: its `--color-muted` resolved to `#64748b` at 3.62:1 on its
  // own panel while `core` was already correct (#861).
  //
  // ⚠️ AND THE SET IS CHOSEN BY THE SURFACE, NOT BY THE MODE NAME (#861, second pass). A pack's
  // "light" mode need not be light: `scifi` reports `mode:'light'` with panel `#132238` and page
  // `#0f1b2e`, both DARK. Selecting the light-tuned greens/reds there put `#15803d` on `#132238` at
  // **3.19:1** — worse than the bug this issue started with. Contrast is a property of ink against
  // SURFACE, so the surface decides. This mirrors what `useThemeRuntime` already does for
  // `color-scheme`, and for the same reason.
  const semantic = p.semantic ?? getSemanticPalette(isDarkSurface(p.panel) ? 'dark' : 'light');

  return {
    // Core
    '--bg': p.bg,
    '--ink': p.ink,
    '--ink-soft': p.inkSoft ?? p.textDim,
    '--panel': p.panel,
    '--line': p.line,
    '--accent': p.accent,
    '--danger': p.danger,
    '--shadow-card': tokens.shadow?.card ?? 'none',
    '--font-body': tokens.typography?.body ?? 'Inter, system-ui, sans-serif',
    '--font-mono': tokens.typography?.mono ?? 'ui-monospace, monospace',
    '--radius-sm': `${tokens.radius?.sm ?? 10}px`,
    '--radius-md': `${tokens.radius?.md ?? 14}px`,

    // Doomchart extended surface layers
    '--bg-elev': p.bgElev ?? p.panel,
    '--bg-elev-2': p.bgElev2 ?? p.panel,
    '--border': p.border ?? p.line,
    '--border-strong': p.borderStrong ?? p.line,

    // Doomchart text scale
    '--text-dim': p.textDim ?? p.inkSoft,
    '--text-faint': p.textFaint ?? p.inkSoft,

    // Doomchart risk spectrum
    '--risk-normal': p.riskNormal ?? '#2ecc91',
    '--risk-watch': p.riskWatch ?? '#c5a3ff',
    '--risk-elevated': p.riskElevated ?? '#ffd166',
    '--risk-high': p.riskHigh ?? '#ff8c42',
    '--risk-critical': p.riskCritical ?? '#ff5470',

    // Doomchart accent soft
    '--accent-soft': p.accentSoft ?? 'rgba(91, 141, 239, 0.12)',

    // ── Semantic colours, PER MODE (#861) ────────────────────────────────────────────────
    //
    // ⚠️ These are used as BODY TEXT app-wide and the dark-tuned values fail WCAG AA on a light
    // surface — `#22c55e` is 2.28:1 on white where AA needs 4.5:1. They live in the palette, not in
    // `index.css`, because the palette is what knows which MODE is resolved; `index.css` keeps the
    // dark values purely as the pre-hydration first paint.
    //
    // ⚠️ Emitted only when the palette declares them, so a theme pack that ships no `semantic` group
    // keeps the CSS defaults instead of receiving empty declarations. An empty custom property is
    // worse than an absent one: `var(--color-profit)` would resolve to nothing and the text would
    // inherit, silently losing its meaning.
    ...(semantic
      ? Object.fromEntries(
          Object.entries({
            '--color-profit': semantic.profit,
            '--color-loss': semantic.loss,
            '--color-buy': semantic.buy,
            '--color-sell': semantic.sell,
            '--color-accent-blue': semantic.accentBlue,
            '--color-warning': semantic.warning,
            '--color-neutral': semantic.neutral,
            '--color-muted': semantic.muted,
            '--color-text-dim': semantic.textDim,
            '--notice-success-text': semantic.noticeSuccess,
            '--notice-warning-text': semantic.noticeWarning,
            '--notice-critical-text': semantic.noticeCritical,
            '--notice-info-text': semantic.noticeInfo,
          }).filter(([, v]) => typeof v === 'string' && v.length > 0),
        )
      : {}),
  };
}

export const themeAdapter = {
  id: 'vanilla',
  transform: toCssVariables
};
