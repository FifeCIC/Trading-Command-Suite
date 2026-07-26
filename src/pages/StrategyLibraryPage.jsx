/**
 * Strategy Library Page
 * =====================
 * Browse trading strategies, understand their theory, see which directives
 * support them, and activate a complete META.Stack pipeline.
 *
 * Route: /trading/strategy-library
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STRATEGY_LIBRARY } from '../data/strategy-library';
import './strategy-library.css';

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

export default function StrategyLibraryPage() {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="sl-page">
      <header className="sl-header">
        <div>
          <h1>Strategy Library</h1>
          <p className="sl-subtitle">
            Browse trading strategies, understand their mechanics, and activate a complete META.Stack pipeline.
          </p>
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

                  {/* Directive Mappings */}
                  <section className="sl-section">
                    <h3>Directive Mappings</h3>
                    <p className="sl-hint">
                      These TCS directives support this strategy. Click any directive to inspect or test it.
                    </p>
                    <div className="sl-directive-grid">
                      {strategy.directiveMappings.map((dm) => (
                        <button
                          key={dm.directiveId}
                          className="sl-directive-chip"
                          onClick={() => navigate(`/scoring/directive-detail?id=${dm.directiveId}`)}
                        >
                          <span className="sl-directive-id">{dm.directiveId}</span>
                          <span className="sl-directive-role">{dm.role}</span>
                          <span className="sl-directive-note">{dm.note}</span>
                        </button>
                      ))}
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
                      onClick={() => navigate(`/lab/meta-stack-explorer`)}
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
