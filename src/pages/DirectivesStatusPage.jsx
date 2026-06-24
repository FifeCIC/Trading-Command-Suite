import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './directives-status.css';

function CategoryChip({ category }) {
  const tone = category === 'Momentum' ? 'momentum' : category === 'Trend' ? 'trend' : category === 'Volatility' ? 'volatility' : 'participation';
  return <span className={`ds-category-chip ds-category--${tone}`}>{category}</span>;
}

export default function DirectivesStatusPage() {
  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 30_000,
  });

  const directives = directivesQuery.data || [];
  const totalDirectives = directives.length;

  if (directivesQuery.isLoading) {
    return (
      <main className="directives-status-page">
        <h1>Directive Status</h1>
        <p className="ds-subtitle">Loading directives from API…</p>
      </main>
    );
  }

  if (directives.length === 0) {
    return (
      <main className="directives-status-page">
        <h1>Directive Status</h1>
        <div className="pf-unavailable">
          <h2>No Directives Registered</h2>
          <p>The NestJS directive registry is empty. Ensure the backend is running and directives are registered in the DirectivesModule.</p>
          <p className="pf-hint">Start the API server: localhost:3201</p>
        </div>
      </main>
    );
  }

  return (
    <main className="directives-status-page">
      <header className="ds-page-header">
        <div>
          <h1>Directive Status</h1>
          <p className="ds-subtitle">All {totalDirectives} registered directives from the scoring pipeline.</p>
        </div>
      </header>

      <section className="ds-summary-grid">
        <article className="ds-summary-card">
          <p className="ds-summary-label">Total Registered</p>
          <strong className="ds-summary-value">{totalDirectives}</strong>
          <p className="ds-summary-note">All directives registered in NestJS DirectivesModule</p>
        </article>

        <article className="ds-summary-card">
          <p className="ds-summary-label">API Status</p>
          <strong className="ds-summary-value" style={{ color: '#4ade80' }}>Live</strong>
          <p className="ds-summary-note">Fetched from GET /api/directives</p>
        </article>
      </section>

      <section className="ds-table-section">
        <h2>Directive Registry</h2>
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>ID</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Protocols</th>
              </tr>
            </thead>
            <tbody>
              {directives.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td><code>{d.id}</code></td>
                  <td><CategoryChip category={d.category || 'Uncategorized'} /></td>
                  <td className="ds-num">{d.priority ?? '—'}</td>
                  <td className="ds-num">{d.protocolCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
