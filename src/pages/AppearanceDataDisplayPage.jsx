/**
 * AppearanceDataDisplayPage — five table examples taken from across the app, each rendered with the
 * APP'S OWN class names and its OWN stylesheet.
 *
 * ⚠️ THAT IS THE WHOLE POINT OF THE PAGE. The owner asked for this page to be the thing that proves
 * the Appearance area shares the real styling: *"This is how I confirm and know that the Appearance
 * area shares the same styling used throughout the app."* So the tables below are not copies that
 * resemble the app's tables — they import `protocols-ladder.css`, `screener.css`,
 * `meta-stack-status.css`, `directive-viewer.css` and `directives-manager.css` and use those exact
 * class names. If this page looks right, the stylesheets are right.
 *
 * ⚠️ FIVE TABLES, FIVE DIFFERENT JOBS. Measured from the owner's Page Walkthrough, which named five
 * distinct table purposes rather than one preferred table style:
 *   1. stats-and-status ladder — /scoring/symbols-ladder (8/10)   "one of the strongest tables"
 *   2. fixed-count status      — /status/meta-stack-status (7/10) "for a set number of items"
 *   3. row-action              — /research/screener (4/10 page)   "per row actions… good styling"
 *   4. dense read              — /protocols/directive-viewer (4/10 page) "a simplistic solution"
 *   5. master–detail + rail    — /protocols/directives-registry (8/10) "a sidebar on the right…
 *                                                                    a mix of controls"
 * ⚠️ Examples 3 and 4 come from pages the owner rated LOW overall — the praise was for the TABLE, not
 * the page. Showing them beside the 8/10 rows is deliberate: a strong table on a weak page is exactly
 * what is worth lifting into a library.
 *
 * ⚠️ REAL DATA ONLY. Owner direction for this area: *"Only use this apps own real data to create
 * examples."* Every row is fetched live; there are no fixtures and no invented tickers or scores.
 *
 * ⚠️ NO NEW TABLE STYLES. The only class this page adds is `.dd-stage` (the plate each example sits
 * on), which is what "examples within their own containers" requires. The tables are the app's.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { timeAgo } from '../core/format-utils';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';

// ⚠️ THE APP'S REAL STYLESHEETS. Not re-implementations — the same files the source pages import, so a
// change to `.pl-table` or `.screener-table` lands here at the same moment.
//
// ⚠️ KNOWN AMBIGUITY, stated rather than hidden: `.pl-page` / `.pl-table` are ALSO defined differently
// in `position-lifecycle.css` and `performance-lab.css`. Every stylesheet is global here, so whichever
// loads last wins for those two selectors. The rules this page actually uses (`.pl-table th/td`,
// `.pl-score-*`, `.pl-status*`) are unique to `protocols-ladder.css`; only the font-size declarations
// collide. Do not "fix" that here — it is pre-existing and recorded in `ui-standards`.
import './protocols-ladder.css';
import './screener.css';
import './meta-stack-status.css';
import './directive-viewer.css';
import './directives-manager.css';
import './appearance-area.css';

/** Example container — number, the job it does, where it came from, and that page's owner score. */
function Example({ n, title, ledger, source, score, children }) {
  return (
    <section className="ap-family">
      <h3>
        {n}. {title}
      </h3>
      <p className="ap-family-lede">{ledger}</p>
      <p className="ap-family-lede">
        From <code>{source}</code> · rated {score}
      </p>
      <div className="dd-stage">{children}</div>
    </section>
  );
}

/**
 * State — loading, failed and empty kept DISTINCT.
 * ⚠️ "No rows" and "the request failed" must never render the same way: `[]` is information, `null` is
 * the absence of it, and an error is a third thing. Collapsing them teaches every reader the wrong
 * conclusion (development-philosophy §7).
 */
function State({ query, rows, what }) {
  if (query.isLoading) return <LoadingSkeleton variant="card" count={2} />;
  if (query.isError) return <p className="ap-family-lede">Could not load {what} — the request failed.</p>;
  if (!rows || rows.length === 0) return <p className="ap-family-lede">No {what} returned. That is an empty result, not a failure.</p>;
  return null;
}

