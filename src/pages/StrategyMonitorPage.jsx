/**
 * Strategy Monitor — Unified Dashboard
 * ======================================
 * Tabbed monitoring hub consolidating overview, comparison, and ladders.
 *
 * Tabs:
 *   Overview  — live metrics grid, strategy health cards (from StrategyDashboardPage)
 *   Compare   — P&L comparison across strategies (from StrategyComparisonPage)
 *   Ladders   — protocol-scored strategy rankings (from StrategyLaddersPage)
 *
 * Data: /api/trading/strategies/with-ratios, /api/automation/status, /api/trading/strategy-comparison, /api/scoring/arena
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './strategy-monitor.css';
import './strategies-list.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'strategies', label: 'Strategies', icon: '◆' },
  { id: 'compare', label: 'Compare', icon: '⚖️' },
  { id: 'ladders', label: 'Ladders', icon: '🪜' },
  { id: 'signals', label: 'Signals', icon: '📡' },
];

const STATUS_COLORS = {
  running: '#22c55e', paused: '#f59e0b', stopped: '#64748b',
  active: '#22c55e', enabled: '#3b82f6', disabled: '#64748b',
};

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PnlBadge({ value }) {
  const cls = value >= 0 ? 'sm-pnl-up' : 'sm-pnl-down';
  const sign = value >= 0 ? '+' : '';
  return <span className={`sm-pnl-badge ${cls}`}>{sign}{Number(value).toFixed(2)}</span>;
}

export default function StrategyMonitorPage() {
  const [tab, setTab] = useState('overview');
  const [stratFilter, setStratFilter] = useState('all');
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

  // ── Tab: Overview ──
  const { data: mt5Diag } = useQuery({
    queryKey: ['monitor-mt5'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
    enabled: tab === 'overview',
  });

  // ── Tab: Compare ──
  const { data: comparison, isLoading: compLoading } = useQuery({
    queryKey: ['monitor-compare'],
    queryFn: () => apiGet('/api/trading/strategy-comparison').catch(() => null),
    refetchInterval: 30_000,
    enabled: tab === 'compare',
  });

  // ── Tab: Ladders ──
  const { data: arena, isLoading: arenaLoading } = useQuery({
    queryKey: ['monitor-arena'],
    queryFn: () => apiGet('/api/scoring/arena').catch(() => null),
    refetchInterval: 30_000,
    enabled: tab === 'ladders',
  });

  // ── Tab: Signals ──
  const { data: signalsData, isLoading: signalsLoading } = useQuery({
    queryKey: ['monitor-signals'],
    queryFn: () => apiGet('/api/signals/envelope/recent?limit=50').catch(() => []),
    refetchInterval: 20_000,
    enabled: tab === 'signals',
  });
  const signals = Array.isArray(signalsData) ? signalsData : (signalsData?.envelopes || signalsData?.signals || []);

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

  // ── Strategies tab filters ──
  const filteredStrats = useMemo(() => {
    if (stratFilter === 'all') return stratList;
    if (stratFilter === 'active') return stratList.filter(s => s.active !== false);
    if (stratFilter === 'trading') return stratList.filter(s => s.symbol);
    if (stratFilter === 'scoring') return stratList.filter(s => s.watchlistName);
    if (stratFilter === 'faulty') return stratList.filter(s => s.dataStatus && s.dataStatus !== 'ready');
    return stratList;
  }, [stratList, stratFilter]);
  const faultyStrats = useMemo(() => stratList.filter(s => s.dataStatus && s.dataStatus !== 'ready'), [stratList]);

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

      {/* Tabs */}
      <div className="sm-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`sm-tab ${tab === t.id ? 'sm-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === 'overview' && (
        <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {/* Stat cards */}
          <div className="sm-stat-grid">
            <div className="sm-stat"><span className="sm-stat-val">{overview.total}</span><span className="sm-stat-label">Total</span></div>
            <div className="sm-stat"><span className="sm-stat-val" style={{ color: '#22c55e' }}>{overview.active}</span><span className="sm-stat-label">Active</span></div>
            <div className="sm-stat"><span className="sm-stat-val" style={{ color: '#3b82f6' }}>{overview.trading}</span><span className="sm-stat-label">Trading</span></div>
            <div className="sm-stat"><span className="sm-stat-val" style={{ color: '#8b5cf6' }}>{overview.scoring}</span><span className="sm-stat-label">Scoring</span></div>
            <div className="sm-stat"><span className="sm-stat-val" style={{ color: overview.avgScore >= 60 ? '#22c55e' : '#f59e0b' }}>{overview.avgScore}</span><span className="sm-stat-label">Avg Score</span></div>
          </div>

          {mt5Diag?.connected && (
            <div className="sm-mt5-banner">
              🟢 MT5 Connected · {mt5Diag.accountName || 'Account'} · Balance: {mt5Diag.balance ?? '—'}
            </div>
          )}

          {/* Strategy cards */}
          {stratLoading ? <LoadingSkeleton variant="card" count={3} /> : (
            <div className="sm-card-grid">
              {stratList.map(s => {
                const isActive = s.active !== false;
                return (
                  <div key={s.id} className="sm-card">
                    <div className="sm-card-row">
                      <span className="sm-card-dot" style={{ background: isActive ? STATUS_COLORS.active : STATUS_COLORS.disabled }} />
                      <strong>{s.name}</strong>
                    </div>
                    <div className="sm-card-meta">
                      {s.symbol && <span className="sm-chip">{s.symbol}</span>}
                      {s.watchlistName && <span className="sm-chip sm-chip-wl">{s.watchlistName}</span>}
                      <span className="sm-chip">{s.protocolId || '—'}</span>
                    </div>
                    {s.lastComposite != null && (
                      <div className="sm-card-score" style={{ color: s.lastComposite >= 60 ? '#22c55e' : s.lastComposite >= 40 ? '#f59e0b' : '#ef4444' }}>
                        {s.lastComposite}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!stratLoading && stratList.length === 0 && (
            <EmptyState icon="📊" title="No strategies" description="Create one to see monitoring data." />
          )}
        </motion.div>
      )}

      {/* ── Strategies Tab (merged from StrategiesListPage #560) ── */}
      {tab === 'strategies' && (
        <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {/* Filter bar */}
          <div className="sm-strat-filters">
            {['all', 'active', 'trading', 'scoring', 'faulty'].map(f => (
              <button
                key={f}
                className={`sl-filter-chip ${stratFilter === f ? 'sl-filter-active' : ''} ${f === 'faulty' ? 'sl-filter-faulty' : ''}`}
                onClick={() => setStratFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Faulty banner */}
          {faultyStrats.length > 0 && stratFilter !== 'faulty' && (
            <div className="sl-faulty-banner">
              <span>⚠️ {faultyStrats.length} strateg{faultyStrats.length !== 1 ? 'ies' : 'y'} with data issues</span>
              <button className="sl-faulty-banner-btn" onClick={() => setStratFilter('faulty')}>View faulty</button>
            </div>
          )}

          {stratLoading ? <LoadingSkeleton variant="card" count={6} /> : filteredStrats.length === 0 ? (
            <EmptyState icon="◆" title="No strategies" description="No strategies match this filter." />
          ) : (
            <div className="sl-grid">
              {filteredStrats.map((s, i) => {
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
                        <span className="sl-score-value" style={{ color: s.lastComposite >= 60 ? '#22c55e' : s.lastComposite >= 40 ? '#f59e0b' : '#ef4444' }}>
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
      )}

      {/* ── Compare Tab ── */}
      {tab === 'compare' && (
        <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {compLoading ? <LoadingSkeleton variant="card" count={3} /> : (
            comparison ? (
              <div className="sm-compare-grid">
                {Array.isArray(comparison) && comparison.map((s, i) => (
                  <div key={s.id || i} className="sm-compare-card">
                    <strong>{s.name || s.id}</strong>
                    <div className="sm-compare-stats">
                      <span>P&L: <PnlBadge value={s.pnl || 0} /></span>
                      <span>Trades: {s.tradeCount ?? '—'}</span>
                      <span>Win Rate: {s.winRate != null ? s.winRate + '%' : '—'}</span>
                    </div>
                  </div>
                ))}
                {(!Array.isArray(comparison) || comparison.length === 0) && (
                  <EmptyState icon="⚖️" title="No comparison data" description="Run trades to populate comparison metrics." />
                )}
              </div>
            ) : (
              <EmptyState icon="⚖️" title="Comparison unavailable" description="Backend may not have the strategy-comparison endpoint yet." />
            )
          )}
        </motion.div>
      )}

      {/* ── Ladders Tab ── */}
      {tab === 'ladders' && (
        <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {arenaLoading ? <LoadingSkeleton variant="text" lines={5} /> : (
            arena ? (
              <div className="sm-ladders-list">
                {Array.isArray(arena) && arena.map((entry, i) => (
                  <div key={i} className="sm-ladder-row">
                    <span className="sm-ladder-rank">#{i + 1}</span>
                    <span className="sm-ladder-name">{entry.name || entry.strategy || entry.id || '—'}</span>
                    <span className="sm-ladder-score" style={{ color: (entry.score || 0) >= 60 ? '#22c55e' : '#f59e0b' }}>
                      {entry.score ?? '—'}
                    </span>
                    {entry.protocol && <span className="sm-ladder-proto">{entry.protocol}</span>}
                  </div>
                ))}
                {(!Array.isArray(arena) || arena.length === 0) && (
                  <EmptyState icon="🪜" title="No ladder data" description="Strategy ladders are being migrated to DB-driven scoring." />
                )}
              </div>
            ) : (
              <EmptyState icon="🪜" title="Ladders unavailable" description="The arena endpoint may not be active yet." />
            )
          )}
        </motion.div>
      )}

      {/* ── Signals Tab ── */}
      {tab === 'signals' && (
        <motion.div className="sm-tab-content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {signalsLoading ? <LoadingSkeleton variant="text" lines={5} /> : (
            signals.length > 0 ? (
              <div className="sm-signals-list">
                <div className="sm-signals-header">
                  <span className="sm-sig-th">Time</span>
                  <span className="sm-sig-th">Symbol</span>
                  <span className="sm-sig-th">Score</span>
                  <span className="sm-sig-th">Signal</span>
                  <span className="sm-sig-th">Protocol</span>
                  <span className="sm-sig-th">Strategy</span>
                </div>
                {signals.slice(0, 50).map((sig, i) => (
                  <div key={sig.id || i} className="sm-signal-row">
                    <span className="sm-sig-td sm-sig-time">
                      {sig.timestamp ? new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                    </span>
                    <span className="sm-sig-td sm-sig-symbol">{sig.symbol}</span>
                    <span className="sm-sig-td sm-sig-score" style={{ color: (sig.composite || sig.score || 0) >= 60 ? '#22c55e' : (sig.composite || sig.score || 0) >= 40 ? '#f59e0b' : '#64748b' }}>
                      {sig.composite ?? sig.score ?? '—'}
                    </span>
                    <span className="sm-sig-td sm-sig-signal" style={{ color: sig.signal === 'BUY' ? '#22c55e' : sig.signal === 'SELL' ? '#ef4444' : '#f59e0b' }}>
                      {sig.signal || 'HOLD'}
                    </span>
                    <span className="sm-sig-td sm-sig-proto">{sig.protocol || sig.protocolId || '—'}</span>
                    <span className="sm-sig-td sm-sig-strategy">{sig.strategy || sig.strategyId || '—'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="📡" title="No signals yet" description="Signals appear when scoring strategies pass symbols through their gates. Run the scoring pipeline to populate." />
            )
          )}
        </motion.div>
      )}
    </div>
  );
}
