import { createThemeTokens } from '../tokens';

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
  const palette = normalizedMode === 'light' ? SLATE_LIGHT : SLATE_DARK;

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
