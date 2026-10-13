import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './performance-lab.css';
import PageInfoPopover from '../components/PageInfoPopover';

function PnlBadge({ value }) {
  const cls = value >= 0 ? 'perflab-up' : 'perflab-down';
  const sign = value >= 0 ? '+' : '';
  return <span className={`perflab-pnl ${cls}`}>{sign}{value.toFixed(2)}</span>;
}

function MiniBar({ value, max, color = '#22c55e' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="perflab-bar"><span className="perflab-bar-fill" style={{ width: `${pct}%`, background: color }} /></span>;
}

/**
 * fmtProfitFactor() — profit factor, rendered without trusting its type.
 *
 * ⚠️ THE BUG THIS EXISTS FOR (2026-10-01). Both call sites read
 * `pf === Infinity ? '∞' : pf.toFixed(n)`. **`Infinity` cannot survive JSON** —
 * `JSON.stringify({ v: Infinity })` is `{"v":null}` — so that guard NEVER matched and `.toFixed()`
 * was called on `null`, throwing "Cannot read properties of null (reading 'toFixed')" on
 * /lab/performance. Measured: 4 of 43 strategies ("Tech Giants - MSFT/GOOGL/AVGO/AAPL", one winning
 * trade and no losing one) arrived as `"profitFactor": null`.
 *
 * A profit factor IS unbounded when there are no losing trades, so '∞' is the honest rendering — not
 * '—' (which would claim the value is unknowable) and not '0.0' (which would claim break-even).
 * `999` is the finite sentinel the API now sends; `null`/non-finite is still handled because that
 * is what older responses carry, and it is what `Infinity` becomes on the wire.
 */
function fmtProfitFactor(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '∞';
  if (v >= 999) return '∞';
  return v.toFixed(digits);
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

  if (isLoading) return <div className="perflab-page"><LoadingSkeleton variant="card" count={6} /></div>;

  return (
    <div className="perflab-page">
      <header className="perflab-header">
        <div>
          <h1>Trading Performance
          <PageInfoPopover>
            Real trade outcomes — win rate, P&L, drawdown, and equity curve from closed trades. Open positions show mark-to-market via MT5.
          </PageInfoPopover>
        </h1>
        </div>
        <div className="perflab-days">
          {[30, 90, 180, 365].map(d => (
            <button key={d} className={`perflab-day-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </header>

      {isError && <ApiOfflineBanner />}

      {/* ── Overall Summary ── */}
      {data?.overall && (
        <div className="perflab-overall">
          <div className="perflab-stat-card">
            <span className="perflab-stat-val" style={{ color: data.overall.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
              {data.overall.totalPnl >= 0 ? '+' : ''}{data.overall.totalPnl.toFixed(2)}
            </span>
            <span className="perflab-stat-label">Total P&L ({days}d)</span>
          </div>
          <div className="perflab-stat-card">
            <span className="perflab-stat-val">{data.overall.winRate}%</span>
            <span className="perflab-stat-label">Win Rate</span>
            <span className="perflab-stat-sub">{data.overall.totalWins}W / {data.overall.totalLosses}L</span>
          </div>
          <div className="perflab-stat-card">
            <span className="perflab-stat-val">{fmtProfitFactor(data.overall.profitFactor, 2)}</span>
            <span className="perflab-stat-label">Profit Factor</span>
          </div>
          <div className="perflab-stat-card">
            <span className="perflab-stat-val">{data.overall.totalTrades}</span>
            <span className="perflab-stat-label">Closed Trades</span>
          </div>
          <div className="perflab-stat-card">
            <span className="perflab-stat-val">{data.overall.activeStrategies}</span>
            <span className="perflab-stat-label">Active Strategies</span>
          </div>
        </div>
      )}

      {/* ── Live MT5 Positions ── */}
      {mt5Positions.length > 0 && (
        <section className="perflab-section">
          <h2>Open Positions (MT5)</h2>
          <div className="perflab-strategy-grid">
            {mt5Positions.map((p, i) => (
              <div key={p.ticket || i} className="perflab-strategy-card">
                <div className="perflab-card-head">
                  <span className="perflab-strategy-name">{p.symbol} {p.type === 0 ? 'BUY' : 'SELL'} ×{p.volume}</span>
                  <PnlBadge value={p.profit || 0} />
                </div>
                <div className="perflab-card-stats">
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{p.price_current?.toFixed(4) || '—'}</span>
                    <span className="perflab-cs-label">Current</span>
                  </div>
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{p.price_open?.toFixed(4) || '—'}</span>
                    <span className="perflab-cs-label">Entry</span>
                  </div>
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{p.ticket}</span>
                    <span className="perflab-cs-label">Ticket</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Per-Strategy Cards ── */}
      {strategies.length > 0 ? (
        <section className="perflab-section">
          <h2>Strategies</h2>
          <div className="perflab-strategy-grid">
            {strategies.map(s => (
              <div key={s.strategyId} className="perflab-strategy-card">
                <div className="perflab-card-head">
                  <span className="perflab-strategy-name">{s.strategyName}</span>
                  <PnlBadge value={s.totalPnl} />
                </div>
                <div className="perflab-card-stats">
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{s.winRate}%</span>
                    <span className="perflab-cs-label">Win Rate</span>
                  </div>
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{s.totalTrades}</span>
                    <span className="perflab-cs-label">Trades</span>
                  </div>
                  <div className="perflab-card-stat">
                    <span className="perflab-cs-val">{fmtProfitFactor(s.profitFactor, 1)}</span>
                    <span className="perflab-cs-label">PF</span>
                  </div>
                </div>
                <div className="perflab-card-bars">
                  <div className="perflab-bar-row">
                    <span className="perflab-bar-label">P&L</span>
                    <MiniBar value={Math.abs(s.totalPnl)} max={maxPnl} color={s.totalPnl >= 0 ? '#22c55e' : '#ef4444'} />
                  </div>
                  <div className="perflab-bar-row">
                    <span className="perflab-bar-label">Volume</span>
                    <MiniBar value={s.totalTrades} max={maxTrades} color="#60a5fa" />
                  </div>
                </div>
                <div className="perflab-card-footer">
                  <span>{s.symbols?.slice(0, 4).join(', ')}{s.symbols?.length > 4 ? ` +${s.symbols.length - 4}` : ''}</span>
                  <span className="perflab-holding">{s.avgHoldingHours > 0 ? `${s.avgHoldingHours}h avg` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="perflab-section">
          <p className="perflab-empty">No strategy performance data yet. Trades recorded via MT5 close or strategy execution will appear here.</p>
        </section>
      )}

      {/* ── Equity Curve ── */}
      {data?.equityCurve?.length > 1 && (
        <section className="perflab-section">
          <h2>Equity Curve</h2>
          <div className="perflab-equity-chart">
            <div className="perflab-ec-bars">
              {data.equityCurve.map((pt, i) => {
                const maxAbs = Math.max(1, ...data.equityCurve.map(p => Math.abs(p.cumPnl)));
                const height = Math.max(2, (Math.abs(pt.cumPnl) / maxAbs) * 120);
                return (
                  <div key={i} className="perflab-ec-bar-wrap" title={`${pt.date}: ${pt.cumPnl >= 0 ? '+' : ''}${pt.cumPnl.toFixed(2)}`}>
                    <div
                      className={`perflab-ec-bar ${pt.cumPnl >= 0 ? 'up' : 'down'}`}
                      style={{ height: `${height}px` }}
                    />
                    {i % Math.ceil(data.equityCurve.length / 10) === 0 && (
                      <span className="perflab-ec-label">{pt.date.slice(5)}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="perflab-ec-summary">
              <span>Start: {data.equityCurve[0]?.date}</span>
              <span>End: {data.equityCurve[data.equityCurve.length - 1]?.date}</span>
              <span className={data.overall?.totalPnl >= 0 ? 'perflab-up' : 'perflab-down'}>
                Net: {data.overall?.totalPnl >= 0 ? '+' : ''}{data.overall?.totalPnl?.toFixed(2)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ── Monthly Breakdown ── */}
      {data?.monthlyBreakdown?.length > 0 && (
        <section className="perflab-section">
          <h2>Monthly Breakdown</h2>
          <div className="perflab-table-wrap">
            <table className="perflab-table">
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
                    <td className="perflab-up">{m.wins}</td>
                    <td className="perflab-down">{m.losses}</td>
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
        <div className="perflab-empty-state">
          <p>No performance data available. Trades are recorded when positions are closed via MT5 or strategy execution.</p>
        </div>
      )}
    </div>
  );
}
