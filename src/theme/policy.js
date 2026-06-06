import { env } from '../core/config/env';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseAllowlist(csv) {
  const entries = String(csv || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  const validEntries = entries.filter((item) => ID_PATTERN.test(item));
  const invalidEntries = entries.filter((item) => !ID_PATTERN.test(item));

  return {
    set: new Set(validEntries),
    invalidEntries,
    configured: entries.length > 0
  };
}

function createDiagnostic(level, code, message, details = undefined) {
  return {
    level,
    code,
    message,
    details
  };
}

export function createThemePolicy() {
  const enforced = import.meta.env.PROD || env.VITE_THEME_POLICY_ENFORCED === 'true';
  const failClosed = enforced && (import.meta.env.PROD || env.VITE_THEME_POLICY_FAIL_CLOSED === 'true');
  const packAllowlistState = parseAllowlist(env.VITE_THEME_ALLOWLIST_PACKS);
  const adapterAllowlistState = parseAllowlist(env.VITE_THEME_ALLOWLIST_ADAPTERS);

  return {
    enforced,
    failClosed,
    packAllowlist: packAllowlistState.set,
    adapterAllowlist: adapterAllowlistState.set,
    packAllowlistState,
    adapterAllowlistState
  };
}

export function applyThemePolicy(modules, policy) {
  const baseDiagnostics = Array.isArray(modules?.diagnostics) ? [...modules.diagnostics] : [];
  const violations = [];

  if (policy.packAllowlistState.invalidEntries.length > 0) {
    baseDiagnostics.push(
      createDiagnostic('error', 'PACK_ALLOWLIST_INVALID_ENTRIES', 'Pack allowlist contains invalid ids.', {
        invalidEntries: policy.packAllowlistState.invalidEntries
      })
    );
    violations.push('PACK_ALLOWLIST_INVALID_ENTRIES');
  }

  if (policy.adapterAllowlistState.invalidEntries.length > 0) {
    baseDiagnostics.push(
      createDiagnostic('error', 'ADAPTER_ALLOWLIST_INVALID_ENTRIES', 'Adapter allowlist contains invalid ids.', {
        invalidEntries: policy.adapterAllowlistState.invalidEntries
      })
    );
    violations.push('ADAPTER_ALLOWLIST_INVALID_ENTRIES');
  }

  if (!policy.enforced) {
    baseDiagnostics.push(
      createDiagnostic('info', 'THEME_POLICY_DISABLED', 'Theme allowlist policy is disabled in this environment.')
    );

    return {
      packs: modules.packs,
      adapters: modules.adapters,
      diagnostics: baseDiagnostics,
      meta: {
        policyEnforced: false,
        failClosed: false,
        blockedPacks: [],
        blockedAdapters: [],
        violations
      }
    };
  }

  if (!policy.packAllowlistState.configured) {
    baseDiagnostics.push(
      createDiagnostic('error', 'PACK_ALLOWLIST_EMPTY_CONFIG', 'Pack allowlist is empty while policy is enforced.')
    );
    violations.push('PACK_ALLOWLIST_EMPTY_CONFIG');
  }

  if (!policy.adapterAllowlistState.configured) {
    baseDiagnostics.push(
      createDiagnostic('error', 'ADAPTER_ALLOWLIST_EMPTY_CONFIG', 'Adapter allowlist is empty while policy is enforced.')
    );
    violations.push('ADAPTER_ALLOWLIST_EMPTY_CONFIG');
  }

  const blockedPacks = [];
  const blockedAdapters = [];

  const packs = modules.packs.filter((pack) => {
    const isAllowed = policy.packAllowlist.has(pack.id);
    if (!isAllowed) {
      blockedPacks.push(pack.id);
      baseDiagnostics.push(
        createDiagnostic('warning', 'PACK_BLOCKED_BY_POLICY', 'Theme pack blocked by allowlist policy.', {
          id: pack.id
        })
      );
    }
    return isAllowed;
  });

  const adapters = modules.adapters.filter((adapter) => {
    const isAllowed = policy.adapterAllowlist.has(adapter.id);
    if (!isAllowed) {
      blockedAdapters.push(adapter.id);
      baseDiagnostics.push(
        createDiagnostic('warning', 'ADAPTER_BLOCKED_BY_POLICY', 'Theme adapter blocked by allowlist policy.', {
          id: adapter.id
        })
      );
    }
    return isAllowed;
  });

  if (packs.length === 0) {
    baseDiagnostics.push(
      createDiagnostic(
        'error',
        'PACK_ALLOWLIST_EMPTY_EFFECTIVE',
        'No allowed theme packs were loaded. Runtime fallback pack will be used.'
      )
    );
    violations.push('PACK_ALLOWLIST_EMPTY_EFFECTIVE');
  }

  if (adapters.length === 0) {
    baseDiagnostics.push(
      createDiagnostic(
        'error',
        'ADAPTER_ALLOWLIST_EMPTY_EFFECTIVE',
        'No allowed theme adapters were loaded. Runtime fallback adapter will be used.'
      )
    );
    violations.push('ADAPTER_ALLOWLIST_EMPTY_EFFECTIVE');
  }

  return {
    packs,
    adapters,
    diagnostics: baseDiagnostics,
    meta: {
      policyEnforced: true,
      failClosed: policy.failClosed,
      blockedPacks,
      blockedAdapters,
      violations
    }
  };
}

export function assertFailClosedPolicy(policyResult) {
  const policyMeta = policyResult?.meta;
  if (!policyMeta?.policyEnforced || !policyMeta?.failClosed) {
    return;
  }

  const violations = Array.isArray(policyMeta.violations) ? policyMeta.violations : [];
  if (violations.length === 0) {
    return;
  }

  const message = `Theme policy fail-closed violation: ${violations.join(', ')}`;
  throw new Error(message);
}
