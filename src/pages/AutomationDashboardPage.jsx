import { useState } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import EmptyState from '../components/EmptyState';
import ToggleSwitch from '../components/ToggleSwitch';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import { formatTime } from '../core/format-utils';
import { decisionScore } from '../core/decision-score';
import { pnlColor } from '../core/signal-utils';
import { isTradingStrategy, isScoringStrategy } from '../core/strategy-filters';
import StrategyFaultBadge from '../components/StrategyFaultBadge';
import './automation-dashboard.css';

export default function AutomationDashboardPage() {
  const [selectedSymbol, setSelectedSymbol] = useState(null);

  const statusQuery = useQuery({
    queryKey: ['automation', 'status'],
    queryFn: () => apiGet('/api/automation/status'),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const portfolioScoresQuery = useQuery({
    queryKey: ['automation', 'portfolio-scores'],
    queryFn: () => apiGet('/api/portfolio/scores'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const providerQuery = useQuery({
    queryKey: ['automation', 'providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 60000,
  });

  const timelineQuery = useQuery({
    queryKey: ['automation', 'timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=240'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const activityQuery = useQuery({
    queryKey: ['automation', 'activity'],
    queryFn: () => apiGet('/api/automation/activity?limit=25'),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  // Multi-broker MT5 health — one card per broker instance
  const mt5BrokersQuery = useQuery({
    queryKey: ['mt5', 'brokers'],
    queryFn: () => apiGet('/api/providers/mt5/brokers'),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: (body) => apiPost('/api/automation/toggle', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'status'] }),
  });

  const configMutation = useMutation({
    mutationFn: (body) => apiPost('/api/automation/config', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'status'] }),
  });

  const startMutation = useMutation({
    mutationFn: () => apiPost('/api/automation/start'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'status'] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiPost('/api/automation/stop'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'status'] }),
  });

  const runNowMutation = useMutation({
    mutationFn: () => apiPost('/api/automation/run-now'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'status'] }),
  });

  // ── A/B Test Runner (#482) ──────────────────────────────
  const [abForm, setAbForm] = useState({ name: '', controlStackId: '', variantStackId: '', symbols: '' });

  const abTestsQuery = useQuery({
    queryKey: ['automation', 'ab-tests'],
    queryFn: () => apiGet('/api/automation/ab-tests').catch(() => []),
    refetchInterval: 10000,
  });

  const abSnapshotsQuery = useQuery({
    queryKey: ['automation', 'ab-snapshots'],
    queryFn: () => apiGet('/api/automation/ab-tests/snapshots').catch(() => []),
    staleTime: 60_000,
  });

  const createAbMutation = useMutation({
    mutationFn: (body) => apiPost('/api/automation/ab-tests', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'ab-tests'] });
      setAbForm({ name: '', controlStackId: '', variantStackId: '', symbols: '' });
    },
  });

  const startAbMutation = useMutation({
    mutationFn: (id) => apiPost(`/api/automation/ab-tests/${id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'ab-tests'] }),
  });

  const stopAbMutation = useMutation({
    mutationFn: (id) => apiPost(`/api/automation/ab-tests/${id}/stop`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', 'ab-tests'] }),
  });

  const abTests = abTestsQuery.data ?? [];
  const abSnapshots = abSnapshotsQuery.data ?? [];

  const apiOnline = !statusQuery.isError;
  const scores = portfolioScoresQuery.data?.scores ?? [];
  const strategies = statusQuery.data?.activeStrategies ?? [];
  const timelineEvents = timelineQuery.data?.events ?? [];
  const loopState = statusQuery.data ?? {};
  const brokerStates = statusQuery.data?.brokerStates ?? {};
  const mt5Brokers = mt5BrokersQuery.data?.brokers ?? [];
  const recentDecisions = statusQuery.data?.recentDecisions ?? [];
  const activityEvents = activityQuery.data?.events ?? [];
  const currentPhase = activityQuery.data?.currentPhase;
  const currentTick = activityQuery.data?.currentTick;
  const totalEventsToday = activityQuery.data?.totalEventsToday ?? 0;
  const loopRunning = loopState.loopEnabled;
  const isBusy = startMutation.isPending || stopMutation.isPending || runNowMutation.isPending;

  const phaseLabel = (step) => {
    const map = {
      tick_start: '🚀 Init', bars_fetched: '📊 Bars', scored: '🧮 Score',
      gated: '🛡 Gate', dispatch: '📤 Dispatch', order_sent: '📨 Sent',
      order_result: '✅ Result', duplicate_check: '🔒 Dup Check',
    };
    return map[step] || step;
  };

  const phaseColor = (step) => {
    const map = {
      tick_start: '#94a3b8', bars_fetched: '#3b82f6', scored: '#8b5cf6',
      gated: '#f59e0b', dispatch: '#06b6d4', order_sent: '#f97316',
      order_result: '#22c55e', duplicate_check: '#ef4444',
    };
    return map[step] || '#94a3b8';
  };

  // Directive breakdown for selected symbol
  const envelopeQuery = useQuery({
    queryKey: ['signals', 'envelope', selectedSymbol],
    queryFn: () => apiGet(`/api/signals/envelope/${selectedSymbol}`),
    enabled: !!selectedSymbol,
    staleTime: 30000,
  });
  const envelope = envelopeQuery.data;

  return (
    <div className="ad-page">
      <motion.header className="ad-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Automation
          <PageInfoPopover>
            Multi-broker command center — scores, strategies, and trade decisions
          </PageInfoPopover>
        </h1>
        </div>
        <div className="ad-header-actions">
          {loopRunning ? (
            <button className="ad-btn ad-btn-pause" onClick={() => stopMutation.mutate()} disabled={isBusy}>
              {stopMutation.isPending ? '⏳' : '⏸'} Stop Loop
            </button>
          ) : (
            <button className="ad-btn ad-btn-start" onClick={() => startMutation.mutate()} disabled={isBusy}>
              {startMutation.isPending ? '⏳' : '▶'} Start Loop
            </button>
          )}
          <button className="ad-btn ad-btn-run" onClick={() => runNowMutation.mutate()} disabled={isBusy || !loopRunning}>
            {runNowMutation.isPending ? '⏳' : '⚡'} Run Now
          </button>
          <a href="/builder/architecture-framework" className="ad-arch-link">⬡ Architecture</a>
        </div>
      </motion.header>

      {/* ── Loop Status Bar ── */}
      <motion.div className="ad-loop-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <span className={`ad-loop-dot ${loopRunning ? 'ad-loop-running' : 'ad-loop-stopped'}`} />
        <span className="ad-loop-label">{loopRunning ? 'Loop Active' : 'Loop Stopped'}</span>
        {loopRunning && (
          <>
            <span className="ad-loop-sep">·</span>
            <span>Tick #{loopState.tickCount || 0}</span>
            <span className="ad-loop-sep">·</span>
            <span>Interval: {Math.round((loopState.tickIntervalMs || 300000) / 1000)}s</span>
            <span className="ad-loop-sep">·</span>
            <span>Last: {formatTime(loopState.lastTickAt, { seconds: true })}</span>
            <span className="ad-loop-sep">·</span>
            <span>Next: {formatTime(loopState.nextTickAt, { seconds: true })}</span>
            {loopState.lastTickMs > 0 && (
              <>
                <span className="ad-loop-sep">·</span>
                <span>Duration: {loopState.lastTickMs}ms</span>
              </>
            )}
          </>
        )}
      </motion.div>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── MT5 Broker Status ── */}
      <motion.div className="ad-broker-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {mt5BrokersQuery.isLoading ? (
          <LoadingSkeleton variant="text" lines={1} />
        ) : mt5Brokers.length > 0 ? (
          <div className="ad-broker-list">
            {mt5Brokers.map((b) => {
              const h = b.health;
              const connected = b.reachable && h?.connected;
              const balance = h?.balance ?? 0;
              const equity = h?.equity ?? balance;
              const pnl = equity - balance;
              return (
                <div key={b.brokerId} className={`ad-broker-card ${connected ? 'ad-broker-on' : 'ad-broker-off'}`}
                      title={`${b.server} — ${connected ? 'Connected' : 'Offline'} — Port ${b.url.split(':').pop()}`}>
                  <span className="ad-broker-dot" style={{ background: connected ? '#22c55e' : '#6b7280' }} />
                  <div className="ad-broker-info">
                    <span className="ad-broker-server">{b.server}</span>
                    <span className="ad-broker-account">{h?.account ?? '—'}</span>
                  </div>
                  {connected && (
                    <div className="ad-broker-balance">
                      <span className="ad-broker-equity">${equity.toFixed(0)}</span>
                      {pnl !== 0 && <span className="ad-broker-pnl" style={{ color: pnlColor(pnl) }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="ad-broker-note">No MT5 bridges detected — check that bridges are running</span>
        )}
      </motion.div>

      <div className="ad-grid">
        <div className="ad-col">
          {/* Portfolio Scores */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2 className="ad-panel-title">📊 Portfolio Scores</h2>
            {portfolioScoresQuery.isLoading && <LoadingSkeleton variant="text" lines={5} />}
            {portfolioScoresQuery.isError && (
              <EmptyState icon="⚠️" title="Unable to load scores" description="Is the NestJS backend running?" />
            )}
            {!portfolioScoresQuery.isLoading && scores.length === 0 && (
              <EmptyState icon="📊" title="No portfolio scores yet" description="Import your Trading212 portfolio or add symbols in Settings." actionLabel="Go to Settings" actionHref="/settings" />
            )}
            {scores.length > 0 && (
              <div className="ad-score-list">
                {scores.slice(0, 10).map((s) => (
                  <button
                    key={s.symbol}
                    className={`ad-score-row ${selectedSymbol === s.symbol ? 'ad-selected' : ''}`}
                    onClick={() => setSelectedSymbol(selectedSymbol === s.symbol ? null : s.symbol)}
                  >
                    <span className="ad-score-symbol">{s.ticker || s.symbol}</span>
                    <span className={`ad-score-value ${s.signal === 'BUY' ? 'ad-buy' : s.signal === 'SELL' ? 'ad-sell' : ''}`}>
                      {s.score !== null ? s.score : '—'}
                    </span>
                    <span className={`ad-score-signal ad-signal-${(s.signal || 'no_data').toLowerCase()}`}>
                      {s.signal || 'NO DATA'}
                    </span>
                    <span className="ad-score-strength">{s.strength}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.section>

          {/* Broker Config */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <h2 className="ad-panel-title">⚙ Broker Config</h2>
            {statusQuery.isLoading ? <LoadingSkeleton variant="text" lines={3} /> : (
              <div className="ad-config-list">
                {Object.entries(brokerStates).map(([brokerId, bs]) => (
                  <div key={brokerId} className="ad-config-row">
                    <div className="ad-config-header">
                      <span className="ad-config-broker">{brokerId}</span>
                      <ToggleSwitch
                        checked={bs.enabled}
                        onChange={() => toggleMutation.mutate({ target: brokerId, enabled: !bs.enabled })}
                      />
                    </div>
                    {bs.enabled && (
                      <div className="ad-config-fields">
                        <label className="ad-config-field">
                          <span>Trading</span>
                          <ToggleSwitch
                            sm
                            checked={bs.tradingEnabled}
                            onChange={() => configMutation.mutate({ brokerId, tradingEnabled: !bs.tradingEnabled })}
                          />
                        </label>
                        <label className="ad-config-field">
                          <span>Threshold</span>
                          {/* ⚠️ The bounds were {40,95} and the fallback was `|| 65` (#839).
                              Both were pre-rescale numbers: the ADR-011 scale measures 10-33, so a
                              bar of 65 could never be cleared and the bot would silently never
                              trade — while looking perfectly configured in this field.
                              The empty-input case no longer invents a bar at all. The server owns
                              these numbers (src/core/api/signals.js), so committing a guess here
                              would create a second owner; skipping the commit cannot. */}
                          <input
                            type="number" min={0} max={100}
                            value={bs.tradeThreshold}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (Number.isFinite(v)) configMutation.mutate({ brokerId, tradeThreshold: v });
                            }}
                            className="ad-config-input"
                          />
                        </label>
                        <label className="ad-config-field">
                          <span>Confirm</span>
                          <ToggleSwitch
                            sm
                            checked={bs.requireConfirmation}
                            onChange={() => configMutation.mutate({ brokerId, requireConfirmation: !bs.requireConfirmation })}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ))}
                {Object.keys(brokerStates).length === 0 && (
                  <EmptyState icon="⚙️" title="No brokers configured" description="Start the loop to initialize broker states." />
                )}
              </div>
            )}
          </motion.section>
        </div>

        <div className="ad-col">
          {/* Why Panel */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <h2 className="ad-panel-title">🔍 Why Panel</h2>
            {selectedSymbol ? (
              envelopeQuery.isLoading ? <LoadingSkeleton variant="card" count={1} /> :
              envelope ? (
              <div className="ad-why-panel">
                <div className="ad-why-header">
                  <span className="ad-why-symbol">{selectedSymbol}</span>
                  <span className="ad-why-composite" style={{ color: envelope.signal === 'BUY' ? '#22c55e' : envelope.signal === 'SELL' ? '#ef4444' : '#94a3b8' }}>
                    {envelope.composite.toFixed(0)} — {envelope.signal}
                  </span>
                  <span className="ad-why-confidence">Conf: {envelope.confidence}%</span>
                  {envelope.rarity && <span className="ad-why-rarity" style={{ color: envelope.rarityColor }}>{envelope.rarity}</span>}
                </div>
                {envelope.preTradeBlockers.length > 0 && (
                  <div className="ad-why-blockers">
                    {envelope.preTradeBlockers.map((b, i) => <span key={i} className="ad-blocker-tag">🚫 {b}</span>)}
                  </div>
                )}
                <div className="ad-why-groups">
                  {envelope.groups.map(g => (
                    <div key={g.groupId} className={`ad-why-group ${g.isRisk ? 'ad-why-risk' : ''}`}>
                      <div className="ad-why-group-head">
                        <span>{g.groupName}</span>
                        <span style={{ color: g.score > 65 ? '#22c55e' : g.score < 35 ? '#ef4444' : '#94a3b8', fontWeight: 800 }}>{g.score}</span>
                      </div>
                      {g.topDirectives.map(d => (
                        <div key={d.id} className={`ad-why-dir ad-why-dir-${d.signalClass}`}>
                          <span className="ad-why-dir-name">{d.name}</span>
                          <span className="ad-why-dir-score">{d.normalized}</span>
                          <span className="ad-why-dir-reason">{d.reason}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {envelope.conflicts.length > 0 && (
                  <div className="ad-why-conflicts">
                    <span className="ad-why-conflicts-title">⚠ Conflicts</span>
                    {envelope.conflicts.map((c, i) => (
                      <span key={i} className="ad-conflict-chip">{c.description}</span>
                    ))}
                  </div>
                )}
              </div>
              ) : (
                <EmptyState icon="🔍" title={`No data for ${selectedSymbol}`} description="Run scoring first to populate directive breakdowns." />
              )
            ) : (
              <EmptyState icon="👆" title="Select a symbol" description="Click a portfolio score (left column) to see the directive breakdown." />
            )}
          </motion.section>

          {/* Timeline */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
            <h2 className="ad-panel-title">⏱ Timeline {timelineEvents.length > 0 && <span className="ad-count-badge">({timelineEvents.length} events)</span>}</h2>
            {timelineQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
            {timelineQuery.isError && (
              <EmptyState icon="⏱️" title="Timeline unavailable" description="Backend may be starting up." />
            )}
            {!timelineQuery.isLoading && timelineEvents.length === 0 && (
              <EmptyState icon="⏱️" title="No active events" description="No events in the next 4 hours. Markets may be closed or calm." />
            )}
            {timelineEvents.length > 0 && (
              <div className="ad-timeline-list">
                {timelineEvents.slice(0, 8).map((ev) => (
                  <div key={ev.id} className={`ad-timeline-item ${ev.action === 'block' || ev.action === 'reduce' ? 'ad-timeline-danger' : ev.action === 'boost' ? 'ad-timeline-boost' : ''}`}>
                    <span className="ad-timeline-dot" style={{ background: ev.color || 'var(--accent)' }} />
                    <div className="ad-timeline-body">
                      <div className="ad-timeline-label">
                        {ev.icon && <span className="ad-timeline-icon">{ev.icon}</span>}
                        <strong>{ev.label}</strong>
                        {ev.riskMultiplier && ev.riskMultiplier !== 1 && (
                          <span className={`ad-risk-badge ${ev.riskMultiplier < 1 ? 'ad-risk-down' : 'ad-risk-up'}`}>
                            {ev.riskMultiplier < 1 ? '↓' : '↑'}{Math.abs(1 - ev.riskMultiplier) * 100}%
                          </span>
                        )}
                      </div>
                      {ev.description && (
                        <p className="ad-timeline-desc">{ev.description}</p>
                      )}
                    </div>
                    <span className="ad-timeline-time">
                      {new Date(ev.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>

        <div className="ad-col">
          {/* Active Strategies */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="ad-panel-title">🎯 Active Strategies</h2>
            {statusQuery.isLoading && <LoadingSkeleton variant="text" lines={3} />}
            {strategies.length === 0 ? (
              <EmptyState icon="🎯" title="No active strategies" description="Create a strategy to start trading or scoring." actionLabel="Create Strategy" actionHref="/strategies/create-strategy" />
            ) : (
              <div className="ad-strategy-list">
                {strategies.map((s) => {
                  const isTrading = isTradingStrategy(s);
                  const isScoring = isScoringStrategy(s);
                  const typeLabel = isTrading ? 'Trading' : isScoring ? 'Scoring' : 'Strategy';
                  const typeColor = isTrading ? '#3b82f6' : isScoring ? '#8b5cf6' : '#94a3b8';
                  return (
                  <div key={s.id} className="ad-strategy-card">
                    <div className="ad-strategy-header">
                      <span className={`ad-strategy-dot ${s.active ? 'ad-active' : ''}`} />
                      <strong>{s.name}</strong>
                      <span className="ad-strategy-type" style={{ background: typeColor + '18', color: typeColor, borderColor: typeColor + '33' }}>{typeLabel}</span>
                      <span className="ad-strategy-broker">{s.brokerId}</span>
                    </div>
                    <div className="ad-strategy-meta">
                      {isTrading && <><span>{s.symbol}</span> · </>}
                      <span>{s.protocolId}</span> · <span>{s.mode}</span>
                      {s.lastComposite != null && <span> · Score: {s.lastComposite}</span>}
                    </div>
                    <StrategyFaultBadge
                      strategy={s}
                      className="ad-strategy-status"
                      style={{
                        marginTop: '0.35rem', fontSize: '0.72rem',
                        color: s.dataStatus === 'pending_bars' ? '#f59e0b' : '#ef4444',
                        background: s.dataStatus === 'pending_bars' ? '#f59e0b10' : '#ef444410',
                        padding: '2px 8px', borderRadius: '4px',
                      }}
                    />
                  </div>
                  );
                })}
              </div>
            )}
          </motion.section>

          {/* Activity Feed */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
            <h2 className="ad-panel-title">
              📡 Activity Feed
              {currentPhase && <span className="ad-phase-badge" style={{ background: phaseColor(currentPhase) + '22', color: phaseColor(currentPhase), marginLeft: '0.5rem', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px' }}>{phaseLabel(currentPhase)}</span>}
              {totalEventsToday > 0 && <span className="ad-count-badge">({totalEventsToday} today)</span>}
            </h2>
            {activityQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
            {activityEvents.length === 0 && !activityQuery.isLoading && (
              <EmptyState icon="📡" title="No activity yet" description="Start the loop and run a tick to see step-by-step progress." />
            )}
            {activityEvents.length > 0 && (
              <div className="ad-activity-list">
                {activityEvents.slice(0, 15).map((ev) => (
                  <div key={ev.id} className="ad-activity-row">
                    <span className="ad-activity-phase" style={{ color: phaseColor(ev.step) }} title={ev.step}>
                      {phaseLabel(ev.step)}
                    </span>
                    {ev.symbol && <span className="ad-activity-symbol">{ev.symbol}</span>}
                    {ev.decision && (
                      <span className={`ad-activity-decision ad-decision-${ev.decision.toLowerCase()}`}>
                        {ev.decision}
                      </span>
                    )}
                    {ev.detail && (
                      <span className="ad-activity-detail" title={ev.detail}>
                        {ev.detail.length > 60 ? ev.detail.substring(0, 60) + '…' : ev.detail}
                      </span>
                    )}
                    <span className="ad-activity-time">{formatTime(ev.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.section>

          {/* Decision Log */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <h2 className="ad-panel-title">📋 Decision Log {recentDecisions.length > 0 && <span className="ad-count-badge">({recentDecisions.length})</span>}</h2>
            {recentDecisions.length === 0 ? (
              <EmptyState icon="📋" title="No decisions yet" description="Start the loop and click Run Now to trigger a tick." />
            ) : (
              <div className="ad-decision-list">
                {recentDecisions.slice(0, 15).map((d, i) => {
                  // #909 — the score is rendered WITH its unit; a raw score and a percentage are
                  // different quantities and must never look alike on the same surface.
                  const score = decisionScore(d);
                  return (
                  <div key={i} className={`ad-decision-row ad-decision-${d.decision?.toLowerCase()}`}>
                    <span className="ad-decision-symbol">{d.symbol}</span>
                    <span className="ad-decision-tag">{d.decision}</span>
                    <span className="ad-decision-composite" title={score.title || undefined}>{score.text}</span>
                    <span className="ad-decision-reason" title={d.reason}>{d.reason}</span>
                    <span className="ad-decision-time">{formatTime(d.timestamp)}</span>
                  </div>
                  );
                })}
              </div>
            )}
          </motion.section>

          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <h2 className="ad-panel-title">🧪 A/B Tests</h2>
            <div className="ab-test-create">
              <input
                className="ab-test-input"
                placeholder="Test name"
                value={abForm.name}
                onChange={(e) => setAbForm({ ...abForm, name: e.target.value })}
              />
              <select
                className="ab-test-input"
                value={abForm.controlStackId}
                onChange={(e) => setAbForm({ ...abForm, controlStackId: e.target.value })}
              >
                <option value="">Control snapshot…</option>
                {abSnapshots.map((s) => (
                  <option key={`c-${s.id}`} value={s.id}>{s.scoringStrategyId} v{s.version}</option>
                ))}
              </select>
              <select
                className="ab-test-input"
                value={abForm.variantStackId}
                onChange={(e) => setAbForm({ ...abForm, variantStackId: e.target.value })}
              >
                <option value="">Variant snapshot…</option>
                {abSnapshots.map((s) => (
                  <option key={`v-${s.id}`} value={s.id}>{s.scoringStrategyId} v{s.version}</option>
                ))}
              </select>
              <input
                className="ab-test-input"
                placeholder="Symbols (comma-sep, max 4)"
                value={abForm.symbols}
                onChange={(e) => setAbForm({ ...abForm, symbols: e.target.value })}
              />
              <button
                className="ad-btn ad-btn-run"
                disabled={!abForm.name || !abForm.controlStackId || !abForm.variantStackId || !abForm.symbols.trim() || createAbMutation.isPending}
                onClick={() => createAbMutation.mutate({
                  name: abForm.name,
                  controlStackId: abForm.controlStackId,
                  variantStackId: abForm.variantStackId,
                  symbols: abForm.symbols.split(',').map((s) => s.trim()).filter(Boolean),
                })}
              >
                {createAbMutation.isPending ? '⏳' : '＋'} Create
              </button>
            </div>
            {abTests.length === 0 ? (
              <p className="ad-panel-hint">No A/B tests yet. Create one to compare two MetaStack snapshots side-by-side.</p>
            ) : (
              <div className="ab-test-list">
                {abTests.slice(0, 8).map((t) => (
                  <div key={t.id} className={`ab-test-row ab-test-${t.status}`}>
                    <div className="ab-test-head">
                      <span className="ab-test-name">{t.name}</span>
                      <span className={`ab-test-status ab-test-status-${t.status}`}>{t.status}</span>
                    </div>
                    <div className="ab-test-meta">{Array.isArray(t.symbols) ? t.symbols.join(', ') : ''}</div>
                    {t.results && (
                      <div className="ab-test-results">
                        <span>A: {t.results.control?.totalPnl ?? 0}</span>
                        <span>B: {t.results.variant?.totalPnl ?? 0}</span>
                      </div>
                    )}
                    <div className="ab-test-actions">
                      {t.status === 'draft' && (
                        <button className="ad-btn ad-btn-start" onClick={() => startAbMutation.mutate(t.id)} disabled={startAbMutation.isPending}>▶ Start</button>
                      )}
                      {t.status === 'running' && (
                        <button className="ad-btn ad-btn-pause" onClick={() => stopAbMutation.mutate(t.id)} disabled={stopAbMutation.isPending}>■ Stop</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>
      </div>
    </div>
  );
}
