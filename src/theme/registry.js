const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMode(mode) {
  return mode === 'dark' ? 'dark' : 'light';
}

function createDiagnostic(level, code, message, details = undefined) {
  return {
    level,
    code,
    message,
    details
  };
}

function validateId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function isValidTokenBundle(tokens) {
  if (!isPlainObject(tokens) || !isPlainObject(tokens.palette)) {
    return false;
  }

  const requiredPaletteKeys = ['bg', 'ink', 'inkSoft', 'panel', 'line', 'accent', 'danger'];

  return requiredPaletteKeys.every((key) => typeof tokens.palette[key] === 'string' && tokens.palette[key].length > 0);
}

export function createThemeRegistry({ packs = [], adapters = [], initialDiagnostics = [] } = {}) {
  const packMap = new Map();
  const adapterMap = new Map();
  const diagnostics = Array.isArray(initialDiagnostics) ? [...initialDiagnostics] : [];

  function pushDiagnostic(level, code, message, details) {
    diagnostics.push(createDiagnostic(level, code, message, details));
  }

  function registerPack(pack) {
    if (!pack || typeof pack !== 'object') {
      pushDiagnostic('error', 'PACK_INVALID', 'Skipped invalid pack module.', { pack });
      return false;
    }

    if (!validateId(pack.id)) {
      pushDiagnostic('error', 'PACK_ID_INVALID', 'Skipped pack with invalid id format.', { id: pack.id });
      return false;
    }

    if (typeof pack.createTokens !== 'function') {
      pushDiagnostic('error', 'PACK_CREATE_TOKENS_MISSING', 'Skipped pack without createTokens function.', {
        id: pack.id
      });
      return false;
    }

    if (packMap.has(pack.id)) {
      pushDiagnostic('error', 'PACK_DUPLICATE', 'Skipped duplicate theme pack id.', { id: pack.id });
      return false;
    }

    packMap.set(pack.id, pack);
    return true;
  }

  function registerAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      pushDiagnostic('error', 'ADAPTER_INVALID', 'Skipped invalid adapter module.', { adapter });
      return false;
    }

    if (!validateId(adapter.id)) {
      pushDiagnostic('error', 'ADAPTER_ID_INVALID', 'Skipped adapter with invalid id format.', { id: adapter.id });
      return false;
    }

    if (typeof adapter.transform !== 'function') {
      pushDiagnostic('error', 'ADAPTER_TRANSFORM_MISSING', 'Skipped adapter without transform function.', {
        id: adapter.id
      });
      return false;
    }

    if (adapterMap.has(adapter.id)) {
      pushDiagnostic('error', 'ADAPTER_DUPLICATE', 'Skipped duplicate adapter id.', { id: adapter.id });
      return false;
    }

    adapterMap.set(adapter.id, adapter);
    return true;
  }

  function listPacks() {
    return Array.from(packMap.keys());
  }

  function listAdapters() {
    return Array.from(adapterMap.keys());
  }

  function getDiagnostics() {
    return [...diagnostics];
  }

  function resolvePack(requestedPackId, runDiagnostics) {
    if (packMap.has(requestedPackId)) {
      return {
        packId: requestedPackId,
        fallbackUsed: false
      };
    }

    // ⚠️ SLATE, NOT CORE (2026-10-12). This is the pack used when the stored id is unknown or missing
    // — the app's real default. It read `core` until the owner asked for slate to be the default and
    // `ai-original` to be removed: leaving it as `core` would have dropped every browser with
    // `ai-original` stored onto a DIFFERENT pack than the one asked for, and that would have looked
    // like "the default did not change" rather than like a bug. Packs are discovered by filename
    // (`packs/*.js`), so deleting the old pack file is what removes it from `packMap`.
    const fallbackPackId = packMap.has('slate')
      ? 'slate'
      : (packMap.has('core') ? 'core' : listPacks()[0]);

    if (!fallbackPackId) {
      throw new Error('No valid theme packs registered.');
    }

    runDiagnostics.push(
      createDiagnostic('warning', 'PACK_FALLBACK', 'Requested theme pack not found. Using fallback pack.', {
        requestedPackId,
        fallbackPackId
      })
    );

    return {
      packId: fallbackPackId,
      fallbackUsed: true
    };
  }

  function build({ pack = 'core', mode = 'light', adapterIds } = {}) {
    const runDiagnostics = [];
    const resolvedMode = normalizeMode(mode);
    const { packId, fallbackUsed } = resolvePack(pack, runDiagnostics);
    const selectedPack = packMap.get(packId);

    let tokens;
    try {
      tokens = selectedPack.createTokens(resolvedMode);
    } catch (error) {
      runDiagnostics.push(
        createDiagnostic('error', 'PACK_RUNTIME_ERROR', 'Theme pack threw during token generation.', {
          packId,
          error: error instanceof Error ? error.message : String(error)
        })
      );

      const fallbackPackId = packMap.has('slate')
      ? 'slate'
      : (packMap.has('core') ? 'core' : listPacks()[0]);
      const fallbackPack = packMap.get(fallbackPackId);
      tokens = fallbackPack.createTokens(resolvedMode);
    }

    if (!isValidTokenBundle(tokens)) {
      runDiagnostics.push(
        createDiagnostic('error', 'TOKENS_INVALID', 'Pack returned an invalid token bundle. Falling back to core.', {
          packId
        })
      );

      const fallbackPackId = packMap.has('slate')
      ? 'slate'
      : (packMap.has('core') ? 'core' : listPacks()[0]);
      tokens = packMap.get(fallbackPackId).createTokens(resolvedMode);
    }

    const requestedAdapters = Array.isArray(adapterIds) && adapterIds.length > 0 ? adapterIds : listAdapters();
    const uniqueRequestedAdapters = Array.from(new Set(requestedAdapters));
    const outputs = {};

    uniqueRequestedAdapters.forEach((id) => {
      const adapter = adapterMap.get(id);

      if (!adapter) {
        runDiagnostics.push(
          createDiagnostic('warning', 'ADAPTER_NOT_FOUND', 'Requested adapter not found and was skipped.', { id })
        );
        return;
      }

      try {
        outputs[id] = adapter.transform(tokens);
      } catch (error) {
        runDiagnostics.push(
          createDiagnostic('error', 'ADAPTER_RUNTIME_ERROR', 'Adapter transform threw and was skipped.', {
            id,
            error: error instanceof Error ? error.message : String(error)
          })
        );
      }
    });

    return {
      packId,
      tokens,
      adapters: outputs,
      meta: {
        mode: resolvedMode,
        requestedPack: pack,
        resolvedPack: packId,
        fallbackUsed,
        availablePacks: listPacks(),
        availableAdapters: listAdapters(),
        diagnostics: [...diagnostics, ...runDiagnostics]
      }
    };
  }

  packs.forEach(registerPack);
  adapters.forEach(registerAdapter);

  return {
    registerPack,
    registerAdapter,
    listPacks,
    listAdapters,
    getDiagnostics,
    build
  };
}
