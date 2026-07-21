/**
 * Trading212 Portfolio Page
 * ==========================
 * Dedicated view for Trading212 investment account — positions, orders,
 * import/sync controls, and account summary.
 *
 * Data: /api/portfolio/trading212/* endpoints
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LastUpdated from '../components/LastUpdated';
import './t212-portfolio.css';

export default function T212PortfolioPage() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [imported, setImported] = useState(false);

  const mode = useQuery({
    queryKey: ['t212-mode'],
    queryFn: () => apiGet('/api/portfolio/trading212/mode'),
    staleTime: 60_000,
  });

  const account = useQuery({
    queryKey: ['t212-account'],
    queryFn: async () => {
      const res = await apiGet('/api/portfolio/trading212/validate');
      return res;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  const history = useQuery({
    queryKey: ['t212-history'],
    queryFn: () => apiGet('/api/portfolio/trading212/history?limit=20').catch(() => []),
    refetchInterval: 120_000,
    retry: 1,
  });

  async function doImport() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiPost('/api/portfolio/trading212/import');
      setSyncResult(res);
      if (res.success) setImported(true);
      qc.invalidateQueries({ queryKey: ['t212-account'] });
      qc.invalidateQueries({ queryKey: ['t212-history'] });
    } catch (e) {
      setSyncResult({ error: e.message });
    }
    setSyncing(false);
  }

  // Auto-import on page visit (backend enforces 60s cooldown)
  useEffect(() => {
    if (!imported) doImport();
  }, []);

  const summary = account.data?.account;
  const positions = account.data?.positions || [];
  const trades = Array.isArray(history.data) ? history.data : (history.data?.trades || []);
  const currentMode = mode.data?.current || 'demo';
  const lastUpdated = account.dataUpdatedAt || history.dataUpdatedAt || Date.now();

  // Human-readable mode label: "DEMO" = paper trading account, not mock UI
  const modeLabel = currentMode === 'live' ? 'LIVE Account' : currentMode === 'demo' ? 'Paper Account' : 'Not Connected';
  const modeClass = currentMode === 'live' ? 'live' : currentMode === 'demo' ? 'demo' : 'none';

  return (
    <div className="t212p-page">
      <header className="t212p-header">
        <h1>🏦 Trading212 Portfolio</h1>
        <p className="t212p-subtitle">
          Investment account overview — positions, orders, and sync controls.{' '}
          <strong className={`t212p-mode t212p-mode--${modeClass}`} title={currentMode === 'demo' ? 'Connected to a Trading212 demo (paper) account — not a real money account' : currentMode === 'live' ? 'Connected to a live Trading212 account with real funds' : 'No Trading212 account connected'}>
            {modeLabel}
          </strong>
        </p>
        {currentMode === 'none' && (
          <p className="t212p-hint" style={{ marginTop: '0.5rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
            Configure TRADING212_API_KEY in your .env file to connect a Trading212 account.
          </p>
        )}
      </header>

      <LastUpdated at={lastUpdated} />

      {/* ── Account Summary ── */}
      <section className="t212p-section">
        <h2>Account Summary</h2>
        <div className="t212p-summary-grid">
          <div className="t212p-stat">
            <span className="t212p-stat-label">Total Value</span>
            <span className="t212p-stat-value">£{summary?.total?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212p-stat">
            <span className="t212p-stat-label">Invested</span>
            <span className="t212p-stat-value">£{summary?.invested?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212p-stat">
            <span className="t212p-stat-label">Free Cash</span>
            <span className="t212p-stat-value">£{summary?.free?.toFixed(2) || '—'}</span>
          </div>
          <div className="t212p-stat">
            <span className="t212p-stat-label">P&L</span>
            <span className={`t212p-stat-value ${summary?.ppl > 0 ? 't212p-profit' : summary?.ppl < 0 ? 't212p-loss' : ''}`}>
              {summary?.ppl != null ? `£${summary.ppl.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="t212p-stat">
            <span className="t212p-stat-label">Result</span>
            <span className={`t212p-stat-value ${summary?.result > 0 ? 't212p-profit' : summary?.result < 0 ? 't212p-loss' : ''}`}>
              {summary?.result != null ? `£${summary.result.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="t212p-stat">
            <span className="t212p-stat-label">Positions</span>
            <span className="t212p-stat-value">{positions.length}</span>
          </div>
        </div>
      </section>

      {/* ── Positions ── */}
      <section className="t212p-section">
        <h2>Positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="t212p-empty">No open positions. Import from Trading212 to populate.</p>
        ) : (
          <div className="t212p-table-wrap">
            <table className="t212p-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg Price</th>
                  <th>Current</th>
                  <th>P&L</th>
                  <th>P&L %</th>
                </tr>
              </thead>
              <tbody>
                {positions.slice(0, 50).map((p, i) => (
                  <tr key={p.ticker || i}>
                    <td className="t212p-symbol">{p.ticker || p.symbol}</td>
                    <td>{p.quantity?.toFixed(2) || '—'}</td>
                    <td>£{p.averagePrice?.toFixed(2) || '—'}</td>
                    <td>£{p.currentPrice?.toFixed(2) || '—'}</td>
                    <td className={p.ppl > 0 ? 't212p-profit' : p.ppl < 0 ? 't212p-loss' : ''}>
                      {p.ppl != null ? `£${p.ppl.toFixed(2)}` : '—'}
                    </td>
                    <td className={p.ppl > 0 ? 't212p-profit' : p.ppl < 0 ? 't212p-loss' : ''}>
                      {p.pplPercent != null ? `${p.pplPercent.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Trades ── */}
      <section className="t212p-section">
        <h2>Recent Trades</h2>
        {trades.length === 0 ? (
          <p className="t212p-empty">No trade history available.</p>
        ) : (
          <div className="t212p-table-wrap">
            <table className="t212p-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 10).map((t, i) => (
                  <tr key={i}>
                    <td className="t212p-symbol">{t.ticker || t.symbol}</td>
                    <td className={t.side === 'BUY' ? 't212p-profit' : 't212p-loss'}>{t.side || t.type}</td>
                    <td>{t.quantity?.toFixed(2) || '—'}</td>
                    <td>£{t.price?.toFixed(2) || '—'}</td>
                    <td>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</td>
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
