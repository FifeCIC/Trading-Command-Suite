import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

// ── Filters ────────────────────────────────────────────────
const SOURCES = [
  { id: 'trading212', label: 'Trading212' },
  { id: 'mt5', label: 'MT5' },
  { id: 'all', label: 'All' },
];

const DATE_RANGES = [
  { id: '7', label: '7 Days' },
  { id: '30', label: '30 Days' },
  { id: '90', label: '90 Days' },
  { id: 'all', label: 'All Time' },
];

// ── CSV Export ─────────────────────────────────────────────
function exportCSV(trades) {
  const header = 'Date,Symbol,Type,Quantity,Entry Price,Exit Price,P&L,Source';
  const rows = trades.map((t) =>
    [
      new Date(t.date).toISOString(),
      t.symbol,
      t.type,
      t.quantity,
      t.entryPrice?.toFixed(2) || '',
      t.exitPrice?.toFixed(2) || '',
      t.pnl?.toFixed(2) || '0.00',
      t.source,
    ].join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trade-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Summary Cards ──────────────────────────────────────────
function SummaryCards({ summary }) {
  const cards = [
    { label: 'Total Trades', value: summary.totalTrades, format: (v) => v },
    { label: 'Win Rate', value: summary.winRate, format: (v) => `${v}%`, cls: summary.winRate >= 50 ? 'pf-green' : 'pf-red' },
    { label: 'Total P&L', value: summary.totalPnl, format: (v) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`, cls: summary.totalPnl >= 0 ? 'pf-green' : 'pf-red' },
    { label: 'Best Trade', value: summary.bestTrade, format: (v) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`, cls: 'pf-green' },
    { label: 'Worst Trade', value: summary.worstTrade, format: (v) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`, cls: 'pf-red' },
  ];

  return (
    <div className="pf-summary">
      {cards.map((c) => (
        <div key={c.label} className="pf-sum-card">
          <div className={`pf-sum-val ${c.cls || ''}`}>
            {c.format(c.value)}
          </div>
          <div>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function TradeHistoryPage() {
  const [source, setSource] = useState('trading212');
  const [dateRange, setDateRange] = useState('30');

  const historyQuery = useQuery({
    queryKey: ['trade-history', source, dateRange],
    queryFn: async () => {
      if (source === 'trading212') {
        const days = dateRange === 'all' ? undefined : parseInt(dateRange, 10);
        const url = `/api/portfolio/trading212/history${days ? `?days=${days}` : ''}`;
        const data = await apiGet(url);
        return data;
      }
      // MT5 and "All" — return empty for now, MT5 integration pending
      return {
        success: true,
        trades: [],
        summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
      };
    },
    staleTime: 30_000,
    refetchInterval: 300_000, // 5 minutes
  });

  const data = historyQuery.data;
  const trades = data?.trades || [];
  const summary = data?.summary || { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0 };
  const apiError = data?.error;

  const onExport = useCallback(() => exportCSV(trades), [trades]);

  return (
    <div className="pf-page">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="pf-header">
        <div>
          <h1>Trade History</h1>
          {trades.length > 0 && (
            <span className="pf-refreshed">
              {trades.length} trade{trades.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="pf-header-actions">
          <select className="pf-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <select className="pf-source-select" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            {DATE_RANGES.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <button className="pf-refresh-btn" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
            {historyQuery.isFetching ? '⟳' : '↻'} Refresh
          </button>
          {trades.length > 0 && (
            <button className="pf-refresh-btn" onClick={onExport}>
              ⬇ CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Refresh Indicator ───────────────────────────────── */}
      {historyQuery.isFetching && !historyQuery.isLoading && (
        <div className="pf-refresh-indicator">⟳ Refreshing…</div>
      )}

      {/* ── API Error Banner ────────────────────────────────── */}
      {apiError && (
        <div className="pf-mode-badge pf-mode-mock" style={{ marginBottom: '1rem' }}>
          ⚠ Trading212 API: {apiError} — showing fallback data
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────── */}
      <SummaryCards summary={summary} />

      {/* ── Win/Loss Detail ─────────────────────────────────── */}
      {summary.totalTrades > 0 && (
        <div className="pf-section" style={{ paddingTop: 0 }}>
          <div className="pf-hint">
            {summary.winningTrades} wins / {summary.losingTrades} losses
            {summary.losingTrades > 0 && (
              <> — need {summary.losingTrades} winning trade{summary.losingTrades !== 1 ? 's' : ''} to offset losses at 1:1 R:R</>
            )}
          </div>
        </div>
      )}

      {/* ── Trades Table ────────────────────────────────────── */}
      <div className="pf-section">
        <h2>Trades</h2>
        {trades.length === 0 ? (
          <p className="pf-hint">
            {historyQuery.isLoading
              ? 'Loading trade history…'
              : source === 'trading212'
                ? 'No trades found in this date range. Connect your Trading212 account to import trade history.'
                : 'MT5 trade history integration coming soon.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>P&amp;L</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={`${t.symbol}-${t.date}-${i}`}>
                    <td>
                      {new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </td>
                    <td><strong>{t.symbol}</strong></td>
                    <td>
                      <span className={`pf-type-badge ${t.type === 'BUY' ? 'pf-type-buy' : 'pf-type-sell'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td>{t.quantity}</td>
                    <td>{t.entryPrice > 0 ? `$${t.entryPrice.toFixed(2)}` : '—'}</td>
                    <td>{t.exitPrice > 0 ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                    <td className={t.pnl >= 0 ? 'pf-green' : 'pf-red'}>
                      {t.pnl !== 0 ? `${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(2)}` : '—'}
                    </td>
                    <td><span className="pf-source-tag">{t.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
