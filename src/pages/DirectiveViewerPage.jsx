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
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import { directionModeLabel, signalTone } from '../core/signal-utils';
import './directive-viewer.css';

const READINESS_LABELS = { ready: 'READY', beta: 'BETA', alpha: 'ALPHA' };

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
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
          <h1>Directive Viewer<PageInfoPopover>Deep-dive on a single directive: metadata, recent scores, and the protocols that use it. Open via ?id=&lt;directiveId&gt;.</PageInfoPopover></h1>
        </header>
        <div className="dv-empty">
          <p>No directive selected.</p>
          <p className="dv-empty-hint">Open from a Protocol Trail directive row, or add <code>?id=&lt;directiveId&gt;</code> to this URL.</p>
        </div>
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
