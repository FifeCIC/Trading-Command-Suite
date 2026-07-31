/**
 * Stocks ISA Page
 * ===============
 * Trading212 Stocks & Shares ISA dashboard — allowance tracking,
 * FX impact analysis, positions, and tax-year summary.
 *
 * Data: /api/isa/dashboard, /api/isa/fx-warning
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './t212-isa.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function T212ISAPage() {
  const isa = useQuery({
    queryKey: ['isa-dashboard'],
    queryFn: () => apiGet('/api/isa/dashboard').catch(() => null),
    refetchInterval: 120_000,
    retry: 1,
  });

  const fx = useQuery({
    queryKey: ['isa-fx-warning'],
    queryFn: () => apiGet('/api/isa/fx-warning').catch(() => null),
    refetchInterval: 300_000,
    retry: 1,
  });

  if (isa.isLoading) {
    return <div className="t212i-page"><p className="t212i-loading">Loading ISA data…</p></div>;
  }

  const data = isa.data;
  if (!data || data.status === 'error' || data.status === 'not_configured') {
    return (
      <div className="t212i-page">
        <header className="t212i-header">
          <h1>Stocks & Shares ISA
          <PageInfoPopover>
            Trading212 Stocks & Shares ISA — allowance tracking, positions, and tax-year summary.
          </PageInfoPopover>
        </h1>
        </header>
        <section className="t212i-section">
          <div className="t212i-placeholder">
            <div className="t212i-placeholder-icon">🔒</div>
            <h2>ISA Account Not Connected</h2>
            <p>
              The Stocks &amp; Shares ISA dashboard requires a <strong>live Trading212 account</strong>
              {' '}with an active ISA subscription. Set <code>TRADING212_ISA_API_KEY</code> in your
              environment to connect.
            </p>
            <p>Once connected, this page will display:</p>
            <ul className="t212i-feature-list">
              <li>ISA allowance tracker with remaining contribution headroom</li>
              <li>Portfolio positions with P&amp;L and currency impact</li>
              <li>FX impact analysis for foreign-listed holdings</li>
              <li>Tax-year summary and trading window guidance</li>
              <li>Real-time account value and cash balance</li>
            </ul>
          </div>
        </section>
        <section className="t212i-section">
          <h2>Planned Data Points</h2>
          <div className="t212i-summary-grid">
            <div className="t212i-stat">
              <span className="t212i-stat-label">Allowance Used</span>
              <span className="t212i-stat-value">—</span>
            </div>
            <div className="t212i-stat">
              <span className="t212i-stat-label">Total Value</span>
              <span className="t212i-stat-value">—</span>
            </div>
            <div className="t212i-stat">
              <span className="t212i-stat-label">Cash</span>
              <span className="t212i-stat-value">—</span>
            </div>
            <div className="t212i-stat">
              <span className="t212i-stat-label">Positions</span>
              <span className="t212i-stat-value">—</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const { summary, allowance, fxImpact, warnings, positions, tradingWindow } = data;
  const usedPct = allowance?.limitGbp > 0 ? (allowance.usedGbp / allowance.limitGbp) * 100 : 0;

  return (
    <div className="t212i-page">
      <header className="t212i-header">
        <h1>Stocks & Shares ISA</h1>
        <p className="t212i-subtitle">
          Tax year {allowance?.taxYear} · {allowance?.limitGbp ? `£${allowance.limitGbp.toLocaleString()} allowance` : ''}
        </p>
      </header>

      {/* ── Allowance Tracker ── */}
      <section className="t212i-section">
        <h2>ISA Allowance</h2>
        <div className="t212i-allowance-bar">
          <div className="t212i-allowance-fill" style={{ width: `${Math.min(usedPct, 100)}%` }}>
            {usedPct > 12 && <span>{usedPct.toFixed(0)}% used</span>}
          </div>
        </div>
        <div className="t212i-allowance-stats">
          <div className="t212i-stat">
            <span className="t212i-stat-label">Used</span>
            <span className="t212i-stat-value">£{allowance?.usedGbp?.toLocaleString() || '0'}</span>
          </div>
          <div className="t212i-stat">
            <span className="t212i-stat-label">Remaining</span>
            <span className="t212i-stat-value t212i-profit">£{allowance?.remainingGbp?.toLocaleString() || '—'}</span>
          </div>
          <div className="t212i-stat">
            <span className="t212i-stat-label">Source</span>
            <span className="t212i-stat-value t212i-stat-small">{allowance?.source || 'unknown'}</span>
          </div>
        </div>
      </section>

      {/* ── Account Summary ── */}
      <section className="t212i-section">
        <h2>Account</h2>
        <div className="t212i-summary-grid">
          <div className="t212i-stat">
            <span className="t212i-stat-label">Total Value</span>
            <span className="t212i-stat-value">£{summary?.totalValueGbp?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212i-stat">
            <span className="t212i-stat-label">Cash</span>
            <span className="t212i-stat-value">£{summary?.cashGbp?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212i-stat">
            <span className="t212i-stat-label">Invested</span>
            <span className="t212i-stat-value">£{summary?.investedGbp?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212i-stat">
            <span className="t212i-stat-label">Result</span>
            <span className={`t212i-stat-value ${summary?.resultGbp > 0 ? 't212i-profit' : summary?.resultGbp < 0 ? 't212i-loss' : ''}`}>
              £{summary?.resultGbp?.toFixed(2) || '—'}
            </span>
          </div>
        </div>
      </section>

      {/* ── FX Impact ── */}
      {fxImpact && fxImpact.foreignPositionCount > 0 && (
        <section className="t212i-section">
          <h2>💱 FX Impact</h2>
          <div className="t212i-fx-card">
            <p>{fxImpact.message || 'FX impact data available.'}</p>
            <div className="t212i-fx-stats">
              <span>Foreign positions: <strong>{fxImpact.foreignPositionCount}</strong></span>
              {fxImpact.observedFxPplGbp != null && (
                <span className={fxImpact.observedFxPplGbp > 0 ? 't212i-profit' : 't212i-loss'}>
                  FX P&L: £{fxImpact.observedFxPplGbp.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Trading Window ── */}
      {tradingWindow && (
        <section className="t212i-section">
          <h2>🕐 Trading Window</h2>
          <div className="t212i-fx-card">
            <p>{tradingWindow.message || 'Check trading hours for foreign-listed ISA positions.'}</p>
          </div>
        </section>
      )}

      {/* ── Warnings ── */}
      {warnings && warnings.length > 0 && (
        <section className="t212i-section">
          <h2>⚠️ Warnings</h2>
          <div className="t212i-warnings">
            {warnings.map((w, i) => (
              <div key={i} className="t212i-warning">
                {typeof w === 'string' ? w : (w.message || w.type || JSON.stringify(w))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Positions ── */}
      <section className="t212i-section">
        <h2>Positions ({positions?.length || 0})</h2>
        {!positions || positions.length === 0 ? (
          <p className="t212i-empty">No positions in this ISA account.</p>
        ) : (
          <div className="t212i-table-wrap">
            <table className="t212i-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Value</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.slice(0, 50).map((p, i) => (
                  <tr key={p.ticker || i}>
                    <td className="t212i-symbol">{p.ticker || p.symbol}</td>
                    <td>{p.quantity?.toFixed(2) || '—'}</td>
                    <td>£{p.currentValue?.toFixed(2) || '—'}</td>
                    <td className={p.ppl > 0 ? 't212i-profit' : p.ppl < 0 ? 't212i-loss' : ''}>
                      {p.ppl != null ? `£${p.ppl.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
