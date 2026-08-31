/**
 * Strategy Monitor — Unified Dashboard
 * ======================================
 * Single merged view (2026-08-31): stat grid + filters + sl-card strategy
 * cards. Former Overview / Strategies / Compare tabs were consolidated into
 * one scrollable view; comparison lives at /trading/strategy-comparison.
 *
 * Data: /api/trading/strategies/with-ratios, /api/automation/status
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { scoreClass } from '../core/signal-utils';
import './strategy-monitor.css';
import './strategies-list.css';

export default function StrategyMonitorPage() {
  const [selectedStratId, setSelectedStratId] = useState(null);

  // ── Shared data ──
  const { data: strategies = [], isLoading: stratLoading } = useQuery({
    queryKey: ['monitor-strategies'],
    queryFn: () => apiGet('/api/trading/strategies/with-ratios').catch(() => ({ strategies: [] })),
    refetchInterval: 15_000,
  });
  const stratList = Array.isArray(strategies) ? strategies : (strategies?.strategies || strategies?.viable || []);

  const { data: autoStatus } = useQuery({
    queryKey: ['monitor-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });

  const { data: mt5Diag } = useQuery({
    queryKey: ['monitor-mt5'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  });

  // ── Compute overview stats ──
  const overview = useMemo(() => {
    const active = stratList.filter(s => s.active !== false);
    const trading = active.filter(s => s.symbol);
    const scoring = active.filter(s => s.watchlistName);
    const withScore = active.filter(s => s.lastComposite != null);
    const avgScore = withScore.length > 0
      ? Math.round(withScore.reduce((sum, s) => sum + s.lastComposite, 0) / withScore.length)
      : 0;
    return { total: stratList.length, active: active.length, trading: trading.length, scoring: scoring.length, avgScore };
  }, [stratList]);

  const loopRunning = autoStatus?.loopEnabled;
  const tickCount = autoStatus?.tickCount || 0;
  const lastTickMs = autoStatus?.lastTickMs || 0;

  // ── Monitored set: active trading strategies only (this is a Monitor view) ──
  const monitoredStrats = useMemo(
    () => stratList.filter(s => s.active !== false && Boolean(s.symbol)),
    [stratList],
  );

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="sm-page">
      <motion.header className="sm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Strategy Monitor</h1>
          <p className="sm-subtitle">
            {overview.active} active · {overview.trading} trading · {overview.scoring} scoring · avg score {overview.avgScore}
          </p>
        </div>
        <div className="sm-loop-badge" style={{ background: loopRunning ? '#22c55e18' : '#64748b18', color: loopRunning ? '#22c55e' : '#64748b' }}>
          {loopRunning ? '🟢 Loop Active' : '⚫ Loop Stopped'} · Tick #{tickCount} · {lastTickMs}ms
        </div>
      </motion.header>

      {/* Single merged view: stats → filters → cards */}
      <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        {/* Stat cards */}
        <div className="sm-stat-grid">
          <div className="sm-stat"><span className="sm-stat-val">{overview.total}</span><span className="sm-stat-label">Total</span></div>
          <div className="sm-stat"><span className="sm-stat-val pl-score-high">{overview.active}</span><span className="sm-stat-label">Active</span></div>
          <div className="sm-stat"><span className="sm-stat-val" style={{ color: '#3b82f6' }}>{overview.trading}</span><span className="sm-stat-label">Trading</span></div>
          <div className="sm-stat"><span className={`sm-stat-val ${scoreClass(overview.avgScore)}`}>{overview.avgScore}</span><span className="sm-stat-label">Avg Score</span></div>
        </div>

        {mt5Diag?.connected && (
          <div className="sm-mt5-banner">
            🟢 MT5 Connected · {mt5Diag.accountName || 'Account'} · Balance: {mt5Diag.balance ?? '—'}
          </div>
        )}

        {/* Filter bar */}
        <div className="sm-strat-filters">
          <span className="sm-monitor-note">Monitoring active trading strategies only ({monitoredStrats.length})</span>
        </div>

        {/* Strategy cards — active trading only */}
        {stratLoading ? <LoadingSkeleton variant="card" count={6} /> : monitoredStrats.length === 0 ? (
          <EmptyState icon="◆" title="No active trading strategies" description="Activate a trading strategy to see monitoring data." />
        ) : (
          <div className="sl-grid">
            {monitoredStrats.map((s, i) => {
              const isActive = s.active !== false;
              const isTrading = Boolean(s.symbol);
              const isScoring = Boolean(s.watchlistName);
              const typeLabel = isTrading ? 'Trading' : isScoring ? 'Scoring' : 'Strategy';
              const typeColor = isTrading ? '#3b82f6' : isScoring ? '#8b5cf6' : '#94a3b8';

              return (
                <motion.div
                  key={s.id}
                  className={`sl-card ${selectedStratId === s.id ? 'sl-card-selected' : ''}`}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => setSelectedStratId(selectedStratId === s.id ? null : s.id)}
                >
                  <div className="sl-card-top">
                    <span className="sl-card-dot" style={{ background: isActive ? '#22c55e' : '#64748b' }} />
                    <strong className="sl-card-name">{s.name}</strong>
                    <span className="sl-card-type" style={{ background: typeColor + '18', color: typeColor, borderColor: typeColor + '33' }}>
                      {typeLabel}
                    </span>
                  </div>
                  <div className="sl-card-meta">
                    {s.symbol && <span className="sl-chip">{s.symbol}</span>}
                    {s.watchlistName && <span className="sl-chip sl-chip-wl">{s.watchlistName}</span>}
                    <span className="sl-chip sl-chip-proto">{s.protocolId || '—'}</span>
                    <span className="sl-chip sl-chip-broker">{s.brokerId || '—'}</span>
                  </div>
                  {s.lastComposite != null && (
                    <div className="sl-card-score">
                      <span className="sl-score-label">Last Score</span>
                      <span className={`sl-score-value ${scoreClass(s.lastComposite)}`}>
                        {s.lastComposite}
                      </span>
                    </div>
                  )}
                  {s.dataStatus && s.dataStatus !== 'ready' && (
                    <div className="sl-card-warning">
                      {s.dataStatus === 'pending_bars' ? '⏳' : '🚫'} {s.dataStatusReason || s.dataStatus}
                    </div>
                  )}
                  {selectedStratId === s.id && (
                    <div className="sl-card-detail">
                      {s.description && <p className="sl-detail-desc">{s.description}</p>}
                      <div className="sl-detail-grid">
                        <span>Mode: <strong>{s.mode || '—'}</strong></span>
                        <span>Base Size: <strong>{s.baseSize || '—'}</strong></span>
                        <span>SL: <strong>{s.slPct != null ? s.slPct + '%' : '—'}</strong></span>
                        <span>TP: <strong>{s.tpPct != null ? s.tpPct + '%' : '—'}</strong></span>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

    </div>
  );
}
