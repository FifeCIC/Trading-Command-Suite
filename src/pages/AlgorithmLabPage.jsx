import { useState, useEffect, useCallback } from 'react';
import './AlgorithmLabPage.css';

// ── API ────────────────────────────────────────────────────

const API = '/api/scoring/algorithm-lab';

async function fetchRuns() {
  const res = await fetch(`${API}/runs`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchState() {
  const res = await fetch(`${API}/state`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Component ──────────────────────────────────────────────

export default function AlgorithmLabPage() {
  const [runs, setRuns] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [pipelineStages, setPipelineStages] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRun, setExpandedRun] = useState(null);
  const [showConcept, setShowConcept] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [runsData, stateData] = await Promise.all([fetchRuns(), fetchState()]);
      setRuns(runsData.runs ?? []);
      setProcedures(runsData.procedures ?? stateData.procedures ?? []);
      setPipelineStages(stateData.pipelineStages ?? []);
      setLastRun(stateData.lastRun ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleRun = (runId) => {
    setExpandedRun((prev) => (prev === runId ? null : runId));
  };

  const formatTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  const signalClass = (signal) => {
    if (signal === 'bullish') return 'al-sig-bull';
    if (signal === 'bearish') return 'al-sig-bear';
    return 'al-sig-neutral';
  };

  const signalEmoji = (signal) => {
    if (signal === 'bullish') return '🟢';
    if (signal === 'bearish') return '🔴';
    return '⚪';
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="al-page">
      {/* Header */}
      <div className="al-header">
        <div className="al-header-left">
          <h1>
            Algorithm Log
            <span className="al-prototype-badge">PROTOTYPE</span>
          </h1>
          <p className="al-subtitle">
            Monitor real scoring pipeline runs. Results are from the live ScoringService.
          </p>
        </div>
        <button
          type="button"
          className="al-refresh-btn"
          onClick={loadData}
          disabled={loading}
        >
          {loading ? '⏳ Running...' : '🔄 Run Scoring'}
        </button>
      </div>

      {/* Concept explainer */}
      <div className="al-concept-section">
        <button
          type="button"
          className="al-concept-toggle"
          onClick={() => setShowConcept(!showConcept)}
        >
          {showConcept ? '▾' : '▸'} How the Algorithm Works
        </button>
        {showConcept && (
          <div className="al-concept-body">
            <p>
              The <strong>&ldquo;algorithm&rdquo;</strong> in Trading Command Suite is{' '}
              <em>not</em> a single monolithic algorithm. It&rsquo;s a{' '}
              <strong>pipeline</strong>:
            </p>
            <ol>
              <li>
                <strong>Directives</strong> evaluate data — each directive is a focused
                rule that scores one aspect of a symbol (RSI overbought, MA crossover,
                volume spike, etc.)
              </li>
              <li>
                <strong>Strategy weights</strong> aggregate directive scores into a
                composite per-symbol score — you control which directives matter and
                how much.
              </li>
              <li>
                <strong>SEES</strong> (Scoring Engine) ranks all symbols by their
                aggregate scores and produces BUY / SELL / HOLD signals.
              </li>
            </ol>
            <p>
              Multiple <strong>scoring procedures</strong> can run independently on
              different symbol groups — they are separate pipelines, not one algorithm.
              This page shows the log of procedure runs below.
            </p>
          </div>
        )}
      </div>

      {/* Pipeline stages diagram */}
      {pipelineStages.length > 0 && (
        <div className="al-pipeline-section">
          <h3 className="al-section-title">Pipeline Stages</h3>
          <div className="al-pipeline">
            <div className="al-pipe-wrapper">
              {pipelineStages.map((stage, i) => (
                <div key={stage.id} className="al-pipe-node">
                  <div className="al-node-icon">
                    {i === 0 ? '📡' : i === 1 ? '📊' : i === 2 ? '🏆' : i === 3 ? '🔍' : '📢'}
                  </div>
                  <div className="al-node-label">{stage.label}</div>
                  <div className="al-node-desc">{stage.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Procedures list */}
      {procedures.length > 0 && (
        <div className="al-procedures-section">
          <h3 className="al-section-title">Scoring Procedures</h3>
          <div className="al-procedures-grid">
            {procedures.map((proc) => (
              <div key={proc.id} className="al-procedure-card">
                <strong>{proc.label}</strong>
                <span>{proc.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="al-error">
          <p>⚠️ Failed to load scoring data: {error}</p>
          <button type="button" className="al-cta-btn" onClick={loadData}>
            Retry
          </button>
        </div>
      )}

      {/* Run log */}
      <div className="al-log-section">
        <div className="al-log-header">
          <h2>Activity Log {lastRun ? `(${runs.length} runs)` : ''}</h2>
        </div>

        {loading && runs.length === 0 && (
          <div className="al-log-empty">Loading scoring runs...</div>
        )}

        {!loading && runs.length === 0 && !error && (
          <div className="al-empty">
            <h2>No scoring runs yet</h2>
            <p>Click &ldquo;Run Scoring&rdquo; to execute a fresh pipeline run and see results here.</p>
            <button type="button" className="al-cta-btn" onClick={loadData}>
              🔄 Run First Scoring
            </button>
          </div>
        )}

        {runs.map((run) => (
          <div key={run.id} className="al-run-entry">
            <button
              type="button"
              className={`al-run-summary ${run.status === 'failed' ? 'al-run-failed' : ''}`}
              onClick={() => toggleRun(run.id)}
            >
              <span className="al-run-time">{formatTime(run.timestamp)}</span>
              <span className="al-run-proc">{run.procedure}</span>
              <span className="al-run-count">
                {run.symbolsScored} symbols
              </span>
              <span className="al-run-duration">{run.durationMs}ms</span>
              <span className={`al-run-status al-status-${run.status}`}>
                {run.status === 'completed' ? '✅' : '❌'}
              </span>
              <span className="al-run-expand">
                {expandedRun === run.id ? '▾' : '▸'}
              </span>
            </button>

            {expandedRun === run.id && run.symbols.length > 0 && (
              <div className="al-run-detail">
                <div className="al-run-detail-header">
                  <span>Symbol</span>
                  <span>Score</span>
                  <span>Signal</span>
                  <span>Directives</span>
                </div>
                {run.symbols
                  .sort((a, b) => b.score - a.score)
                  .map((sym) => (
                    <div key={sym.ticker} className="al-run-symbol">
                      <span className="al-sym-ticker">{sym.ticker}</span>
                      <span className="al-sym-score">{sym.score}</span>
                      <span className={`al-sym-signal ${signalClass(sym.signal)}`}>
                        {signalEmoji(sym.signal)} {sym.signal.toUpperCase()}
                      </span>
                      <span className="al-sym-dirs">{sym.directiveCount} dirs</span>
                    </div>
                  ))}
              </div>
            )}

            {expandedRun === run.id && run.status === 'failed' && (
              <div className="al-run-detail">
                <p className="al-run-fail-msg">This run failed. Check server logs for details.</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
