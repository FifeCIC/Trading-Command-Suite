/**
 * Strategy Library Page
 * =====================
 * Browse trading strategies, understand their theory, see which directives
 * support them, and activate a complete META.Stack pipeline.
 *
 * Route: /trading/strategy-library
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { STRATEGY_LIBRARY } from '../data/strategy-library';
import {
  buildDecisionPath,
  strategyClaims,
  evaluateStrategyClaims,
  unverifiableSchemaKeys,
} from '../core/strategy-diagram';
import { summarise } from '../core/diagram-claims';
import { noticeFromError } from '../core/notices/from-error';
import './strategy-library.css';
import './strategy-decision-path.css';
import PageInfoPopover from '../components/PageInfoPopover';

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
 * Worst status across a node's claims.
 * Disagreement outranks unverified outranks matched — the reader is shown the thing that needs
 * attention, not the first claim that happened to pass.
 */
function worstStatus(rows) {
  if (rows.some((r) => r.ok === false)) return 'bad';
  if (rows.some((r) => r.ok === null)) return 'unknown';
  if (rows.some((r) => r.ok === true)) return 'ok';
  return 'none';
}

/**
 * Layout for the decision path. A LINEAR CHAIN needs no layout engine.
 *
 * ⚠️ This is why the interactive version is cheap HERE. `/lab/pipeline-graph-lab` is 624 lines of
 * JSX plus 491 of CSS because it draws an ARBITRARY graph — positions from a JSON file, ports
 * computed per side, pan and zoom. A strategy decision path is n1 → n2 → … → n8: one column, so
 * every node's position is `index * pitch` and every edge is a straight segment of known length.
 * No measurement, no ResizeObserver, no positions file.
 */
const SDP = { spineX: 20, nodeLeft: 44, nodeH: 72, gap: 28, pitch: 100 };

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
  const [lit, setLit] = useState(null);
  const notCheckable = unverifiableSchemaKeys(strategy);

  const claimsOf = (nodeId) => rows.filter((r) => r.node === nodeId);
  const statusOf = (nodeId) => worstStatus(claimsOf(nodeId));
  const height = path.nodes.length * SDP.pitch - SDP.gap;
  const glowId = `sdp-glow-${strategy.id}`;

  // One stub from the spine into each node, plus one segment per gap between stages.
  // `a`/`b` are the node indices the edge sits between, so hovering either endpoint lights it.
  const edges = useMemo(() => {
    const out = [];
    for (let i = 0; i < path.nodes.length; i++) {
      const cy = i * SDP.pitch + SDP.nodeH / 2;
      out.push({ key: `stub-${i}`, d: `M${SDP.spineX},${cy} L${SDP.nodeLeft},${cy}`, a: i, b: i });
      if (i < path.nodes.length - 1) {
        const y1 = i * SDP.pitch + SDP.nodeH;
        const y2 = (i + 1) * SDP.pitch;
        out.push({ key: `seg-${i}`, d: `M${SDP.spineX},${y1} L${SDP.spineX},${y2}`, a: i, b: i + 1 });
      }
    }
    return out;
  }, [path.nodes.length]);

  const isLit = (e) => {
    if (!lit) return false;
    if (lit.type === 'edge') return lit.key === e.key;
    if (lit.type === 'node') return e.a === lit.index || e.b === lit.index;
    return false;
  };

  return (
    <section className="sl-section">
      <h3>Decision Path</h3>
      <p className="sl-hint">
        Generated from this entry's own directive mappings, then checked against the bot that
        runs <strong>{strategy.tcsProtocol}</strong>. Hover a stage to trace its connections —
        the path lights up. Green matched, <strong>red</strong> disagreed, amber could not be
        checked.
      </p>

      {/* aria-hidden: the table below carries the same information as real table semantics.
          Exposing the interactive decoration as well would duplicate it for screen readers. */}
      <div className="sdp" style={{ height }} aria-hidden="true">
        <svg className="sdp-links" width="100%" height={height}>
          <defs>
            <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {edges.map((e) => {
            const on = isLit(e);
            const st = statusOf(path.nodes[e.b]?.id);
            return (
              <g
                key={e.key}
                className={`sdp-edge sdp-edge--${st}${on ? ' sdp-edge--lit' : ''}`}
                onMouseEnter={() => setLit({ type: 'edge', key: e.key })}
                onMouseLeave={() => setLit(null)}
              >
                {/* A 2px line is nearly impossible to hover — the wide transparent path is what
                    makes the connection interactive at all. Same trick as the pipeline graph. */}
                <path d={e.d} className="sdp-edge-hit" fill="none" />
                <path
                  d={e.d}
                  className="sdp-edge-line"
                  fill="none"
                  filter={on ? `url(#${glowId})` : undefined}
                />
              </g>
            );
          })}
        </svg>

        {path.nodes.map((n, i) => {
          const st = statusOf(n.id);
          const mine = claimsOf(n.id);
          // ⚠️ Show the claim that DECIDED the status, not simply the first one.
          // The first draft used `find(r => r.ok !== null)`, so the signal node read
          // "disagreed" beside a passing value ("speed-momentum → ready") while the actual
          // disagreement — XAU versus XAGUSD — was a different claim on the same node.
          // A badge and a value that contradict each other are worse than no value at all.
          // The order below mirrors `worstStatus` exactly, so the two can never disagree.
          const live =
            mine.find((r) => r.ok === false) ??
            mine.find((r) => r.ok === null) ??
            mine.find((r) => r.ok === true) ??
            mine[0];
          return (
            <div
              key={n.id}
              className={`sdp-node sdp-node--${st}${lit?.type === 'node' && lit.index === i ? ' sdp-node--lit' : ''}`}
              style={{ top: i * SDP.pitch, height: SDP.nodeH }}
              onMouseEnter={() => setLit({ type: 'node', index: i })}
              onMouseLeave={() => setLit(null)}
            >
              <span className={`sdp-dot sdp-dot--${n.stage}`} />
              <div className="sdp-main">
                <div className="sdp-row">
                  <span className="sdp-stage">{n.stage}</span>
                  <span className="sdp-dirs">
                    {n.mappings.length
                      ? n.mappings.map((m) => m.directiveId).join(' + ')
                      : 'from the bot'}
                  </span>
                  <span className={`sdp-status sdp-status--${st}`}>
                    {st === 'ok' ? 'matched'
                      : st === 'bad' ? 'disagreed'
                        : st === 'unknown' ? 'unchecked'
                          : 'no claim'}
                  </span>
                </div>
                <div className="sdp-row sdp-row--sub">
                  <span className="sdp-role">{n.mappings[0]?.role || n.label}</span>
                  {live && (
                    <span
                      className={`sdp-live sdp-live--${live.ok === false ? 'bad' : live.ok === null ? 'unknown' : 'ok'}`}
                    >
                      {Array.isArray(live.expect) ? live.expect.join('/') : String(live.expect)}
                      {' → '}
                      {live.actual == null ? '—' : String(live.actual)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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

      {/* The generated Mermaid source is kept visible rather than deleted: it is the portable
          form of this picture (pasteable into an issue or a doc) and nothing else produces it. */}
      <details className="sd-source">
        <summary>Generated Mermaid source</summary>
        <pre>{path.source}</pre>
      </details>
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

                  {/* Decision Path — only where the entry names a protocol; a concept entry has
                      nothing live to check, and drawing a path for it would imply otherwise. */}
                  {strategy.tcsProtocol && (
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
