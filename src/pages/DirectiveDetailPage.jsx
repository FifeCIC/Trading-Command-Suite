/**
 * Directive Detail Page
 * =====================
 * Template-based detail view for any directive. Shows formula, inputs, metadata.
 * Uses existing directive registry data — no per-directive files needed.
 *
 * Route: /scoring/directives/:id
 */
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import BeginnerGuide from '../components/BeginnerGuide';
import GlossaryRichText from '../components/GlossaryRichText';
import DirectiveChart from '../components/DirectiveChart';
import SymbolAutocomplete from '../components/SymbolAutocomplete';
import './directive-detail.css';

export default function DirectiveDetailPage() {
  const { id: pathId } = useParams();
  const [searchParams] = useSearchParams();
  const id = pathId || searchParams.get('id');
  const navigate = useNavigate();

  const { data: directive, isLoading, error } = useQuery({
    queryKey: ['directive', id],
    queryFn: () => apiGet(`/api/directives/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="dd-page"><LoadingSkeleton variant="text" lines={12} /></div>;
  if (error || !directive) {
    return (
      <div className="dd-page">
        <EmptyState icon="🔍" title="Directive not found" description={`No directive with ID "${id}" found in the registry.`} actionLabel="Back to Directives" actionHref="/scoring/directives-manager" />
      </div>
    );
  }

  return (
    <DirectiveDetailContent directive={directive} id={id} navigate={navigate} />
  );
}

function DirectiveDetailContent({ directive, id, navigate }) {
  const [testSymbol, setTestSymbol] = useState('EURUSD');
  const [testTimeframe, setTestTimeframe] = useState('1d');
  const [testBarCount, setTestBarCount] = useState(100);

  const testMutation = useMutation({
    mutationFn: () => apiPost(`/api/directives/${id}/test`, { symbol: testSymbol, timeframe: testTimeframe, barCount: testBarCount }),
  });

  const testResult = testMutation.data;

  // Bar count availability — query symbol metadata to disable unattainable counts
  const barCounts = [36, 50, 72, 100, 200, 365];
  const barAvailQuery = useQuery({
    queryKey: ['bar-avail', testSymbol, testTimeframe],
    queryFn: async () => {
      // Use the test endpoint with the max bar count to discover actual availability
      const r = await apiPost(`/api/directives/${id}/test`, {
        symbol: testSymbol, timeframe: testTimeframe, barCount: 365,
      }).catch(() => null);
      return r?.barCount || 0;
    },
    enabled: !!testSymbol && testSymbol.length > 0,
    staleTime: 120_000,
  });

  const categoryColors = {
    Entry: '#22c55e', Exit: '#ef4444', Risk: '#f59e0b', Macro: '#8b5cf6',
    Momentum: '#3b82f6', Trend: '#06b6d4', Volume: '#a855f7', Other: '#64748b',
  };
  const catColor = categoryColors[directive.category] || categoryColors.Other;

  return (
    <div className="dd-page">
      <button className="dd-back" onClick={() => navigate('/scoring/directives-manager')}>← Back to Directives</button>

      <header className="dd-header">
        <div className="dd-header-left">
          <h1>{directive.name || directive.id}</h1>
          <p className="dd-code">{directive.id}</p>
        </div>
        <div className="dd-badges">
          <span className="dd-badge" style={{ background: catColor + '18', color: catColor, borderColor: catColor + '33' }}>
            {directive.category || 'Other'}
          </span>
          <span className={`dd-badge dd-status-${directive.active !== false ? 'active' : 'inactive'}`}>
            {directive.active !== false ? 'Active' : 'Inactive'}
          </span>
          {directive.classification === 'stub' && (
            <span className="dd-badge dd-stub">STUB</span>
          )}
        </div>
      </header>

      {/* ── Beginner's Guide ── */}
      <BeginnerGuide directive={directive} />

      {/* ── Formula Card ── */}
      <section className="dd-card">
        <h2>Formula</h2>
        <div className="dd-formula">
          <GlossaryRichText text={
            typeof directive.description === 'string' ? directive.description
              : typeof directive.formula === 'string' ? directive.formula
              : 'No formula description available.'
          } />
        </div>
        <div className="dd-meta-grid">
          <div><span>Max Score</span><strong>{directive.maxScore ?? '—'}</strong></div>
          <div><span>Direction Bias</span><strong>{directive.directionBias || 'neutral'}</strong></div>
          <div><span>Complexity</span><strong>{typeof directive.complexity === 'object' ? directive.complexity?.label || JSON.stringify(directive.complexity) : (directive.complexity || '—')}</strong></div>
          <div><span>Classification</span><strong>{directive.classification || '—'}</strong></div>
          <div>
            <span>Readiness</span>
            <strong style={{
              color: directive.readiness === 'ready' ? '#22c55e' : directive.readiness === 'beta' ? '#f59e0b' : '#ef4444',
            }}>
              {directive.readiness === 'ready' ? '🟢 READY' : directive.readiness === 'beta' ? '🟡 BETA' : '🔴 ALPHA'}
            </strong>
          </div>
          <div>
            <span>Data Feeds</span>
            <strong>
              {(directive.requiredDataFeeds && directive.requiredDataFeeds.length > 0)
                ? directive.requiredDataFeeds.map(f => (
                    <span key={f} style={{
                      background: '#3b82f618', color: '#60a5fa',
                      padding: '1px 6px', borderRadius: '3px', fontSize: '0.75rem',
                      marginRight: '4px', border: '1px solid #3b82f633',
                    }}>{f}</span>
                  ))
                : 'bars only (self-contained)'}
            </strong>
          </div>
        </div>
      </section>

      {/* ── Inputs ── */}
      {directive.inputs && directive.inputs.length > 0 && (
        <section className="dd-card">
          <h2>Inputs</h2>
          <ul className="dd-inputs-list">
            {directive.inputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Dependencies ── */}
      {directive.dependsOn && directive.dependsOn.length > 0 && (
        <section className="dd-card">
          <h2>Dependencies</h2>
          <div className="dd-chip-list">
            {directive.dependsOn.map((dep) => (
              <span key={dep} className="dd-chip" onClick={() => navigate(`/scoring/directives/${dep}`)}>
                {dep}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Test Directive ── */}
      <section className="dd-card">
        <h2>Test Directive</h2>
        <p className="dd-hint" style={{ marginBottom: '0.75rem' }}>
          Run this directive in isolation against live market data for a specific symbol.
        </p>

        <div className="dd-test-controls">
          <label className="dd-test-field">
            Symbol
            <SymbolAutocomplete
              value={testSymbol}
              onChange={(val) => setTestSymbol(val.split(/[,\s]+/).filter(Boolean)[0]?.toUpperCase() || '')}
              placeholder="EURUSD"
              className="dd-symbol-input"
            />
          </label>
          <label className="dd-test-field">
            Timeframe
            <select value={testTimeframe} onChange={e => setTestTimeframe(e.target.value)} className="dd-test-select">
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </label>
          <label className="dd-test-field">
            Bars
            <select value={testBarCount} onChange={e => setTestBarCount(Number(e.target.value))} className="dd-test-select">
              {barCounts.map(n => (
                <option key={n} value={n} disabled={barAvailQuery.data > 0 && n > barAvailQuery.data}>
                  {n}{barAvailQuery.data > 0 && n > barAvailQuery.data ? ` (max ${barAvailQuery.data})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="dd-test-btn"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? 'Running…' : 'Run Test'}
          </button>
        </div>

        {testMutation.isError && (
          <div className="dd-test-error">
            {testMutation.error?.message || 'Test failed — check symbol, timeframe, or data availability'}
          </div>
        )}

        {testResult && !testResult.error && (
          <div className="dd-test-result">
            <div className="dd-test-result-header">
              <span>{testResult.symbol} · {testResult.timeframe} · {testResult.barCount} bars</span>
              <span className="dd-test-date-range">
                {testResult.firstBar?.slice(0, 10)} → {testResult.lastBar?.slice(0, 10)}
              </span>
            </div>
            <div className="dd-test-scores">
              <div className="dd-test-score-main">
                <span className="dd-test-score-label">Score</span>
                <span className="dd-test-score-value">{testResult.result.score} / {testResult.result.maxScore}</span>
              </div>
              <div className="dd-test-score-pct">
                {testResult.result.maxScore > 0 ? Math.round(testResult.result.score / testResult.result.maxScore * 100) : 0}%
              </div>
            </div>
            <div className="dd-test-meta">
              <div><span>Signal</span><strong className={`dd-test-signal-${testResult.result.signalClass || 'neutral'}`}>{testResult.result.signal || 'N/A'}</strong></div>
              <div><span>Signal Class</span><strong>{testResult.result.signalClass || 'neutral'}</strong></div>
              <div><span>Confidence</span><strong>{testResult.result.confidence != null ? Math.round(testResult.result.confidence * 100) + '%' : '—'}</strong></div>
            </div>
            {testResult.result.reason && (
              <div className="dd-test-reason">
                <span className="dd-test-reason-label">Reason</span>
                <p><GlossaryRichText text={typeof testResult.result.reason === 'string' ? testResult.result.reason : JSON.stringify(testResult.result.reason)} /></p>
              </div>
            )}
            {testResult.result.meta && Object.keys(testResult.result.meta).length > 0 && (
              <details className="dd-test-raw">
                <summary>Raw metadata</summary>
                <pre>{JSON.stringify(testResult.result.meta, null, 2)}</pre>
              </details>
            )}
          </div>
        )}

        {testResult?.error && (
          <div className="dd-test-error">{testResult.error}</div>
        )}
      </section>

      {/* ── Chart ── */}
      {testResult?.bars && testResult.bars.length > 0 && (
        <section className="dd-card">
          <h2>Chart</h2>
          <p className="dd-hint" style={{ marginBottom: '0.75rem' }}>
            {testResult.symbol} · {testResult.timeframe} · {testResult.barCount} bars · {testResult.firstBar?.slice(0, 10)} → {testResult.lastBar?.slice(0, 10)}
          </p>
          <DirectiveChart bars={testResult.bars} symbol={testResult.symbol} height={320} />
        </section>
      )}

      {/* ── Raw Metadata ── */}
      <section className="dd-card dd-raw">
        <h2>Raw Metadata</h2>
        <pre className="dd-json">{JSON.stringify(directive, null, 2)}</pre>
      </section>
    </div>
  );
}
