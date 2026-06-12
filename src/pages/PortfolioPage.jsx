import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

// ── Mock fallback when API is unavailable or Trading212 not configured ──
const MOCK_PORTFOLIO = {
  summary: {
    totalValue: 75000,
    cash: 25000,
    totalCost: 46375,
    totalPnl: 4083.65,
    pnlPct: 8.81,
    positionCount: 5,
    provider: 'Trading212',
    mode: 'mock',
  },
  positions: [
    { symbol: 'AAPL', ticker: 'AAPL_US_EQ', shares: 50, avgCost: 175.50, currentPrice: 198.32, value: 9916, pnl: 1141, pnlPct: 13.0, allocation: 0.198, initialFillDate: '2025-03-01T09:30:00Z' },
    { symbol: 'NVDA', ticker: 'NVDA_US_EQ', shares: 30, avgCost: 420.00, currentPrice: 485.25, value: 14557.5, pnl: 1957.5, pnlPct: 15.5, allocation: 0.291, initialFillDate: '2025-02-15T09:30:00Z' },
    { symbol: 'TSLA', ticker: 'TSLA_US_EQ', shares: 40, avgCost: 260.00, currentPrice: 227.91, value: 9116.4, pnl: -1283.6, pnlPct: -12.3, allocation: 0.182, initialFillDate: '2025-04-10T09:30:00Z' },
    { symbol: 'MSFT', ticker: 'MSFT_US_EQ', shares: 25, avgCost: 380.00, currentPrice: 462.75, value: 11568.75, pnl: 2068.75, pnlPct: 21.8, allocation: 0.231, initialFillDate: '2025-01-20T09:30:00Z' },
    { symbol: 'SPY', ticker: 'SPY_US_EQ', shares: 10, avgCost: 510.00, currentPrice: 530.00, value: 5300, pnl: 200, pnlPct: 3.92, allocation: 0.098, initialFillDate: '2025-05-05T09:30:00Z' },
  ],
  account: { blocked: 0, free: 25000, invested: 46375, pieCash: 0, ppl: 4083.65, result: 4083.65, total: 71375 },
};

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

// ── Mode Badge ──────────────────────────────────────────────
function ModeBadge({ mode }) {
  const map = {
    live: { label: '🔴 LIVE', className: 'pf-mode-live' },
    demo: { label: '🟡 DEMO', className: 'pf-mode-demo' },
    mock: { label: '⚪ MOCK DATA', className: 'pf-mode-mock' },
  };
  const m = map[mode] || map.mock;
  return <span className={`pf-mode-badge ${m.className}`}>{m.label}</span>;
}

// ── Main Page ───────────────────────────────────────────────
export default function PortfolioPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newCost, setNewCost] = useState('');

  // Real API call — falls back to mock data on error
  const portfolioQuery = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => {
      try {
        const data = await apiGet('/api/portfolio');
        if (data?.summary?.mode !== 'mock') return data;
      } catch { /* fall through to mock */ }
      return MOCK_PORTFOLIO;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data = portfolioQuery.data || MOCK_PORTFOLIO;
  const { summary, positions, account } = data;
  const totalValue = summary.totalValue;
  const cash = summary.cash;
  const totalPnl = summary.totalPnl;
  const pnlPct = summary.pnlPct;

  function addPosition() {
    if (!newSymbol || !newShares || !newCost) return;
    setNewSymbol(''); setNewShares(''); setNewCost(''); setShowAddForm(false);
  }

  return (
    <div className="pf-page">
      <div className="pf-header">
        <h1>Portfolio</h1>
        <ModeBadge mode={summary.mode} />
      </div>

      {portfolioQuery.isFetching && !portfolioQuery.isLoading && (
        <div className="pf-refresh-indicator">⟳ Refreshing…</div>
      )}

      <div className="pf-summary">
        <div className="pf-sum-card"><div className="pf-sum-val">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total Value</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Cash</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${totalPnl >= 0 ? 'pf-green' : 'pf-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div>Total P&amp;L</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${pnlPct >= 0 ? 'pf-green' : 'pf-red'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div><div>Return</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">{summary.positionCount}</div><div>Positions</div></div>
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
        {positions.length === 0 ? (
          <p className="pf-hint">No open positions. Connect your Trading212 account to see your portfolio here.</p>
        ) : (
          <table className="pf-table">
            <thead>
              <tr><th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Price</th><th>Value</th><th>P&amp;L</th><th>%</th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol}>
                  <td><strong>{p.symbol}</strong></td>
                  <td>{p.shares.toLocaleString()}</td>
                  <td>${p.avgCost.toFixed(2)}</td>
                  <td>${p.currentPrice.toFixed(2)}</td>
                  <td>${p.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className={p.pnl >= 0 ? 'pf-green' : 'pf-red'}>{p.pnl >= 0 ? '+' : ''}{p.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className={p.pnlPct >= 0 ? 'pf-green' : 'pf-red'}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

      <div className="pf-section">
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          disabled={summary.mode === 'live' || summary.mode === 'demo'}
          title={summary.mode !== 'mock' ? 'Positions are managed directly in Trading212' : 'Add a mock position'}
        >
          {showAddForm ? 'Cancel' : '+ Add Position'}
        </button>
        {summary.mode !== 'mock' && (
          <span className="pf-hint" style={{ marginLeft: '0.75rem' }}>Managed in Trading212</span>
        )}
        {showAddForm && (
          <div className="pf-add-form">
            <input placeholder="Symbol" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
            <input placeholder="Shares" type="number" value={newShares} onChange={(e) => setNewShares(e.target.value)} />
            <input placeholder="Avg Cost" type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
            <button type="button" onClick={addPosition}>Add</button>
          </div>
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
