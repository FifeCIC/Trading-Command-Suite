/**
 * Protocol scoring status — app-wide single source of truth for WHY a
 * protocol is (or isn't) scoring.
 * =========================================================================
 * The automation loop persists one row per active protocol every tick
 * (`protocol_score_status` table) and the backend merges it with registry
 * config in GET /api/scoring/gated/protocols/status.
 *
 * Any protocol view (ladder, performance, arena, meta-stack) should derive
 * its state badge from buildProtocolStatus() — never re-derive state from
 * scores, dashes, or the `active` flag alone.
 *
 * States (loop-owned):
 *   scoring    → Active   — scored symbols on the last tick
 *   standby    → Standby  — every venue it trades is closed; no fresh score is produced
 *                          (venue axis, 2026-09-19 — a closed market has no signal because
 *                          it has no fresh score, not because dispatch blocks it later)
 *   no-data    → Stalled  — symbols resolve but lack 5m bars
 *   no-symbols → Stalled  — no symbols configured at all
 *   paused     → Paused   — blocked by non-ready directives
 *   error      → Error    — scoring threw on the last tick
 *   (no row)   → Pending  — awaiting its first scoring tick
 *   active=0   → Disabled — turned off, not scored
 *
 * @created 2026-08-20 — protocol-status clarity (#666)
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api/client';

export const PROTOCOL_STATUS_META = {
  scoring: { label: 'Active', kind: 'ok', help: 'Scored symbols on the last tick' },
  standby: {
    label: 'Standby',
    kind: 'muted',
    help: 'Closed market — every venue this protocol trades is shut, so no fresh score is produced. The reason names the venue and its next open.',
  },
  'no-data': { label: 'Stalled', kind: 'warn', help: 'Active but no market data to score' },
  'no-symbols': { label: 'Stalled', kind: 'warn', help: 'Active but no symbols configured' },
  paused: { label: 'Paused', kind: 'warn', help: 'Blocked by non-ready directives' },
  error: { label: 'Error', kind: 'bad', help: 'Scoring failed on the last tick' },
  pending: { label: 'Pending', kind: 'muted', help: 'Awaiting its first scoring tick' },
  disabled: { label: 'Disabled', kind: 'muted', help: 'Turned off — not scored' },
};

/**
 * Derive the display status for a protocol.
 *
 * @param {object} protocol  Registry protocol entry ({ active, note }).
 * @param {object|null} statusRow  Loop-owned status row
 *   ({ state, reason, symbolsResolved, symbolsScored, lastTickAt }).
 * @returns {{ state: string, label: string, kind: string, help: string,
 *   reason: string|null, note: string|null,
 *   symbolsResolved: number|null, symbolsScored: number|null,
 *   lastTickAt: string|null }}
 */
export function buildProtocolStatus(protocol, statusRow) {
  const active = protocol?.active !== false;
  const state = !active
    ? 'disabled'
    : statusRow
      ? statusRow.state
      : 'pending';
  const meta = PROTOCOL_STATUS_META[state] ?? PROTOCOL_STATUS_META.pending;
  return {
    state,
    label: meta.label,
    kind: meta.kind,
    help: meta.help,
    reason: statusRow?.reason || null,
    note: protocol?.note || null,
    symbolsResolved: statusRow?.symbolsResolved ?? null,
    symbolsScored: statusRow?.symbolsScored ?? null,
    lastTickAt: statusRow?.lastTickAt || null,
  };
}

/**
 * Shared hook — fetch live scoring statuses for ALL protocols (incl. disabled).
 * Returns { statuses, statusMap, isLoading } where statusMap is keyed by
 * protocolId.
 */
export function useProtocolStatuses() {
  const q = useQuery({
    queryKey: ['protocol-statuses'],
    queryFn: () => apiGet('/api/scoring/gated/protocols/status').catch(() => ({ statuses: [] })),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const statusMap = {};
  for (const s of q.data?.statuses || []) statusMap[s.protocolId] = s;
  return { statuses: q.data?.statuses || [], statusMap, isLoading: q.isLoading };
}
