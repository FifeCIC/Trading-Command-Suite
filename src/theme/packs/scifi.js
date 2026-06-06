import { createThemeTokens } from '../tokens';

const SCIFI_LIGHT = {
  bg: '#0f1b2e',
  ink: '#d6e8ff',
  inkSoft: '#9bb4d0',
  panel: '#132238',
  line: 'rgba(0, 217, 255, 0.35)',
  accent: '#00d9ff',
  danger: '#ff0055'
};

const SCIFI_DARK = {
  bg: '#0a1428',
  ink: '#c1d0e0',
  inkSoft: '#7f99b6',
  panel: '#0f1b2e',
  line: 'rgba(0, 217, 255, 0.3)',
  accent: '#00d9ff',
  danger: '#ff0055'
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
