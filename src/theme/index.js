import { loadThemeModules } from './loader';
import { applyThemePolicy, assertFailClosedPolicy, createThemePolicy } from './policy';
import { createThemeRegistry } from './registry';
import { createThemeTokens } from './tokens';

const discoveredModules = loadThemeModules();
const policy = createThemePolicy();
const modules = applyThemePolicy(discoveredModules, policy);
assertFailClosedPolicy(modules);
const fallbackPack = {
  id: 'core-fallback',
  createTokens: createThemeTokens
};
const fallbackVanillaAdapter = {
  id: 'vanilla-fallback',
  transform: (tokens) => ({
    '--bg': tokens.palette?.bg || '#f4f7fb',
    '--ink': tokens.palette?.ink || '#0f172a',
    '--ink-soft': tokens.palette?.inkSoft || '#334155',
    '--panel': tokens.palette?.panel || '#ffffff',
    '--line': tokens.palette?.line || '#d9e2ec',
    '--accent': tokens.palette?.accent || '#0ea5a6',
    '--danger': tokens.palette?.danger || '#dc2626'
  })
};

const safePacks = modules.packs.length > 0 ? modules.packs : [fallbackPack];
const safeAdapters = modules.adapters.length > 0 ? modules.adapters : [fallbackVanillaAdapter];

const registry = createThemeRegistry({
  packs: safePacks,
  adapters: safeAdapters,
  initialDiagnostics: modules.diagnostics
});

export function buildThemeBundle(mode = 'light', options = {}) {
  const bundle = registry.build({ mode, ...options });

  return {
    ...bundle,
    meta: {
      ...bundle.meta,
      policy: modules.meta
    }
  };
}

export function getThemeRegistry() {
  return registry;
}
