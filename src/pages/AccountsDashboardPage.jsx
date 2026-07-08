import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../core/api/client';
import EmptyState from '../components/EmptyState';
import './trading-platforms.css';
import './accounts-dashboard.css';

const REFRESH_MS = 30_000;

export default function AccountsDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null);
  const [showDemo, setShowDemo] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const results = await Promise.allSettled([
        apiGet('/api/providers/mt5/accounts'),
        apiGet('/api/portfolio/summary'),
        apiGet('/api/isa/dashboard'),
      ]);

      const mt5Raw = results[0].status === 'fulfilled' ? results[0].value : null;
      const t212Raw = results[1].status === 'fulfilled' ? results[1].value : null;
      const isaRaw = results[2].status === 'fulfilled' ? results[2].value : null;

      const errors = [];
      if (results[0].status === 'rejected') errors.push('MT5 bridge offline');
      if (results[1].status === 'rejected') errors.push('Trading212 API offline');
      if (results[2].status === 'rejected') errors.push('Stocks ISA API offline');

      const mt5Accounts = Array.isArray(mt5Raw?.accounts) ? mt5Raw.accounts : [];
      const mt5Data = Array.isArray(mt5Raw) ? mt5Raw : mt5Accounts;
      const t212Data = t212Raw ?? {};

      setData({ mt5: mt5Data, t212: t212Data, isa: isaRaw, errors });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Load last snapshot
    try {
      const snap = localStorage.getItem('tcs:accounts-snapshot');
      if (snap) setLastSnapshot(JSON.parse(snap));
    } catch { /* ignore */ }
  }, [load]);

  // Auto-refresh + save snapshot on unmount
  useEffect(() => {
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(interval);
      if (data) {
        try {
          localStorage.setItem('tcs:accounts-snapshot', JSON.stringify({
            ts: Date.now(),
            mt5: data.mt5,
            t212: data.t212,
            isa: data.isa,
          }));
        } catch { /* ignore */ }
      }
    };
  }, [load, data]);

  const mt5Accounts = Array.isArray(data?.mt5) ? data.mt5 : (Array.isArray(data?.mt5?.accounts) ? data.mt5.accounts : []);
  const t212Summary = data?.t212 ?? {};

  // Separate live from demo
  const liveMT5 = mt5Accounts.filter((a) => a.type === 'live' || a.isLive || a.login?.toString().includes('7240659') || a.login?.toString().includes('8026714'));
  const demoMT5 = mt5Accounts.filter((a) => !liveMT5.includes(a));

  // Trading212 data
  const t212Positions = Array.isArray(t212Summary.positions) ? t212Summary.positions : [];
  const t212Account = t212Summary.account ?? {};
  const isa = data?.isa ?? {};
  const isaSummary = isa.summary ?? {};
  const isaAllowance = isa.allowance ?? {};

  // Net totals (approximate)
  const liveTotal = liveMT5.reduce((s, a) => s + (a.balance ?? a.equity ?? 0), 0)
    + (t212Account.total ?? 0);
  const demoTotal = demoMT5.reduce((s, a) => s + (a.balance ?? a.equity ?? 0), 0);
  const allTotal = liveTotal + demoTotal;

  const formatCurrency = (val, currency) => {
    if (val == null) return '—';
    const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
    return `${sym}${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const statusDot = (account) => {
    if (account.connected === false) return '🔴';
    if (account.error) return '🔴';
    if (account.stale) return '🟡';
    return '🟢';
  };

  const sinceLastView = lastSnapshot?.ts
    ? `Last viewed: ${new Date(lastSnapshot.ts).toLocaleTimeString()}`
    : null;

  return (
    <div className="trading-platforms-page ad-page">
      <header className="tp-page-header">
        <h1>💰 Accounts</h1>
        <p>
          Unified view of all trading accounts. Auto-refreshes every 30s.
          <button type="button" className="ad-refresh-btn" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'} Refresh
          </button>
        </p>
        {data?.errors?.length > 0 && (
          <p className="ad-errors">
            {data.errors.map((e, i) => <span key={i} className="ad-error-tag">⚠️ {e}</span>)}
          </p>
        )}
      </header>

      {loading && !data && (
        <div className="ad-loading">Loading account data...</div>
      )}

      {error && !data && (
        <div className="ad-error">
          <p>Failed to load accounts: {error}</p>
          <button type="button" className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      )}

      {data && (
        <>
          {/* Live Accounts */}
          <section className="tp-card">
            <h2>Live Accounts</h2>
            <div className="ad-grid">
              {/* MT5 Live */}
              {liveMT5.map((acc) => (
                <div key={acc.login || acc.id} className="ad-card ad-card--live">
                  <div className="ad-card-header">
                    <span className="ad-provider">MT5</span>
                    <span className="ad-status-dot">{statusDot(acc)}</span>
                  </div>
                  <div className="ad-card-body">
                    <span className="ad-card-name">{acc.name || acc.broker || `MT5 ${acc.login}`}</span>
                    <span className="ad-card-balance">{formatCurrency(acc.balance ?? acc.equity, acc.currency)}</span>
                    {acc.currency && <span className="ad-card-currency">{acc.currency}</span>}
                  </div>
                  <div className="ad-card-footer">
                    <span className="ad-card-type">Live</span>
                    {acc.server && <span className="ad-card-server">{acc.server}</span>}
                  </div>
                </div>
              ))}

              {/* T212 Investment */}
              <div className="ad-card ad-card--live">
                <div className="ad-card-header">
                  <span className="ad-provider">T212</span>
                  <span className="ad-status-dot">{t212Account.total != null ? '🟢' : '🔴'}</span>
                </div>
                <div className="ad-card-body">
                  <span className="ad-card-name">Investment</span>
                  <span className="ad-card-balance">{formatCurrency(t212Account.total, t212Account.currency)}</span>
                  {t212Account.currency && <span className="ad-card-currency">{t212Account.currency}</span>}
                </div>
                <div className="ad-card-footer">
                  <span className="ad-card-type">Live</span>
                  <span className="ad-card-positions">{t212Positions.length} positions</span>
                </div>
              </div>

              {/* T212 ISA */}
              <div className="ad-card ad-card--isa">
                <div className="ad-card-header">
                  <span className="ad-provider">T212</span>
                  <span className="ad-status-dot">{isa.status === 'connected' ? '🟢' : '🟡'}</span>
                </div>
                <div className="ad-card-body">
                  <span className="ad-card-name">Stocks ISA</span>
                  <span className="ad-card-balance">{formatCurrency(isaSummary.totalValueGbp, 'GBP')}</span>
                  <span className="ad-card-currency">GBP only</span>
                </div>
                <div className="ad-card-footer">
                  <span className="ad-card-type">ISA (GBP)</span>
                  <span className="ad-card-positions">{isaSummary.positionCount ?? 0} positions</span>
                </div>
              </div>

              {liveMT5.length === 0 && t212Account.total == null && (
                <EmptyState icon="💼" title="No live accounts connected" description="Start MT5 bridge or configure Trading212 credentials." />
              )}
            </div>
          </section>

          <section className="tp-card ad-isa-panel">
            <div className="ad-isa-head">
              <h2>Stocks ISA</h2>
              <span className="ad-isa-status">{isa.status === 'connected' ? 'Connected' : 'API key needed'}</span>
            </div>
            <div className="ad-isa-metrics">
              <div>
                <span>Allowance remaining</span>
                <strong>{formatCurrency(isaAllowance.remainingGbp, 'GBP')}</strong>
              </div>
              <div>
                <span>Foreign-listed holdings</span>
                <strong>{isa.fxImpact?.foreignPositionCount ?? 0}</strong>
              </div>
              <div>
                <span>Best window today</span>
                <strong>{isa.tradingWindow?.bestTimeToTradeToday || '—'}</strong>
              </div>
            </div>
            {isa.fxImpact?.message && (
              <p className="ad-isa-note">{isa.fxImpact.message}</p>
            )}
            {Array.isArray(isa.warnings) && isa.warnings.length > 0 && (
              <div className="ad-isa-warnings">
                {isa.warnings.map((warning) => (
                  <span key={warning.type} className={`ad-isa-warning ad-isa-warning--${warning.severity}`}>
                    {warning.message}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Demo Accounts */}
          <section className="tp-card">
            <button
              type="button"
              className="ad-toggle-btn"
              onClick={() => setShowDemo(!showDemo)}
            >
              {showDemo ? '▾' : '▸'} Demo Accounts ({demoMT5.length})
            </button>
            {showDemo && (
              <div className="ad-grid" style={{ marginTop: '0.5rem' }}>
                {demoMT5.map((acc) => (
                  <div key={acc.login || acc.id} className="ad-card ad-card--demo">
                    <div className="ad-card-header">
                      <span className="ad-provider">MT5</span>
                      <span className="ad-status-dot">{statusDot(acc)}</span>
                    </div>
                    <div className="ad-card-body">
                      <span className="ad-card-name">{acc.name || acc.broker || `Demo ${acc.login}`}</span>
                      <span className="ad-card-balance">{formatCurrency(acc.balance ?? acc.equity, acc.currency)}</span>
                      {acc.currency && <span className="ad-card-currency">{acc.currency}</span>}
                    </div>
                    <div className="ad-card-footer">
                      <span className="ad-card-type">Demo</span>
                      {acc.server && <span className="ad-card-server">{acc.server}</span>}
                    </div>
                  </div>
                ))}
                {demoMT5.length === 0 && <EmptyState icon="🧪" title="No demo accounts found" />}
              </div>
            )}
          </section>

          {/* Net Totals */}
          <section className="tp-card ad-totals">
            <h2>Net Totals</h2>
            <div className="ad-total-row">
              <span className="ad-total-label">Live Accounts</span>
              <span className="ad-total-value">{formatCurrency(liveTotal, 'GBP')}</span>
            </div>
            <div className="ad-total-row">
              <span className="ad-total-label">All Accounts (incl. demo)</span>
              <span className="ad-total-value ad-total-all">{formatCurrency(allTotal, 'GBP')}</span>
            </div>
            {sinceLastView && <p className="ad-since-last">{sinceLastView}</p>}
          </section>
        </>
      )}
    </div>
  );
}
