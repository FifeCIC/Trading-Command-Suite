import { createThemeTokens } from '../tokens';

// Bloomberg Terminal inspired — pure black with neon green accents.
const TERMINAL_PALETTE = {
  bg: '#0a0a0a',
  ink: '#e0e0e0',
  inkSoft: '#9aa0a6',
  panel: '#141414',
  line: 'rgba(0, 255, 65, 0.25)',
  accent: '#00ff41',
  danger: '#ff0040',
};

export function createTerminalTokens(mode = 'dark') {
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
