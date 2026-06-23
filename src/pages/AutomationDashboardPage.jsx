import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './automation-dashboard.css';

// ── Protocol Presets ──────────────────────────────────────

const PROTOCOL_PRESETS = [
  {
    id: 'momentum-short',
    name: 'Momentum / Short-Term',
    description: 'RSI, MACD, volume confirmation — 1-5 day horizon',
    directives: ['rsi-oversold', 'macd-crossover', 'volume-confirmation', 'atr-dip'],
  },
  {
    id: 'mean-reversion',
    name: 'Mean Reversion',
    description: 'Bollinger bands, RSI extremes, session timing — intraday to 3 days',
    directives: ['rsi-oversold', 'bollinger-squeeze', 'session-timing-filter', 'ema-structure'],
  },
  {
    id: 'swing-long',
    name: 'Swing / Long-Term',
    description: 'EMA structure, Hurst exponent, earnings momentum — weeks to months',
    directives: ['ema-structure', 'hurst-regime', 'earnings-momentum', 'social-buzz'],
  },
];

const DEFAULT_RUNS = [];

// ── Helpers ────────────────────────────────────────────────

function scoreBadge(score) {
  if (score == null) return '—';
  if (score >= 70) return 'auto-score-high';
  if (score >= 40) return 'auto-score-mid';
  return 'auto-score-low';
}

function scoreLabel(score) {
  if (score == null) return '—';
  return score.toFixed(1);
}

// ── Component ──────────────────────────────────────────────

