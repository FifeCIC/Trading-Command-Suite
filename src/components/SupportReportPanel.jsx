/**
 * SupportReportPanel — the REVIEW half of the support service (#1248).
 *
 * ⚠️ THE REVIEW STEP IS THE SAFETY MECHANISM, NOT A NICETY.
 * Owner decision 2026-11-07, option B: response bodies are allowed into a report
 * because "sometimes we're going to need to know the numbers" — but the report is
 * shown in full, here, before anything is copied. There is no send button, no
 * telemetry and no endpoint: the report is a local artefact the user hands over.
 *
 * Input:  the app's own buffered errors/failures, /api/health, /api/version
 * Output: a Markdown report on the clipboard (plus the JSON twin for a future sink)
 *
 * ⚠️ Every fetch here is wrapped so a FAILED collection is a stated fact
 * ("Could not collect") rather than a blank block that reads as healthy.
 */
import { useState } from 'react';
import { buildSupportReport } from '../core/support/report-build';
import { getSupportSnapshot, isSupportCaptureActive, withSupportCapturePaused } from '../core/support/report-buffers';
import { apiGet } from '../core/api/client';

const mono = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '0.72rem',
  lineHeight: 1.35,
};

export default function SupportReportPanel({ experienceLevel }) {
  const [includeBodies, setIncludeBodies] = useState(false);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('');

  async function buildReport() {
    setStatus('Collecting…');
    let system;
    try {
      // ⚠️ Paused capture: these calls are the report collecting facts, not a fault the user
      // experienced. Left unpaused they crowd out the real failure (#1248, measured in the app).
      // ⚠️ The paths carry `/api` — `VITE_API_BASE_URL` is the host only, and a bare '/health'
      // silently 404s against the dev server (measured 2026-11-07).
      const [health, version] = await withSupportCapturePaused(() =>
        Promise.all([apiGet('/api/health'), apiGet('/api/version')]),
      );
      system = { health, version };
    } catch (err) {
      system = { error: err?.message || String(err) };
    }

    const snapshot = getSupportSnapshot();
    const built = buildSupportReport({
      context: {
        route: `${window.location.pathname}${window.location.search}`,
        appVersion: system?.version?.version,
        experienceLevel,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        userAgent: navigator.userAgent,
      },
      errors: snapshot.errors,
      requests: snapshot.requests,
      includeBodies,
      system,
      captureActive: isSupportCaptureActive(),
    });
    setReport(built);
    setStatus('');
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.markdown);
      setStatus('✅ Copied — paste into a GitHub issue or email it.');
    } catch {
      setStatus('Copy failed — select the text below and copy it manually.');
    }
  }

  return (
    <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--line)', paddingTop: '0.6rem' }}>
      <div className="dev-section-title" style={{ marginBottom: '0.4rem' }}>Report a problem</div>

      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontSize: '0.75rem', color: 'var(--ink-soft)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={includeBodies}
          onChange={(e) => setIncludeBodies(e.target.checked)}
          style={{ marginTop: '0.15rem' }}
        />
        <span>
          Include response data
          <br />
          <span style={{ opacity: 0.8 }}>Often needed to see a wrong number. Can contain balances and positions.</span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button type="button" className="topbar-calc-btn" style={{ minHeight: 32, minWidth: 0, padding: '0.25rem 0.6rem' }} onClick={buildReport}>
          Build report
        </button>
        {report && (
          <button type="button" className="topbar-calc-btn" style={{ minHeight: 32, minWidth: 0, padding: '0.25rem 0.6rem' }} onClick={copyReport}>
            Copy
          </button>
        )}
      </div>

      {status && (
        <p role="status" aria-live="polite" style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
          {status}
        </p>
      )}

      {report && (
        <>
          <p style={{ margin: '0.45rem 0 0.25rem', fontSize: '0.7rem', color: 'var(--ink-soft)' }}>
            Read this before copying — it is exactly what leaves the app.
          </p>
          <pre
            aria-label="Report preview"
            style={{
              ...mono,
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '0.5rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {report.markdown}
          </pre>
        </>
      )}
    </div>
  );
}
