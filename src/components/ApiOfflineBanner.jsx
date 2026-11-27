import './api-offline-banner.css';

/**
 * ⚠️ THE LINK IS ROOT-RELATIVE, AND THAT IS THE FIX (2026-11-27). Both anchors used to point at
 * `http://localhost:5188/trading/server-controls`, and **the app is served on 5173** — nothing in
 * `vite.config.js` or the repo configures 5188, so the banner's only action, shown precisely when a
 * reader needs an action, landed on a dead port. Measured: the only two occurrences of `5188` in the
 * whole repository were these two lines.
 *
 * ⚠️ IT IS ALSO THE `external-systems-are-data` RULE. A host and port belong to a deployment, not to a
 * component: this banner is rendered on 27 surfaces, and on any other machine the literal points
 * somewhere that no longer exists. A root-relative path cannot be stale.
 *
 * ⚠️ NOT A react-router `<Link>`. `ApiOfflineBanner` is shown in failure states, and a recovery banner
 * must not assume it is inside `<BrowserRouter>` — a `Link` outside the router throws. A plain anchor to
 * a root-relative path works in both positions, and a full reload after starting the API is a feature
 * here, not a cost.
 */

/**
 * Standardized banner shown when the NestJS backend API is unreachable.
 * Includes a link to the in-app Server Controls page where the backend can be started.
 *
 * Props:
 *   serviceName - optional label (default: "NestJS Backend")
 *   port        - optional port (default: 3201)
 *   compact     - if true, render as a single-line pill instead of full banner
 */
export default function ApiOfflineBanner({ serviceName = 'NestJS Backend', port = 3201, compact = false }) {
  if (compact) {
    return (
      <div className="api-offline-pill" title={`${serviceName} on port ${port} is offline`}>
        <span className="api-offline-pill-icon">⚠️</span>
        <span className="api-offline-pill-text">API offline</span>
        <a
          className="api-offline-pill-link"
          href="/trading/server-controls"
          target="_self"
          rel="noopener noreferrer"
        >
          Start {serviceName}
        </a>
      </div>
    );
  }

  return (
    <div className="api-offline-banner">
      <div className="api-offline-banner-icon">⚠️</div>
      <div className="api-offline-banner-body">
        <strong className="api-offline-banner-title">
          {serviceName} is offline
        </strong>
        <p className="api-offline-banner-text">
          The backend API on port {port} is not responding.{' '}
          Showing cached or sample data where available.
        </p>
        <div className="api-offline-banner-actions">
          <a
            className="api-offline-banner-btn"
            href="/trading/server-controls"
            target="_self"
            rel="noopener noreferrer"
          >
            🖥️ Server Controls
          </a>
          <span className="api-offline-banner-hint">
            Start the <strong>Trading Command Suite (API)</strong> service
          </span>
        </div>
        <p className="api-offline-banner-cmd">
          Or run in terminal:{' '}
          <code>npm --prefix c:\wamp64\www\trading-command-suite\nest run start:dev</code>
        </p>
      </div>
    </div>
  );
}
