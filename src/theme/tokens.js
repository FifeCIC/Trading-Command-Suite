const LIGHT_PALETTE = {
  bg: '#f4f7fb',
  ink: '#0f172a',
  inkSoft: '#334155',
  panel: '#ffffff',
  line: '#d9e2ec',
  accent: '#0ea5a6',
  danger: '#dc2626'
};

const DARK_PALETTE = {
  bg: '#0b1220',
  ink: '#e2e8f0',
  inkSoft: '#a7b4c6',
  panel: '#111b2e',
  line: '#23324a',
  accent: '#22d3ee',
  danger: '#f87171'
};

export function createThemeTokens(mode = 'light') {
  const normalizedMode = mode === 'dark' ? 'dark' : 'light';
  const palette = normalizedMode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;

  return {
    mode: normalizedMode,
    palette,
    radius: {
      sm: 10,
      md: 14
    },
    shadow: {
      card:
        normalizedMode === 'dark'
          ? '0 12px 28px rgba(2, 6, 23, 0.45)'
          : '0 10px 24px rgba(15, 23, 42, 0.08)'
    },
    typography: {
      body: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    }
  };
}
