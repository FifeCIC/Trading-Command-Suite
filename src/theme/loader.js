function createDiagnostic(level, code, message, details = undefined) {
  return {
    level,
    code,
    message,
    details
  };
}

function ensureThemePack(modulePath, mod, diagnostics) {
  if (!mod?.themePack) {
    diagnostics.push(
      createDiagnostic('error', 'PACK_EXPORT_MISSING', 'Theme pack module missing themePack export.', {
        modulePath
      })
    );
    return null;
  }

  return mod.themePack;
}

function ensureThemeAdapter(modulePath, mod, diagnostics) {
  if (!mod?.themeAdapter) {
    diagnostics.push(
      createDiagnostic('error', 'ADAPTER_EXPORT_MISSING', 'Theme adapter module missing themeAdapter export.', {
        modulePath
      })
    );
    return null;
  }

  return mod.themeAdapter;
}

export function loadThemeModules() {
  const diagnostics = [];
  const packModules = import.meta.glob('./packs/*.js', { eager: true });
  const adapterModules = import.meta.glob('./adapters/*.js', { eager: true });

  const packs = Object.entries(packModules)
    .map(([path, mod]) => ensureThemePack(path, mod, diagnostics))
    .filter(Boolean);
  const adapters = Object.entries(adapterModules)
    .map(([path, mod]) => ensureThemeAdapter(path, mod, diagnostics))
    .filter(Boolean);

  return {
    packs,
    adapters,
    diagnostics
  };
}
