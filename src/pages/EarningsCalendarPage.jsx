import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEarningsCalendar } from '../core/api/research.js';
import './earnings-calendar.css';

function getWeekLabel(dateStr) {
  const d = new Date(dateStr);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const diffDays = Math.floor((d - startOfMonth) / (1000 * 60 * 60 * 24));
  const weekNum = Math.floor(diffDays / 7) + 1;
  const monthName = d.toLocaleString('en-US', { month: 'short' });
  return `${monthName} W${weekNum}`;
}

function formatRev(val) {
  if (val == null) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  return `${val}`;
}

export default function EarningsCalendarPage() {
  const [sectorFilter, setSectorFilter] = useState('all');
  const [expandedSym, setExpandedSym] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(3); // default 3 months

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['earnings-calendar', selectedMonth],
    queryFn: () => fetchEarningsCalendar({ months: selectedMonth }),
    staleTime: 15 * 60 * 1000, // 15 min — earnings calendar doesn't change rapidly
  });

  const events = data?.events ?? [];
  const sectors = useMemo(() => {
    const set = new Set();
    events.forEach((e) => { if (e.sector) set.add(e.sector); });
    return ['all', ...Array.from(set).sort()];
  }, [events]);

  const grouped = useMemo(() => {
    const filtered = sectorFilter === 'all' ? events : events.filter((e) => e.sector === sectorFilter);
    const groups = {};
    filtered.forEach((e) => {
      const wk = getWeekLabel(e.reportDate);
      if (!groups[wk]) groups[wk] = [];
      groups[wk].push(e);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, sectorFilter]);

  // ── Loading State ──
  if (isLoading) {
    return (
      <div className="ec-page">
        <header className="ec-header">
          <h1>Earnings Calendar</h1>
        </header>
        <div className="ec-loading">Loading earnings data from Finnhub…</div>
      </div>
    );
  }

  // ── Error State ──
  if (isError) {
    return (
      <div className="ec-page">
        <header className="ec-header">
          <h1>Earnings Calendar</h1>
        </header>
        <div className="ec-error">
          <p>Failed to load earnings data.</p>
          <p className="ec-error-detail">{error?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Earnings Calendar</h1>
        <p className="ec-subtitle">
          {data?.count ?? 0} upcoming earnings reports from Finnhub.
          <span className="ec-source"> Data refreshes every 15 min.</span>
        </p>
      </header>

      <div className="ec-filters">
        <div className="ec-field">
          <label>Horizon</label>
          <div className="ec-chip-tabs">
            {[1, 2, 3].map((m) => (
              <button key={m} type="button" className={`ec-chip ${selectedMonth === m ? 'ec-chip-active' : ''}`} onClick={() => setSelectedMonth(m)}>
                {m} month{m > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="ec-field">
          <label>Sector</label>
          <div className="ec-chip-tabs">
            {sectors.map((s) => (
              <button key={s} type="button" className={`ec-chip ${sectorFilter === s ? 'ec-chip-active' : ''}`} onClick={() => setSectorFilter(s)}>
                {s === 'all' ? 'All Sectors' : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Empty State ── */}
      {grouped.length === 0 && (
        <div className="ec-empty">
          <p>No upcoming earnings found{data?.count > 0 ? ' for this filter' : ''}.</p>
          <p className="ec-empty-hint">Try a longer horizon or remove the sector filter.</p>
        </div>
      )}

      {grouped.map(([week, reports]) => (
        <section key={week} className="ec-week">
          <h2 className="ec-week-label">{week} <span className="ec-count">{reports.length} reports</span></h2>
          <div className="ec-table-wrap">
            <table className="ec-table">
              <thead>
                <tr>
                  <th>Symbol</th><th>Company</th><th>Date</th><th>Time</th>
                  <th className="ec-right">EPS Est</th><th className="ec-right">Rev Est</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r, idx) => {
                  const isExpanded = expandedSym === r.symbol;
                  return (
                    <tr key={r.symbol + '-' + idx} className={`ec-row ${isExpanded ? 'ec-row-expanded' : ''}`} onClick={() => setExpandedSym(isExpanded ? null : r.symbol)}>
                      <td className="ec-sym">{r.symbol}</td>
                      <td>{r.name || r.companyName || r.symbol}</td>
                      <td>{r.reportDate}</td>
                      <td><span className={`ec-time-badge ${r.timeOfDay === 'After Close' ? 'ec-time-pm' : r.timeOfDay === 'Before Open' ? 'ec-time-am' : 'ec-time-na'}`}>{r.timeOfDay || 'Unknown'}</span></td>
                      <td className="ec-right ec-mono">{r.epsEstimate != null ? `$${r.epsEstimate}` : '—'}</td>
                      <td className="ec-right ec-mono">{formatRev(r.revenueEstimate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