export default function AutomationDashboardPage() {
  // ── System health ──────────────────────────────────
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version').catch(() => null),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const scoringSummary = useQuery({
    queryKey: ['scoring-summary'],
    queryFn: () => apiGet('/api/scoring/summary').catch(() => null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const apiOnline = Boolean(healthQuery.data?.version);
  const dbOnline = healthQuery.data?.services?.databaseConnected;
  const uptime = healthQuery.data?.uptime;

  // ── Protocol runs (localStorage for now) ────────────
  const [runs, setRuns] = useState(() => {
    try {
      const saved = localStorage.getItem('tcs:automation-runs');
      return saved ? JSON.parse(saved) : DEFAULT_RUNS;
    } catch {
      return DEFAULT_RUNS;
    }
  });

  const persistRuns = useCallback((next) => {
    setRuns(next);
    localStorage.setItem('tcs:automation-runs', JSON.stringify(next));
  }, []);

  // ── UI state ───────────────────────────────────────
  const [activeTab, setActiveTab] = useState('stack');
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRun, setNewRun] = useState({ name: '', protocolId: 'momentum-short', symbols: '' });

  // ── Add run ────────────────────────────────────────
  function handleAddRun() {
    const symbols = newRun.symbols
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!newRun.name.trim() || symbols.length === 0) return;

    const run = {
      id: Date.now(),
      name: newRun.name.trim(),
      protocolId: newRun.protocolId,
      protocolName: PROTOCOL_PRESETS.find((p) => p.id === newRun.protocolId)?.name || newRun.protocolId,
      symbols,
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      runCount: 0,
      results: null, // populated by backend
    };

    persistRuns([...runs, run]);
    setShowAddModal(false);
    setNewRun({ name: '', protocolId: 'momentum-short', symbols: '' });
  }

  // ── Remove run ─────────────────────────────────────
  function handleRemove(id) {
    persistRuns(runs.filter((r) => r.id !== id));
    if (expandedRunId === id) setExpandedRunId(null);
  }

  // ── Toggle expand ──────────────────────────────────
  function toggleExpand(id) {
    setExpandedRunId((prev) => (prev === id ? null : id));
  }

  // ── Get protocol preset info ───────────────────────
  function getPreset(protocolId) {
    return PROTOCOL_PRESETS.find((p) => p.id === protocolId);
  }

  // ── Queue stub data ────────────────────────────────
  const queueStub = [];

  return (
    <div className="pf-page">
      <div className="pf-header">
        <div>
          <h1>Automation Dashboard</h1>
          <p className="pf-hint" style={{ margin: 0 }}>
            Multi-protocol orchestration — configure scoring runs, monitor results, and manage execution.
          </p>
        </div>
        <button className="pf-add-btn" onClick={() => setShowAddModal(true)}>
          + Add Protocol Run
        </button>
      </div>

      {/* ── System Status Cards ─────────────────────────────── */}
      <div className="pf-summary">
        <div className="pf-stat">
          <span className="pf-stat-label">API Server</span>
          <span className={`pf-stat-value ${apiOnline ? 'pf-positive' : 'pf-negative'}`}>
            {apiOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="pf-stat">
          <span className="pf-stat-label">Database</span>
          <span className={`pf-stat-value ${dbOnline ? 'pf-positive' : 'pf-negative'}`}>
            {dbOnline ? 'Connected' : 'Offline'}
          </span>
        </div>
        <div className="pf-stat">
          <span className="pf-stat-label">Protocol Runs</span>
          <span className="pf-stat-value">{runs.length}</span>
        </div>
        <div className="pf-stat">
          <span className="pf-stat-label">Uptime</span>
          <span className="pf-stat-value">
            {uptime ? `${Math.floor(uptime / 60)}m` : '—'}
          </span>
        </div>
        <div className="pf-stat">
          <span className="pf-stat-label">Total Scores</span>
          <span className="pf-stat-value">
            {scoringSummary.data?.totalScores ?? '—'}
          </span>
        </div>
        <div className="pf-stat">
          <span className="pf-stat-label">Active Symbols</span>
          <span className="pf-stat-value">
            {scoringSummary.data?.activeSymbols ?? '—'}
          </span>
        </div>
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────── */}
      <div className="auto-tabs">
        <button
          className={`auto-tab ${activeTab === 'stack' ? 'active' : ''}`}
          onClick={() => setActiveTab('stack')}
        >
          📋 Stack View
        </button>
        <button
          className={`auto-tab ${activeTab === 'grid' ? 'active' : ''}`}
          onClick={() => setActiveTab('grid')}
        >
          📊 Grid View
        </button>
        <button
          className={`auto-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          ⏳ Queue
        </button>
      </div>

      {/* ── Stack View ──────────────────────────────────────── */}
      {activeTab === 'stack' && (
        <div className="pf-section">
          <h2>Protocol Runs</h2>
          {runs.length === 0 ? (
            <div className="auto-empty">
              <h3>No protocols configured</h3>
              <p>Create your first protocol run to start scoring symbols across multiple strategies.</p>
              <button className="auto-btn primary" onClick={() => setShowAddModal(true)}>
                + Add Protocol Run
              </button>
            </div>
          ) : (
            <div className="auto-runs">
              {runs.map((run) => {
                const preset = getPreset(run.protocolId);
                const isExpanded = expandedRunId === run.id;
                const isRunning = run.status === 'running';

                return (
                  <div key={run.id} className={`auto-run-card ${isExpanded ? 'expanded' : ''}`}>
                    <div className="auto-run-header" onClick={() => toggleExpand(run.id)}>
                      <div className="auto-run-name">
                        {isRunning && <span className="auto-pulse" />}
                        {run.name}
                        <span className={`auto-run-status auto-status-${run.status}`}>
                          {run.status}
                        </span>
                      </div>
                      <div className="auto-run-meta">
                        {run.symbols.length} symbols · {preset?.name || run.protocolId}
                        {run.lastRunAt && ` · last run ${new Date(run.lastRunAt).toLocaleDateString()}`}
                      </div>
                      <div className="auto-run-actions">
                        <button
                          className="auto-btn primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Trigger run — stub for now
                          }}
                          disabled={!apiOnline}
                          title="Run now"
                        >
                          ▶ Run
                        </button>
                        <button
                          className="auto-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(run.id);
                          }}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="auto-run-body">
                        <div style={{ marginBottom: '0.6rem' }}>
                          <strong>Protocol:</strong> {preset?.name || run.protocolId}
                          <span style={{ marginLeft: '1rem', color: 'var(--ink-soft)', fontSize: '0.82rem' }}>
                            {preset?.description}
                          </span>
                        </div>
                        <div style={{ marginBottom: '0.6rem' }}>
                          <strong>Symbols:</strong>
                          <div className="auto-symbol-chips" style={{ marginTop: '0.3rem' }}>
                            {run.symbols.map((sym) => (
                              <span key={sym} className="auto-chip">{sym}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ marginBottom: '0.6rem' }}>
                          <strong>Directives:</strong>{' '}
                          <span style={{ color: 'var(--ink-soft)', fontSize: '0.82rem' }}>
                            {preset?.directives?.join(', ') || '—'}
                          </span>
                        </div>

                        {run.results ? (
                          <div>
                            <strong style={{ display: 'block', marginBottom: '0.3rem' }}>Last Results:</strong>
                            <table className="auto-scores-mini">
                              <thead>
                                <tr>
                                  <th>Symbol</th>
                                  <th>Score</th>
                                  <th>Signal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {run.results.map((r) => (
                                  <tr key={r.symbol}>
                                    <td><strong>{r.symbol}</strong></td>
                                    <td>
                                      <span className={`auto-score-badge ${scoreBadge(r.score)}`}>
                                        {scoreLabel(r.score)}
                                      </span>
                                    </td>
                                    <td style={{ color: 'var(--ink-soft)' }}>{r.signalClass || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="pf-hint">
                            {run.runCount === 0
                              ? 'Not yet executed. Click ▶ Run to score these symbols.'
                              : `Completed ${run.runCount} run${run.runCount > 1 ? 's' : ''}. Results will appear here after next run.`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Grid View ───────────────────────────────────────── */}
      {activeTab === 'grid' && (
        <div className="pf-section">
          <h2>Symbol × Protocol Matrix</h2>
          {runs.length === 0 ? (
            <div className="auto-empty">
              <h3>No data to display</h3>
              <p>Add protocol runs to populate the grid view.</p>
            </div>
          ) : (
            <>
              <p className="pf-hint" style={{ marginBottom: '0.75rem' }}>
                Color indicates score: <span className="auto-score-badge auto-score-high">70+</span>{' '}
                <span className="auto-score-badge auto-score-mid">40-69</span>{' '}
                <span className="auto-score-badge auto-score-low">&lt;40</span>
              </p>
              <div
                className="auto-grid"
                style={{
                  gridTemplateColumns: `120px repeat(${runs.length}, 1fr)`,
                }}
              >
                {/* Header row */}
                <div className="auto-grid-header">Symbol</div>
                {runs.map((run) => (
                  <div key={run.id} className="auto-grid-header" title={run.protocolName}>
                    {run.name}
                  </div>
                ))}

                {/* Collect all unique symbols across runs */}
                {(() => {
                  const allSymbols = [...new Set(runs.flatMap((r) => r.symbols))].sort();
                  return allSymbols.map((sym) => (
                    <>
                      <div key={`sym-${sym}`} className="auto-grid-cell" style={{ textAlign: 'left', fontWeight: 600 }}>
                        {sym}
                      </div>
                      {runs.map((run) => {
                        const result = run.results?.find((r) => r.symbol === sym);
                        const score = result?.score;
                        return (
                          <div key={`${run.id}-${sym}`} className="auto-grid-cell">
                            {score != null ? (
                              <span className={`auto-score-badge ${scoreBadge(score)}`}>
                                {scoreLabel(score)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--ink-soft)' }}>—</span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ));
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Queue View ──────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <div className="pf-section">
          <h2>Execution Queue</h2>
          {queueStub.length === 0 ? (
            <div className="auto-empty">
              <h3>Queue is empty</h3>
              <p>Run a protocol to see jobs appear here. The execution queue manages scoring runs sequentially.</p>
            </div>
          ) : (
            <div className="auto-queue-list">
              {queueStub.map((job) => (
                <div key={job.id} className="auto-queue-item">
                  <span className="auto-queue-jobid">{job.id}</span>
                  <span>{job.symbols?.join(', ') || '—'}</span>
                  <span className={`auto-run-status auto-status-${job.status}`}>{job.status}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
                    {job.progress ? `${job.progress.done}/${job.progress.total}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Add Protocol Run Modal ───────────────────────────── */}
      {showAddModal && (
        <div className="auto-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="auto-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Protocol Run</h3>

            <div>
              <label>Run Name</label>
              <input
                type="text"
                placeholder="e.g. Tech Momentum Scan"
                value={newRun.name}
                onChange={(e) => setNewRun({ ...newRun, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRun()}
                autoFocus
              />
            </div>

            <div>
              <label>Protocol Preset</label>
              <select
                value={newRun.protocolId}
                onChange={(e) => setNewRun({ ...newRun, protocolId: e.target.value })}
              >
                {PROTOCOL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="pf-hint" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
                {PROTOCOL_PRESETS.find((p) => p.id === newRun.protocolId)?.description}
              </p>
            </div>

            <div>
              <label>Symbols (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. NVDA, AAPL, MSFT, TSLA"
                value={newRun.symbols}
                onChange={(e) => setNewRun({ ...newRun, symbols: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRun()}
              />
            </div>

            <div className="auto-modal-actions">
              <button className="auto-btn" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button className="auto-btn primary" onClick={handleAddRun}>
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
