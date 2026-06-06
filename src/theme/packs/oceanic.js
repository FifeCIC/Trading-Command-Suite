import { createThemeTokens } from '../tokens';

export function createOceanicTokens(mode = 'light') {
  const base = createThemeTokens(mode);
  const isDark = mode === 'dark';

  return {
    ...base,
    palette: {
      ...base.palette,
      bg: isDark ? '#081a26' : '#ecf9ff',
      panel: isDark ? '#102838' : '#f7fcff',
      accent: isDark ? '#38bdf8' : '#0369a1'
    },
    shadow: {
      ...base.shadow,
      card: isDark ? '0 12px 28px rgba(1, 9, 18, 0.55)' : '0 10px 24px rgba(3, 105, 161, 0.18)'
    }
  };
}

export const themePack = {
  id: 'oceanic',
  createTokens: createOceanicTokens
};
