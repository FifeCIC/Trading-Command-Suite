/**
 * MetaStack Performance View
 * ===========================
 * Dedicated page displaying stack ratings, composition, drill-down,
 * and fingerprint change warnings.
 *
 * API: GET /api/scoring/metastacks/ratings
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './metastack-performance.css';

const BAND_COLORS = {
  Gold: '#ffd700', Silver: '#c0c0c0', Bronze: '#cd7f32', Untested: '#64748b',
};

function starBandLabel(band, rating) {
  if (band === 'Gold') return '●●● Gold';
  if (band === 'Silver') return '●● Silver';
  if (band === 'Bronze') return '● Bronze';
  return '○ Untested';
}

export default function MetaStackPerformancePage() {
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('rating');

  // ── Fetch ratings ──
  const ratingsQuery = useQuery({
    queryKey: ['ms-ratings'],
    queryFn: () => apiGet('/api/scoring/metastacks/ratings').catch(() => ({ metaStacks: [] })),
    refetchInterval: 30_000,
  });
  const stacks = ratingsQuery.data?.metaStacks || [];

  // ── Sort ──
  const sortedStacks = useMemo(() => {
    return [...stacks].sort((a, b) => {
      switch (sortBy) {
        case 'rating': return (b.rating || 0) - (a.rating || 0);
        case 'pnl': return (b.totalPnl || 0) - (a.totalPnl || 0);
        case 'trades': return (b.totalTrades || 0) - (a.totalTrades || 0);
        case 'winRate': return (b.winRate || 0) - (a.winRate || 0);
        default: return 0;
      }
    });
  }, [stacks, sortBy]);

  // ── Summary stats ──
  const totalStacks = stacks.length;
  const ratedStacks = stacks.filter(s => s.band !== 'Untested').length;
  const totalPnl = stacks.reduce((s, st) => s + (st.totalPnl || 0), 0);
  const topStack = sortedStacks[0];

  if (ratingsQuery.isLoading) {
    return (
      <div className="mp-page">
        <header className="mp-header"><h1>MetaStack Performance</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  return (
    <div className="mp-page">
      <header className="mp-header">
        <div>
          <h1>📊 MetaStack Performance</h1>
          <p className="mp-subtitle">Stack ratings, composition, and performance history for every M.E.T.A. configuration</p>
        </div>
      </header>

      {/* Summary bar */}
      <div className="mp-summary-bar">
        <div className="mp-summary-item">{totalStacks} stacks</div>
        <div className="mp-summary-item">{ratedStacks} rated</div>
        <div className="mp-summary-item" style={{color: totalPnl >= 0 ? '#22c55e' : '#ef4444'}}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} total P&amp;L
        </div>
        {topStack && (
          <div className="mp-summary-item">🏆 {topStack.metaStackName || 'Top Stack'}</div>
        )}
      </div>

      {stacks.length === 0 ? (
        <Notice level="info">No MetaStacks configured. Create scoring strategies to populate stack data.</Notice>
      ) : (
        <>
          {/* Sort controls */}
          <div className="mp-sort-bar">
            {[
              { key: 'rating', label: 'Rating' },
              { key: 'pnl', label: 'P&L' },
              { key: 'trades', label: 'Trades' },
              { key: 'winRate', label: 'Win Rate' },
            ].map(s => (
              <button
                key={s.key}
                className={`mp-sort-btn ${sortBy === s.key ? 'active' : ''}`}
                onClick={() => setSortBy(s.key)}
              >{s.label}</button>
            ))}
          </div>

          {/* Stack cards */}
          <div className="mp-grid">
            {sortedStacks.map((stack, i) => {
              const isExpanded = expanded === stack.scoringStrategyId;
              const band = stack.band || 'Untested';
              const bandColor = BAND_COLORS[band] || '#64748b';
              return (
                <motion.div
                  key={stack.scoringStrategyId}
                  className={`mp-card ${isExpanded ? 'expanded' : ''}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  style={{ borderTopColor: bandColor }}
                >
                  <div className="mp-card-header" onClick={() => setExpanded(isExpanded ? null : stack.scoringStrategyId)}>
                    <div className="mp-card-top">
                      <span className="mp-card-name">{stack.metaStackName || 'Unnamed Stack'}</span>
                      <span className="mp-card-band" style={{ color: bandColor }}>
                        {starBandLabel(band, stack.rating)}
                      </span>
                    </div>
                    <div className="mp-card-sub">
                      {stack.protocolId} · {stack.watchlistName} · {stack.brokerId}
                    </div>
                  </div>

                  <div className="mp-card-metrics">
                    <div className="mp-metric">
                      <span className="mp-metric-label">P&amp;L</span>
                      <span className="mp-metric-value" style={{color: (stack.totalPnl || 0) >= 0 ? '#22c55e' : '#ef4444'}}>
                        {(stack.totalPnl || 0) >= 0 ? '+' : ''}{(stack.totalPnl || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="mp-metric">
                      <span className="mp-metric-label">Win Rate</span>
                      <span className="mp-metric-value">{stack.winRate ? `${(stack.winRate * 100).toFixed(0)}%` : '—'}</span>
                    </div>
                    <div className="mp-metric">
                      <span className="mp-metric-label">Trades</span>
                      <span className="mp-metric-value">{stack.totalTrades || 0}</span>
                    </div>
                    <div className="mp-metric">
                      <span className="mp-metric-label">$/hr</span>
                      <span className="mp-metric-value">{stack.effectivenessRate != null ? stack.effectivenessRate.toFixed(2) : '—'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mp-card-detail">
                      <div className="mp-detail-grid">
                        <div className="mp-detail-item"><span>Protocol</span><span>{stack.protocolId}</span></div>
                        <div className="mp-detail-item"><span>Watchlist</span><span>{stack.watchlistName}</span></div>
                        <div className="mp-detail-item"><span>Broker</span><span>{stack.brokerId}</span></div>
                        <div className="mp-detail-item"><span>Base Size</span><span>{stack.baseSize || '—'}</span></div>
                        <div className="mp-detail-item"><span>SL</span><span>{stack.slPct != null ? `${stack.slPct}%` : 'ATR'}</span></div>
                        <div className="mp-detail-item"><span>TP</span><span>{stack.tpPct != null ? `${stack.tpPct}%` : 'ATR'}</span></div>
                        <div className="mp-detail-item"><span>Threshold</span><span>{stack.tradeThreshold || '—'}</span></div>
                        <div className="mp-detail-item"><span>Mode</span><span>{stack.tradingEnabled ? '🟢 Trading' : '📊 Monitor'}</span></div>
                      </div>
                    </div>
                  )}

                  <div className="mp-card-footer">
                    <span className="mp-card-chevron">{isExpanded ? '▲ Less' : '▼ Details'}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      <p className="mp-footer">
        Auto-refresh every 30s · {stacks.length} stacks
        {' · '}
        <button type="button" className="mp-refresh-link" onClick={() => ratingsQuery.refetch()}>Refresh now</button>
      </p>
    </div>
  );
}
