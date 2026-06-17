import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

// ── Available data sources ──────────────────────────────────
const PLATFORMS = [
  { id: 'trading212', label: 'Trading212' },
  { id: 'mt5', label: 'MT5' },
  { id: 'alpaca', label: 'Alpaca' },
  { id: 'all', label: 'All Platforms' },
];

// ── Allocation Bar ──────────────────────────────────────────
function AllocationBar({ positions, total }) {
  const colors = ['#00a63e', '#0ea5a6', '#8f7dff', '#ffb347', '#ff6b6b'];
  return (
    <div className="pf-alloc-bar">
      {positions.map((p, i) => {
        const pct = total > 0 ? (p.value / total * 100) : 0;
        return (
          <div key={p.symbol} className="pf-alloc-seg" style={{ flex: p.allocation, background: colors[i % colors.length] }} title={`${p.symbol}: ${pct.toFixed(1)}%`}>
            {pct > 8 && <span>{p.symbol}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Unavailable Notice ──────────────────────────────────────
function UnavailableNotice({ reason, source, onRefresh }) {
  const notices = {
    no_key: {
      title: 'Trading212 API Key Required',
      body: 'Set TRADING212_API_KEY and TRADING212_API_SECRET in your .env file to connect your Trading212 account.',
      help: 'See SETUP.md for API key configuration instructions.',
    },
    no_connection: {
      title: 'Cannot Reach Trading212',
      body: 'The API returned an error or could not be reached. Check your internet connection and API key.',
    },
    no_positions: {
      title: 'No Open Positions',
      body: source === 'trading212'
        ? 'Your Trading212 account has no open positions.'
        : source === 'mt5'
          ? 'MT5 integration is pending. Switch to Trading212 for live portfolio data.'
          : 'No positions available from the selected source.',
    },
    not_implemented: {
      title: `${source === 'mt5' ? 'MT5' : source === 'alpaca' ? 'Alpaca' : 'This source'} Not Yet Available`,
      body: `Portfolio data from ${source === 'mt5' ? 'MT5' : source === 'alpaca' ? 'Alpaca' : 'this source'} is not yet implemented. Switch to Trading212 for live data.`,
    },
  };

  const n = notices[reason] || notices.no_connection;

  return (
    <div className="pf-unavailable">
      <h2>{n.title}</h2>
      <p>{n.body}</p>
      {n.help && <p className="pf-hint">{n.help}</p>}
      {onRefresh && (
        <button className="pf-refresh-btn" onClick={onRefresh} style={{ marginTop: '0.5rem' }}>
          ↻ Retry
        </button>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function PortfolioPage() {
  const [source, setSource] = useState('trading212');

  const portfolioQuery = useQuery({
    queryKey: ['portfolio', source],
    queryFn: async () => {
      if (source === 'mt5' || source === 'alpaca') {
        return { unavailable: 'not_implemented' };
      }
      const url = source === 'all' ? '/api/portfolio/holdings?source=all' : `/api/portfolio?source=${source}`;
      const data = await apiGet(url);
      return data || { unavailable: 'no_connection' };
    },
    staleTime: 30_000,
    refetchInterval: 300_000,
  });

  const scoresQuery = useQuery({
    queryKey: ['portfolio-scores'],
    queryFn: () => apiGet('/api/portfolio/scores').then((d) => d?.scores || []).catch(() => []),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const data = portfolioQuery.data;
  const unavailable = data?.unavailable;
  const hasData = !unavailable && data?.positions?.length > 0;
  const summary = data?.summary;
  const positions = data?.positions || [];
  const account = data?.account;
  const error = data?.error;

  // Still loading
  if (portfolioQuery.isLoading) {
    return (
      <div className="pf-page">
        <h1>Portfolio</h1>
        <p className="pf-hint">Loading portfolio data…</p>
      </div>
    );
  }

  // API returned an error
  if (error && !hasData) {
    return (
      <div className="pf-page">
        <div className="pf-header">
          <h1>Portfolio</h1>
        </div>
        <UnavailableNotice reason="no_connection" source={source} onRefresh={() => portfolioQuery.refetch()} />
      </div>
    );
  }

  // Source not implemented / no key / no connection / no positions
  if (!hasData) {
    const reason = unavailable || (positions.length === 0 ? 'no_positions' : 'no_connection');
    return (
      <div className="pf-page">
        <div className="pf-header">
          <div>
            <h1>Portfolio</h1>
          </div>
          <div className="pf-header-actions">
            <select className="pf-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button className="pf-refresh-btn" onClick={() => portfolioQuery.refetch()} disabled={portfolioQuery.isFetching}>
              {portfolioQuery.isFetching ? '⟳' : '↻'} Refresh
            </button>
          </div>
        </div>
        <UnavailableNotice reason={reason} source={source} onRefresh={() => portfolioQuery.refetch()} />
      </div>
    );
  }

  // ── Live data display ────────────────────────────────────
  const totalValue = summary?.totalValue || 0;
  const cash = summary?.cash || 0;
  const totalPnl = summary?.totalPnl || 0;
  const pnlPct = summary?.pnlPct || 0;

  return (
    <div className="pf-page">
      <div className="pf-header">
        <div>
          <h1>Portfolio</h1>
          {summary?.lastRefreshed && <span className="pf-refreshed">Updated: {new Date(summary.lastRefreshed).toLocaleTimeString()}</span>}
        </div>
        <div className="pf-header-actions">
          <select className="pf-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button className="pf-refresh-btn" onClick={() => portfolioQuery.refetch()} disabled={portfolioQuery.isFetching}>
            {portfolioQuery.isFetching ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      {portfolioQuery.isFetching && !portfolioQuery.isLoading && (
        <div className="pf-refresh-indicator">⟳ Refreshing…</div>
      )}

      <div className="pf-summary">
        <div className="pf-sum-card"><div className="pf-sum-val">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total Value</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Cash</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${totalPnl >= 0 ? 'pf-green' : 'pf-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total P&amp;L</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${pnlPct >= 0 ? 'pf-green' : 'pf-red'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div><div>Return</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">{summary?.positionCount || positions.length}</div><div>Positions</div></div>
      </div>

      {positions.length > 0 && (
        <div className="pf-section">
          <h2>Allocation</h2>
          <AllocationBar positions={positions} total={totalValue - cash} />
          <div className="pf-alloc-legend">
            {positions.map((p) => {
              const pct = (totalValue - cash) > 0 ? (p.value / (totalValue - cash) * 100) : 0;
              return <span key={p.symbol} className="pf-legend-item">{p.symbol}: {pct.toFixed(1)}%</span>;
            })}
          </div>
        </div>
      )}

      <div className="pf-section">
        <h2>Positions</h2>
        <table className="pf-table">
          <thead>
            <tr><th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Price</th><th>Value</th><th>P&amp;L</th><th>%</th><th>Signal</th><th></th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const s = (scoresQuery.data || []).find((sc) => sc.symbol === p.symbol);
              return (
              <tr key={p.symbol}>
                <td><strong>{p.symbol}</strong></td>
                <td>{p.shares?.toLocaleString() || p.quantity?.toLocaleString() || '—'}</td>
                <td>${(p.avgCost || 0).toFixed(2)}</td>
                <td>${(p.currentPrice || 0).toFixed(2)}</td>
                <td>${(p.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={(p.pnl || 0) >= 0 ? 'pf-green' : 'pf-red'}>{(p.pnl || 0) >= 0 ? '+' : ''}${Math.abs(p.pnl || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={(p.pnlPct || 0) >= 0 ? 'pf-green' : 'pf-red'}>{(p.pnlPct || 0) >= 0 ? '+' : ''}{(p.pnlPct || 0).toFixed(1)}%</td>
                <td>{s ? <span className={`pf-sig pf-sig-${s.signal}`}>{s.signal.toUpperCase()}</span> : '—'}</td>
                <td><a href="/trading/mt5-trading" className="pf-action-btn" title="Trade this symbol">↗</a></td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      <div className="pf-section">
        <h2>Trade Suggestions</h2>
        <p className="pf-hint">Based on current scores and averaging policy.</p>
        {positions.filter((p) => p.currentPrice < p.avgCost).map((p) => (
          <div key={p.symbol} className="pf-suggestion">
            <strong>{p.symbol}</strong> — {((1 - p.currentPrice / p.avgCost) * 100).toFixed(1)}% below entry.
            Consider averaging if conviction remains high and support levels are near.
          </div>
        ))}
        {positions.filter((p) => p.currentPrice < p.avgCost).length === 0 && (
          <p className="pf-hint">No positions below entry. No averaging suggestions.</p>
        )}
      </div>

      {account && (
        <div className="pf-section pf-account-detail">
          <h2>Account</h2>
          <div className="pf-account-grid">
            <div><span>Free</span><strong>${account.free?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Invested</span><strong>${account.invested?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Blocked</span><strong>${account.blocked?.toLocaleString() ?? '—'}</strong></div>
            <div><span>Result</span><strong>${account.result?.toLocaleString() ?? '—'}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
}
