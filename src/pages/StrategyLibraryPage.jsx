/**
 * Strategy Library Page
 * =====================
 * Browse trading strategies, understand their theory, see which directives
 * support them, and activate a complete META.Stack pipeline.
 *
 * Route: /trading/strategy-library
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import mermaid from 'mermaid';
import { apiGet } from '../core/api/client';
import { STRATEGY_LIBRARY } from '../data/strategy-library';
import {
  buildDecisionPath,
  strategyClaims,
  evaluateStrategyClaims,
  unverifiableSchemaKeys,
} from '../core/strategy-diagram';
import { annotateSource, summarise } from '../core/diagram-claims';
import { useThemedMermaid, readStatusColors } from '../core/mermaid-theme';
import { noticeFromError } from '../core/notices/from-error';
import './strategy-library.css';
import './strategy-decision-path.css';
import PageInfoPopover from '../components/PageInfoPopover';

// ⚠️ Mermaid is configured by `core/mermaid-theme`, NOT here — `mermaid.initialize()` sets a
// GLOBAL singleton, so a second call on another page silently overrides this one.

const DIFFICULTY_COLORS = {
  Beginner: '#22c55e',
  Intermediate: '#f59e0b',
  Advanced: '#ef4444',
};

const STATUS_LABELS = {
  concept: 'Concept',
  partial: 'Partially Supported',
  supported: 'Fully Supported',
  live: 'Live',
};

const STATUS_COLORS = {
  concept: '#64748b',
  partial: '#f59e0b',
  supported: '#3b82f6',
  live: '#22c55e',
};

const READINESS_STYLES = {
  ready:  { color: '#22c55e', bg: '#22c55e18', label: 'READY', title: 'Verified against live data' },
  beta:  { color: '#f59e0b', bg: '#f59e0b18', label: 'BETA', title: 'Real math, proxy/limited data' },
  alpha:  { color: '#ef4444', bg: '#ef444418', label: 'ALPHA', title: 'Mock, stub, or placeholder' },
};

/**
 * The decision path for one library entry, drawn from the entry's own data and checked
 * against the bot that runs its protocol.
 *
 * ⚠️ WHICH BOT IS READ, and why it is not "the first active one": the claims resolve against
 * bots whose `protocolId` equals THIS entry's `tcsProtocol`. Two library entries can name the
 * same protocol (`forex-session-trading` and `forex-session-cable` both name
 * `forex-session-v1`), so they will legitimately show identical live values. That is a
 * property of the current model, not a bug in this component — see the sprint record.
 */
