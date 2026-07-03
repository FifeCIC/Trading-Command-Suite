import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './strategy-comparison.css';

function StatCard({ label, value, color, sub }) {
  return (
    <div className="sc-stat">
      <span className="sc-stat-val" style={{ color }}>{value}</span>
      <span className="sc-stat-label">{label}</span>
      {sub && <span className="sc-stat-sub">{sub}</span>}
    </div>
  );
}

function PnlBadge({ value }) {
  const cls = value >= 0 ? 'sc-pnl-up' : 'sc-pnl-down';
  const sign = value >= 0 ? '+' : '';
  return <span className={`sc-pnl-badge ${cls}`}>{sign}{value.toFixed(2)}</span>;
}

export default function StrategyComparisonPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['strategy-comparison'],
    queryFn: () => apiGet('/api/trading/strategy-comparison'),
    refetchInterval: 30000,
  });

  const showdown = data?.showdown || [];
  const livePositions = data?.livePositions || [];

  // Best/worst strategy
  const best = showdown[0];
  const worst = showdown[showdown.length - 1];

  if (isLoading) return <div className="sc-page"><LoadingSkeleton variant="card" count={4} /></div>;

  return (
    <div className="sc-page">
      <motion.header className="sc-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Strategy Comparison</h1>
          <p className="sc-subtitle">Head-to-head trade outcomes — profit is the truth. Compare strategies by actual closed trades.</p>
        </div>
        <span className="sc-clock">{data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'}</span>
      </motion.header>

      {isError && <ApiOfflineBanner />}

      {/* ── Showdown Table ── */}
      {showdown.length > 0 ? (
        <motion.div className="sc-section" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h2>Strategy Showdown</h2>
          <div className="sc-table-wrap">
            <table className="sc-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Trades</th>
                  <th>Win Rate</th>
                  <th>Total P&L</th>
                  <th>Avg Win</th>
                  <th>Avg Loss</th>
                  <th>Best</th>
                  <th>Worst</th>
                  <th>Drawdown</th>
                  <th>Profit Factor</th>
                  <th>Symbols</th>
                </tr>
              </thead>
              <tbody>
                {showdown.map((s, i) => (
                  <motion.tr key={s.strategy}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className={i === 0 ? 'sc-row-best' : ''}
                  >
                    <td><strong>{s.strategy}</strong></td>
                    <td>{s.trades}</td>
                    <td style={{ color: s.winRate >= 50 ? '#22c55e' : '#ef4444' }}>{s.winRate}%</td>
                    <td><PnlBadge value={s.totalPnl} /></td>
                    <td className="sc-up">+{s.avgWinPnl.toFixed(2)}</td>
                    <td className="sc-down">{s.avgLossPnl.toFixed(2)}</td>
                    <td className="sc-up">+{s.bestTrade.toFixed(2)}</td>
                    <td className="sc-down">{s.worstTrade.toFixed(2)}</td>
                    <td style={{ color: s.maxDrawdown > 20 ? '#ef4444' : s.maxDrawdown > 10 ? '#f59e0b' : '#22c55e' }}>
                      {s.maxDrawdown}%
                    </td>
                    <td>{s.profitFactor != null ? s.profitFactor.toFixed(2) : '—'}</td>
                    <td>{s.symbolCount}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Best/Worst summary */}
          {best && worst && (
            <div className="sc-best-worst">
              <div className="sc-best-card">
                <span className="sc-bw-label">🏆 Best: {best.strategy}</span>
                <PnlBadge value={best.totalPnl} />
                <span className="sc-bw-meta">Win rate: {best.winRate}% · {best.trades} trades</span>
              </div>
              {worst !== best && (
                <div className="sc-worst-card">
                  <span className="sc-bw-label">📉 Worst: {worst.strategy}</span>
                  <PnlBadge value={worst.totalPnl} />
                  <span className="sc-bw-meta">Win rate: {worst.winRate}% · {worst.trades} trades</span>
                </div>
              )}
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div className="sc-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p>No closed trades with strategy tags yet. Trades recorded via MT5 close or strategy execution will appear here.</p>
        </motion.div>
      )}

      {/* ── Live Positions ── */}
      <motion.div className="sc-section" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h2>Live Positions by Strategy</h2>
        {data?.liveSource && <p className="sc-source-note">{data.liveSource}</p>}
        {livePositions.length === 0 ? (
          <p className="sc-empty-text">No open positions currently tracked by strategy.</p>
        ) : (
          <div className="sc-live-grid">
            {livePositions.map((lp) => (
              <motion.div key={lp.strategy} className="sc-live-card"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              >
                <div className="sc-live-head">
                  <span className="sc-live-strategy">{lp.strategy}</span>
                  <span className="sc-live-count">{lp.positionCount} open</span>
                  <PnlBadge value={lp.totalPnl} />
                </div>
                <div className="sc-live-positions">
                  {lp.positions.map((p, j) => (
                    <div key={j} className="sc-live-pos">
                      <span className="sc-lp-symbol">{p.symbol}</span>
                      <span className={`sc-lp-side ${p.side === 'buy' ? 'sc-buy' : 'sc-sell'}`}>{p.side?.toUpperCase()}</span>
                      <span className="sc-lp-qty">×{p.quantity}</span>
                      <span className="sc-lp-entry">@{p.entryPrice?.toFixed(4) || '—'}</span>
                      <PnlBadge value={p.pnl || 0} />
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
