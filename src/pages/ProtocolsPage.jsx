/**
 * ProtocolsPage — the Protocols Registry route.
 *
 * ROUTE: `/protocols/protocols-registry`. The DESIGN lives in ProtocolsPageB.
 *
 * ⚠️ THE OLD DESIGN IS GONE (owner direction, 2026-10-08): *"Delete the old and accept the newer
 * design."* It lived inline in this file behind `?variant=A`, so the registry existed TWICE — two
 * copies of one page that drift apart, where only one gets the next fix. `?variant=A` is no longer
 * honoured; the old JSX and its ~230 lines are deleted, not left behind a flag.
 *
 * ⚠️ TWO THINGS THIS FILE STILL OWNS — do NOT fold them into ProtocolsPageB:
 *  1. `?proto=<id>` — cross-page links pre-select a protocol. Passed down as `initialProtocolId`.
 *  2. The load guard below. ProtocolsPageB renders a LOADING state but has NO error state, so
 *     without this a failed fetch renders an empty registry with no explanation — the "plausible
 *     output, no error" signature this repo keeps re-finding. The notice is a NOTICE (#826 Phase 5),
 *     not a bare `error.message`, so the status, code and remedy survive.
 *
 * ⚠️ THE GUARD SHARES REACT QUERY'S `['protocols-b']` KEY WITH ProtocolsPageB, so it is the SAME
 * request, not a second fetch. Rename the key in one place and you must rename it in the other, or
 * this silently becomes a duplicate fetch that can disagree with what the page renders.
 */
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import ProtocolsPageB from './ProtocolsPageB';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './protocols-page.css';

export default function ProtocolsPage() {
  const [searchParams] = useSearchParams();

  const protocolsQuery = useQuery({
    queryKey: ['protocols-b'],
    queryFn: () => apiGet('/api/scoring/gated/protocols'),
    staleTime: 30_000,
  });

  if (protocolsQuery.isLoading) {
    return (
      <div className="protocols-page">
        <div className="protocols-loading">Loading protocols…</div>
      </div>
    );
  }

  if (protocolsQuery.error) {
    return (
      <div className="protocols-page">
        <div className="protocols-error">
          <h2>Unable to load protocols</h2>
          <NoticeBlock notice={noticeFromError(protocolsQuery.error)} />
          <button onClick={() => protocolsQuery.refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  // ?proto=PROTOCOL_ID pre-selects a protocol (used by cross-page links).
  const initialProtocolId = searchParams.get('proto') || undefined;
  return <ProtocolsPageB initialProtocolId={initialProtocolId} />;
}
