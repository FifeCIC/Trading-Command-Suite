import { createThemeTokens } from '../tokens.js';

/**
 * SCIFI — a neon cyan pack whose TWO modes are both dark, so it needs TWO semantic sets.
 *
 * ⚠️ ONE SET CANNOT SERVE BOTH (measured 2026-11-26). The panels differ (`#132238` for "light",
 * `#0f1b2e` for dark) and so does the ink scale: `--ink-soft` measures 7.49:1 on the light panel but
 * 5.86:1 on the dark one. A single dim trio either sits above the dark ink-soft (the inversion this
 * fixes) or too close to AA on the light panel. The dims below track each mode's own ink scale.
 *
 * Every value is measured on that mode's own panel and page; the minimum pair is `loss` at 5.14:1
 * (light) / 5.55:1 (dark), AA needing 4.5. Guard: `src/theme/semantic-contrast.test.js`.
 */
const SCIFI_LIGHT = {
  bg: '#0f1b2e',
  ink: '#d6e8ff',
  inkSoft: '#9bb4d0',
  panel: '#132238',
  line: 'rgba(0, 217, 255, 0.35)',
  accent: '#00d9ff',
  danger: '#ff0055',
  semantic: {
    profit: '#37e0a0',      //  9.39 / 10.14
    loss: '#ff5470',        //  5.14 /  5.55
    buy: '#37e0a0',
    sell: '#ff5470',
    accentBlue: '#33d6ff',  //  9.29 / 10.03 — the pack's own cyan, not a foreign blue
    warning: '#ffcf5c',     // 10.91 / 11.78
    neutral: '#a9c0d8',     //  8.54 /  9.22
    muted: '#93aac1',       //  6.67 /  7.22
    textDim: '#9db4cb',     //  7.48 /  8.08 — level with ink-soft (7.49), so hierarchy holds
    noticeSuccess: '#37e0a0',
    noticeWarning: '#ffcf5c',
    noticeCritical: '#ff5470',
    noticeInfo: '#33d6ff',
  }
};

const SCIFI_DARK = {
  bg: '#0a1428',
  ink: '#c1d0e0',
  inkSoft: '#7f99b6',
  panel: '#0f1b2e',
  line: 'rgba(0, 217, 255, 0.3)',
  accent: '#00d9ff',
  danger: '#ff0055',
  semantic: {
    profit: '#37e0a0',      // 10.14 / 10.78
    loss: '#ff5470',        //  5.55 /  5.91
    buy: '#37e0a0',
    sell: '#ff5470',
    accentBlue: '#33d6ff',  // 10.03 / 10.67
    warning: '#ffcf5c',     // 11.78 / 12.53
    neutral: '#8499b0',     //  5.89 /  6.26 — level with ink-soft (5.86)
    muted: '#7b90a8',       //  5.26 /  5.59
    textDim: '#8096ae',     //  5.66 /  6.02
    noticeSuccess: '#37e0a0',
    noticeWarning: '#ffcf5c',
    noticeCritical: '#ff5470',
    noticeInfo: '#33d6ff',
  }
};

export function createSciFiTokens(mode = 'dark') {
  const normalizedMode = mode === 'light' ? 'light' : 'dark';
  const base = createThemeTokens(normalizedMode);
  const palette = normalizedMode === 'light' ? SCIFI_LIGHT : SCIFI_DARK;

  return {
    ...base,
    mode: normalizedMode,
    palette,
    shadow: {
      ...base.shadow,
      card:
        normalizedMode === 'dark'
          ? '0 0 14px rgba(0, 217, 255, 0.15), 0 10px 28px rgba(1, 8, 20, 0.6)'
          : '0 0 12px rgba(0, 217, 255, 0.18), 0 8px 18px rgba(1, 8, 20, 0.35)'
    }
  };
}

export const themePack = {
  id: 'scifi',
  createTokens: createSciFiTokens
};
