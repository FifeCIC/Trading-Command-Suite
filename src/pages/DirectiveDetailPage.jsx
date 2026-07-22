/**
 * Directive Detail Page
 * =====================
 * Template-based detail view for any directive. Shows formula, inputs, metadata.
 * Uses existing directive registry data — no per-directive files needed.
 *
 * Route: /scoring/directives/:id
 */
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './directive-detail.css';

export default function DirectiveDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: directive, isLoading, error } = useQuery({
    queryKey: ['directive', id],
    queryFn: async () => {
      const res = await apiGet('/api/directives');
      const dirs = Array.isArray(res) ? res : (res?.directives || []);
      return dirs.find((d) => d.id === id) || null;
    },
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

  const categoryColors = {
    Entry: '#22c55e', Exit: '#ef4444', Risk: '#f59e0b', Macro: '#8b5cf6',
    Momentum: '#3b82f6', Trend: '#06b6d4', Volume: '#a855f7', Other: '#64748b',
  };
  const catColor = categoryColors[directive.category] || categoryColors.Other;

  return (
    <div className="dd-page">
      <button className="dd-back" onClick={() => navigate('/scoring/directives-manager')}>← Back to Directives</button>

      <header className="dd-header">
        <h1>{directive.name || directive.id}</h1>
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

      <p className="dd-code" style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{directive.id}</p>

      {/* ── Formula Card ── */}
      <section className="dd-card">
        <h2>Formula</h2>
        <div className="dd-formula">
          {directive.description || directive.formula || 'No formula description available.'}
        </div>
        <div className="dd-meta-grid">
          <div><span>Max Score</span><strong>{directive.maxScore ?? '—'}</strong></div>
          <div><span>Direction Bias</span><strong>{directive.directionBias || 'neutral'}</strong></div>
          <div><span>Complexity</span><strong>{directive.complexity || '—'}</strong></div>
          <div><span>Classification</span><strong>{directive.classification || '—'}</strong></div>
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

      {/* ── Score History (placeholder — needs backend endpoint) ── */}
      <section className="dd-card">
        <h2>Score History</h2>
        <p className="dd-hint">
          Score history charts will appear here once a backend endpoint for per-directive score data is available.
          The chart will show historical scores for this directive across selected symbols.
        </p>
      </section>

      {/* ── Raw Metadata ── */}
      <section className="dd-card dd-raw">
        <h2>Raw Metadata</h2>
        <pre className="dd-json">{JSON.stringify(directive, null, 2)}</pre>
      </section>
    </div>
  );
}
