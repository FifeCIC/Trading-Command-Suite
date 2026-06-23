import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAnalystTargets } from '../core/api/research.js';
import './price-forecast.css';

// Default symbols list for the forecast table
const DEFAULT_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD', 'AMZN', 'META', 'GOOGL', 'JPM', 'NFLX', 'BA', 'XOM', 'SPY', 'GLD'];

export default function PriceForecastPage() {
  const [sortKey, setSortKey] = useState('upside');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedSym, setExpandedSym] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analyst-targets'],
    queryFn: () => fetchAnalystTargets({ symbols: DEFAULT_SYMBOLS, sort: sortKey, order: sortDir }),
    staleTime: 60 * 60 * 1000, // 1 hour — analyst targets change rarely
  });

  const forecasts = data?.targets ?? [];

  const sorted = useMemo(() => {
    const arr = [...forecasts];
    arr.sort((a, b) => {
      let cmp = 0;
      const getA = (key) => {
        if (key === 'sym') return (a.symbol || '').toUpperCase();
        if (key === 'price') return a.currentPrice ?? 0;
        if (key === 'target') return a.avgTarget ?? 0;
        if (key === 'upside') return a.upside ?? 0;
        if (key === 'analysts') return a.analystCount ?? 0;
        return 0;
      };
      const getB = (key) => {
        if (key === 'sym') return (b.symbol || '').toUpperCase();
        if (key === 'price') return b.currentPrice ?? 0;
        if (key === 'target') return b.avgTarget ?? 0;
        if (key === 'upside') return b.upside ?? 0;
        if (key === 'analysts') return b.analystCount ?? 0;
        return 0;
      };
      if (sortKey === 'sym') cmp = getA('sym').localeCompare(getB('sym'));
      else cmp = getA(sortKey) - getB(sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [forecasts, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  // ── Loading State ──
  if (isLoading) {
    return (
      <div className="pf-page">
        <header className="pf-header"><h1>Price Forecast</h1></header>
        <div className="pf-loading">Loading analyst targets from Finnhub…</div>
      </div>
    );
  }

  // ── Error State ──
  if (isError) {
    return (
      <div className="pf-page">
        <header className="pf-header"><h1>Price Forecast</h1></header>
        <div className="pf-error">
          <p>Failed to load analyst data.</p>
          <p className="pf-error-detail">{error?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-page">
      <header className="pf-header">
        <h1>Price Forecast</h1>
        <p className="pf-subtitle">
          Analyst price targets and consensus ratings.
          <span className="pf-source"> Data refreshes hourly.</span>
        </p>
      </header>

      {/* Consensus summary */}
      <div className="pf-summary">
        {['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'].map((c) => {
          const count = forecasts.filter((f) => f.consensus === c).length;
          const cls = c === 'Strong Buy' || c === 'Buy' ? 'pf-cons-pos' : c === 'Sell' || c === 'Strong Sell' ? 'pf-cons-neg' : 'pf-cons-neu';
          return <span key={c} className={`pf-summary-chip ${cls}`}>{c}: {count}</span>;
        })}
      </div>

      {/* ── Empty State ── */}
      {forecasts.length === 0 && (
        <div className="pf-empty">
          <p>No analyst coverage available from Finnhub.</p>
          <p className="pf-empty-hint">Finnhub's free tier does not include price-target data. Upgrade to premium for full analyst coverage.</p>
        </div>
      )}

      {/* Forecast table */}
      {forecasts.length > 0 && (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th className="pf-sortable" onClick={() => handleSort('sym')}>Symbol {sortKey === 'sym' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th>Company</th>
                <th className="pf-right pf-sortable" onClick={() => handleSort('price')}>Price {sortKey === 'price' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className="pf-right pf-sortable" onClick={() => handleSort('target')}>Avg Target {sortKey === 'target' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className="pf-right">High</th>
                <th className="pf-right">Low</th>
                <th className="pf-right pf-sortable" onClick={() => handleSort('upside')}>Upside {sortKey === 'upside' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th>Consensus</th>
                <th className="pf-right pf-sortable" onClick={() => handleSort('analysts')}>Analysts {sortKey === 'analysts' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => {
                const isExpanded = expandedSym === f.symbol;
                const consCls = f.consensus === 'Strong Buy' || f.consensus === 'Buy' ? 'pf-cons-pos' : f.consensus === 'Sell' || f.consensus === 'Strong Sell' ? 'pf-cons-neg' : 'pf-cons-neu';
                const upsideVal = f.upside ?? 0;
                const upsideCls = upsideVal >= 15 ? 'pf-up-high' : upsideVal >= 5 ? 'pf-up-mid' : 'pf-up-low';

                return (
                  <tr key={f.symbol} className={`pf-row ${isExpanded ? 'pf-row-expanded' : ''}`} onClick={() => setExpandedSym(isExpanded ? null : f.symbol)}>
                    <td className="pf-sym">{f.symbol}</td>
                    <td>{f.companyName || f.symbol}</td>
                    <td className="pf-right pf-mono">${f.currentPrice?.toFixed(2) ?? '—'}</td>
                    <td className="pf-right pf-mono">${f.avgTarget?.toFixed(2) ?? '—'}</td>
                    <td className="pf-right pf-mono pf-muted">${f.highTarget?.toFixed(2) ?? '—'}</td>
                    <td className="pf-right pf-mono pf-muted">${f.lowTarget?.toFixed(2) ?? '—'}</td>
                    <td className={`pf-right pf-mono ${upsideCls}`}>{upsideVal >= 0 ? '+' : ''}{upsideVal}%</td>
                    <td><span className={`pf-consensus ${consCls}`}>{f.consensus || '—'}</span></td>
                    <td className="pf-right pf-muted">{f.analystCount ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Expanded detail for clicked row */}
      {expandedSym && (() => {
        const f = forecasts.find((x) => x.symbol === expandedSym);
        if (!f) return null;
        const currentPrice = f.currentPrice || 0;
        const lowTarget = f.lowTarget || 0;
        const highTarget = f.highTarget || 1;
        const avgTarget = f.avgTarget || 0;
        const rangePct = ((highTarget - lowTarget) / currentPrice * 100).toFixed(0);
        const upsideVal = f.upside ?? 0;
        return (
          <div key={`exp-${f.symbol}`} className="pf-expanded">
            <div className="pf-target-bar-wrap">
              <div className="pf-target-bar-labels">
                <span>Low ${lowTarget.toFixed(0)}</span>
                <span>Current ${currentPrice.toFixed(2)}</span>
                <span>Avg ${avgTarget.toFixed(0)}</span>
                <span>High ${highTarget.toFixed(0)}</span>
              </div>
              <div className="pf-target-bar">
                <div className="pf-target-range" style={{ left: '0%', width: '100%' }} />
                <div className="pf-target-current" style={{ left: `${((currentPrice - lowTarget) / (highTarget - lowTarget)) * 100}%` }} />
                <div className="pf-target-avg" style={{ left: `${((avgTarget - lowTarget) / (highTarget - lowTarget)) * 100}%` }} />
              </div>
              <div className="pf-target-meta">
                <span>Range: ${(highTarget - lowTarget).toFixed(0)} ({rangePct}%)</span>
                <span>Upside to target: {upsideVal >= 0 ? '+' : ''}{upsideVal}%</span>
                <span>{f.analystCount ?? 0} analysts covering</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
