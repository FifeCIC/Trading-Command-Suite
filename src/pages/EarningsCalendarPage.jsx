import { useState, useMemo } from 'react';
import './earnings-calendar.css';

const EARNINGS = [
  { sym: 'AAPL', name: 'Apple Inc.', date: '2026-07-25', time: 'After Close', epsEst: 1.52, epsAct: null, revEst: '89.2B', marketCap: '3.2T', sector: 'Technology', surpriseHist: [2.1, 3.8, -1.2, 4.5] },
  { sym: 'NVDA', name: 'NVIDIA Corp.', date: '2026-08-15', time: 'After Close', epsEst: 0.68, epsAct: null, revEst: '35.1B', marketCap: '3.0T', sector: 'Technology', surpriseHist: [8.2, 12.5, 5.1, 9.8] },
  { sym: 'MSFT', name: 'Microsoft Corp.', date: '2026-07-18', time: 'After Close', epsEst: 3.12, epsAct: null, revEst: '65.8B', marketCap: '3.1T', sector: 'Technology', surpriseHist: [1.8, 2.2, 0.9, 3.1] },
  { sym: 'TSLA', name: 'Tesla Inc.', date: '2026-07-19', time: 'After Close', epsEst: 0.72, epsAct: null, revEst: '26.2B', marketCap: '580B', sector: 'Consumer', surpriseHist: [-5.2, 1.1, -2.8, 3.4] },
  { sym: 'JPM', name: 'JPMorgan Chase', date: '2026-07-12', time: 'Before Open', epsEst: 4.32, epsAct: null, revEst: '42.1B', marketCap: '520B', sector: 'Financial', surpriseHist: [2.5, 1.8, 3.2, 0.9] },
  { sym: 'AMD', name: 'Advanced Micro Devices', date: '2026-07-28', time: 'After Close', epsEst: 0.84, epsAct: null, revEst: '7.2B', marketCap: '280B', sector: 'Technology', surpriseHist: [1.2, -0.5, 2.8, 4.1] },
  { sym: 'GS', name: 'Goldman Sachs', date: '2026-07-14', time: 'Before Open', epsEst: 8.95, epsAct: null, revEst: '12.8B', marketCap: '150B', sector: 'Financial', surpriseHist: [3.1, 5.2, 1.5, -0.8] },
  { sym: 'NFLX', name: 'Netflix Inc.', date: '2026-07-17', time: 'After Close', epsEst: 4.85, epsAct: null, revEst: '9.9B', marketCap: '290B', sector: 'Communication', surpriseHist: [6.2, 2.8, 8.1, 4.5] },
  { sym: 'BA', name: 'Boeing Co.', date: '2026-07-24', time: 'Before Open', epsEst: -0.45, epsAct: null, revEst: '18.1B', marketCap: '110B', sector: 'Industrial', surpriseHist: [-12.5, -8.2, -3.1, -1.8] },
  { sym: 'XOM', name: 'Exxon Mobil', date: '2026-07-29', time: 'Before Open', epsEst: 2.15, epsAct: null, revEst: '92.4B', marketCap: '460B', sector: 'Energy', surpriseHist: [1.2, -0.8, 3.5, 2.1] },
];

const SECTORS = ['all', 'Technology', 'Financial', 'Consumer', 'Communication', 'Industrial', 'Energy'];

// Group by month-week for calendar display
function getWeekLabel(dateStr) {
  const d = new Date(dateStr);
  const start = new Date('2026-07-01');
  const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
  const weekNum = Math.floor(diffDays / 7) + 1;
  return `Jul W${weekNum}`;
}

export default function EarningsCalendarPage() {
  const [sectorFilter, setSectorFilter] = useState('all');
  const [expandedSym, setExpandedSym] = useState(null);

  const grouped = useMemo(() => {
    const filtered = sectorFilter === 'all' ? EARNINGS : EARNINGS.filter((e) => e.sector === sectorFilter);
    const groups = {};
    filtered.forEach((e) => {
      const wk = getWeekLabel(e.date);
      if (!groups[wk]) groups[wk] = [];
      groups[wk].push(e);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sectorFilter]);

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Earnings Calendar</h1>
        <p className="ec-subtitle">Upcoming earnings reports. Filter by sector. Click any row for historical surprise data.</p>
      </header>

      <div className="ec-filters">
        <div className="ec-field">
          <label>Sector</label>
          <div className="ec-chip-tabs">
            {SECTORS.map((s) => (
              <button key={s} type="button" className={`ec-chip ${sectorFilter === s ? 'ec-chip-active' : ''}`} onClick={() => setSectorFilter(s)}>
                {s === 'all' ? 'All Sectors' : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {grouped.map(([week, reports]) => (
        <section key={week} className="ec-week">
          <h2 className="ec-week-label">{week} <span className="ec-count">{reports.length} reports</span></h2>
          <div className="ec-table-wrap">
            <table className="ec-table">
              <thead>
                <tr>
                  <th>Symbol</th><th>Company</th><th>Date</th><th>Time</th>
                  <th className="ec-right">EPS Est</th><th className="ec-right">Rev Est</th>
                  <th className="ec-right">Market Cap</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const isExpanded = expandedSym === r.sym;
                  return (
                    <tr key={r.sym} className={`ec-row ${isExpanded ? 'ec-row-expanded' : ''}`} onClick={() => setExpandedSym(isExpanded ? null : r.sym)}>
                      <td className="ec-sym">{r.sym}</td>
                      <td>{r.name}</td>
                      <td>{r.date}</td>
                      <td><span className={`ec-time-badge ${r.time === 'After Close' ? 'ec-time-pm' : 'ec-time-am'}`}>{r.time}</span></td>
                      <td className="ec-right ec-mono">${r.epsEst}</td>
                      <td className="ec-right ec-mono">{r.revEst}</td>
                      <td className="ec-right ec-muted">{r.marketCap}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Expanded surprise history for clicked row */}
          {reports.filter((r) => r.sym === expandedSym).map((r) => (
            <div key={`exp-${r.sym}`} className="ec-expanded" onClick={(e) => e.stopPropagation()}>
              <div className="ec-surprise-bar">
                <span className="ec-surprise-label">Historical EPS Surprise (%):</span>
                <div className="ec-surprise-chips">
                  {r.surpriseHist.map((v, i) => (
                    <span key={i} className={`ec-surprise-chip ${v >= 0 ? 'ec-surp-pos' : 'ec-surp-neg'}`}>
                      Q{i+1}: {v >= 0 ? '+' : ''}{v}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
