/**
 * Trading212 Portfolio Page
 * ==========================
 * Unified multi-account portfolio overview — Trading212 (Live, Demo, Stocks ISA,
 * CFD), MT5 bridge accounts, and Capital.com, grouped into Live / Demo categories.
 *
 * Account selection and totals are owned by the API:
 *   GET  /api/portfolio/accounts          → categories + accounts + totals
 *   POST /api/portfolio/accounts/:id      → toggle an account or category
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LastUpdated from '../components/LastUpdated';
import PageInfoPopover from '../components/PageInfoPopover';
import './t212-portfolio.css';

const fmt = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`);

export default function T212PortfolioPage() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [imported, setImported] = useState(false);

  // ── Unified account overview (API-owned toggles + totals) ──
  const overview = useQuery({
    queryKey: ['portfolio-accounts'],
    queryFn: () => apiGet('/api/portfolio/accounts').catch(() => ({ categories: [], grandTotal: null })),
    refetchInterval: 60_000,
  });
  const categories = overview.data?.categories || [];
  const grandTotal = overview.data?.grandTotal ?? null;
  const allAccounts = categories.flatMap((c) => c.accounts);

  const demoInvest = allAccounts.find((a) => a.id === 't212:demo');
  const liveInvest = allAccounts.find((a) => a.id === 't212:live');
  const isaAcct = allAccounts.find((a) => a.id === 't212:isa');

  const investActive = demoInvest?.enabled && demoInvest?.connected
    ? 'demo'
    : liveInvest?.enabled && liveInvest?.connected ? 'live' : null;
  const isaActive = isaAcct?.enabled && isaAcct?.connected;

  // ── Investment account detail (positions/summary/history) ──
  const account = useQuery({
    queryKey: ['t212-account'],
    queryFn: () => apiGet('/api/portfolio/trading212/validate'),
    refetchInterval: 60_000,
    retry: 1,
  });

  const history = useQuery({
    queryKey: ['t212-history'],
    queryFn: () => apiGet('/api/portfolio/trading212/history?limit=20').catch(() => []),
    refetchInterval: 120_000,
    retry: 1,
  });

  // ── Stocks ISA detail ──
  const isa = useQuery({
    queryKey: ['t212-isa'],
    queryFn: () => apiGet('/api/isa/dashboard').catch(() => null),
    refetchInterval: 60_000,
    retry: 1,
    enabled: isaActive,
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
      qc.invalidateQueries({ queryKey: ['portfolio-accounts'] });
    } catch (e) {
      setSyncResult({ error: e.message });
    }
    setSyncing(false);
  }

  // Auto-import on page visit (backend enforces 60s cooldown)
  useEffect(() => {
    if (!imported) doImport();
  }, []);

  // Account toggles live in Screen Options — refresh when they change there.
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['portfolio-accounts'] });
      qc.invalidateQueries({ queryKey: ['t212-isa'] });
    };
    window.addEventListener('tcs:accounts-changed', refresh);
    return () => window.removeEventListener('tcs:accounts-changed', refresh);
  }, [qc]);

  const summary = account.data?.account;
  const positions = account.data?.positions || [];
  const trades = Array.isArray(history.data) ? history.data : (history.data?.trades || []);
  const lastUpdated = account.dataUpdatedAt || history.dataUpdatedAt || Date.now();
  const isaData = isa.data || {};
  const isaPositions = Array.isArray(isaData.positions) ? isaData.positions : [];

  const investTitle = investActive === 'demo' ? 'Practice (Demo)' : 'Invest (Live)';

  // One combined positions table across all enabled accounts.
  const combinedPositions = useMemo(() => {
    const list = [];
    if (investActive) {
      for (const p of positions) {
        list.push({
          key: 'inv-' + (p.ticker || p.symbol || list.length),
          ticker: p.ticker || p.symbol,
          account: investTitle,
          quantity: p.quantity,
          currentPrice: p.currentPrice,
          value: (p.quantity || 0) * (p.currentPrice || 0),
          pnl: p.ppl,
        });
      }
    }
    if (isaActive) {
      for (const p of isaPositions) {
        list.push({
          key: 'isa-' + (p.ticker || list.length),
          ticker: p.ticker,
          account: 'Stocks ISA',
          quantity: p.quantity,
          currentPrice: p.currentPriceGbp,
          value: p.valueGbp,
          pnl: p.pnlGbp,
        });
      }
    }
    return list;
  }, [investActive, positions, investTitle, isaActive, isaPositions]);

  return (
    <div className="t212p-page">
      <header className="t212p-header">
        <h1>
          Trading212 Portfolio
          <PageInfoPopover>
            Unified account overview — enable or disable each account (and each
            Live / Demo category) to control exactly what is totalled together.
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── Grand total (recomputed from enabled accounts) ── */}
      <div className="t212p-grand-total">
        <span className="t212p-grand-label">Total across enabled accounts</span>
        <span className="t212p-grand-value">{fmt(grandTotal)}</span>
      </div>
      <p className="t212p-hint" style={{ margin: '0 0 0.75rem' }}>
        Configure which accounts are included via ⚙ Screen Options → Accounts &amp; Totals.
      </p>

      <LastUpdated at={lastUpdated} />

      {syncing && <p className="t212p-hint">Syncing…</p>}
      {syncResult?.error && <p className="t212p-sync-result t212p-sync-err">{syncResult.error}</p>}

      {/* ── Investment account summary ── */}
      {investActive && (
        <section className="t212p-section">
          <h2>{investTitle} — Account Summary</h2>
          <div className="t212p-summary-grid">
            <div className="t212p-stat">
              <span className="t212p-stat-label">Total Value</span>
              <span className="t212p-stat-value">{fmt(summary?.total)}</span>
            </div>
            <div className="t212p-stat">
              <span className="t212p-stat-label">Invested</span>
              <span className="t212p-stat-value">{fmt(summary?.invested)}</span>
            </div>
            <div className="t212p-stat">
              <span className="t212p-stat-label">Free Cash</span>
              <span className="t212p-stat-value">{fmt(summary?.free)}</span>
            </div>
            <div className="t212p-stat">
              <span className="t212p-stat-label">P&L</span>
              <span className={`t212p-stat-value ${summary?.ppl > 0 ? 't212p-profit' : summary?.ppl < 0 ? 't212p-loss' : ''}`}>
                {summary?.ppl != null ? fmt(summary.ppl) : '—'}
              </span>
            </div>
            <div className="t212p-stat">
              <span className="t212p-stat-label">Result</span>
              <span className={`t212p-stat-value ${summary?.result > 0 ? 't212p-profit' : summary?.result < 0 ? 't212p-loss' : ''}`}>
                {summary?.result != null ? fmt(summary.result) : '—'}
              </span>
            </div>
            <div className="t212p-stat">
              <span className="t212p-stat-label">Positions</span>
              <span className="t212p-stat-value">{positions.length}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Combined positions (all enabled accounts) ── */}
      <section className="t212p-section">
        <h2>Positions ({combinedPositions.length})</h2>
        {combinedPositions.length === 0 ? (
          <p className="t212p-empty">No open positions. Import from Trading212 to populate.</p>
        ) : (
          <div className="t212p-table-wrap">
            <table className="t212p-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Account</th>
                  <th>Qty</th>
                  <th>Current</th>
                  <th>Value</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {combinedPositions.slice(0, 100).map((p) => (
                  <tr key={p.key}>
                    <td className="t212p-symbol">{p.ticker}</td>
                    <td className="t212p-account-cell">{p.account}</td>
                    <td>{p.quantity != null ? p.quantity.toFixed(2) : '—'}</td>
                    <td>{fmt(p.currentPrice)}</td>
                    <td>{fmt(p.value)}</td>
                    <td className={p.pnl > 0 ? 't212p-profit' : p.pnl < 0 ? 't212p-loss' : ''}>
                      {p.pnl != null ? fmt(p.pnl) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent Trades ── */}
      {investActive && (
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
                      <td>{fmt(t.price)}</td>
                      <td>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
