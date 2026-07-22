import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './performance-lab.css';

function PnlBadge({ value }) {
  const cls = value >= 0 ? 'pl-up' : 'pl-down';
  const sign = value >= 0 ? '+' : '';
  return <span className={`pl-pnl ${cls}`}>{sign}{value.toFixed(2)}</span>;
}

function MiniBar({ value, max, color = '#22c55e' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="pl-bar"><span className="pl-bar-fill" style={{ width: `${pct}%`, background: color }} /></span>;
}

export default function PerformanceLabPage() {
  const [days, setDays] = useState(90);

  const summaryQuery = useQuery({
    queryKey: ['performance', 'summary', days],
    queryFn: () => apiGet(`/api/performance/summary/full?days=${days}`),
    refetchInterval: 60000,
  });

  const strategiesQuery = useQuery({
    queryKey: ['performance', 'strategies'],
    queryFn: () => apiGet('/api/performance'),
    refetchInterval: 60000,
  });

  // Live MT5 positions for mark-to-market context
  const mt5Query = useQuery({
    queryKey: ['mt5-positions'],
    queryFn: () => apiGet('/api/trading/mt5/positions').catch(() => []),
    refetchInterval: 30000,
  });

  const data = summaryQuery.data;
  const strategies = strategiesQuery.data?.strategies || [];
  const mt5Positions = Array.isArray(mt5Query.data) ? mt5Query.data : [];
  const isLoading = summaryQuery.isLoading || strategiesQuery.isLoading;
  const isError = summaryQuery.isError || strategiesQuery.isError;

  // Compute max values for bar scaling
  const maxPnl = useMemo(() => Math.max(1, ...strategies.map(s => Math.abs(s.totalPnl))), [strategies]);
  const maxTrades = useMemo(() => Math.max(1, ...strategies.map(s => s.totalTrades)), [strategies]);

  if (isLoading) return <div className="pl-page"><LoadingSkeleton variant="card" count={6} /></div>;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <h1>Trading Performance</h1>
          <p className="pl-subtitle">Real trade outcomes — win rate, P&L, drawdown, and equity curve from closed trades. Open positions show mark-to-market via MT5.</p>
        </div>
        <div className="pl-days">
          {[30, 90, 180, 365].map(d => (
            <button key={d} className={`pl-day-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </header>

      {isError && <ApiOfflineBanner />}

      {/* ── Overall Summary ── */}
      {data?.overall && (
        <div className="pl-overall">
          <div className="pl-stat-card">
            <span className="pl-stat-val" style={{ color: data.overall.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
              {data.overall.totalPnl >= 0 ? '+' : ''}{data.overall.totalPnl.toFixed(2)}
            </span>
            <span className="pl-stat-label">Total P&L ({days}d)</span>
          </div>
          <div className="pl-stat-card">
            <span className="pl-stat-val">{data.overall.winRate}%</span>
            <span className="pl-stat-label">Win Rate</span>
            <span className="pl-stat-sub">{data.overall.totalWins}W / {data.overall.totalLosses}L</span>
          </div>
          <div className="pl-stat-card">
            <span className="pl-stat-val">{data.overall.profitFactor === Infinity ? '∞' : data.overall.profitFactor.toFixed(2)}</span>
            <span className="pl-stat-label">Profit Factor</span>
          </div>
          <div className="pl-stat-card">
            <span className="pl-stat-val">{data.overall.totalTrades}</span>
            <span className="pl-stat-label">Closed Trades</span>
          </div>
          <div className="pl-stat-card">
            <span className="pl-stat-val">{data.overall.activeStrategies}</span>
            <span className="pl-stat-label">Active Strategies</span>
          </div>
        </div>
      )}

      {/* ── Live MT5 Positions ── */}
      {mt5Positions.length > 0 && (
        <section className="pl-section">
          <h2>Open Positions (MT5)</h2>
          <div className="pl-strategy-grid">
            {mt5Positions.map((p, i) => (
              <div key={p.ticket || i} className="pl-strategy-card">
                <div className="pl-card-head">
                  <span className="pl-strategy-name">{p.symbol} {p.type === 0 ? 'BUY' : 'SELL'} ×{p.volume}</span>
                  <PnlBadge value={p.profit || 0} />
                </div>
                <div className="pl-card-stats">
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{p.price_current?.toFixed(4) || '—'}</span>
                    <span className="pl-cs-label">Current</span>
                  </div>
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{p.price_open?.toFixed(4) || '—'}</span>
                    <span className="pl-cs-label">Entry</span>
                  </div>
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{p.ticket}</span>
                    <span className="pl-cs-label">Ticket</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Per-Strategy Cards ── */}
      {strategies.length > 0 ? (
        <section className="pl-section">
          <h2>Strategies</h2>
          <div className="pl-strategy-grid">
            {strategies.map(s => (
              <div key={s.strategyId} className="pl-strategy-card">
                <div className="pl-card-head">
                  <span className="pl-strategy-name">{s.strategyName}</span>
                  <PnlBadge value={s.totalPnl} />
                </div>
                <div className="pl-card-stats">
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{s.winRate}%</span>
                    <span className="pl-cs-label">Win Rate</span>
                  </div>
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{s.totalTrades}</span>
                    <span className="pl-cs-label">Trades</span>
                  </div>
                  <div className="pl-card-stat">
                    <span className="pl-cs-val">{s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(1)}</span>
                    <span className="pl-cs-label">PF</span>
                  </div>
                </div>
                <div className="pl-card-bars">
                  <div className="pl-bar-row">
                    <span className="pl-bar-label">P&L</span>
                    <MiniBar value={Math.abs(s.totalPnl)} max={maxPnl} color={s.totalPnl >= 0 ? '#22c55e' : '#ef4444'} />
                  </div>
                  <div className="pl-bar-row">
                    <span className="pl-bar-label">Volume</span>
                    <MiniBar value={s.totalTrades} max={maxTrades} color="#60a5fa" />
                  </div>
                </div>
                <div className="pl-card-footer">
                  <span>{s.symbols?.slice(0, 4).join(', ')}{s.symbols?.length > 4 ? ` +${s.symbols.length - 4}` : ''}</span>
                  <span className="pl-holding">{s.avgHoldingHours > 0 ? `${s.avgHoldingHours}h avg` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="pl-section">
          <p className="pl-empty">No strategy performance data yet. Trades recorded via MT5 close or strategy execution will appear here.</p>
        </section>
      )}

      {/* ── Equity Curve ── */}
      {data?.equityCurve?.length > 1 && (
        <section className="pl-section">
          <h2>Equity Curve</h2>
          <div className="pl-equity-chart">
            <div className="pl-ec-bars">
              {data.equityCurve.map((pt, i) => {
                const maxAbs = Math.max(1, ...data.equityCurve.map(p => Math.abs(p.cumPnl)));
                const height = Math.max(2, (Math.abs(pt.cumPnl) / maxAbs) * 120);
                return (
                  <div key={i} className="pl-ec-bar-wrap" title={`${pt.date}: ${pt.cumPnl >= 0 ? '+' : ''}${pt.cumPnl.toFixed(2)}`}>
                    <div
                      className={`pl-ec-bar ${pt.cumPnl >= 0 ? 'up' : 'down'}`}
                      style={{ height: `${height}px` }}
                    />
                    {i % Math.ceil(data.equityCurve.length / 10) === 0 && (
                      <span className="pl-ec-label">{pt.date.slice(5)}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="pl-ec-summary">
              <span>Start: {data.equityCurve[0]?.date}</span>
              <span>End: {data.equityCurve[data.equityCurve.length - 1]?.date}</span>
              <span className={data.overall?.totalPnl >= 0 ? 'pl-up' : 'pl-down'}>
                Net: {data.overall?.totalPnl >= 0 ? '+' : ''}{data.overall?.totalPnl?.toFixed(2)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ── Monthly Breakdown ── */}
      {data?.monthlyBreakdown?.length > 0 && (
        <section className="pl-section">
          <h2>Monthly Breakdown</h2>
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Trades</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Win Rate</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyBreakdown.map(m => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.trades}</td>
                    <td className="pl-up">{m.wins}</td>
                    <td className="pl-down">{m.losses}</td>
                    <td style={{ color: m.winRate >= 50 ? '#22c55e' : '#ef4444' }}>{m.winRate}%</td>
                    <td><PnlBadge value={m.pnl} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Empty State ── */}
      {!data?.overall && !strategies.length && (
        <div className="pl-empty-state">
          <p>No performance data available. Trades are recorded when positions are closed via MT5 or strategy execution.</p>
        </div>
      )}
    </div>
  );
}
