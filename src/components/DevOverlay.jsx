import { useMemo } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { findTaggedElements } from '../dev-runtime/tags';

/**
 * Dev Overlay — primary panel for Admin + Status information.
 *
 * Always shows when devOverlayOpen is true. Admin/Status data is the
 * primary content; tagged runtime elements appear below.
 */
export default function DevOverlay({
  healthQuery,
  availableAdapters,
  analyticsSnapshot,
  performanceSnapshot,
  onDownloadRuntimeReport,
}) {
  const open = useUiStore((state) => state.devOverlayOpen);

  const tags = useMemo(() => {
    if (!open) return [];
    return findTaggedElements();
  }, [open]);

  if (!open) return null;

  const healthData = healthQuery?.data || null;
  const healthLoading = healthQuery?.isLoading || false;
  const healthError = healthQuery?.error || null;

  return (
    <div className="dev-overlay-content">
      {/* ── Admin + Status (primary) ── */}
      <section className="dev-admin-section">
        <h3 className="dev-section-title">Admin + Status</h3>

        {/* Server */}
        <div className="dev-stat-row">
          <span className="dev-stat-label">Server</span>
          <span className="dev-stat-value">
            {healthLoading && 'Checking...'}
            {healthError && <span className="error">Offline</span>}
            {healthData && (
              <span className="ok">Online: {healthData.version || 'unknown'}</span>
            )}
          </span>
        </div>

        {/* Adapters */}
        <div className="dev-stat-row">
          <span className="dev-stat-label">Adapters</span>
          <span className="dev-stat-value muted">{availableAdapters.length}</span>
        </div>

        {/* Analytics */}
        <div className="dev-stat-row">
          <span className="dev-stat-label">Analytics</span>
          <span className="dev-stat-value muted">{analyticsSnapshot.queueLength} queued</span>
        </div>

        {/* Performance */}
        <div className="dev-stat-row">
          <span className="dev-stat-label">Perf</span>
          <span className="dev-stat-value muted">{performanceSnapshot.samples} samples</span>
        </div>

        {/* Vitals */}
        <div className="dev-stat-row">
          <span className="dev-stat-label">Vitals</span>
          <span className="dev-stat-value muted">
            {performanceSnapshot.started ? 'tracking' : 'idle'}
          </span>
        </div>

        {/* Actions */}
        <div className="dev-actions">
          <button
            type="button"
            onClick={onDownloadRuntimeReport}
            className="dev-action-btn"
          >
            Export Report
          </button>
        </div>
      </section>

      {/* ── Tagged elements (secondary) ── */}
      {tags.length > 0 && (
        <section className="dev-tags-section">
          <h3 className="dev-section-title">Runtime Tags</h3>
          <ul className="dev-tag-list">
            {tags.map((item, index) => (
              <li key={`${item.tag}-${index}`}>
                <strong>{item.tag}</strong>
                <span>{item.meta}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tags.length === 0 && (
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          No tagged elements detected.
        </p>
      )}
    </div>
  );
}
