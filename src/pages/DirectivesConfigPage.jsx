/**
 * DirectivesConfigPage
 * ====================
 * Protocol directive configuration. Pick a protocol, view its grouped directives,
 * and toggle them on/off. Changes persist to the database via PATCH.
 *
 * Route: /scoring/configure-directives
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ProtocolPicker from '../components/ProtocolPicker';
import './directives-config.css';

export default function DirectivesConfigPage() {
  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const queryClient = useQueryClient();

  // Fetch directives for selected protocol
  const directivesQuery = useQuery({
    queryKey: ['protocol-directives', selectedProtocol],
    queryFn: () => apiGet(`/api/scoring/protocols/${selectedProtocol}/directives`),
    enabled: !!selectedProtocol,
    staleTime: 15_000,
  });

  const protocol = directivesQuery.data?.protocol || null;
  const groups = directivesQuery.data?.groups || [];

  // Protocol usage check — is this protocol referenced by an enabled ScoringStrategy?
  const usageQuery = useQuery({
    queryKey: ['protocol-usage', selectedProtocol],
    queryFn: () => apiGet(`/api/scoring/protocols/${selectedProtocol}/usage`),
    enabled: !!selectedProtocol,
    staleTime: 30_000,
  });
  const usage = usageQuery.data || null;

  // Flatten groups into a single directives array for display
  const directives = groups.flatMap((g) =>
    (g.directives || []).map((d) => ({ ...d, groupId: g.groupId, groupName: g.name, isRiskGate: g.isRiskGate }))
  );

  // Remove directive mutation
  const removeMutation = useMutation({
    mutationFn: ({ directiveId }) =>
      apiGet(`/api/scoring/protocols/${selectedProtocol}/directives/${directiveId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['protocol-directives', selectedProtocol] });
    },
  });

  function handleRemove(directiveId) {
    if (usage?.inUse) return; // locked — can't remove while strategy is active
    removeMutation.mutate({ directiveId });
  }

  const activeCount = directives.filter((d) => d.active).length;

  return (
    <div className="dc-page">
      <header className="dc-header">
        <div>
          <h1>Protocol Directive Editor</h1>
          <p>Select a protocol to curate its directives, grouped by category. Directives removed from a protocol will not run during scoring.</p>
        </div>
        <div className="dc-header-actions">
          <ProtocolPicker
            className="pf-source-select"
            value={selectedProtocol || ''}
            onChange={(id) => setSelectedProtocol(id || null)}
            style={{ minWidth: 220 }}
          />
        </div>
      </header>

      {!selectedProtocol && (
        <EmptyState
          icon="📋"
          title="No protocol selected"
          description="Select a protocol above to configure its directives."
        />
      )}

      {selectedProtocol && directivesQuery.isLoading && <LoadingSkeleton variant="card" count={4} />}

      {selectedProtocol && !directivesQuery.isLoading && directives.length === 0 && (
        <EmptyState
          icon="📝"
          title="No directives configured"
          description={`"${protocol?.name || selectedProtocol}" has no directives linked. Directives are assigned when the protocol is created.`}
        />
      )}

      {selectedProtocol && directives.length > 0 && (
        <>
          <div className="dc-stats">
            <span>{activeCount}/{directives.length} active</span>
            <span className="dc-strategy-name">
              Protocol: {protocol?.name || selectedProtocol}
              {protocol?.version && <span className="dc-version">v{protocol.version}</span>}
              {usage?.inUse && (
                <a href={`/trading/trading-bots`} className="dc-lock-icon" title={`In use by ${usage.strategyNames?.join(', ') || 'active strategy'} — click to view`}>
                  🔒
                </a>
              )}
            </span>
          </div>

          {groups.map((group) => {
            const groupDirectives = (group.directives || []).map((d) => ({
              ...d,
              groupId: group.groupId,
              groupName: group.name,
              isRiskGate: group.isRiskGate,
            }));

            if (groupDirectives.length === 0) return null;

            return (
              <div key={group.groupId} className="dc-group">
                <h2 className="dc-group-title">
                  {group.name}
                  {group.isRiskGate && <span className="dc-badge dc-badge--risk">Risk Gate</span>}
                  {group.description && <span className="dc-group-desc">{group.description}</span>}
                </h2>

                <div className="dc-cards">
                  {groupDirectives.map((d) => (
                    <article key={d.id} className={`dc-card ${!d.active ? 'dc-card--disabled' : ''}`}>
                      <div className="dc-card-header">
                        <div className="dc-card-title">
                          <h3>{d.name}</h3>
                          <code className="dc-id">{d.id}</code>
                        </div>
                        <button
                          className="dc-remove-btn"
                          onClick={() => handleRemove(d.id)}
                          disabled={usage?.inUse}
                          title={usage?.inUse ? 'Protocol is locked — in use by an active strategy' : 'Remove this directive from the protocol'}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="dc-weight-row">
                        <span className="dc-weight-label">Max Score: <strong>{d.maxScore ?? 100}</strong></span>
                        {d.description && <span className="dc-canonical-hint">{d.description}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}

          <p className="dc-hint">
            Removing a directive prevents it from running during scoring for this protocol. Inactive protocols are hidden from the list.
          </p>
        </>
      )}
    </div>
  );
}
