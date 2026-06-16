import { useEffect, useMemo } from 'react';
import { buildThemeBundle } from './index';

function isSafeCssVariableName(name) {
  return typeof name === 'string' && /^--[a-z0-9-]{1,64}$/i.test(name);
}

function createSafeFallbackBundle() {
  return {
    packId: 'runtime-fallback',
    tokens: {
      mode: 'light',
      palette: {
        bg: '#f4f7fb',
        ink: '#0f172a',
        inkSoft: '#334155',
        panel: '#ffffff',
        line: '#d9e2ec',
        accent: '#0ea5a6',
        danger: '#dc2626'
      }
    },
    adapters: {
      vanilla: {
        '--bg': '#f4f7fb',
        '--ink': '#0f172a',
        '--ink-soft': '#334155',
        '--panel': '#ffffff',
        '--line': '#d9e2ec',
        '--accent': '#0ea5a6',
        '--danger': '#dc2626'
      }
    },
    meta: {
      mode: 'light',
      requestedPack: 'runtime-fallback',
      resolvedPack: 'runtime-fallback',
      fallbackUsed: true,
      availablePacks: [],
      availableAdapters: ['vanilla'],
      diagnostics: [
        {
          level: 'error',
          code: 'RUNTIME_BUILD_FAILURE',
          message: 'Theme runtime failed and used safe fallback defaults.'
        }
      ]
    }
  };
}

export function useThemeRuntime({ mode, packId = 'core', adapterIds } = {}) {
  const bundle = useMemo(() => {
    try {
      return buildThemeBundle(mode, { pack: packId, adapterIds });
    } catch {
      return createSafeFallbackBundle();
    }
  }, [mode, packId, adapterIds]);

  useEffect(() => {
    const root = document.documentElement;

    const cssVars = bundle.adapters.vanilla || bundle.adapters['vanilla-fallback'] || {};

    Object.entries(cssVars).forEach(([key, value]) => {
      if (isSafeCssVariableName(key) && (typeof value === 'string' || typeof value === 'number')) {
        root.style.setProperty(key, String(value), 'important');
      }
    });

    root.setAttribute('data-theme-pack', bundle.packId || 'unknown');
    root.setAttribute('data-theme-mode', bundle.tokens?.mode || 'light');
  }, [bundle]);

  return bundle;
}
