export function assessRuntimeReadiness({ health, analyticsSnapshot, performanceSnapshot, policyMeta, diagnostics }) {
  const warnings = [];
  const blockers = [];

  if (!health?.version) {
    warnings.push('API version not confirmed');
  }

  if (!analyticsSnapshot?.enabled) {
    warnings.push('Analytics disabled');
  }

  if (analyticsSnapshot?.enabled && !analyticsSnapshot?.endpointConfigured) {
    warnings.push('Analytics forwarding not configured');
  }

  if (analyticsSnapshot?.droppedCount > 0) {
    warnings.push(`Dropped analytics events: ${analyticsSnapshot.droppedCount}`);
  }

  if (!performanceSnapshot?.started) {
    warnings.push('Web vitals not started');
  }

  if (policyMeta?.failClosed && !policyMeta?.policyEnforced) {
    blockers.push('Fail-closed is enabled without policy enforcement');
  }

  if ((diagnostics || []).some((item) => item?.level === 'error')) {
    warnings.push('Theme diagnostics include errors');
  }

  let level = 'ready';
  if (blockers.length > 0) {
    level = 'blocked';
  } else if (warnings.length > 0) {
    level = 'warning';
  }

  return {
    level,
    blockers,
    warnings,
    summary: blockers[0] || warnings[0] || 'Runtime posture looks healthy'
  };
}