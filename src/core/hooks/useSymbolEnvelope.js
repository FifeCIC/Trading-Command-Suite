/**
 * useSymbolEnvelope() — resolve which protocols score a symbol, then fetch the envelope(s).
 * =========================================================================================
 * Created 2026-09-21 for #925. THREE pages called `GET /api/signals/envelope/:symbol` with no
 * protocol and received `400 TCS-SYS-002`, so each rendered an empty card with no explanation:
 *
 *   src/pages/SymbolPage.jsx                  (#921 — already fixed inline; can adopt this hook)
 *   src/pages/AutomationDashboardPage.jsx     (#925 — directive breakdown, always empty)
 *   src/pages/ScoringActivityLogsPage.jsx     (#925 — directive trace, always empty)
 *
 * ⚠️ WHY THIS IS A HOOK AND NOT THREE INLINE QUERIES. "Which protocol scores this symbol?" is not
 * answerable from the caller — the symbol does not carry it. It must be RESOLVED first, and the
 * resolution has a specific source:
 *
 *   `GET /api/symbols/:ticker/protocols`  <-- DO NOT USE. It is a dead endpoint: it filters on
 *   `config.symbols`, which no row of the `strategy` table populates, so it answers
 *   `{"protocols":[],"count":0}` for EVERY symbol, forever. Measured 2026-09-21. See #926.
 *
 *   `GET /api/symbols/:ticker/focus`      <-- USE THIS. Returns `protocols` as an object keyed by
 *   protocol id, derived from bot subscriptions. Verified: 4 protocols for XAUUSD, 1 for USDCAD.
 *
 * ⚠️ A SYMBOL USUALLY HAS SEVERAL PROTOCOLS, and they can disagree. XAUUSD scores under FIVE at
 * once. So this hook never hides that: it returns the full list, and the single-envelope form
 * (`envelope` + `protocolId`) always NAMES the protocol it used. An unlabelled score is not
 * attributable — that is the defect #921 exists to fix, and repeating it here would be the same
 * mistake in a new place.
 *
 * ⚠️ A FAILED REQUEST MUST NOT RENDER AS "NO DATA". Callers get `isError` and `error` separately
 * from an empty result, so a refusal can be shown as a refusal (with its `TCS-*` code) rather than
 * as an empty card. Collapsing those two is how the original 400 stayed invisible.
 *
 * Query-key note: keyed the same way as SymbolPage's own queries so visiting both costs one request.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
// ⚠️ `../api/client` — this file lives in `src/core/hooks/`, so `..` is `src/core`. Writing
// `../core/api/client` resolves to `src/core/core/api/client` and fails the build with
// UNRESOLVED_IMPORT. The sibling hooks in this folder use the same one-level-up form.
import { apiGet } from '../api/client';

/**
 * @param {string} symbol            ticker, any case
 * @param {object} [options]
 * @param {number} [options.limit]   cap the number of protocols fetched (default: all)
 * @returns {{
 *   protocolIds: string[],          every protocol that scores this symbol
 *   envelopes: Array<{protocolId, meta, env, query}>,   one entry per protocol, each labelled
 *   envelope: object|null,          convenience: the FIRST protocol's envelope
 *   protocolId: string|null,        convenience: WHICH protocol `envelope` came from
 *   isLoading: boolean,             the resolve step or any envelope is still in flight
 *   isError: boolean, error: unknown,
 * }}
 */
export function useSymbolEnvelope(symbol, options = {}) {
  const upper = (symbol || '').toUpperCase();
  const { limit } = options;

  // ── 1. Resolve the protocol list — `/focus`, NOT the dead `/protocols` endpoint ──
  const focusQuery = useQuery({
    queryKey: ['symbol-focus', upper],
    queryFn: () => apiGet(`/api/symbols/${upper}/focus`),
    enabled: !!upper,
    staleTime: 60_000,
    retry: 1,
  });

  // `/focus` returns `protocols` as an OBJECT keyed by protocol id, so the keys are the ids.
  const allProtocolIds = Object.keys(focusQuery.data?.protocols || {});
  const protocolIds = limit ? allProtocolIds.slice(0, limit) : allProtocolIds;

  // ── 2. One envelope per protocol. Several protocols must not be collapsed into one number. ──
  const envelopeQueries = useQueries({
    queries: protocolIds.map((protocolId) => ({
      queryKey: ['symbol-envelope', upper, protocolId],
      queryFn: () =>
        apiGet(`/api/signals/envelope/${upper}?protocol=${encodeURIComponent(protocolId)}`),
      enabled: !!upper && !!protocolId,
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const envelopes = protocolIds.map((protocolId, i) => ({
    protocolId,
    meta: focusQuery.data?.protocols?.[protocolId] || {},
    query: envelopeQueries[i],
    env: envelopeQueries[i]?.data ?? null,
  }));

  const firstWithData = envelopes.find((e) => e.env) ?? null;
  const firstError = envelopes.find((e) => e.query?.isError)?.query?.error ?? null;

  return {
    protocolIds,
    envelopes,
    // The single-envelope convenience form. `protocolId` is NOT optional — a caller that shows
    // `envelope` without it is showing an unattributable number.
    envelope: firstWithData?.env ?? null,
    protocolId: firstWithData?.protocolId ?? null,
    isLoading:
      focusQuery.isLoading ||
      (protocolIds.length > 0 && envelopeQueries.some((q) => q.isLoading)),
    // Surfaced in preference to "no data". If the resolve failed, that is the error to report.
    isError: focusQuery.isError || (envelopeQueries.length > 0 && envelopeQueries.every((q) => q.isError)),
    error: focusQuery.error ?? firstError,
    focusQuery,
  };
}
