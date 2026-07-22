/**
 * ProtocolChecklist — multi-select checkbox list for scoring protocols.
 *
 * Props:
 *   selected   — array of currently selected protocol IDs
 *   onChange   — called with updated array of protocol IDs
 *   className  — optional wrapper class
 *   maxHeight  — max height for scroll (default: 300px)
 *
 * Behavior:
 *   - Fetches available protocols from GET /api/scoring/protocols
 *   - Shows checkboxes for each protocol (filtered to code-based)
 *   - "Select All" / "Deselect All" buttons
 *   - Loading skeleton while fetching
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './protocol-checklist.css';

export default function ProtocolChecklist({
  selected = [],
  onChange,
  className = '',
  maxHeight = 300,
}) {
  const protoQuery = useQuery({
    queryKey: ['protocol-checklist'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });

  const protocols = useMemo(() => {
    const list = protoQuery.data?.protocols ?? [];
    return list;
  }, [protoQuery.data]);

  const allSelected = protocols.length > 0 && selected.length === protocols.length;
  const someSelected = selected.length > 0 && selected.length < protocols.length;

  const toggleProtocol = (protocolId) => {
    const next = selected.includes(protocolId)
      ? selected.filter(id => id !== protocolId)
      : [...selected, protocolId];
    onChange?.(next);
  };

  const selectAll = () => onChange?.(protocols.map(p => p.id));
  const deselectAll = () => onChange?.([]);

  if (protoQuery.isLoading) {
    return (
      <div className={`pc-wrap pc-loading ${className}`}>
        <span className="pc-loading-text">Loading protocols…</span>
      </div>
    );
  }

  if (protocols.length === 0) {
    return (
      <div className={`pc-wrap pc-empty ${className}`}>
        <span className="pc-empty-text">No protocols available</span>
      </div>
    );
  }

  return (
    <div className={`pc-wrap ${className}`}>
      <div className="pc-header">
        <span className="pc-title">Protocols</span>
        <span className="pc-count">{selected.length}/{protocols.length}</span>
        <button
          type="button"
          className="pc-action-btn"
          onClick={allSelected ? deselectAll : selectAll}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      <div className="pc-list" style={{ maxHeight }}>
        {protocols.map(p => (
          <label key={p.id} className={`pc-item ${selected.includes(p.id) ? 'pc-checked' : ''}`}>
            <input
              type="checkbox"
              className="pc-checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggleProtocol(p.id)}
            />
            <span className="pc-item-name">{p.name ?? p.id}</span>
            <span className="pc-item-slug">{p.id}</span>
          </label>
        ))}
      </div>
      {someSelected && (
        <div className="pc-footer">
          <button type="button" className="pc-clear-btn" onClick={deselectAll}>
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
