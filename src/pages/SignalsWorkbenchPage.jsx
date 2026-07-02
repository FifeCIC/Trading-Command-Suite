import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './signals-workbench.css';

const SIGNAL_COLORS = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#94a3b8' };
const CONFLICT_SEVERITY = {
  high: { color: '#ef4444', label: 'High' },
  medium: { color: '#f59e0b', label: 'Med' },
  low: { color: '#94a3b8', label: 'Low' },
};

export default function SignalsWorkbenchPage() {
  const qc = useQueryClient();
  const { prefs } = usePreferences();
  const [symbolInput, setSymbolInput] = useState(prefs.defaultSignalSymbols || '');
  const [protocolId, setProtocolId] = useState(prefs.defaultProtocol || '');
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [viewMode, setViewMode] = useState('ladder');

  const ladderMutation = useMutation({
    mutationFn: (payload) => apiPost('/api/signals/ladder', payload),
    onSuccess: (data) => {
      qc.setQueryData(['signals-ladder'], data);
    },
  });

  const protocolsQuery = useQuery({
    queryKey: ['protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols'),
    staleTime: 60000,
  });

  const ladderData = qc.getQueryData(['signals-ladder']) || ladderMutation.data;
  const envelopes = ladderData?.envelopes || [];
  const topConflicts = ladderData?.topConflicts || [];
  const stats = ladderData || { buyCount: 0, sellCount: 0, holdCount: 0, totalSymbols: 0 };

  const handleRun = useCallback(() => {
    const symbols = symbolInput
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    ladderMutation.mutate({ symbols, protocol: protocolId || undefined });
  }, [symbolInput, protocolId, ladderMutation]);

  const expandedEnvelope = envelopes.find((e) => e.symbol === expandedSymbol);

  // Auto-refresh
  useEffect(() => {
    if (!prefs.signalsAutoRefresh || !symbolInput.trim()) return;
    const symbols = symbolInput.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) return;
    const timer = setInterval(() => {
      ladderMutation.mutate({ symbols, protocol: protocolId || undefined });
    }, prefs.signalsRefreshInterval);
    return () => clearInterval(timer);
  }, [prefs.signalsAutoRefresh, prefs.signalsRefreshInterval, symbolInput, protocolId]);

  return (
    <div className="sw-page">
      <motion.header className="sw-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Signals Workbench</h1>
          <p className="sw-subtitle">
            Live signal ladder — directive breakdown, confidence rails, conflict resolution, pre-trade readiness.
          </p>
        </div>
        <span className="sw-clock">
          {ladderData?.generatedAt ? new Date(ladderData.generatedAt).toLocaleTimeString() : '—'}
        </span>
      </motion.header>

      {/* ── Controls ── */}
      <motion.div className="sw-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        <input
          type="text"
          className="sw-symbol-input"
          placeholder="AAPL, NVDA, MSFT..."
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
        />
        <select className="sw-protocol-select" value={protocolId} onChange={(e) => setProtocolId(e.target.value)}>
          <option value="">Default directives</option>
          {(protocolsQuery.data?.protocols || []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="sw-run-btn" onClick={handleRun} disabled={ladderMutation.isPending}>
          {ladderMutation.isPending ? '⏳ Scoring...' : '▶ Run Signal Scan'}
        </button>
        <div className="sw-view-tabs">
          <button className={viewMode === 'ladder' ? 'active' : ''} onClick={() => setViewMode('ladder')}>
            Ladder
          </button>
          <button className={viewMode === 'conflicts' ? 'active' : ''} onClick={() => setViewMode('conflicts')}>
            Conflicts{topConflicts.length > 0 ? ` (${topConflicts.length})` : ''}
          </button>
        </div>
      </motion.div>

      {ladderMutation.isError && <ApiOfflineBanner />}

      {/* ── Stats Bar ── */}
      {stats.totalSymbols > 0 && (
        <motion.div className="sw-stats-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
          <span className="sw-stat">{stats.totalSymbols} symbols</span>
          <span className="sw-stat sw-buy">{stats.buyCount} BUY</span>
          <span className="sw-stat sw-sell">{stats.sellCount} SELL</span>
          <span className="sw-stat sw-hold">{stats.holdCount} HOLD</span>
          {ladderData?.protocolName && (
            <span className="sw-stat sw-protocol">Protocol: {ladderData.protocolName}</span>
          )}
        </motion.div>
      )}

      {ladderMutation.isPending && (
        <div className="sw-loading-wrap"><LoadingSkeleton variant="card" count={4} /></div>
      )}

      {/* ── Ladder View ── */}
      {viewMode === 'ladder' && envelopes.length > 0 && (
        <motion.div className="sw-ladder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          {envelopes.map((env, i) => (
            <motion.div
              key={env.symbol}
              className={`sw-env-card ${expandedSymbol === env.symbol ? 'sw-expanded' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.03 }}
              style={{ borderLeftColor: SIGNAL_COLORS[env.signal] || '#94a3b8' }}
              onClick={() => setExpandedSymbol(expandedSymbol === env.symbol ? null : env.symbol)}
            >
              <div className="sw-env-top">
                <span className="sw-env-rank">#{i + 1}</span>
                <span className="sw-env-symbol">{env.symbol}</span>
                <span className="sw-env-composite" style={{ color: SIGNAL_COLORS[env.signal] }}>
                  {env.composite.toFixed(0)}
                </span>
                <span
                  className="sw-env-signal"
                  style={{ background: SIGNAL_COLORS[env.signal] + '22', color: SIGNAL_COLORS[env.signal] }}
                >
                  {env.signal}
                </span>
                <span className="sw-env-confidence">
                  Conf: {env.confidence}%
                  <span className="sw-conf-bar-wrap">
                    <span
                      className="sw-conf-bar"
                      style={{
                        width: env.confidence + '%',
                        background: env.confidence > 70 ? '#22c55e' : env.confidence > 40 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </span>
                </span>
                {env.rarity && (
                  <span className="sw-env-rarity" style={{ color: env.rarityColor }}>{env.rarity}</span>
                )}
                {env.preTradeReady && <span className="sw-ready-badge">✓ Ready</span>}
                {env.preTradeBlockers.length > 0 && (
                  <span className="sw-blocked-badge" title={env.preTradeBlockers.join('; ')}>
                    ⚠ {env.preTradeBlockers.length}
                  </span>
                )}
                {env.conflicts.length > 0 && <span className="sw-conflict-badge">↯ {env.conflicts.length}</span>}
                <span className="sw-env-chevron">{expandedSymbol === env.symbol ? '▾' : '▸'}</span>
              </div>

              {/* ── Directive Drilldown ── */}
              <AnimatePresence>
                {expandedSymbol === env.symbol && expandedEnvelope && (
                  <motion.div
                    className="sw-drilldown"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Risk Gate Chain */}
                    {expandedEnvelope.riskGate.active && (
                      <div className="sw-risk-chain">
                        <h4>Risk Gate Chain</h4>
                        <div className="sw-multiplier-flow">
                          {expandedEnvelope.riskGate.chain.map((step, j) => (
                            <span key={j} className="sw-mult-step" style={{ opacity: 1 - step.severity * 0.6 }}>
                              {step.rule}: ×{step.multiplier.toFixed(2)}
                            </span>
                          ))}
                          <span className="sw-mult-result">= ×{expandedEnvelope.riskGate.multiplier.toFixed(2)}</span>
                        </div>
                        {expandedEnvelope.riskGate.warnings.length > 0 && (
                          <div className="sw-warnings">
                            {expandedEnvelope.riskGate.warnings.map((w, j) => (
                              <span key={j} className="sw-warning-tag">⚠ {w}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Directive Groups */}
                    <div className="sw-groups">
                      {expandedEnvelope.groups.map((g) => (
                        <div key={g.groupId} className={`sw-group ${g.isRisk ? 'sw-group-risk' : ''}`}>
                          <div className="sw-group-header">
                            <span className="sw-group-name">{g.groupName}</span>
                            <span
                              className="sw-group-score"
                              style={{ color: g.score > 65 ? '#22c55e' : g.score < 35 ? '#ef4444' : '#94a3b8' }}
                            >
                              {g.score}
                            </span>
                            <span className="sw-group-weight">({g.weight}%)</span>
                          </div>
                          <div className="sw-directive-list">
                            {g.topDirectives.map((d) => (
                              <div key={d.id} className={`sw-directive sw-dir-${d.signalClass}`}>
                                <span className="sw-dir-name">{d.name}</span>
                                <span className="sw-dir-score">{d.normalized}</span>
                                <span className="sw-dir-reason">{d.reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Conflicts */}
                    {expandedEnvelope.conflicts.length > 0 && (
                      <div className="sw-conflicts-panel">
                        <h4>Conflicts</h4>
                        {expandedEnvelope.conflicts.map((c, j) => (
                          <div
                            key={j}
                            className="sw-conflict-row"
                            style={{ borderLeftColor: CONFLICT_SEVERITY[c.severity]?.color }}
                          >
                            <span className="sw-conflict-type">{c.type}</span>
                            <span className="sw-conflict-sev" style={{ color: CONFLICT_SEVERITY[c.severity]?.color }}>
                              {CONFLICT_SEVERITY[c.severity]?.label}
                            </span>
                            <span className="sw-conflict-desc">{c.description}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Pre-Trade Blockers */}
                    {expandedEnvelope.preTradeBlockers.length > 0 && (
                      <div className="sw-blockers">
                        {expandedEnvelope.preTradeBlockers.map((b, j) => (
                          <div key={j} className="sw-blocker-row">🚫 {b}</div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* ── Conflicts View ── */}
      {viewMode === 'conflicts' && (
        <motion.div className="sw-conflicts-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h2>Conflict Resolver</h2>
          {topConflicts.length === 0 ? (
            <p className="sw-empty">No conflicts detected — all directives agree.</p>
          ) : (
            topConflicts.map((c) => {
              const env = envelopes.find((e) => e.symbol === c.symbol);
              return (
                <div
                  key={c.symbol}
                  className={`sw-conflict-card ${c.severity}`}
                  onClick={() => {
                    setViewMode('ladder');
                    setExpandedSymbol(c.symbol);
                  }}
                >
                  <span className="sw-conflict-symbol">{c.symbol}</span>
                  <span className="sw-conflict-badge-count">{c.conflictCount} conflicts</span>
                  <span
                    className="sw-conflict-sev-badge"
                    style={{ background: CONFLICT_SEVERITY[c.severity]?.color }}
                  >
                    {c.severity}
                  </span>
                  {env && (
                    <span className="sw-conflict-signal" style={{ color: SIGNAL_COLORS[env.signal] }}>
                      → {env.signal} ({env.composite.toFixed(0)})
                    </span>
                  )}
                </div>
              );
            })
          )}
        </motion.div>
      )}

      {/* ── Empty State ── */}
      {!ladderMutation.isPending && envelopes.length === 0 && (
        <motion.div className="sw-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <div className="sw-empty-icon">◈</div>
          <h2>No signals yet</h2>
          <p>Enter symbols above and click "Run Signal Scan" to build a live signal ladder with directive drilldown.</p>
          <div className="sw-empty-hints">
            <span>Try: AAPL, NVDA, MSFT</span>
            <span>or pick a protocol from the dropdown</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
