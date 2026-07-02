import { useState } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
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

  const apiOnline = !statusQuery.isError;
  const scores = portfolioScoresQuery.data?.scores ?? [];
  const strategies = statusQuery.data?.activeStrategies ?? [];
  const timelineEvents = timelineQuery.data?.events ?? [];
  const loopState = statusQuery.data ?? {};
  const brokerStates = statusQuery.data?.brokerStates ?? {};
  const recentDecisions = statusQuery.data?.recentDecisions ?? [];
  const loopRunning = loopState.loopEnabled;
  const isBusy = startMutation.isPending || stopMutation.isPending || runNowMutation.isPending;

  const formatTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
          <h1>🤖 Automation</h1>
          <p className="ad-subtitle">Multi-broker command center — scores, strategies, and trade decisions</p>
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
          <a href="/builder/architecture-framework" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 4, alignSelf: 'center' }}>⬡ Architecture</a>
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
            <span>Last: {formatTime(loopState.lastTickAt)}</span>
            <span className="ad-loop-sep">·</span>
            <span>Next: {formatTime(loopState.nextTickAt)}</span>
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

      {/* ── Broker Config ── */}
      <motion.div className="ad-broker-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {providerQuery.isLoading ? (
          <LoadingSkeleton variant="text" lines={1} />
        ) : (
          <div className="ad-broker-list">
            {Object.keys(brokerStates).length > 0 ? (
              Object.entries(brokerStates).map(([id, bs]) => (
                <span key={id} className={`ad-broker-chip ${bs.enabled ? 'ad-broker-on' : 'ad-broker-off'}`}>
                  {id} {bs.enabled ? '🟢' : '⚫'} {bs.tradingEnabled ? '🔴LIVE' : ''}
                </span>
              ))
            ) : (
              <span className="ad-broker-note">Start the loop to initialize broker states</span>
            )}
          </div>
        )}
      </motion.div>

      <div className="ad-grid">
        <div className="ad-col">
          {/* Portfolio Scores */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2 className="ad-panel-title">📊 Portfolio Scores</h2>
            {portfolioScoresQuery.isLoading && <LoadingSkeleton variant="text" lines={5} />}
            {portfolioScoresQuery.isError && <p className="ad-empty">Unable to load scores — is the NestJS backend running?</p>}
            {!portfolioScoresQuery.isLoading && scores.length === 0 && (
              <p className="ad-empty">No portfolio scores yet. Import your Trading212 portfolio or add symbols in Settings.</p>
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

          {/* Active Strategies */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="ad-panel-title">🎯 Active Strategies</h2>
            {statusQuery.isLoading && <LoadingSkeleton variant="text" lines={3} />}
            {strategies.length === 0 ? (
              <p className="ad-empty">
                No active strategies.{' '}
                <a href="/trading/trading-strategies">Create one in Trading Strategies →</a>
              </p>
            ) : (
              <div className="ad-strategy-list">
                {strategies.map((s) => (
                  <div key={s.id} className="ad-strategy-card">
                    <div className="ad-strategy-header">
                      <span className={`ad-strategy-dot ${s.active ? 'ad-active' : ''}`} />
                      <strong>{s.name}</strong>
                      <span className="ad-strategy-broker">{s.brokerId}</span>
                    </div>
                    <div className="ad-strategy-meta">
                      <span>{s.protocolId}</span> · <span>{s.mode}</span>
                      {s.lastComposite != null && <span> · Score: {s.lastComposite}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>

        <div className="ad-col">
          {/* Config Panel */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <h2 className="ad-panel-title">⚙ Broker Config</h2>
            {statusQuery.isLoading ? <LoadingSkeleton variant="text" lines={3} /> : (
              <div className="ad-config-list">
                {Object.entries(brokerStates).map(([brokerId, bs]) => (
                  <div key={brokerId} className="ad-config-row">
                    <div className="ad-config-header">
                      <span className="ad-config-broker">{brokerId}</span>
                      <label className="ad-toggle">
                        <input
                          type="checkbox"
                          checked={bs.enabled}
                          onChange={() => toggleMutation.mutate({ target: brokerId, enabled: !bs.enabled })}
                        />
                        <span className="ad-toggle-slider" />
                      </label>
                    </div>
                    {bs.enabled && (
                      <div className="ad-config-fields">
                        <label className="ad-config-field">
                          <span>Trading</span>
                          <label className="ad-toggle sm">
                            <input
                              type="checkbox"
                              checked={bs.tradingEnabled}
                              onChange={() => configMutation.mutate({ brokerId, tradingEnabled: !bs.tradingEnabled })}
                            />
                            <span className="ad-toggle-slider" />
                          </label>
                        </label>
                        <label className="ad-config-field">
                          <span>Threshold</span>
                          <input
                            type="number" min={40} max={95}
                            value={bs.tradeThreshold}
                            onChange={(e) => configMutation.mutate({ brokerId, tradeThreshold: parseInt(e.target.value) || 65 })}
                            className="ad-config-input"
                          />
                        </label>
                        <label className="ad-config-field">
                          <span>Confirm</span>
                          <label className="ad-toggle sm">
                            <input
                              type="checkbox"
                              checked={bs.requireConfirmation}
                              onChange={() => configMutation.mutate({ brokerId, requireConfirmation: !bs.requireConfirmation })}
                            />
                            <span className="ad-toggle-slider" />
                          </label>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
                {Object.keys(brokerStates).length === 0 && (
                  <p className="ad-empty">No brokers configured. Start the loop to initialize broker states.</p>
                )}
              </div>
            )}
          </motion.section>

          {/* Timeline */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
            <h2 className="ad-panel-title">⏱ Timeline {timelineEvents.length > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', fontWeight: 400 }}>({timelineEvents.length} events)</span>}</h2>
            {timelineQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
            {timelineQuery.isError && (
              <p className="ad-empty">Timeline unavailable — backend may be starting up.</p>
            )}
            {!timelineQuery.isLoading && timelineEvents.length === 0 && (
              <p className="ad-empty">No active events in the next 4 hours. Markets may be closed or calm.</p>
            )}
            {timelineEvents.length > 0 && (
              <div className="ad-timeline-list">
                {timelineEvents.slice(0, 8).map((ev) => (
                  <div key={ev.id} className={`ad-timeline-item ${ev.action === 'block' || ev.action === 'reduce' ? 'ad-timeline-danger' : ev.action === 'boost' ? 'ad-timeline-boost' : ''}`}>
                    <span className="ad-timeline-dot" style={{ background: ev.color || 'var(--accent)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ad-timeline-label">
                        {ev.icon && <span style={{ marginRight: 4 }}>{ev.icon}</span>}
                        <strong style={{ fontSize: '0.8rem' }}>{ev.label}</strong>
                        {ev.riskMultiplier && ev.riskMultiplier !== 1 && (
                          <span className={`ad-risk-badge ${ev.riskMultiplier < 1 ? 'ad-risk-down' : 'ad-risk-up'}`}>
                            {ev.riskMultiplier < 1 ? '↓' : '↑'}{Math.abs(1 - ev.riskMultiplier) * 100}%
                          </span>
                        )}
                      </div>
                      {ev.description && (
                        <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--ink-soft)' }}>{ev.description}</p>
                      )}
                    </div>
                    <span className="ad-timeline-time" style={{ fontSize: '0.65rem', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                      {new Date(ev.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.section>

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
                <p className="ad-empty">No directive data available for {selectedSymbol}. Run scoring first.</p>
              )
            ) : (
              <p className="ad-empty">Click a portfolio score (left column) to see the directive breakdown.</p>
            )}
          </motion.section>

          {/* Decision Log */}
          <motion.section className="ad-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <h2 className="ad-panel-title">📋 Decision Log {recentDecisions.length > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', fontWeight: 400 }}>({recentDecisions.length})</span>}</h2>
            {recentDecisions.length === 0 ? (
              <p className="ad-empty">No decisions yet. Start the loop and click Run Now to trigger a tick.</p>
            ) : (
              <div className="ad-decision-list">
                {recentDecisions.slice(0, 15).map((d, i) => (
                  <div key={i} className={`ad-decision-row ad-decision-${d.decision?.toLowerCase()}`}>
                    <span className="ad-decision-symbol">{d.symbol}</span>
                    <span className="ad-decision-tag">{d.decision}</span>
                    <span className="ad-decision-composite">{d.composite > 0 ? d.composite : ''}</span>
                    <span className="ad-decision-reason" title={d.reason}>{d.reason}</span>
                    <span className="ad-decision-time">{formatTime(d.timestamp)}</span>
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
