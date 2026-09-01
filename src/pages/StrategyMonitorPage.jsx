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
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import { dismissSignal } from '../core/api/signals';
import { timeAgo } from '../core/format-utils';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageInfoPopover from '../components/PageInfoPopover';
import { scoreClass } from '../core/signal-utils';
import './strategy-monitor.css';
import './strategies-list.css';

export default function StrategyMonitorPage() {
  const [selectedStratId, setSelectedStratId] = useState(null);
  const [expandedBotId, setExpandedBotId] = useState(null);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSort, setQueueSort] = useState('depth');
  const [rowResults, setRowResults] = useState({});
  const queryClient = useQueryClient();

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

  // ── Signal queues (#714 Stage 2) — pending entries per trading bot ──
  const { data: queueEntries = [], isLoading: queueLoading } = useQuery({
    queryKey: ['monitor-queues'],
    queryFn: () => apiGet('/api/trading/strategies/queues').catch(() => []),
    refetchInterval: 15_000,
  });
  const queueList = Array.isArray(queueEntries) ? queueEntries : [];

  const queueBots = useMemo(() => {
    const byStrat = new Map();
    for (const e of queueList) {
      if (!byStrat.has(e.strategyId)) {
        byStrat.set(e.strategyId, {
          strategyId: e.strategyId,
          name: e.strategyName || e.strategyId,
          symbol: e.strategySymbol,
          mode: e.strategyMode,
          active: e.strategyActive,
          entries: [],
        });
      }
      byStrat.get(e.strategyId).entries.push(e);
    }
    const q = (queueSearch || '').trim().toUpperCase();
    let bots = [...byStrat.values()].map(b => {
      const entries = q
        ? b.entries.filter(e => e.symbol?.toUpperCase().includes(q)
            || (e.protocolId || '').toUpperCase().includes(q)
            || b.name.toUpperCase().includes(q))
        : b.entries;
      return { ...b, entries, depth: entries.length, top: Math.max(...entries.map(e => e.combinedStrength || 0), 0) };
    });
    if (q) bots = bots.filter(b => b.entries.length > 0);
    bots = bots.sort((a, b) => queueSort === 'strength'
      ? b.top - a.top
      : b.depth - a.depth || b.top - a.top);
    return bots;
  }, [queueList, queueSearch, queueSort]);

  const queueDepthByStrategy = useMemo(() => {
    const m = new Map();
    for (const e of queueList) m.set(e.strategyId, (m.get(e.strategyId) || 0) + 1);
    return m;
  }, [queueList]);

  // Execute a queued signal — triggers the bot's existing execute path.
  const executeMutation = useMutation({
    mutationFn: ({ strategyId, entryId }) => apiPost(`/api/trading/strategies/${strategyId}/execute`),
    onSuccess: (res, vars) => {
      const text = res?.executed
        ? '✅ Executed'
        : `⛔ ${res?.reason || (res?.evaluated ? 'Conditions not met' : 'Not executed')}`;
      setRowResults(prev => ({ ...prev, [vars.entryId]: text }));
      queryClient.invalidateQueries({ queryKey: ['monitor-queues'] });
    },
    onError: (err, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entryId]: `❌ ${err?.message || 'Execute failed'}` }));
    },
  });

  // Dismiss a queued signal — propagates into the queue (#714) and Signals (#684).
  const dismissMutation = useMutation({
    mutationFn: ({ entry }) => dismissSignal({
      symbol: entry.symbol,
      protocolId: entry.protocolId,
      hours: 1,
      strengths: {
        combinedStrength: entry.combinedStrength,
        signalPct: entry.signalPct,
        opportunityPct: entry.opportunityPct,
      },
    }),
    onSuccess: (_, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entry.id]: '🚫 Dismissed 1h' }));
      queryClient.invalidateQueries({ queryKey: ['monitor-queues'] });
      queryClient.invalidateQueries({ queryKey: ['signals-best'] });
    },
    onError: (err, vars) => {
      setRowResults(prev => ({ ...prev, [vars.entry.id]: `❌ ${err?.message || 'Dismiss failed'}` }));
    },
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

  // ── Broker chips — dynamic from automation brokerStates (mt5, trading212, …) ──
  const brokerStates = autoStatus?.brokerStates || {};
  const brokerChips = Object.entries(brokerStates).map(([brokerId, bs]) => {
    const label = String(brokerId).toUpperCase();
    const connected = Boolean(bs?.enabled);
    const trading = Boolean(bs?.tradingEnabled);
    const balance = brokerId === 'mt5' ? mt5Diag?.balance : null;
    const account = brokerId === 'mt5' ? mt5Diag?.accountName : null;
    const status = trading ? 'Trading' : connected ? 'Connected' : 'Offline';
    const color = trading ? '#22c55e' : connected ? '#f59e0b' : '#64748b';
    const icon = trading ? '🟢' : connected ? '🟡' : '⚫';
    return { brokerId, label, status, color, icon, balance, account };
  });

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
          {brokerChips.map(bc => (
            <div
              key={bc.brokerId}
              className="sm-stat"
              title={bc.account ? `${bc.label} · ${bc.account} · ${bc.status}` : `${bc.label} · ${bc.status}`}
            >
              <span className="sm-stat-val" style={{ color: bc.color }}>{bc.icon} {bc.label}</span>
              <span className="sm-stat-label">
                {bc.status === 'Trading'
                  ? 'Trading'
                  : bc.balance != null
                    ? `Balance ${bc.balance}`
                    : bc.status}
              </span>
            </div>
          ))}
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
                    {s.symbol && (
                      <Link
                        to="/scoring/symbols-ladder"
                        className="sl-chip sl-chip-link"
                        title={`Open ${s.symbol} in the symbols ladder`}
                        onClick={e => e.stopPropagation()}
                      >
                        {s.symbol}
                      </Link>
                    )}
                    {s.watchlistName && <span className="sl-chip sl-chip-wl">{s.watchlistName}</span>}
                    <Link
                      to="/protocols/protocols-registry"
                      className="sl-chip sl-chip-proto sl-chip-link"
                      title={`Open protocol registry — this strategy consumes ${s.protocolId || 'no protocol'}`}
                      onClick={e => e.stopPropagation()}
                    >
                      {s.protocolId || '—'}
                    </Link>
                    <span className="sl-chip sl-chip-broker">{s.brokerId || '—'}</span>
                    {queueDepthByStrategy.get(s.id) > 0 && (
                      <span
                        className="sl-chip sl-chip-queue"
                        title={`${queueDepthByStrategy.get(s.id)} pending signal(s) — see Signal Queues below`}
                      >
                        ⏳ {queueDepthByStrategy.get(s.id)} queued
                      </span>
                    )}
                  </div>
                  {s.lastComposite != null && (
                    <div className="sl-card-score">
                      <span className="sl-score-label">
                        Last Score
                        <PageInfoPopover>
                          <strong>Protocol-scoped gated composite (0–100%).</strong>
                          <br />
                          The strategy's latest evaluation, expressed as a percentage of the protocol's
                          maximum score. The Scoring ladder shows a different, dual scale — raw Signal
                          (x/max) plus raw Opportunity (x/max) with percentages — so numbers there
                          look larger. Click the score to see the live ordering stack.
                        </PageInfoPopover>
                      </span>
                      <Link
                        to="/scoring/live-ordering-stack"
                        className={`sl-score-value ${scoreClass(s.lastComposite)}`}
                        title="Open the live ordering stack (Scoring)"
                        onClick={e => e.stopPropagation()}
                      >
                        {s.lastComposite}
                      </Link>
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

        {/* Signal Queues (#714 Stage 2) — bots as queues of signals */}
        <section className="sm-queues">
          <div className="sm-queues-header">
            <h2>
              Signal Queues
              <PageInfoPopover>
                <strong>Every trading bot is a queue of signals.</strong>
                <br />
                The one scoring line routes actionable signals into each bot's queue based on
                its protocol subscriptions. Re-signals refresh the entry; when a symbol stops
                signalling the entry is voided. Dismissals propagate both ways.
              </PageInfoPopover>
            </h2>
            <div className="sm-queues-controls">
              <input
                className="smq-search"
                placeholder="Filter symbol, protocol, bot…"
                value={queueSearch}
                onChange={e => setQueueSearch(e.target.value)}
              />
              <select className="smq-sort" value={queueSort} onChange={e => setQueueSort(e.target.value)}>
                <option value="depth">Sort: Queue depth</option>
                <option value="strength">Sort: Strength</option>
              </select>
            </div>
          </div>

          {queueLoading && queueList.length === 0 ? <LoadingSkeleton variant="card" count={2} /> : queueBots.length === 0 ? (
            <EmptyState
              icon="⏳"
              title={queueList.length === 0 ? 'No pending signals' : 'No bots match the filter'}
              description={queueList.length === 0
                ? 'When the scoring line signals a symbol a trading bot subscribes to, it will appear here.'
                : 'Try a different symbol, protocol, or bot name.'}
            />
          ) : (
            <div className="smq-list">
              {queueBots.map((bot, i) => {
                const expanded = expandedBotId === bot.strategyId;
                return (
                  <motion.div
                    key={bot.strategyId}
                    className={`smq-bot ${expanded ? 'smq-bot--open' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <button
                      type="button"
                      className="smq-bot-row"
                      onClick={() => setExpandedBotId(expanded ? null : bot.strategyId)}
                      aria-expanded={expanded}
                    >
                      <span className="smq-chevron">{expanded ? '▾' : '▸'}</span>
                      <span className="smq-bot-dot" style={{ background: bot.active !== false ? '#22c55e' : '#64748b' }} />
                      <strong className="smq-bot-name">{bot.name}</strong>
                      {bot.symbol && <span className="smq-bot-symbol">{bot.symbol}</span>}
                      <span className="smq-bot-mode">{bot.mode || '—'}</span>
                      <span className="smq-depth" title="Pending signals in this bot's queue">
                        {bot.depth} pending
                      </span>
                    </button>
                    {expanded && (
                      <div className="smq-entries">
                        {bot.entries.map(e => (
                          <div key={e.id} className="smq-entry">
                            <span className="smq-entry-symbol">
                              <Link to="/scoring/symbols-ladder" className="sl-chip-link">{e.symbol}</Link>
                            </span>
                            <span className={`smq-entry-dir smq-entry-dir--${(e.direction || 'long').toLowerCase()}`}>
                              {e.direction === 'SHORT' ? 'SELL' : e.direction === 'LONG' ? 'BUY' : e.direction || '—'}
                            </span>
                            <span className="smq-entry-proto">
                              <Link to="/protocols/protocols-registry" className="sl-chip-link">{e.protocolId}</Link>
                            </span>
                            <span className="smq-entry-scores" title="SEES dual score at signal time — composite · signal · opportunity">
                              <span className={scoreClass(e.compositePct)}>{e.compositePct ?? '—'}</span>
                              <i>C</i>
                              <span className={scoreClass(e.signalPct)}>{e.signalPct ?? '—'}</span>
                              <i>S</i>
                              <span className={scoreClass(e.opportunityPct)}>{e.opportunityPct ?? '—'}</span>
                              <i>O</i>
                            </span>
                            <span className={`smq-entry-strength ${scoreClass(e.combinedStrength)}`} title="Combined strength">
                              {e.combinedStrength}
                            </span>
                            <span className="smq-entry-age" title={e.createdAt}>{timeAgo(e.createdAt)}</span>
                            <span className="smq-entry-actions">
                              <button
                                type="button"
                                className="smq-btn smq-btn--go"
                                disabled={executeMutation.isPending || dismissMutation.isPending}
                                title="Run this bot now (respects mode, cooldown and position limits)"
                                onClick={() => executeMutation.mutate({ strategyId: bot.strategyId, entryId: e.id })}
                              >
                                ▶ Execute
                              </button>
                              <button
                                type="button"
                                className="smq-btn smq-btn--dismiss"
                                disabled={executeMutation.isPending || dismissMutation.isPending}
                                title="Dismiss for 1h — removes this queue entry and the Signals card"
                                onClick={() => dismissMutation.mutate({ entry: e })}
                              >
                                ✕
                              </button>
                            </span>
                            {rowResults[e.id] && <span className="smq-entry-result">{rowResults[e.id]}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </motion.div>

    </div>
  );
}
