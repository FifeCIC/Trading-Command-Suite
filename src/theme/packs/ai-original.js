import { createThemeTokens } from '../tokens';

// Based on doomchart.com/dashboard palette. Variables prefixed for our
// existing theme system while also producing the doomchart CSS variable names.
const AI_ORIGINAL_DARK = {
  // Core surfaces (mapped 1:1 to our --bg / --panel / --line system)
  bg: '#0a0e17',
  ink: '#e6ecf7',
  inkSoft: '#8b9bb8',
  panel: '#111726',
  line: '#1f2a40',
  accent: '#5b8def',
  danger: '#ff5470',

  // Extended doomchart surface layers
  bgElev: '#111726',
  bgElev2: '#161e30',
  border: '#1f2a40',
  borderStrong: '#2c3a57',

  // Doomchart text scale
  textDim: '#8b9bb8',
  textFaint: '#5b6b80',

  // Risk spectrum
  riskNormal: '#2ecc91',
  riskWatch: '#c5a3ff',
  riskElevated: '#ffd166',
  riskHigh: '#ff8c42',
  riskCritical: '#ff5470',

  // Accent soft (for hover / active backgrounds)
  accentSoft: 'rgba(91, 141, 239, 0.12)',
};

const AI_ORIGINAL_LIGHT = {
  bg: '#f0f3f8',
  ink: '#0a0e17',
  inkSoft: '#5b6b80',
  panel: '#ffffff',
  line: '#d4dce8',
  accent: '#4a7de0',
  danger: '#e53e5a',

  bgElev: '#ffffff',
  bgElev2: '#f4f6fa',
  border: '#d4dce8',
  borderStrong: '#b0bfd1',

  textDim: '#5b6b80',
  textFaint: '#8896aa',

  riskNormal: '#1fa870',
  riskWatch: '#8b6fc9',
  riskElevated: '#d4a830',
  riskHigh: '#e07030',
  riskCritical: '#e04050',

  accentSoft: 'rgba(74, 125, 224, 0.10)',
};

export function createAiOriginalTokens(mode = 'dark') {
  const normalizedMode = mode === 'light' ? 'light' : 'dark';
  const base = createThemeTokens(normalizedMode);
  const palette = normalizedMode === 'light' ? AI_ORIGINAL_LIGHT : AI_ORIGINAL_DARK;

  return {
    ...base,
    mode: normalizedMode,
    palette,
    radius: {
      sm: 8,
      md: 14,
    },
    shadow: {
      card:
        normalizedMode === 'dark'
          ? '0 4px 20px rgba(0, 0, 0, 0.4)'
          : '0 4px 16px rgba(15, 23, 42, 0.08)',
    },
    typography: {
      body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: '"SFMono-Regular", ui-monospace, "Cascadia Code", "Consolas", monospace',
    },
  };
}

export const themePack = {
  id: 'ai-original',
  createTokens: createAiOriginalTokens,
};
