/**
 * CFD Trading Page (Placeholder)
 * ===============================
 * Trading212 CFD account — currently unavailable.
 * The practice API key doesn't support CFD endpoints.
 * Will be wired when live CFD access is available.
 */

import './t212-cfd.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function T212CFDPage() {
  return (
    <div className="t212c-page">
      <header className="t212c-header">
        <h1>CFD Trading
          <PageInfoPopover>
            Contracts for Difference — leveraged trading on indices, forex, commodities, and shares.
          </PageInfoPopover>
        </h1>
      </header>

      <section className="t212c-section">
        <div className="t212c-placeholder">
          <div className="t212c-placeholder-icon">🔒</div>
          <h2>CFD Access Not Available</h2>
          <p>
            Trading212's CFD API requires a <strong>live account</strong> with CFD permissions enabled.
            The practice/demo API key does not support CFD endpoints.
          </p>
          <p>
            Once a live CFD-enabled account is connected, this page will display:
          </p>
          <ul className="t212c-feature-list">
            <li>Open CFD positions with leverage and margin</li>
            <li>Real-time P&L with overnight swap tracking</li>
            <li>Stop-loss and take-profit management</li>
            <li>Margin utilisation and free margin indicators</li>
            <li>Order history with entry/exit timestamps</li>
          </ul>
          <p className="t212c-note">
            CFD trading carries a high risk of rapid capital loss. 70-80% of retail CFD accounts lose money.
          </p>
        </div>
      </section>

      <section className="t212c-section">
        <h2>Planned Data Points</h2>
        <div className="t212c-summary-grid">
          <div className="t212c-stat">
            <span className="t212c-stat-label">Equity</span>
            <span className="t212c-stat-value">—</span>
          </div>
          <div className="t212c-stat">
            <span className="t212c-stat-label">Margin Used</span>
            <span className="t212c-stat-value">—</span>
          </div>
          <div className="t212c-stat">
            <span className="t212c-stat-label">Free Margin</span>
            <span className="t212c-stat-value">—</span>
          </div>
          <div className="t212c-stat">
            <span className="t212c-stat-label">Margin Level</span>
            <span className="t212c-stat-value">—</span>
          </div>
        </div>
      </section>
    </div>
  );
}
