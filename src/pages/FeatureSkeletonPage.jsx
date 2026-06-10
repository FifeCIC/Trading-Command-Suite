import './feature-skeleton.css'

function Card({ title, status = 'planned', children, variant = 'cyan', thick = false }) {
  const thickClass = thick ? 'skeleton-card--thick' : ''
  return (
    <article className={`skeleton-card skeleton-card--${variant} ${thickClass}`}>
      <header className="skeleton-card-header">
        <h3>{title}</h3>
        <span className={`skeleton-chip skeleton-chip--${status}`}>{status}</span>
      </header>
      <div className="skeleton-card-body">{children}</div>
    </article>
  )
}

export default function FeatureSkeletonPage({
  title,
  subtitle,
  domain,
  rollout,
  handoff,
  milestones = [],
  metrics = [],
  placeholders = [],
  notes = [],
}) {
  return (
    <div className="feature-skeleton-page">
      <header className="feature-skeleton-header">
        <p className="feature-domain">{domain}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {rollout && (
          <div className="feature-rollout-meta">
            <span className="feature-rollout-chip feature-rollout-chip--phase">{rollout.phase}</span>
            <span className="feature-rollout-chip feature-rollout-chip--order">Order {rollout.order}</span>
            <span className="feature-rollout-chip feature-rollout-chip--status">{rollout.status}</span>
          </div>
        )}
      </header>

      <section className="feature-skeleton-grid">
        <Card title="Milestones" status="active" variant="cyan">
          <ul>
            {milestones.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>

        <Card title="Live Metrics" status="stub" variant="lime" thick>
          <div className="metric-list">
            {metrics.map((item) => (
              <div key={item.label} className="metric-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Planned Blocks" status="planned" variant="violet">
          <div className="placeholder-grid">
            {placeholders.map((item) => (
              <div key={item} className="placeholder-pill">{item}</div>
            ))}
          </div>
        </Card>

        <Card title="Implementation Notes" status="agent-ready" variant="amber" thick>
          <ul>
            {notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </section>

      {handoff && (
        <section className="feature-handoff-panel skeleton-card skeleton-card--cyan">
          <header className="feature-handoff-header">
            <h3>Agent Handoff</h3>
            <span className="skeleton-chip skeleton-chip--active">agent-ready</span>
          </header>

          <div className="feature-handoff-grid">
            <article>
              <h4>Backend Owners</h4>
              <ul>
                {handoff.backendOwners.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article>
              <h4>Endpoint Contracts</h4>
              <ul>
                {handoff.endpointContracts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article>
              <h4>Seed Targets</h4>
              <ul>
                {handoff.seedTargets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article>
              <h4>Rate Limit Rules</h4>
              <ul>
                {handoff.rateLimitRules.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>

          <div className="feature-handoff-state">
            <h4>State Store Shape</h4>
            <pre>{JSON.stringify(handoff.stateShape, null, 2)}</pre>
          </div>
        </section>
      )}
    </div>
  )
}
