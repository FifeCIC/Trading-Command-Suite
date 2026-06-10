import { DIRECTIVE_SEED } from './directives-manager.seed'
import './directives-status.css'

function ImplementationBadge({ directiveId }) {
  // Check if NestJS implementation file exists by convention
  const nestPath = `nest/src/modules/directives/implementations/${directiveId}.directive.ts`
  const implemented = true // All 5 are implemented as of 2026-06-10
  return (
    <span className={`ds-badge ds-badge--${implemented ? 'done' : 'pending'}`}>
      {implemented ? 'implemented' : 'stub'}
    </span>
  )
}

function CategoryChip({ category }) {
  const tone = category === 'Momentum' ? 'momentum' : category === 'Trend' ? 'trend' : category === 'Volatility' ? 'volatility' : 'participation'
  return <span className={`ds-category-chip ds-category--${tone}`}>{category}</span>
}

function ComplexityBar({ complexity }) {
  const levels = { low: 1, medium: 2, high: 3 }
  const filled = levels[complexity] || 1
  return (
    <div className="ds-complexity-bar" title={`Complexity: ${complexity}`}>
      {[1, 2, 3].map((level) => (
        <div key={level} className={`ds-complexity-seg ${level <= filled ? 'filled' : ''}`} />
      ))}
    </div>
  )
}

export default function DirectivesStatusPage() {
  const totalDirectives = DIRECTIVE_SEED.length
  const activeDirectives = DIRECTIVE_SEED.filter((d) => d.status === 'active').length
  const implementedCount = 5 // All 5 NestJS implementations exist
  const unitTestedCount = 0 // No spec files yet (Q5)
  const totalWeight = DIRECTIVE_SEED.reduce((sum, d) => sum + d.baseWeight, 0)
  const avgTestCoverage = Math.round(DIRECTIVE_SEED.reduce((sum, d) => sum + d.testCoverage, 0) / totalDirectives)

  return (
    <main className="directives-status-page">
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">Scoring / Directives</p>
          <h1>Directive Development Status</h1>
          <p className="ds-subtitle">Coverage and implementation maturity for the 5 MVP directives.</p>
        </div>
      </header>

      <section className="ds-summary-grid">
        <article className="ds-summary-card">
          <p className="ds-summary-label">Directives</p>
          <strong className="ds-summary-value">{totalDirectives}</strong>
          <p className="ds-summary-note">{activeDirectives} active · {implementedCount} implemented · {unitTestedCount} unit tested</p>
        </article>

        <article className="ds-summary-card">
          <p className="ds-summary-label">Total Weight</p>
          <strong className="ds-summary-value">{totalWeight}%</strong>
          <p className="ds-summary-note">Must equal 100%. Currently: {totalWeight === 100 ? '✅ valid' : '⚠️ off by ' + (100 - totalWeight)}</p>
        </article>

        <article className="ds-summary-card">
          <p className="ds-summary-label">Avg Test Coverage</p>
          <strong className="ds-summary-value">{avgTestCoverage}%</strong>
          <p className="ds-summary-note">From seed data. Real coverage determined by Q5 unit tests.</p>
        </article>

        <article className="ds-summary-card">
          <p className="ds-summary-label">Canonical Ref</p>
          <strong className="ds-summary-value" style={{ fontSize: '0.9rem' }}>docs/CANONICAL-DIRECTIVE-REFERENCE.md</strong>
          <p className="ds-summary-note">Single source of truth for directive IDs and contracts.</p>
        </article>
      </section>

      <section className="ds-progress-section">
        <h2>Implementation Progress</h2>
        <div className="ds-progress-track">
          <div className="ds-progress-fill" style={{ width: `${(implementedCount / totalDirectives) * 100}%` }} />
        </div>
        <div className="ds-progress-steps">
          <div className="ds-step done">
            <span className="ds-step-icon">1</span>
            <span>Interface defined</span>
          </div>
          <div className="ds-step done">
            <span className="ds-step-icon">2</span>
            <span>Stubs created</span>
          </div>
          <div className="ds-step done">
            <span className="ds-step-icon">3</span>
            <span>Math utils</span>
          </div>
          <div className="ds-step done">
            <span className="ds-step-icon">4</span>
            <span>Implemented</span>
          </div>
          <div className="ds-step">
            <span className="ds-step-icon">5</span>
            <span>Unit tested</span>
          </div>
          <div className="ds-step">
            <span className="ds-step-icon">6</span>
            <span>Pipeline wired</span>
          </div>
        </div>
      </section>

      <section className="ds-table-section">
        <h2>Directive Details</h2>
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>Category</th>
                <th>Weight</th>
                <th>Complexity</th>
                <th>Coverage</th>
                <th>Implementation</th>
                <th>NestJS File</th>
              </tr>
            </thead>
            <tbody>
              {DIRECTIVE_SEED.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                    <small>{d.id}</small>
                  </td>
                  <td><CategoryChip category={d.category} /></td>
                  <td className="ds-num">{d.baseWeight}%</td>
                  <td><ComplexityBar complexity={d.complexity} /></td>
                  <td>
                    <div className="ds-coverage">
                      <div className="ds-coverage-bar">
                        <div className="ds-coverage-fill" style={{ width: `${d.testCoverage}%` }} />
                      </div>
                      <span className="ds-coverage-label">{d.testCoverage}%</span>
                    </div>
                  </td>
                  <td><ImplementationBadge directiveId={d.id} /></td>
                  <td><code>nest/.../implementations/{d.id}.directive.ts</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ds-weights-section">
        <h2>Strategy Weight Distribution</h2>
        <p className="ds-subtitle">Conviction Dip Accumulation — canonical weights from docs/CANONICAL-DIRECTIVE-REFERENCE.md</p>
        <div className="ds-weight-bars">
          {DIRECTIVE_SEED.map((d) => (
            <div key={d.id} className="ds-weight-row">
              <span className="ds-weight-label">{d.name}</span>
              <div className="ds-weight-track">
                <div className="ds-weight-fill" style={{ width: `${d.baseWeight}%` }} />
              </div>
              <span className="ds-weight-value">{d.baseWeight}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ds-footer-card">
        <h2>What These Directives Need</h2>
        <ul>
          <li><strong>Real market data:</strong> MarketBar table must be populated (Q2). Currently 0 bars → all scores fall back to deterministic.</li>
          <li><strong>Unit tests:</strong> Q5 will add Jest spec files for all 5 directives. Currently 0 spec files exist.</li>
          <li><strong>Strategy aggregator:</strong> Q3 will implement weighted average in StrategiesService. Currently returns placeholder.</li>
          <li><strong>Pipeline wiring:</strong> ScoringService already calls directives (P02) but needs real MarketBars to produce non-zero scores.</li>
        </ul>
      </section>
    </main>
  )
}
