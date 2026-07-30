/**
 * Multi-Column Strategy Dashboard
 * ================================
 * Responsive grid of strategy cards showing real-time metrics:
 * P&L, allocated budget, run duration, active trades, status.
 *
 * Data sources:
 *   GET /api/trading/strategies       — all trading strategies
 *   GET /api/providers/mt5/diagnostics — portfolio data
 *   GET /api/providers/mt5/positions   — positions per strategy symbol
 *   GET /api/automation/status         — active strategies + decisions
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './strategy-dashboard.css';

const STATUS_COLORS = {
  running: '#22c55e', paused: '#f59e0b', stopped: '#64748b',
  error: '#ef4444', active: '#22c55e', enabled: '#3b82f6', disabled: '#64748b',
};

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function StrategyDashboardPage() {
  const [expanded, setExpanded] = useState(null);

  // ── Trading strategies ──
  const strategiesQuery = useQuery({
    queryKey: ['sd-strategies'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => ({ strategies: [] })),
    refetchInterval: 15_000,
  });
  const strategies = strategiesQuery.data?.strategies || [];

  // ── Automation status ──
  const autoQuery = useQuery({
    queryKey: ['sd-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });
  const autoStatus = autoQuery.data || {};

  // ── Portfolio ──
  const diagQuery = useQuery({
    queryKey: ['sd-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  });
  const mt5Connected = diagQuery.data?.connected === true;

  // ── Positions ──
  const posQuery = useQuery({
    queryKey: ['sd-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    refetchInterval: 15_000,
    enabled: mt5Connected,
  });
  const positions = posQuery.data?.positions || [];

  // ── Build strategy cards with merged data ──
  const strategyCards = useMemo(() => {
    const activeMap = new Map();
    (autoStatus.activeStrategies || []).forEach(s => {
      activeMap.set(s.strategyName || s.name || s.id, s);
    });

    return strategies.map(s => {
      const active = activeMap.get(s.name || s.id) || {};
      const stratPositions = positions.filter(p =>
        p.symbol?.toUpperCase() === (s.symbol || '').toUpperCase()
      );
      const stratPnl = stratPositions.reduce((sum, p) => sum + (p.profit || 0), 0);
      const posCount = stratPositions.length;
      const status = s.enabled !== false ? (s.active !== false ? 'active' : 'paused') : 'stopped';

      return {
        id: s.id || s.name,
        name: s.name || 'Unnamed Strategy',
        symbol: s.symbol || active.symbol || '—',
        status,
        mode: s.mode || active.mode || 'semi-auto',
        budget: s.baseSize ? `$${s.baseSize}` : '—',
        pnl: stratPnl,
        posCount,
        duration: formatDuration(active.runDurationMs || 0),
        runDurationMs: active.runDurationMs || 0,
        tradeThreshold: s.tradeThreshold || 3,
        protocolId: s.protocolId || active.protocolId,
        watchlistName: s.watchlistName || active.watchlistName,
        slPct: s.slPct,
        tpPct: s.tpPct,
      };
    }).sort((a, b) => {
      const order = { active: 0, paused: 1, stopped: 2, error: 3 };
      return (order[a.status] || 0) - (order[b.status] || 0);
    });
  }, [strategies, autoStatus, positions]);

  const totalPnl = strategyCards.reduce((s, c) => s + c.pnl, 0);
  const totalPositions = strategyCards.reduce((s, c) => s + c.posCount, 0);
  const activeCount = strategyCards.filter(c => c.status === 'active').length;
  const pausedCount = strategyCards.filter(c => c.status === 'paused').length;

  const isLoading = strategiesQuery.isLoading;

  if (isLoading) {
    return (
      <div className="sd-page">
        <header className="sd-header"><h1>Strategy Dashboard</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  return (
    <div className="sd-page">
      <header className="sd-header">
        <div>
          <h1>📊 Strategy Dashboard</h1>
          <p className="sd-subtitle">Multi-column grid — monitor all strategies in real-time</p>
        </div>
        <div className="sd-header-stats">
          <span className="sd-hs-item">{strategyCards.length} strategies</span>
          <span className="sd-hs-item" style={{color: '#22c55e'}}>{activeCount} active</span>
          {pausedCount > 0 && <span className="sd-hs-item" style={{color: '#f59e0b'}}>{pausedCount} paused</span>}
          <span className="sd-hs-item">{totalPositions} positions</span>
          <span className="sd-hs-item" style={{color: totalPnl >= 0 ? '#22c55e' : '#ef4444'}}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </span>
        </div>
      </header>

      {strategyCards.length === 0 ? (
        <Notice level="info">No trading strategies configured yet. Create strategies under Trading → Create Strategy.</Notice>
      ) : (
        <div className="sd-grid">
          {strategyCards.map((card, i) => {
            const isExpanded = expanded === card.id;
            const statusColor = STATUS_COLORS[card.status] || '#64748b';
            return (
              <motion.div
                key={card.id}
                className={`sd-card ${isExpanded ? 'expanded' : ''} sd-status-${card.status}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                {/* Card header */}
                <div className="sd-card-header" onClick={() => setExpanded(isExpanded ? null : card.id)}>
                  <div className="sd-card-top">
                    <span className="sd-card-name">{card.name}</span>
                    <span className="sd-card-status" style={{ background: statusColor }}>
                      {card.status}
                    </span>
                  </div>
                  <div className="sd-card-symbol">{card.symbol} · {card.mode}</div>
                </div>

                {/* Key metrics */}
                <div className="sd-card-metrics">
                  <div className="sd-metric">
                    <span className="sd-metric-label">P&amp;L</span>
                    <span className="sd-metric-value" style={{ color: card.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                      {card.pnl >= 0 ? '+' : ''}{card.pnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="sd-metric">
                    <span className="sd-metric-label">Positions</span>
                    <span className="sd-metric-value">{card.posCount}</span>
                  </div>
                  <div className="sd-metric">
                    <span className="sd-metric-label">Budget</span>
                    <span className="sd-metric-value">{card.budget}</span>
                  </div>
                  <div className="sd-metric">
                    <span className="sd-metric-label">P&amp;L/day</span>
                    <span className="sd-metric-value" style={{ color: card.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                      {card.runDurationMs > 86400000
                        ? `${card.pnl >= 0 ? '+' : ''}${(card.pnl / (card.runDurationMs / 86400000)).toFixed(2)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="sd-metric">
                    <span className="sd-metric-label">Runtime</span>
                    <span className="sd-metric-value">{card.duration}</span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="sd-card-detail">
                    <div className="sd-detail-grid">
                      <div className="sd-detail-item">
                        <span>Protocol</span>
                        <span>{card.protocolId || '—'}</span>
                      </div>
                      <div className="sd-detail-item">
                        <span>Watchlist</span>
                        <span>{card.watchlistName || '—'}</span>
                      </div>
                      <div className="sd-detail-item">
                        <span>Trade Threshold</span>
                        <span>{card.tradeThreshold}</span>
                      </div>
                      <div className="sd-detail-item">
                        <span>Stop Loss</span>
                        <span>{card.slPct != null ? `${card.slPct}%` : 'ATR-based'}</span>
                      </div>
                      <div className="sd-detail-item">
                        <span>Take Profit</span>
                        <span>{card.tpPct != null ? `${card.tpPct}%` : 'ATR-based'}</span>
                      </div>
                      <div className="sd-detail-item">
                        <span>Mode</span>
                        <span className="sd-mode-badge">{card.mode}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card footer */}
                <div className="sd-card-footer">
                  <span className="sd-card-chevron">{isExpanded ? '▲ Less' : '▼ More'}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="sd-footer">
        Auto-refresh every 15s · {strategyCards.length} strategies
        {' · '}
        <button type="button" className="sd-refresh-link" onClick={() => strategiesQuery.refetch()}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
