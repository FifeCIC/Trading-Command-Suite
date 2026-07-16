import { useMemo, useState, useCallback, useEffect } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { findTaggedElements } from '../dev-runtime/tags';
import { formatViewMeta } from '../core/view-meta';

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
  const [inspectMode, setInspectMode] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState('');

  const tags = useMemo(() => {
    if (!open) return [];
    return findTaggedElements();
  }, [open]);

  // ── Copy View Info ──
  const handleCopyViewInfo = useCallback(() => {
    const meta = formatViewMeta(window.location.pathname);
    navigator.clipboard.writeText(meta).then(() => {
      setCopiedMsg('View info copied!');
      setTimeout(() => setCopiedMsg(''), 2000);
    }).catch(() => {
      setCopiedMsg('Copy failed');
      setTimeout(() => setCopiedMsg(''), 2000);
    });
  }, []);

  // ── Element Inspector Mode ──
  useEffect(() => {
    if (!inspectMode) return;

    let hoveredEl = null;
    let overlay = null;

    function onMouseMove(e) {
      if (hoveredEl) {
        hoveredEl.style.outline = '';
        hoveredEl = null;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== document.body && el !== document.documentElement) {
        hoveredEl = el;
        el.style.outline = '2px solid #f59e0b';
        el.style.outlineOffset = '1px';
      }
    }

    function onClick(e) {
      if (!hoveredEl) return;
      e.preventDefault();
      e.stopPropagation();
      
      // Copy element snippet
      const clone = hoveredEl.cloneNode(false);
      const snippet = hoveredEl.outerHTML.replace(hoveredEl.innerHTML, '...');
      const tag = hoveredEl.tagName.toLowerCase();
      const id = hoveredEl.id ? `#${hoveredEl.id}` : '';
      const classes = hoveredEl.className && typeof hoveredEl.className === 'string'
        ? `.${hoveredEl.className.split(' ').filter(Boolean).join('.')}`
        : '';
      
      const info = `Element:  <${tag}${id}${classes}>
Snippet:  ${snippet}
Source:   ${window.location.pathname}`;
      
      navigator.clipboard.writeText(info).then(() => {
        setCopiedMsg('Element copied!');
        setTimeout(() => setCopiedMsg(''), 2000);
      }).catch(() => {});

      // Exit inspect mode after copy
      setInspectMode(false);
    }

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.body.style.cursor = 'crosshair';

    return () => {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.body.style.cursor = '';
      if (hoveredEl) hoveredEl.style.outline = '';
    };
  }, [inspectMode]);

  if (!open) return null;

  const healthData = healthQuery?.data || null;
  const healthLoading = healthQuery?.isLoading || false;
  const healthError = healthQuery?.error || null;

  return (
    <div className="dev-overlay-content">
      {/* ── System Status ── */}
      <section className="dev-admin-section">
        <h3 className="dev-section-title">System</h3>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Server</span>
          <span className="dev-stat-value">
            {healthLoading && '…'}
            {healthError && <span className="error">Offline</span>}
            {healthData && <span className="ok">Online</span>}
          </span>
        </div>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Version</span>
          <span className="dev-stat-value muted">{healthData?.version || '—'}</span>
        </div>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Adapters</span>
          <span className="dev-stat-value">{availableAdapters.length}</span>
        </div>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Analytics</span>
          <span className="dev-stat-value muted">{analyticsSnapshot.queueLength} queued</span>
        </div>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Perf</span>
          <span className="dev-stat-value muted">{performanceSnapshot.samples} samples</span>
        </div>

        <div className="dev-stat-row">
          <span className="dev-stat-label">Vitals</span>
          <span className="dev-stat-value muted">{performanceSnapshot.started ? 'Active' : 'Idle'}</span>
        </div>
      </section>

        {/* Actions */}
        <div className="dev-actions">
          <button
            type="button"
            onClick={onDownloadRuntimeReport}
            className="dev-action-btn"
          >
            Export Report
          </button>
          <button
            type="button"
            onClick={handleCopyViewInfo}
            className="dev-action-btn"
            style={{ marginTop: '0.35rem' }}
          >
            📋 Copy View Info
          </button>
          <button
            type="button"
            onClick={() => { setInspectMode(true); setCopiedMsg(''); }}
            className="dev-action-btn"
            style={{ marginTop: '0.35rem' }}
          >
            {inspectMode ? '🔍 Inspecting... (click element)' : '🔍 Inspect Element'}
          </button>
          {copiedMsg && (
            <span style={{ fontSize: '0.68rem', color: '#22c55e', display: 'block', marginTop: '0.25rem' }}>
              {copiedMsg}
            </span>
          )}
        </div>

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