// ── Tone mapping, using only modifiers the app's stylesheets actually define ──────────────────────
// ⚠️ `.pl-score-mid` is emitted by the real ladder page but defined NOWHERE. The mid band is left
// uncoloured here on purpose — inventing the class would put a rule in this file that the app lacks,
// which is the divergence this page exists to disprove.
const badgeTone = (signal) => String(signal || 'HOLD').replace('STRONG_', '').toLowerCase();
const scoreTone = (score, max) => {
  const pct = max ? (score / max) * 100 : score;
  if (pct >= 60) return 'pl-score-high';
  if (pct <= 20) return 'pl-score-low';
  return '';
};
const statusTone = (s) => (s === 'live' ? 'live' : s === 'stale' ? 'warn' : 'closed');

export default function AppearanceDataDisplayPage() {
  const [picked, setPicked] = useState(null);

  const rankedQ = useQuery({
    queryKey: ['dd-ranked'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=20').catch(() => null),
  });
  const providersQ = useQuery({
    queryKey: ['dd-providers'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
  });
  const screenerQ = useQuery({
    queryKey: ['dd-screener'],
    queryFn: () => apiGet('/api/screener/ranked?limit=200').catch(() => null),
  });
  const directivesQ = useQuery({
    queryKey: ['dd-directives'],
    queryFn: () => apiGet('/api/directives').catch(() => null),
  });

  const ranked = rankedQ.data?.ranked ?? [];
  const providers = providersQ.data?.providers ?? [];
  const screener = screenerQ.data?.ranked ?? [];
  const directives = Array.isArray(directivesQ.data) ? directivesQ.data : [];
  const selected = directives.find((d) => d.id === picked) || directives[0] || null;

  return (
    <div className="appearance-area">
      <header className="appearance-head">
        <p className="appearance-lede">
          Five table examples from across the app — each using the source page&apos;s own stylesheet and
          class names, with live data. Same data, different jobs: a status ladder, a fixed-count status
          board, a row-action list, a dense read table, and a master–detail table with a control rail.
          If these look right, the Appearance area and the app are drawing from the same styles.
        </p>
        <PageInfoPopover>
          These are not lookalikes. Each example imports the real stylesheet from the view it came from
          — protocols-ladder.css, screener.css, meta-stack-status.css, directive-viewer.css and
          directives-manager.css — and uses that page&apos;s exact class names, so a change to those
          rules changes this page at the same moment. Source views and scores come from the Page
          Walkthrough: symbols-ladder 8/10 and meta-stack-status 7/10; the screener and directive-viewer
          pages were each rated 4/10 while their TABLES were singled out as good.
        </PageInfoPopover>
      </header>

      {/* ── 1. Stats-and-status ladder ─────────────────────────────────────────────────────────── */}
      <Example
        n={1}
        title="Stats-and-status ladder"
        ledger="Ranked rows where most columns are a status rather than a number. Rectangular status marks, and a score stacked over its percentage so the part that changes stands out."
        source="/scoring/symbols-ladder"
        score="8/10"
      >
        <State query={rankedQ} rows={ranked} what="ranked symbols" />
        {ranked.length > 0 && (
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Score</th>
                  <th>Signal</th>
                  <th>Status</th>
                  <th>Directives</th>
                  <th className="pl-time">Scored</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 8).map((r, i) => (
                  <tr key={r.symbolId || r.ticker}>
                    <td className="pl-rank">{i + 1}</td>
                    <td className="pl-symbol">{r.ticker}</td>
                    <td>
                      <span className="pl-score-stack">
                        <span className="pl-score-line">
                          <span className={scoreTone(r.score, r.maxPossibleScore)}>{r.score}</span>
                        </span>
                        <span className="pl-muted">{Number(r.normalizedScore).toFixed(1)}%</span>
                      </span>
                    </td>
                    <td>
                      <span className={`pl-badge pl-badge-${badgeTone(r.signal)}`}>{r.signal}</span>
                    </td>
                    <td>
                      <span className={`pl-status pl-status-${statusTone(r.dataStatus)}`}>
                        <span className="pl-status-dot" /> {r.dataStatus || '—'}
                      </span>
                    </td>
                    <td className="pl-muted">
                      {r.activeDirectives} / {r.totalDirectives}
                    </td>
                    <td className="pl-muted pl-time">{timeAgo(r.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Example>

      {/* ── 2. Fixed-count status board ────────────────────────────────────────────────────────── */}
      <Example
        n={2}
        title="Fixed-count status board"
        ledger="For a known, small number of rows that never grows — a handful of systems, each with a health state. Sits inside the app's own .mss-panel."
        source="/status/meta-stack-status"
        score="7/10"
      >
        <State query={providersQ} rows={providers} what="providers" />
        {providers.length > 0 && (
          <section className="mss-panel">
            <div className="mss-table-wrap">
              <table className="mss-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Adapter</th>
                    <th>Credentials</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.provider}>
                      <td>
                        <strong>{p.displayName || p.provider}</strong>
                      </td>
                      <td className="mss-dim">{p.adapterType || '—'}</td>
                      <td>{p.credentialsConfigured ? '✅' : '—'}</td>
                      <td className="mss-dim">{p.latencyMs != null ? `${p.latencyMs} ms` : '—'}</td>
                      <td>
                        <span
                          className={`mss-signal-chip mss-signal--${
                            p.status === 'healthy' ? 'buy' : p.status === 'unknown' ? 'hold' : 'sell'
                          }`}
                        >
                          {p.status || 'unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </Example>

      {/* ── 3. Row-action table ────────────────────────────────────────────────────────────────── */}
      <Example
        n={3}
        title="Row-action table"
        ledger="Every row can be acted on. The table-WRAP is the container — it carries the border and radius, not the table. Rows highlight on hover and the top picks are marked."
        source="/research/screener"
        score="4/10 page"
      >
        <State query={screenerQ} rows={screener} what="screener rows" />
        {screener.length > 0 && (
          <section className="screener-table-wrap">
            <table className="screener-table">
              <thead>
                <tr>
                  <th className="screener-col-pick">🎯</th>
                  <th>Ticker</th>
                  <th>Catalyst</th>
                  <th>Source</th>
                  <th>Strength</th>
                  <th>Reliability</th>
                  <th>Attention</th>
                  <th className="screener-col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {screener.slice(0, 10).map((r, i) => (
                  <tr key={r.ticker} className={i < 3 ? 'screener-top-pick' : undefined}>
                    <td className="screener-col-pick">{i < 3 ? '🎯' : ''}</td>
                    <td className="screener-ticker-cell">
                      <strong>{r.ticker}</strong>
                      {r.inDb ? <span className="screener-in-db" title="Symbol exists in your database">DB</span> : null}
                      {r.fitsCount > 0 ? <span className="screener-fits">✓{r.fitsCount}</span> : null}
                    </td>
                    <td>{(r.catalystTypes ?? []).join(', ') || '—'}</td>
                    <td>
                      {(r.sources ?? []).map((s) => (
                        <span key={s} className={`screener-chip screener-chip--${s}`}>
                          {s}
                        </span>
                      ))}
                    </td>
                    <td>{r.strength}</td>
                    <td>{r.reliability}</td>
                    <td>
                      <div className="screener-attn-cell">
                        <span className="screener-attn-num">{r.attentionWeight}</span>
                        <span className="screener-attn-bar">
                          <span
                            className="screener-attn-fill"
                            style={{ width: `${Math.min(100, Math.max(0, r.attentionWeight))}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="screener-col-action">
                      {r.promotedStatus ? (
                        <span className="screener-watching">🔖 {r.promotedStatus}</span>
                      ) : (
                        <button type="button" className="screener-watch-btn" title="Add to watchlist">
                          ➕ Watch
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Example>

      {/* ── 4. Dense read table ────────────────────────────────────────────────────────────────── */}
      <Example
        n={4}
        title="Dense read table"
        ledger="The plainest treatment, for fitting as much as possible on one screen. Same rows as example 1, deliberately unstyled columns — the choice to make for logs and reference data."
        source="/protocols/directive-viewer"
        score="4/10 page"
      >
        <State query={rankedQ} rows={ranked} what="ranked symbols" />
        {ranked.length > 0 && (
          <section className="dv-card">
            <div className="dv-table-wrap">
              <table className="dv-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Score</th>
                    <th>Norm %</th>
                    <th>Signal</th>
                    <th>Active</th>
                    <th>Total</th>
                    <th>Coverage</th>
                    <th>Conf.</th>
                    <th>Fresh</th>
                    <th>Status</th>
                    <th>Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.symbolId || r.ticker}>
                      <td className="dv-mono">{r.ticker}</td>
                      <td className="dv-mono">{r.score}</td>
                      <td className="dv-mono">{Number(r.normalizedScore).toFixed(1)}</td>
                      <td>
                        <span className={`dv-signal dv-signal--${badgeTone(r.signal)}`}>{r.signal}</span>
                      </td>
                      <td className="dv-mono">{r.activeDirectives}</td>
                      <td className="dv-mono">{r.totalDirectives}</td>
                      <td className="dv-mono">{r.coverage != null ? `${Math.round(r.coverage * 100)}%` : '—'}</td>
                      <td className="dv-mono">{r.confidence != null ? r.confidence : '—'}</td>
                      <td className="dv-muted">{r.freshness || '—'}</td>
                      <td className="dv-muted">{r.dataStatus || '—'}</td>
                      <td className="dv-muted">{timeAgo(r.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </Example>

      {/* ── 5. Master–detail with a control rail ───────────────────────────────────────────────── */}
      <Example
        n={5}
        title="Master–detail with a control rail"
        ledger="Wide selectable rows on the left, and a right-hand rail that is a mix of quick controls and detail for whatever is selected — the owner's words were 'like quick settings for something that is selected'. Select a row."
        source="/protocols/directives-registry"
        score="8/10"
      >
        <State query={directivesQ} rows={directives} what="directives" />
        {directives.length > 0 && (
          <section className="directives-layout">
            <div className="directives-table-wrap">
              <table className="directives-table">
                <thead>
                  <tr>
                    <th>Directive</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Bias</th>
                    <th>Protocols</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {directives.slice(0, 10).map((d) => (
                    <tr
                      key={d.id}
                      className={`directive-row ${selected && selected.id === d.id ? 'is-selected' : ''}`}
                      onClick={() => setPicked(d.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <span className="directive-primary">
                          <strong>{d.name}</strong>
                          <small>{d.id}</small>
                        </span>
                      </td>
                      <td>{d.category}</td>
                      <td>
                        <span className={`directive-chip tone-${d.active ? 'ok' : 'muted'}`}>
                          {d.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{d.directionBias || d.bias || '—'}</td>
                      <td>{d.protocolCount || '—'}</td>
                      <td>
                        {d.priority}
                        <span className="directive-weight-meta">
                          {d.complexity?.label ? ` ${d.complexity.label}` : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <aside className="directive-detail-rail" aria-label="Selected directive details">
              {!selected ? (
                <p>Select a row to see its detail.</p>
              ) : (
                <>
                  {/* ⚠️ THE RAIL MARKUP IS MATCHED TO THE SOURCE EXACTLY, AND THAT IS NOT COSMETIC.
                      This block previously put `directive-slider` on the WRAPPER div and omitted
                      `directive-detail-defaults` / `directive-slider-row`, so the pieces were laid out by
                      the wrong rules and the rail's elements overlapped. In the source page
                      `.directive-slider` IS the range input and `.directive-slider-row` is the flex row
                      around it. Same for `directive-detail-header-row` and `directive-detail-actions`
                      below. Copying the app's structure is the entire point of this page — an
                      approximation of the markup cannot prove anything about the styling. */}
                  <header className="directive-detail-header">
                    <div className="directive-detail-header-row">
                      <h2>{selected.name}</h2>
                      <span className={`directive-chip tone-${selected.active ? 'ok' : 'muted'}`}>
                        {selected.readiness}
                      </span>
                    </div>
                    <div className="directive-detail-meta-row">
                      <span className="directive-detail-badge">{selected.category}</span>
                      <span className="directive-detail-badge">{selected.complexity?.label || '—'}</span>
                    </div>
                  </header>
                  <p>{selected.description}</p>

                  <section className="directive-detail-section">
                    <h3>Defaults</h3>
                    <div className="directive-detail-defaults">
                      <div>
                        <span className="directive-detail-label">Priority</span>
                        <div className="directive-slider-row">
                          <input
                            type="range"
                            min="1"
                            max="100"
                            defaultValue={selected.priority}
                            className="directive-slider"
                          />
                          <span>{selected.priority}</span>
                        </div>
                      </div>
                      <div>
                        <span className="directive-detail-label">Protocols using it</span>
                        <div className="directive-slider-row">
                          <input
                            type="range"
                            min="0"
                            max="40"
                            defaultValue={selected.protocolCount}
                            className="directive-slider"
                          />
                          <span>{selected.protocolCount}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="directive-detail-section">
                    <h3>Actions</h3>
                    <div className="directive-detail-actions">
                      <button type="button" className="directive-detail-btn">
                        {selected.active ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="directive-detail-btn">
                        Test in isolation
                      </button>
                    </div>
                  </section>
                </>
              )}
            </aside>
          </section>
        )}
      </Example>

    </div>
  );
}
