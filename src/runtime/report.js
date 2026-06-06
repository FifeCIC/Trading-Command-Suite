import { assessRuntimeReadiness } from './readiness';

function createReportEnvelope({ appId, context, readiness, telemetry, runtime, diagnostics, activity }) {
  return {
    schemaVersion: 'runtime-report.v1',
    generatedAt: new Date().toISOString(),
    app: {
      id: appId,
      context
    },
    readiness,
    telemetry,
    runtime,
    diagnostics,
    activity
  };
}

export function buildRuntimeReport({
  health,
  analyticsSnapshot,
  performanceSnapshot,
  themePack,
  themeMode,
  availablePacks,
  availableAdapters,
  diagnostics,
  policyMeta,
  activityLog,
  primaryArea,
  secondaryView
}) {
  const readiness = assessRuntimeReadiness({
    health,
    analyticsSnapshot,
    performanceSnapshot,
    policyMeta,
    diagnostics
  });

  return createReportEnvelope({
    appId: 'tradingcs',
    context: {
      area: primaryArea,
      view: secondaryView
    },
    readiness,
    telemetry: {
      analytics: analyticsSnapshot,
      performance: performanceSnapshot,
      serverAnalytics: null
    },
    runtime: {
      health,
      usage: null,
      pricing: null,
      theme: {
        pack: themePack,
        mode: themeMode,
        policy: policyMeta,
        availablePacks,
        availableAdapters
      }
    },
    diagnostics: {
      errors: [],
      themeDiagnostics: diagnostics
    },
    activity: {
      recent: activityLog
    }
  });
}

export function exportRuntimeReport(report, mode = 'download') {
  const payload = JSON.stringify(report, null, 2);

  if (mode === 'copy') {
    return navigator.clipboard.writeText(payload);
  }

  const blob = new Blob([payload], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tradingcs-runtime-${Date.now()}.json`;
  link.click();
  window.URL.revokeObjectURL(url);
}
