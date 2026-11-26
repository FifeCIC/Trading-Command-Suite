import { createThemeTokens } from '../tokens.js';

// Deep void — pure black with neon purple accents.
const VOID_PALETTE = {
  bg: '#08080d',
  ink: '#d4d0e8',
  inkSoft: '#8c82b8',
  panel: '#111118',
  line: 'rgba(138, 80, 255, 0.3)',
  accent: '#8a50ff',
  danger: '#ff3355',
};

export function createVoidTokens() {
  const base = createThemeTokens('dark');

  return {
    ...base,
    mode: 'dark',
    palette: {
      ...VOID_PALETTE,
      /**
       * VOID'S OWN SEMANTIC SET (#861 follow-up, 2026-11-26).
       *
       * ⚠️ A pack that replaces `palette` wholesale loses the base `semantic` group, and
       * `vanilla.js` then falls back to `getSemanticPalette('dark')` — the generic greens and reds.
       * That fallback is AA-correct (#861 measured it), so this is NOT a contrast fix. It is that
       * void could never state its own identity, and the generic set is measurably BRIGHTER than
       * void's own secondary text: `--color-muted` resolved to `#8896ab` at 6.26:1 on void's panel
       * while `--ink-soft` is 5.37:1 — so a "muted" label outshone the body text beside it.
       *
       * ⚠️ Every value below is measured on void's own two surfaces — panel `#111118` and page
       * `#08080d` — and the minimum pair is `muted` at 5.01:1 (AA needs 4.5). The guard is
       * `src/theme/semantic-contrast.test.js`, which runs the SAME adapter the runtime runs, so
       * these numbers cannot drift by hand.
       */
      semantic: {
        profit: '#34d399',      // 9.78 on panel · 10.39 on page
        loss: '#ff5470',        // 6.05 · 6.43
        buy: '#34d399',
        sell: '#ff5470',
        accentBlue: '#a78bfa',  // 6.91 · 7.34 — violet, not blue: it belongs to void's accent family
        warning: '#fbbf24',     // 11.26 · 11.97
        neutral: '#9a92b8',     // 6.42 · 6.83
        muted: '#877fa4',       // 5.01 · 5.33 — the AA floor for this pack
        textDim: '#8b83a8',     // 5.29 · 5.62 — dimmer than `--ink-soft` (5.37), so hierarchy holds
        noticeSuccess: '#34d399',
        noticeWarning: '#fbbf24',
        noticeCritical: '#ff5470',
        noticeInfo: '#a78bfa',
      },
    },
    shadow: {
      ...base.shadow,
      card: '0 0 16px rgba(138, 80, 255, 0.1), 0 8px 24px rgba(0, 0, 0, 0.8)',
    },
  };
}

export const themePack = {
  id: 'void',
  createTokens: createVoidTokens,
};
