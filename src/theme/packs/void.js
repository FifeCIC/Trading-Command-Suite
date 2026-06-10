import { createThemeTokens } from '../tokens';

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
    palette: VOID_PALETTE,
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
