import { useState, useMemo } from 'react';
import './price-forecast.css';

const FORECASTS = [
  { sym: 'AAPL', name: 'Apple Inc.', price: 198.32, avgTarget: 215.00, highTarget: 240.00, lowTarget: 170.00, consensus: 'Buy', analysts: 38, upside: 8.4 },
  { sym: 'NVDA', name: 'NVIDIA Corp.', price: 129.14, avgTarget: 155.00, highTarget: 200.00, lowTarget: 100.00, consensus: 'Strong Buy', analysts: 45, upside: 20.0 },
  { sym: 'MSFT', name: 'Microsoft Corp.', price: 462.75, avgTarget: 510.00, highTarget: 600.00, lowTarget: 420.00, consensus: 'Strong Buy', analysts: 42, upside: 10.2 },
  { sym: 'TSLA', name: 'Tesla Inc.', price: 227.91, avgTarget: 245.00, highTarget: 350.00, lowTarget: 130.00, consensus: 'Hold', analysts: 35, upside: 7.5 },
  { sym: 'AMD', name: 'Advanced Micro Devices', price: 94.12, avgTarget: 120.00, highTarget: 155.00, lowTarget: 80.00, consensus: 'Buy', analysts: 32, upside: 27.5 },
  { sym: 'AMZN', name: 'Amazon.com Inc.', price: 198.50, avgTarget: 230.00, highTarget: 270.00, lowTarget: 180.00, consensus: 'Strong Buy', analysts: 48, upside: 15.9 },
  { sym: 'META', name: 'Meta Platforms Inc.', price: 525.30, avgTarget: 580.00, highTarget: 650.00, lowTarget: 450.00, consensus: 'Buy', analysts: 40, upside: 10.4 },
  { sym: 'GOOGL', name: 'Alphabet Inc.', price: 185.20, avgTarget: 210.00, highTarget: 240.00, lowTarget: 160.00, consensus: 'Strong Buy', analysts: 44, upside: 13.4 },
  { sym: 'JPM', name: 'JPMorgan Chase', price: 198.45, avgTarget: 215.00, highTarget: 235.00, lowTarget: 180.00, consensus: 'Buy', analysts: 25, upside: 8.3 },
  { sym: 'NFLX', name: 'Netflix Inc.', price: 675.80, avgTarget: 720.00, highTarget: 850.00, lowTarget: 580.00, consensus: 'Buy', analysts: 36, upside: 6.5 },
  { sym: 'BA', name: 'Boeing Co.', price: 178.20, avgTarget: 200.00, highTarget: 260.00, lowTarget: 140.00, consensus: 'Hold', analysts: 28, upside: 12.2 },
  { sym: 'XOM', name: 'Exxon Mobil', price: 112.40, avgTarget: 125.00, highTarget: 140.00, lowTarget: 100.00, consensus: 'Hold', analysts: 22, upside: 11.2 },
  { sym: 'SPY', name: 'SPDR S&P 500 ETF', price: 548.20, avgTarget: 580.00, highTarget: 620.00, lowTarget: 500.00, consensus: 'Buy', analysts: 15, upside: 5.8 },
  { sym: 'GLD', name: 'SPDR Gold Trust', price: 232.50, avgTarget: 250.00, highTarget: 280.00, lowTarget: 210.00, consensus: 'Buy', analysts: 12, upside: 7.5 },
];

export default function PriceForecastPage() {
  const [sortKey, setSortKey] = useState('upside');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedSym, setExpandedSym] = useState(null);

  const sorted = useMemo(() => {
    const arr = [...FORECASTS];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'sym') cmp = a.sym.localeCompare(b.sym);
      else if (sortKey === 'price') cmp = a.price - b.price;
      else if (sortKey === 'target') cmp = a.avgTarget - b.avgTarget;
      else if (sortKey === 'upside') cmp = a.upside - b.upside;
      else if (sortKey === 'analysts') cmp = a.analysts - b.analysts;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div className="pf-page">
      <header className="pf-header">
        <h1>Price Forecast</h1>
        <p className="pf-subtitle">Analyst price targets and consensus ratings. Click column headers to sort. Click a row to expand.</p>
      </header>

      {/* Consensus summary */}
      <div className="pf-summary">
        {['Strong Buy', 'Buy', 'Hold', 'Sell'].map((c) => {
          const count = FORECASTS.filter((f) => f.consensus === c).length;
          const cls = c === 'Strong Buy' || c === 'Buy' ? 'pf-cons-pos' : c === 'Sell' ? 'pf-cons-neg' : 'pf-cons-neu';
          return <span key={c} className={`pf-summary-chip ${cls}`}>{c}: {count}</span>;
        })}
      </div>

      {/* Forecast table */}
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
              const isExpanded = expandedSym === f.sym;
              const consCls = f.consensus === 'Strong Buy' || f.consensus === 'Buy' ? 'pf-cons-pos' : f.consensus === 'Sell' ? 'pf-cons-neg' : 'pf-cons-neu';
              const upsideCls = f.upside >= 15 ? 'pf-up-high' : f.upside >= 5 ? 'pf-up-mid' : 'pf-up-low';

              return (
                <tr key={f.sym} className={`pf-row ${isExpanded ? 'pf-row-expanded' : ''}`} onClick={() => setExpandedSym(isExpanded ? null : f.sym)}>
                  <td className="pf-sym">{f.sym}</td>
                  <td>{f.name}</td>
                  <td className="pf-right pf-mono">${f.price}</td>
                  <td className="pf-right pf-mono">${f.avgTarget}</td>
                  <td className="pf-right pf-mono pf-muted">${f.highTarget}</td>
                  <td className="pf-right pf-mono pf-muted">${f.lowTarget}</td>
                  <td className={`pf-right pf-mono ${upsideCls}`}>+{f.upside}%</td>
                  <td><span className={`pf-consensus ${consCls}`}>{f.consensus}</span></td>
                  <td className="pf-right pf-muted">{f.analysts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded detail for clicked row */}
      {expandedSym && (() => {
        const f = FORECASTS.find((x) => x.sym === expandedSym);
        if (!f) return null;
        const rangePct = ((f.highTarget - f.lowTarget) / f.price * 100).toFixed(0);
        return (
          <div key={`exp-${f.sym}`} className="pf-expanded">
            <div className="pf-target-bar-wrap">
              <div className="pf-target-bar-labels">
                <span>Low ${f.lowTarget}</span>
                <span>Current ${f.price}</span>
                <span>Avg ${f.avgTarget}</span>
                <span>High ${f.highTarget}</span>
              </div>
              <div className="pf-target-bar">
                <div className="pf-target-range" style={{ left: '0%', width: '100%' }} />
                <div className="pf-target-current" style={{ left: `${((f.price - f.lowTarget) / (f.highTarget - f.lowTarget)) * 100}%` }} />
                <div className="pf-target-avg" style={{ left: `${((f.avgTarget - f.lowTarget) / (f.highTarget - f.lowTarget)) * 100}%` }} />
              </div>
              <div className="pf-target-meta">
                <span>Range: ${f.highTarget - f.lowTarget} ({rangePct}%)</span>
                <span>Upside to target: +{f.upside}%</span>
                <span>{f.analysts} analysts covering</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
