import { useState, useCallback, useEffect } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { getViewMeta } from '../core/view-meta';

/**
 * Dev Overlay — primary panel for Admin + Status information.
 *
 * Always shows when devOverlayOpen is true. Admin/Status data is the
 * primary content; tagged runtime elements appear below.
 *
 * Inspect Mode: click any UI element to open its source file in VS Code.
 * Requires `code` command in PATH on the development machine.
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

  // ── Copy View Info ──
  const handleCopyViewInfo = useCallback(() => {
    const meta = getViewMeta(window.location.pathname);
    if (!meta) {
      setCopiedMsg('No metadata for this route');
      setTimeout(() => setCopiedMsg(''), 2000);
      return;
    }
    const text = [
      `View:       ${meta.label}`,
      `Route:      ${window.location.pathname}`,
      `File:       ${meta.file}`,
      `CSS:        ${meta.css}`,
      `API:        ${(meta.api || []).join(', ') || 'None'}`,
      `Component:  <${meta.label.replace(/\s+/g, '')} />`,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
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
      
      // Resolve route to source file
      const meta = getViewMeta(window.location.pathname);
      const file = meta?.file || null;
      
      // Extract a short text query from the element for line matching
      const text = (hoveredEl.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60);
      
      if (file) {
        setCopiedMsg(text ? `Opening "${text}"...` : `Opening ${file}...`);
        fetch('http://localhost:3201/api/dev/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, query: text || undefined }),
        }).then(r => r.json()).then(data => {
          const msg = data.line
            ? `Opened ${file}:${data.line}`
            : data.opened ? `Opened: ${file}` : `Failed: ${data.error || 'unknown'}`;
          setCopiedMsg(msg);
          setTimeout(() => setCopiedMsg(''), 3000);
        }).catch(() => {
          setCopiedMsg('Backend unreachable');
          setTimeout(() => setCopiedMsg(''), 2000);
        });
      } else {
        setCopiedMsg('No source file mapped for this route');
        setTimeout(() => setCopiedMsg(''), 2000);
      }

      if (hoveredEl) {
        hoveredEl.style.outline = '';
        hoveredEl = null;
      }
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

  // ── Escape key closes inspect mode or overlay ──
  const toggleDevOverlay = useUiStore((state) => state.toggleDevOverlay);
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (inspectMode) {
          setInspectMode(false);
        } else {
          toggleDevOverlay();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, inspectMode, toggleDevOverlay]);

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
          <span className={`dev-stat-value ${healthData ? 'ok' : healthError ? 'error' : 'muted'}`}>
            {healthLoading ? '…' : healthData ? 'Online' : healthError ? 'Offline' : '—'}
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
            {inspectMode ? '🔍 Click element to open in VS Code...' : '🔍 Inspect Element'}
          </button>
          {copiedMsg && (
            <span style={{ fontSize: '0.68rem', color: '#22c55e', display: 'block', marginTop: '0.25rem' }}>
              {copiedMsg}
            </span>
          )}
        </div>
    </div>
  );
}
