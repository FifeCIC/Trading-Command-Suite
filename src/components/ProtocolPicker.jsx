import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

/**
 * ProtocolPicker — reusable protocol dropdown.
 *
 * Fetches from /api/scoring/protocols by default. Pass `protocols` to use
 * pre-fetched data instead (e.g. from /api/scoring/gated/protocols).
 *
 * Props:
 *   value        — currently selected protocol id (slug)
 *   onChange     — (protocolId: string) => void
 *   protocols    — pre-fetched protocol array (optional; auto-fetches if omitted)
 *   includeAll   — show an "All protocols" option (default false)
 *   placeholder  — placeholder text (default "— Select a protocol —")
 *   className    — additional CSS class
 *   disabled     — disable the dropdown
 *   filterFn     — optional filter: (p) => boolean
 */
export default function ProtocolPicker({
  value = '',
  onChange,
  protocols: preloadedProtocols,
  includeAll = false,
  placeholder = '— Select a protocol —',
  className = '',
  disabled = false,
  filterFn,
}) {
  const { data } = useQuery({
    queryKey: ['protocols', 'picker'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
    enabled: !preloadedProtocols, // skip fetch if protocols provided
  });

  const protocols = preloadedProtocols
    || (Array.isArray(data?.protocols) ? data.protocols : []);

  const filtered = filterFn ? protocols.filter(filterFn) : protocols;

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {includeAll && <option value="__all__">All protocols</option>}
      {filtered.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}