function StrategyDecisionPath({ strategy, bots, botsNotice, directives }) {
  const path = useMemo(() => buildDecisionPath(strategy), [strategy]);
  const claims = useMemo(() => strategyClaims(strategy, path), [strategy, path]);
  const rows = useMemo(
    () =>
      evaluateStrategyClaims(claims, {
        bots,
        directives,
        error: botsNotice?.message ?? null,
        protocol: strategy.tcsProtocol,
      }),
    [claims, bots, directives, botsNotice, strategy.tcsProtocol],
  );
  const summary = useMemo(() => summarise(rows), [rows]);
  const notCheckable = unverifiableSchemaKeys(strategy);
  const hostRef = useRef(null);
  // The shared Mermaid config. `themeKey` changes on every theme switch, so the effect below
  // redraws the SVG instead of leaving the previous pack's palette cached in the DOM.
  const { themeKey } = useThemedMermaid();

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let cancelled = false;
    // The source is annotated with the claim results FIRST, so a node whose claim failed is
    // stroked in the picture rather than only described beside it.
    const src = annotateSource(strategy.id, path.source, rows, readStatusColors());
    mermaid
      .render(`sd-${strategy.id}-svg`, src)
      .then(({ svg }) => {
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML =
            '<p class="sl-hint">The decision path could not be rendered.</p>';
        }
      });
    return () => { cancelled = true; };
  }, [strategy.id, path.source, rows, themeKey]);

  return (
    <section className="sl-section">
      <h3>Decision Path</h3>
      <p className="sl-hint">
        Generated from this entry's own directive mappings
        {strategy.tcsProtocol ? (
          <>
            , then checked against the bot that runs <strong>{strategy.tcsProtocol}</strong>.
          </>
        ) : (
          <>
            . This entry names <strong>no protocol</strong>, so there is no bot to compare
            against — the directive claims are still checked, the bot-side ones are not.
          </>
        )}{' '}
        A node outlined in green matched; <strong>red dashed</strong> did not; unoutlined was
        not checked. Drawn in the active theme.
      </p>

      <div className="sd-diagram" ref={hostRef} role="img"
        aria-label={`Decision path for ${strategy.name}`} />

      <div className="sd-summary">
        <span className="sd-summary-count">
          {summary.checked} of {summary.total} claims checked
        </span>
        <span className="sd-pill sd-pill--ok">{summary.passed} matched</span>
        <span className="sd-pill sd-pill--bad">{summary.failed} disagreed</span>
        <span className="sd-pill sd-pill--unknown">{summary.unverified} unverified</span>
      </div>

      {botsNotice && (
        <p className="sd-note sd-note--warn">
          The strategies endpoint could not be read ({botsNotice.code}) — {botsNotice.message} Every
          claim below is
          <strong> unverified</strong> — that is not a pass, and nothing here says the theory is
          wrong. The diagram shows the intended path only.
        </p>
      )}

      <table className="sd-claims">
        <thead>
          <tr><th>Stage</th><th>Claim</th><th>Theory says</th><th>Running system</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.ok === false ? 'sd-row--bad' : r.ok === true ? 'sd-row--ok' : ''}>
              <td className="sd-cell-node">{r.node}</td>
              <td>{r.says}</td>
              <td className="sd-cell-expect">
                {Array.isArray(r.expect) ? r.expect.join(' / ') : String(r.expect)}
              </td>
              <td className="sd-cell-actual">
                {r.actual == null ? <em>not checked</em> : String(r.actual)}
                {r.error && <div className="sd-cell-error">{r.error}</div>}
                {!r.error && r.note && <div className="sd-cell-note">{r.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {notCheckable.length > 0 && (
        <div className="sd-unverifiable">
          <div className="sd-unverifiable-head">
            {notCheckable.length} of {Object.keys(strategy.configSchema || {}).length} declared
            parameters have no home in the running system
          </div>
          <p className="sd-unverifiable-why">
            These cannot be checked now or later as things stand, because a bot stores a
            percentage where this entry declares pips, a named session where it declares clock
            times, and has no column at all for the rest. They are shown rather than hidden:
            a theory asking for something the app cannot store is a capability gap, not a
            diagram problem.
          </p>
          <ul className="sd-unverifiable-list">
            {notCheckable.map((u) => (
              <li key={u.key}><code>{u.key}</code> — {u.why}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function StrategyLibraryPage() {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  // Fetch directive readiness from API for per-directive badges
  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 60_000,
  });

  /**
   * The live bots, for the decision-path claims.
   * Fetched ONCE for the whole page rather than per card — there are ~27 bots, and the
   * strategy list can have ten entries open in sequence.
   * ⚠️ The failure is carried as a CODED NOTICE (`botsNotice`), not swallowed. A swallowed error
   * here would render every claim as "unverified" with no explanation, which reads as a data gap
   * rather than an outage — the exact confusion this report exists to avoid.
   */
  const botsQuery = useQuery({
    queryKey: ['trading', 'strategies', 'for-diagrams'],
    queryFn: () => apiGet('/api/trading/strategies'),
    staleTime: 60_000,
  });
  const bots = Array.isArray(botsQuery.data)
    ? botsQuery.data
    : botsQuery.data?.strategies;
  // #826 Phase 5 — the failure is carried as a CODED notice, never as a raw `error.message`
  // render. The ratchet in scripts/validate-notices.cjs counts raw renders and cannot tell "the
  // API did not respond" from a broker refusal — a code can. TCS-SYS-009 is the no-response
  // fallback; noticeFromError upgrades it to the status-bearing code when a response existed.
  const botsNotice = botsQuery.isError
    ? noticeFromError(botsQuery.error, 'TCS-SYS-009', { operation: 'read the strategies endpoint' })
    : null;

  const readinessMap = useMemo(() => {
    const map = {};
    if (directivesQuery.data) {
      for (const d of directivesQuery.data) {
        map[d.id] = d.readiness || 'alpha';
      }
    }
    return map;
  }, [directivesQuery.data]);

  const feedsMap = useMemo(() => {
    const map = {};
    if (directivesQuery.data) {
      for (const d of directivesQuery.data) {
        map[d.id] = d.requiredDataFeeds || [];
      }
    }
    return map;
  }, [directivesQuery.data]);

  return (
    <div className="sl-page">
      <header className="sl-header">
        <div>
          <h1>Strategy Library
          <PageInfoPopover>
            Browse trading strategies, understand their mechanics, and activate a complete META.Stack pipeline.
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {STRATEGY_LIBRARY.length === 0 && (
        <div className="sl-empty">
          <p>No strategies in the library yet.</p>
        </div>
      )}

      <div className="sl-list">
        {STRATEGY_LIBRARY.map((strategy) => {
          const isOpen = expandedId === strategy.id;
          const diffColor = DIFFICULTY_COLORS[strategy.difficulty] || DIFFICULTY_COLORS.Intermediate;
          const statusColor = STATUS_COLORS[strategy.status] || STATUS_COLORS.concept;

          return (
            <article key={strategy.id} className={`sl-card ${isOpen ? 'sl-card--open' : ''}`}>
              {/* ── Card header (always visible) ── */}
              <button className="sl-card-header" onClick={() => toggle(strategy.id)} aria-expanded={isOpen}>
                <div className="sl-card-title">
                  <h2>{strategy.name}</h2>
                  <p className="sl-tagline">{strategy.tagline}</p>
                </div>
                <div className="sl-card-meta">
                  <span className="sl-badge" style={{ color: diffColor, borderColor: diffColor }}>
                    {strategy.difficulty}
                  </span>
                  <span className="sl-badge" style={{ color: statusColor, borderColor: statusColor }}>
                    {STATUS_LABELS[strategy.status]}
                  </span>
                  <span className="sl-badge sl-badge--category">{strategy.category}</span>
                </div>
                <span className={`sl-chevron ${isOpen ? 'sl-chevron--open' : ''}`}>▼</span>
              </button>

              {/* ── Expanded content ── */}
              {isOpen && (
                <div className="sl-expanded">
                  {/* Overview */}
                  <section className="sl-section">
                    <h3>Overview</h3>
                    <div className="sl-prose">{strategy.overview}</div>
                    <div className="sl-meta-row">
                      <span><strong>Asset Classes:</strong> {strategy.assetClasses.join(', ')}</span>
                      <span><strong>Timeframe:</strong> {strategy.timeframe}</span>
                    </div>
                  </section>

                  {/* Theory */}
                  <section className="sl-section">
                    <h3>Theory</h3>
                    <div className="sl-prose sl-prose--rich" dangerouslySetInnerHTML={{ __html: formatMarkdown(strategy.theory) }} />
                  </section>

                  {/* Mechanics */}
                  <section className="sl-section">
                    <h3>Mechanics</h3>
                    <div className="sl-mechanics-grid">
                      {strategy.mechanics.map((m, i) => (
                        <div key={i} className="sl-mechanic-card">
                          <h4>{m.title}</h4>
                          <p>{m.body}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* State Machine */}
                  {strategy.stateMachine && (
                    <section className="sl-section">
                      <h3>Position State Machine</h3>
                      <p className="sl-hint">{strategy.stateMachine.description}</p>
                      <div className="sl-state-flow">
                        {strategy.stateMachine.states.map((s, i) => (
                          <div key={s.state} className="sl-state-node">
                            <div className="sl-state-label">{s.label}</div>
                            <div className="sl-state-name">{s.state}</div>
                            <div className="sl-state-desc">{s.desc}</div>
                            {i < strategy.stateMachine.states.length - 1 && (
                              <div className="sl-state-arrow">→</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Decision Path — for any entry that maps directives, whether or not it names a
                      protocol.

                      ⚠️ This gate used to be `strategy.tcsProtocol &&`, on the reasoning that a
                      concept entry "has nothing live to check, and drawing a path for it would
                      imply otherwise". The implication was real and it came from the RESOLVER, not
                      from the diagram: with no protocol, `protocol-resolves` set `ok = false`, so
                      every concept entry would have rendered a red "disagreed" pill reading
                      "the library entry may be stale".

                      The resolver now treats an undeclared protocol as an ABSENCE (`ok: null`,
                      "not checked"), so the path can be drawn for all 10 entries and still mean
                      exactly one thing by red. The directive-registration claims resolve either
                      way — that is the half of this panel a concept entry can answer, and it is
                      the half that was previously not shown at all. */}
                  {strategy.directiveMappings?.length > 0 && (
                    <StrategyDecisionPath
                      strategy={strategy}
                      bots={bots}
                      botsNotice={botsNotice}
                      directives={directivesQuery.data}
                    />
                  )}

                  {/* Directive Mappings */}
                  <section className="sl-section">
                    <h3>Directive Mappings</h3>
                    <p className="sl-hint">
                      These TCS directives support this strategy. Click any directive to inspect or test it.
                    </p>
                    <div className="sl-directive-grid">
                      {strategy.directiveMappings.map((dm) => {
                        const readiness = readinessMap[dm.directiveId] || 'alpha';
                        const rs = READINESS_STYLES[readiness] || READINESS_STYLES.alpha;
                        return (
                        <button
                          key={dm.directiveId}
                          className="sl-directive-chip"
                          onClick={() => navigate(`/scoring/directive-detail?id=${dm.directiveId}`)}
                        >
                          <span className="sl-directive-id">{dm.directiveId}</span>
                          <span className="sl-directive-role">{dm.role}</span>
                          <span className="sl-directive-note">{dm.note}</span>
                          <span
                            className="sl-readiness-badge"
                            style={{
                              color: rs.color,
                              background: rs.bg,
                              border: `1px solid ${rs.color}40`,
                              padding: '1px 6px',
                              borderRadius: '3px',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              marginLeft: 'auto',
                              flexShrink: 0,
                            }}
                            title={rs.title}
                          >
                            {rs.label}
                          </span>
                          {(feedsMap[dm.directiveId] || []).map((feed) => (
                            <span key={feed} style={{
                              color: '#60a5fa', background: '#3b82f610',
                              border: '1px solid #3b82f633',
                              padding: '1px 4px', borderRadius: '3px',
                              fontSize: '0.58rem', fontWeight: 600,
                              flexShrink: 0,
                            }} title={`Requires ${feed} data`}>{feed}</span>
                          ))}
                        </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* Strengths & Risks */}
                  <div className="sl-two-col">
                    <section className="sl-section">
                      <h3>Strengths</h3>
                      <ul className="sl-bullet-list sl-bullet-list--pro">
                        {strategy.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </section>
                    <section className="sl-section">
                      <h3>Risks & Vulnerabilities</h3>
                      <ul className="sl-bullet-list sl-bullet-list--con">
                        {strategy.risks.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </section>
                  </div>

                  {/* Config */}
                  <section className="sl-section">
                    <h3>Default Configuration</h3>
                    <div className="sl-config-grid">
                      {Object.entries(strategy.configSchema).map(([key, value]) => (
                        <div key={key} className="sl-config-item">
                          <span className="sl-config-key">{formatKey(key)}</span>
                          <code className="sl-config-value">
                            {Array.isArray(value) ? value.join(' / ') : String(value)}
                          </code>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Activate */}
                  <div className="sl-activate-bar">
                    <div className="sl-activate-info">
                      <strong>Status:</strong>{' '}
                      <span style={{ color: statusColor }}>{STATUS_LABELS[strategy.status]}</span>
                      {strategy.status === 'concept' && (
                        <span className="sl-activate-note"> — directive support is being built. Check back soon.</span>
                      )}
                      {strategy.status === 'partial' && (
                        <span className="sl-activate-note"> — some directives are ready. You can test the pipeline now.</span>
                      )}
                    </div>
                    <button
                      className="sl-activate-btn"
                      disabled={strategy.status === 'concept'}
                      onClick={() => navigate(`/status/meta-stack-explorer`)}
                    >
                      {strategy.status === 'concept' ? 'Coming Soon' : 'Activate Strategy →'}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatMarkdown(text) {
  // Bold
  let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Newlines to <br/>
  html = html.replace(/\n/g, '<br/>');
  return html;
}
