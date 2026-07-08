/**
 * DirectivesConfigPage
 * ====================
 * Per-strategy directive configuration. Pick a strategy, toggle its directives
 * on/off, and adjust weights. Changes persist to the database via PATCH.
 *
 * Route: /scoring/configure-directives
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './directives-config.css';

export default function DirectivesConfigPage() {
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const queryClient = useQueryClient();

  // Fetch saved strategies
  const strategiesQuery = useQuery({
    queryKey: ['strategies', 'saved'],
    queryFn: () => apiGet('/api/strategies/saved'),
    staleTime: 30_000,
  });

  const strategies = strategiesQuery.data?.strategies || [];

  // Fetch directives for selected strategy
  const directivesQuery = useQuery({
    queryKey: ['strategy-directives', selectedStrategy],
    queryFn: () => apiGet(`/api/strategies/${selectedStrategy}/directives`),
    enabled: !!selectedStrategy,
    staleTime: 15_000,
  });

  const strategyName = directivesQuery.data?.strategyName || '';
  const directives = directivesQuery.data?.directives || [];

  // Toggle directive mutation
  const toggleMutation = useMutation({
    mutationFn: ({ directiveId, active }) =>
      apiGet(`/api/strategies/${selectedStrategy}/directives/${directiveId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-directives', selectedStrategy] });
    },
  });

  function handleToggle(directiveId, currentActive) {
    toggleMutation.mutate({ directiveId, active: !currentActive });
  }

  const activeCount = directives.filter((d) => d.active).length;

  return (
    <div className="dc-page">
      <header className="dc-header">
        <div>
          <h1>Configure Directives</h1>
          <p>Select a strategy, then enable/disable individual directives. Changes persist to the database.</p>
        </div>
        <div className="dc-header-actions">
          <select
            className="pf-source-select"
            value={selectedStrategy || ''}
            onChange={(e) => setSelectedStrategy(e.target.value || null)}
            style={{ minWidth: 220 }}
          >
            <option value="">— Select a strategy —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </header>

      {strategiesQuery.isLoading && <LoadingSkeleton variant="card" count={3} />}

      {!selectedStrategy && !strategiesQuery.isLoading && (
        <EmptyState
          icon="📋"
          title="No strategy selected"
          description={strategies.length === 0
            ? 'No strategies found in the database. Run the strategy seeder or create one in Strategy Builder.'
            : 'Select a strategy above to configure its directives.'}
          actionLabel={strategies.length === 0 ? 'Create Strategy' : undefined}
          actionHref={strategies.length === 0 ? '/strategies/create-strategy' : undefined}
        />
      )}

      {selectedStrategy && directivesQuery.isLoading && <LoadingSkeleton variant="card" count={4} />}

      {selectedStrategy && !directivesQuery.isLoading && directives.length === 0 && (
        <EmptyState
          icon="📝"
          title="No directives configured"
          description={`"${strategyName}" has no directives linked. Directives are assigned when the strategy is created.`}
        />
      )}

      {selectedStrategy && directives.length > 0 && (
        <>
          <div className="dc-stats">
            <span>{activeCount}/{directives.length} active</span>
            <span className="dc-strategy-name">Strategy: {strategyName}</span>
          </div>

          <div className="dc-cards">
            {directives.map((d) => (
              <article key={d.id} className={`dc-card ${!d.active ? 'dc-card--disabled' : ''}`}>
                <div className="dc-card-header">
                  <div className="dc-card-title">
                    <h3>{d.name}</h3>
                    <code className="dc-id">{d.type || d.id}</code>
                    {d.isFork && <span className="dc-badge dc-badge--fork">Fork</span>}
                    {d.isDefault && <span className="dc-badge dc-badge--default">Default</span>}
                  </div>
                  <label className="dc-toggle">
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={() => handleToggle(d.id, d.active)}
                    />
                    <span className="dc-toggle-track">
                      <span className="dc-toggle-thumb" />
                    </span>
                    <span className="dc-toggle-label">{d.active ? 'Enabled' : 'Disabled'}</span>
                  </label>
                </div>

                <div className="dc-weight-row">
                  <span className="dc-weight-label">Weight: <strong>{d.active ? (d.weight ?? 0) : 0}%</strong></span>
                  {d.forkReason && <span className="dc-canonical-hint">Fork: {d.forkReason}</span>}
                </div>
              </article>
            ))}
          </div>

          <p className="dc-hint">
            Toggling directives on/off immediately affects scoring for this strategy. Weight adjustments coming in a future update.
          </p>
        </>
      )}
    </div>
  );
}
