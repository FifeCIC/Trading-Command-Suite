import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

const MOCK_PORTFOLIO = {
  cash: 25000,
  positions: [
    { symbol: 'AAPL', shares: 50, avgCost: 175.50, currentPrice: 198.32, allocation: 0.20 },
    { symbol: 'NVDA', shares: 30, avgCost: 420.00, currentPrice: 485.25, allocation: 0.30 },
    { symbol: 'TSLA', shares: 40, avgCost: 260.00, currentPrice: 227.91, allocation: 0.18 },
    { symbol: 'MSFT', shares: 25, avgCost: 380.00, currentPrice: 462.75, allocation: 0.22 },
    { symbol: 'SPY', shares: 10, avgCost: 510.00, currentPrice: 530.00, allocation: 0.10 },
  ],
};

function AllocationBar({ positions, total }) {
  const colors = ['#00a63e', '#0ea5a6', '#8f7dff', '#ffb347', '#ff6b6b'];
  return (
    <div className="pf-alloc-bar">
      {positions.map((p, i) => {
        const pct = total > 0 ? (p.currentPrice * p.shares / total * 100) : 0;
        return (
          <div key={p.symbol} className="pf-alloc-seg" style={{ flex: p.allocation, background: colors[i % colors.length] }} title={`${p.symbol}: ${pct.toFixed(1)}%`}>
            {pct > 8 && <span>{p.symbol}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function PortfolioPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newCost, setNewCost] = useState('');
  const [positions, setPositions] = useState(MOCK_PORTFOLIO.positions);
  const [cash] = useState(MOCK_PORTFOLIO.cash);

  const symbolsQuery = useQuery({
    queryKey: ['portfolio-symbols'],
    queryFn: () => apiGet('/api/symbols'),
  });

  const totalValue = useMemo(() => positions.reduce((s, p) => s + p.currentPrice * p.shares, 0), [positions]);
  const totalCost = useMemo(() => positions.reduce((s, p) => s + p.avgCost * p.shares, 0), [positions]);
  const totalPnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;

  function addPosition() {
    if (!newSymbol || !newShares || !newCost) return;
    setPositions([...positions, {
      symbol: newSymbol.toUpperCase(), shares: Number(newShares), avgCost: Number(newCost),
      currentPrice: Number(newCost), allocation: 0.05,
    }]);
    setNewSymbol(''); setNewShares(''); setNewCost(''); setShowAddForm(false);
  }

  return (
    <div className="pf-page">
      <h1>Portfolio</h1>

      <div className="pf-summary">
        <div className="pf-sum-card"><div className="pf-sum-val">${totalValue.toLocaleString()}</div><div>Total Value</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">${cash.toLocaleString()}</div><div>Cash</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${totalPnl >= 0 ? 'pf-green' : 'pf-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString()}</div><div>Total P&amp;L</div></div>
        <div className="pf-sum-card"><div className={`pf-sum-val ${pnlPct >= 0 ? 'pf-green' : 'pf-red'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div><div>Return</div></div>
        <div className="pf-sum-card"><div className="pf-sum-val">{positions.length}</div><div>Positions</div></div>
      </div>

      <div className="pf-section">
        <h2>Allocation</h2>
        <AllocationBar positions={positions} total={totalValue} />
        <div className="pf-alloc-legend">
          {positions.map((p) => {
            const pct = totalValue > 0 ? (p.currentPrice * p.shares / totalValue * 100) : 0;
            return <span key={p.symbol} className="pf-legend-item">{p.symbol}: {pct.toFixed(1)}%</span>;
          })}
        </div>
      </div>

      <div className="pf-section">
        <h2>Positions</h2>
        <table className="pf-table">
          <thead>
            <tr><th>Symbol</th><th>Shares</th><th>Avg Cost</th><th>Price</th><th>Value</th><th>P&amp;L</th><th>%</th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const val = p.currentPrice * p.shares;
              const cost = p.avgCost * p.shares;
              const pnl = val - cost;
              const ret = cost > 0 ? (pnl / cost * 100) : 0;
              return (
                <tr key={p.symbol}>
                  <td><strong>{p.symbol}</strong></td>
                  <td>{p.shares}</td>
                  <td>${p.avgCost.toFixed(2)}</td>
                  <td>${p.currentPrice.toFixed(2)}</td>
                  <td>${val.toLocaleString()}</td>
                  <td className={pnl >= 0 ? 'pf-green' : 'pf-red'}>{pnl >= 0 ? '+' : ''}{pnl.toLocaleString()}</td>
                  <td className={ret >= 0 ? 'pf-green' : 'pf-red'}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</td>
                </tr>
              );
            })}
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

      <div className="pf-section">
        <button type="button" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Position'}
        </button>
        {showAddForm && (
          <div className="pf-add-form">
            <input placeholder="Symbol" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
            <input placeholder="Shares" type="number" value={newShares} onChange={(e) => setNewShares(e.target.value)} />
            <input placeholder="Avg Cost" type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
            <button type="button" onClick={addPosition}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}
