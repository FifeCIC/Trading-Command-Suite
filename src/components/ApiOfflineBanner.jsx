import './api-offline-banner.css';

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
          href="http://localhost:5188/trading/server-controls"
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
            href="http://localhost:5188/trading/server-controls"
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
