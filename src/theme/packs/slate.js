import { createThemeTokens } from '../tokens.js';

const SLATE_LIGHT = {
  bg: '#f1f5f9',
  ink: '#0f172a',
  inkSoft: '#475569',
  panel: '#ffffff',
  line: '#cbd5e1',
  accent: '#3b82f6',
  danger: '#ef4444',
};

const SLATE_DARK = {
  bg: '#0f172a',
  ink: '#e2e8f0',
  inkSoft: '#94a3b8',
  panel: '#1e293b',
  line: '#334155',
  accent: '#3b82f6',
  danger: '#ef4444',
};

export function createSlateTokens(mode = 'dark') {
  const normalizedMode = mode === 'light' ? 'light' : 'dark';
  const base = createThemeTokens(normalizedMode);
  /**
   * ⚠️ SPREADS THE BASE PALETTE INSTEAD OF REPLACING IT (2026-11-26).
   *
   * Replacing it dropped the `semantic` group, so slate was served by the adapter's
   * `getSemanticPalette(isDarkSurface(panel))` fallback. That fallback happens to pick the right
   * set for slate in both modes — so this **changes no pixel today**, and saying otherwise would be
   * a false claim. What it changes is the wiring: slate now inherits the canonical per-mode set
   * DELIBERATELY, so a retune of the neutral set reaches it, and the pack no longer depends on a
   * luminance guess to arrive at the right answer.
   *
   * ⚠️ One known asymmetry, left alone on purpose: on the slate DARK panel (`#1e293b`) the base
   * `neutral` (`#a1a9b5`) measures 6.17:1 against slate's own `--ink-soft` of 5.71:1, i.e. it sits
   * *above* the secondary ink rather than below it as it does in core. `--color-neutral` is a
   * semantic VALUE colour (HOLD), not a hierarchy step — the dim tokens (`muted`, `textDim`) are the
   * ones that must recede, and they do (4.87 / 5.71). Guarded by the "dim never outshines ink-soft"
   * case in `src/theme/semantic-contrast.test.js`.
   */
  const palette = { ...base.palette, ...(normalizedMode === 'light' ? SLATE_LIGHT : SLATE_DARK) };

  return {
    ...base,
    mode: normalizedMode,
    palette,
    radius: {
      sm: 6,
      md: 10,
    },
    shadow: {
      ...base.shadow,
      card:
        normalizedMode === 'dark'
          ? '0 4px 16px rgba(0, 0, 0, 0.4)'
          : '0 2px 8px rgba(15, 23, 42, 0.08)',
    },
    typography: {
      body: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    },
  };
}

export const themePack = {
  id: 'slate',
  createTokens: createSlateTokens,
};
