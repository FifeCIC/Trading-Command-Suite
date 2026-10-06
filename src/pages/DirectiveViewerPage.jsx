/**
 * Directive Viewer — deep-dive on a single directive.
 * =====================================================================
 * Shows a directive's metadata, its recent per-run scores, and the
 * protocols that include it. Deep-linked from Protocol Trail directive
 * rows via `?id=<directiveId>` (the directive registry ID, e.g.
 * "liquidity-check").
 *
 * Data: GET /api/directives/:id/viewer — one shot for the whole page.
 */
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import { directionModeLabel, signalTone } from '../core/signal-utils';
import { formatTimestamp } from '../core/format-utils';
import './directive-viewer.css';

const READINESS_LABELS = { ready: 'READY', beta: 'BETA', alpha: 'ALPHA' };

/**
 * DirectivePicker — the page's ENTRY POINT, and the search the owner asked for.
 *
 * ⚠️ WHY IT EXISTS (Page Walkthrough 2026-10-01, fixed 2026-10-06).
 * Owner: *"This page does not load anything and I think its meant to offer a breakdown of directives.
 * Ability to search directives."* The endpoint was fine — `GET /api/directives/:id/viewer` returns a
 * full payload (readiness, nature, directionBias, requiredDataFeeds, scores, protocols). What was
 * missing was a way IN: the page read `?id=` and nothing else, so opening it from the navigation
 * produced "No directive selected" and no route forward. It was reachable only from a Protocol Trail
 * row, i.e. only if you already knew it existed. (The same defect as Single Symbol, fixed the same day.)
 *
 * ⚠️ THREE STATES, RENDERED DIFFERENTLY: still loading, list unreadable, and no match. Collapsing
 * them would make a failed request look like a directive registry that happened to be empty.
 */
