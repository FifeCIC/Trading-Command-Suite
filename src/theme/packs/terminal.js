import { createThemeTokens } from '../tokens.js';

// Bloomberg Terminal inspired — pure black with neon green accents.
const TERMINAL_PALETTE = {
  bg: '#0a0a0a',
  ink: '#e0e0e0',
  inkSoft: '#9aa0a6',
  panel: '#141414',
  line: 'rgba(0, 255, 65, 0.25)',
  accent: '#00ff41',
  danger: '#ff0040',
  /**
   * TERMINAL'S OWN SEMANTIC SET (#861 follow-up, 2026-11-26) — same reason as `void.js`: replacing
   * `palette` wholesale drops the base `semantic` group and the adapter falls back to
   * `getSemanticPalette('dark')`. That fallback is AA-correct, but its dim tokens measure brighter
   * than this pack's own secondary text (`--ink-soft` is 6.98:1 here; the fallback `textDim` was
   * 7.18:1), so "dim" text outshone the body text beside it — and nothing was neon.
   *
   * Every value is measured on panel `#141414` and page `#0a0a0a`; the minimum pair is `loss` at
   * 5.73:1 (AA needs 4.5), and `muted 5.71 · textDim 6.47 · ink-soft 6.98 · neutral 6.98` keeps the
   * hierarchy in ascending order. Guarded by `src/theme/semantic-contrast.test.js`.
   */
  semantic: {
    profit: '#00e63c',      // 10.86 / 11.68
    loss: '#ff4d6d',        //  5.73 /  6.16
    buy: '#00e63c',
    sell: '#ff4d6d',
    accentBlue: '#4dd0ff',  // 10.34 / 11.11
    warning: '#ffcc33',     // 12.23 / 13.14
    neutral: '#9aa0a6',     //  6.98 /  7.50 — same as --ink-soft: neutral is not a hierarchy step
    muted: '#8a9096',       //  5.71 /  6.14
    textDim: '#939aa0',     //  6.47 /  6.95
    noticeSuccess: '#00e63c',
    noticeWarning: '#ffcc33',
    noticeCritical: '#ff4d6d',
    noticeInfo: '#4dd0ff',
  },
};

export function createTerminalTokens() {
  const base = createThemeTokens('dark');

  return {
    ...base,
    mode: 'dark',
    palette: TERMINAL_PALETTE,
    shadow: {
      ...base.shadow,
      card: '0 0 12px rgba(0, 255, 65, 0.08), 0 8px 24px rgba(0, 0, 0, 0.8)',
    },
  };
}

export const themePack = {
  id: 'terminal',
  createTokens: createTerminalTokens,
};
