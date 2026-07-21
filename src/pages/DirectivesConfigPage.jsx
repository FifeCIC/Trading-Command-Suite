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

  // Flatten groups into a single directives array for display
  const directives = groups.flatMap((g) =>
    (g.directives || []).map((d) => ({ ...d, groupId: g.groupId, groupName: g.name, isRiskGate: g.isRiskGate }))
  );

  // Toggle directive mutation
  const toggleMutation = useMutation({
    mutationFn: ({ directiveId, active }) =>
      apiGet(`/api/scoring/protocols/${selectedProtocol}/directives/${directiveId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['protocol-directives', selectedProtocol] });
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
          <h1>Protocol Directive Editor</h1>
          <p>Select a protocol, then enable/disable its individual directives grouped by category. Changes persist to the database.</p>
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
            <span className="dc-strategy-name">Protocol: {protocol?.name || selectedProtocol}</span>
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
            Toggling directives on/off affects scoring for this protocol. The directive will be skipped during scoring when disabled.
          </p>
        </>
      )}
    </div>
  );
}
