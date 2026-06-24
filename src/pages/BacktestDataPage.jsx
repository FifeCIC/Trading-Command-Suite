import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './trading-platforms.css';

const STATUS_COLORS = {
  ok: 'tp-chip--ok',
  partial: 'tp-chip--neutral',
  none: 'tp-chip--warn',
};

function BarStatus({ count }) {
  const status = count >= 200 ? 'ok' : count > 0 ? 'partial' : 'none';
  const label = count >= 200 ? `${count} bars` : count > 0 ? `${count} bars` : 'No data';
  return <span className={`tp-chip ${STATUS_COLORS[status]}`}>{label}</span>;
}

export default function BacktestDataPage() {
  const [sortKey, setSortKey] = useState('barCount');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all');
  const queryClient = useQueryClient(); // all | with-data | no-data | bt-run

  const inventory = useQuery({
    queryKey: ['bt-inventory'],
    queryFn: () => apiGet('/api/backtest/data-inventory'),
    refetchInterval: 60_000,
    retry: 1,
  });

  // Active recordings
  const activeRec = useQuery({
    queryKey: ['bt-active-recordings'],
    queryFn: () => apiGet('/api/speed/record/active').catch(() => ({ recordings: [] })),
    refetchInterval: 5000,
    staleTime: 2000,
  });
  const recordings = activeRec.data?.recordings ?? [];
  const recordingTickers = new Set(recordings.map((r) => r.ticker));

  const toggleRecording = async (ticker) => {
    const isRec = recordingTickers.has(ticker.toUpperCase());
    const endpoint = isRec ? '/api/speed/record/stop' : '/api/speed/record/start';
    try {
      await fetch(`http://localhost:3201${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: ticker }),
      });
      activeRec.refetch();
      queryClient.invalidateQueries({ queryKey: ['bt-inventory'] });
    } catch { /* silent */ }
  };

  const data = inventory.data ?? {};
  const summary = data.summary ?? {};
  const symbols = Array.isArray(data.symbols) ? data.symbols : [];

  const filtered = useMemo(() => {
    let list = [...symbols];
    if (filter === 'with-data') list = list.filter((s) => s.barCount > 0);
    if (filter === 'no-data') list = list.filter((s) => s.barCount === 0);
    if (filter === 'bt-run') list = list.filter((s) => s.backtestRuns > 0);

    list.sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = typeof aVal === 'number'
        ? (bVal ?? 0) - (aVal ?? 0)
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? -cmp : cmp;
    });
    return list;
  }, [symbols, filter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortArrow = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  if (inventory.isLoading) return (
    <div className="trading-platforms-page">
      <header className="tp-page-header"><h2>Backtest Data Inventory</h2></header>
      <LoadingSkeleton variant="card" count={4} />
      <LoadingSkeleton variant="table" rows={8} cols={7} className="ls-spacer-top" />
    </div>
  );

  if (inventory.isError) return (
    <div className="trading-platforms-page">
      <header className="tp-page-header"><h2>Backtest Data Inventory</h2></header>
      <div className="tp-card tp-card--warn">Failed to load. Is the backend running?</div>
    </div>
  );

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h2>Backtest Data Inventory</h2>
        <p>{summary.totalSymbols} symbols · {summary.symbolsWithBars} with market data · {summary.totalBars.toLocaleString()} total bars · {summary.totalBacktestRuns} backtest runs</p>
      </header>

      {/* Summary cards */}
      <div className="data-cards" style={{ marginBottom: 16 }}>
        <div className="data-card">
          <div className="data-card-value">{summary.symbolsWithBars}<small>/{summary.totalSymbols}</small></div>
          <div className="data-card-label">Symbols with Data</div>
        </div>
        <div className="data-card">
          <div className="data-card-value">{summary.totalBars.toLocaleString()}</div>
          <div className="data-card-label">Total Bars</div>
        </div>
        <div className="data-card">
          <div className="data-card-value">{summary.totalBacktestRuns}</div>
          <div className="data-card-label">Backtest Runs</div>
        </div>
        <div className="data-card">
          <div className="data-card-value">{symbols.filter((s) => s.barCount >= 365).length}</div>
          <div className="data-card-label">1yr+ History</div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: `All (${symbols.length})` },
          { key: 'with-data', label: `With Data (${symbols.filter((s) => s.barCount > 0).length})` },
          { key: 'no-data', label: `No Data (${symbols.filter((s) => s.barCount === 0).length})` },
          { key: 'bt-run', label: `BT Run (${symbols.filter((s) => s.backtestRuns > 0).length})` },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            className={`tp-chip ${filter === f.key ? 'tp-chip--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="tp-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="tp-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer' }}>Ticker{sortArrow('ticker')}</th>
              <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type{sortArrow('type')}</th>
              <th onClick={() => toggleSort('barCount')} style={{ cursor: 'pointer' }}>Bars{sortArrow('barCount')}</th>
              <th onClick={() => toggleSort('dateFrom')} style={{ cursor: 'pointer' }}>From{sortArrow('dateFrom')}</th>
              <th onClick={() => toggleSort('dateTo')} style={{ cursor: 'pointer' }}>To{sortArrow('dateTo')}</th>
              <th onClick={() => toggleSort('provider')} style={{ cursor: 'pointer' }}>Provider{sortArrow('provider')}</th>
              <th>Timeframes</th>
              <th onClick={() => toggleSort('backtestRuns')} style={{ cursor: 'pointer' }}>BT Runs{sortArrow('backtestRuns')}</th>
              <th onClick={() => toggleSort('lastBacktest')} style={{ cursor: 'pointer' }}>Last BT{sortArrow('lastBacktest')}</th>
              <th style={{ width: 50 }}>Rec</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.ticker}>
                <td className="tp-mono">{s.ticker}</td>
                <td>{s.type}</td>
                <td><BarStatus count={s.barCount} /></td>
                <td className="tp-mono">{s.dateFrom || '—'}</td>
                <td className="tp-mono">{s.dateTo || '—'}</td>
                <td><span className="tp-chip tp-chip--neutral">{s.provider || '—'}</span></td>
                <td>{s.timeframes?.join(', ') || '—'}</td>
                <td style={{ textAlign: 'center' }}>{s.backtestRuns || '—'}</td>
                <td className="tp-mono" style={{ fontSize: 11 }}>{s.lastBacktest || '—'}</td>
                <td>
                  {recordingTickers.has(s.ticker) ? (
                    <button className="tp-chip tp-chip--warn" style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 10 }} onClick={() => toggleRecording(s.ticker)} title={`Recording ${recordings.find(r => r.ticker === s.ticker)?.barCount ?? 0} 5s bars — click to stop`}>
                      ⏺ {recordings.find(r => r.ticker === s.ticker)?.barCount ?? 0}
                    </button>
                  ) : (
                    <button className="tp-chip tp-chip--neutral" style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 10, opacity: 0.6 }} onClick={() => toggleRecording(s.ticker)} title="Record 5s candles">
                      ⏺
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--tcs-text-muted)' }}>No symbols match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