function DirectivePicker({ currentId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [term, setTerm] = useState('');

  const list = useQuery({
    queryKey: ['directives-for-picker'],
    queryFn: () => apiGet('/api/directives').catch(() => null),
    staleTime: 300_000,
  });

  // The endpoint has returned both a bare array and a wrapped object at different times; accept both
  // rather than betting on one — a shape bet here renders an empty page that looks like "no data".
  const raw = list.data;
  const all = Array.isArray(raw) ? raw : (raw?.directives ?? raw?.items ?? []);
  const q = term.trim().toLowerCase();
  const shown = (
    q
      ? all.filter((d) =>
          `${d?.id ?? ''} ${d?.name ?? ''} ${d?.category ?? ''}`.toLowerCase().includes(q),
        )
      : all
  ).slice(0, 12);

  const choose = (directiveId) => {
    const next = new URLSearchParams(searchParams);
    next.set('id', directiveId);
    setSearchParams(next);
  };

  return (
    <div className="dv-picker">
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search directives by name, id or category…"
        aria-label="Search directives"
      />
      {list.isLoading ? (
        <p className="dv-empty-hint">Loading directives…</p>
      ) : all.length === 0 ? (
        <p className="dv-empty-hint">
          Could not read the directive list — the API did not answer. This is NOT &quot;no directives
          exist&quot;.
        </p>
      ) : shown.length === 0 ? (
        <p className="dv-empty-hint">No directive matches “{term}”.</p>
      ) : (
        <ul className="dv-picker-list">
          {shown.map((d) => {
            const directiveId = d?.id ?? d?.directiveId ?? '';
            if (!directiveId) return null;
            return (
              <li key={directiveId}>
                <button
                  type="button"
                  className={directiveId === currentId ? 'dv-picker-item is-current' : 'dv-picker-item'}
                  onClick={() => choose(directiveId)}
                >
                  <span className="dv-picker-name">{d?.name ?? directiveId}</span>
                  <span className="dv-picker-cat">{d?.category ?? directiveId}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DirectiveViewerPage() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';

  const query = useQuery({
    queryKey: ['directive-viewer', id],
    queryFn: () =>
      id
        ? apiGet(`/api/directives/${encodeURIComponent(id)}/viewer`).catch(() => null)
        : Promise.resolve(null),
    enabled: !!id,
  });

  const data = query.data;
  const isLoading = query.isLoading && !data;

  if (!id) {
    return (
      <div className="dv-page">
        <header className="dv-header">
          <h1>Directive Viewer<PageInfoPopover>Deep-dive on a single directive: metadata, recent scores, and the protocols that use it. Search below, or open via ?id=&lt;directiveId&gt;.</PageInfoPopover></h1>
        </header>
        <DirectivePicker currentId="" />
      </div>
    );
  }

  if (isLoading) {
    return <div className="dv-page"><LoadingSkeleton variant="card" count={3} /></div>;
  }

  if (!data || data.error) {
    return (
      <div className="dv-page">
        <header className="dv-header"><h1>Directive Viewer</h1></header>
        <div className="dv-empty">
          <p>Directive <code>{id}</code> not found.</p>
          <p className="dv-empty-hint">Check the ID — it must match the directive registry ID.</p>
        </div>
      </div>
    );
  }

  const readiness = READINESS_LABELS[data.readiness] || (data.readiness || 'ALPHA').toUpperCase();

  return (
    <div className="dv-page">
      <header className="dv-header">
        <h1>Directive Viewer<PageInfoPopover>Single-directive deep-dive — metadata, live score history, and the protocols that include it.</PageInfoPopover></h1>
      </header>

      {/* The picker stays available once a directive is chosen, so switching does not mean editing
          the URL by hand. `currentId` marks the one you are looking at. */}
      <DirectivePicker currentId={id} />

      {/* ── Identity ── */}
      <section className="dv-card dv-identity">
        <div className="dv-identity-head">
          <h2>{data.name}</h2>
          <div className="dv-identity-badges">
            <span className={`dv-badge dv-badge--${data.active !== false ? 'active' : 'inactive'}`}>
              {data.active !== false ? 'active' : 'inactive'}
            </span>
            <span className={`dv-badge dv-badge--readiness dv-badge--readiness-${data.readiness || 'alpha'}`}>{readiness}</span>
            {data.nature && <span className="dv-badge dv-badge--nature">{data.nature}</span>}
          </div>
        </div>
        <p className="dv-code">{data.id}</p>
        <p className="dv-description">{data.description || data.formula || 'No description available.'}</p>
      </section>

      {/* ── Metadata grid ── */}
      <section className="dv-card">
        <h3 className="dv-section-title">Metadata</h3>
        <div className="dv-meta-grid">
          <div className="dv-meta-item"><span>Category</span><strong>{data.category}</strong></div>
          <div className="dv-meta-item"><span>Priority</span><strong>{data.priority ?? '—'}</strong></div>
          <div className="dv-meta-item"><span>Max score</span><strong>{data.maxScore ?? '—'}</strong></div>
          <div className="dv-meta-item"><span>Direction bias</span><strong>{data.directionBias ?? '—'}</strong></div>
          <div className="dv-meta-item"><span>Version</span><strong>{data.version ?? '—'}</strong></div>
          <div className="dv-meta-item"><span>Protocols</span><strong>{data.protocolCount}</strong></div>
        </div>
        {data.formula && data.formula !== data.description && (
          <div className="dv-formula">
            <span className="dv-section-title">Formula</span>
            <p>{data.formula}</p>
          </div>
        )}
        {Array.isArray(data.requiredDataFeeds) && data.requiredDataFeeds.length > 0 && (
          <div className="dv-feeds">
            <span className="dv-section-title">Data feeds</span>
            <div className="dv-feed-tags">
              {data.requiredDataFeeds.map((f) => <span key={f} className="dv-badge dv-badge--feed">{f}</span>)}
            </div>
          </div>
        )}
      </section>

      {/* ── Recent scores ── */}
      <section className="dv-card">
        <h3 className="dv-section-title">Recent scores <span className="dv-count">({data.scoreCount})</span></h3>
        {!Array.isArray(data.scores) || data.scores.length === 0 ? (
          <p className="dv-muted">No recent scores recorded for this directive.</p>
        ) : (
          <div className="dv-table-wrap">
            <table className="dv-table">
              <thead>
                <tr><th>Symbol</th><th>Protocol</th><th>Score</th><th>Signal</th><th>Time</th></tr>
              </thead>
              <tbody>
                {data.scores.slice(0, 50).map((s, i) => (
                  <tr key={`${s.timestamp}-${s.symbol}-${i}`}>
                    <td className="dv-mono">{s.symbol || '—'}</td>
                    <td>
                      {s.protocol ? (
                        <Link className="dv-link" to={`/protocols/protocol-trail?symbol=${encodeURIComponent(s.symbol || '')}&protocol=${encodeURIComponent(s.protocol)}`}>{s.protocol}</Link>
                      ) : '—'}
                    </td>
                    <td className="dv-mono">{s.score}{s.maxScore != null ? <span className="dv-score-max"> / {s.maxScore}</span> : null}</td>
                    <td>
                      {s.signal ? (
                        <span className={`dv-signal dv-signal--${signalTone(s.signal)}`}>{s.signal}</span>
                      ) : '—'}
                    </td>
                    <td className="dv-muted">{formatTimestamp(s.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Used in protocols ── */}
      <section className="dv-card">
        <h3 className="dv-section-title">Used in protocols <span className="dv-count">({data.protocolCount})</span></h3>
        {!Array.isArray(data.protocols) || data.protocols.length === 0 ? (
          <p className="dv-muted">This directive is not linked to any protocol.</p>
        ) : (
          <div className="dv-proto-list">
            {data.protocols.map((p) => (
              <div key={p.slug} className="dv-proto-card">
                <div className="dv-proto-head">
                  <Link className="dv-link dv-proto-name" to={`/protocols/protocol-trail?protocol=${encodeURIComponent(p.slug)}`}>{p.name}</Link>
                  <span className="dv-badge dv-badge--nature">{directionModeLabel(p.directionMode)}</span>
                </div>
                <p className="dv-mono dv-proto-slug">{p.slug}</p>
                <div className="dv-proto-groups">
                  {p.groups.map((g) => (
                    <span key={g.groupId} className="dv-badge dv-badge--feed">
                      {g.groupId}{g.isRiskGate ? ' · risk gate' : ''} · {g.maxScore}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
