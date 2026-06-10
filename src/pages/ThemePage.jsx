import { useUiStore } from '../stores/useUiStore'
import './theme-page.css'

export default function ThemePage() {
  const themePack = useUiStore((state) => state.themePack)

  return (
    <div className="theme-page">
      <header className="theme-page-header">
        <p>
          Pack: <strong>{themePack}</strong> · Layout: <strong>omni</strong>
          {' '}· Use this page to preview visual direction before feature implementation.
        </p>
      </header>

      <section className="theme-content">
        <article className="theme-section-card neon-lab-card">
          <h2>Neon Border System</h2>
          <p className="theme-helper">Corner-only accents, full colored outlines, and thicker highlight borders for high-energy trading surfaces.</p>
          <div className="neon-style-grid">
            <div className="neon-sample neon-sample--corners">
              <h3>Corner Highlights</h3>
              <p>Thin container line with bright corner anchors only.</p>
            </div>
            <div className="neon-sample neon-sample--full-cyan">
              <h3>Full Cyan Outline</h3>
              <p>Entire container line in a neon cyan track.</p>
            </div>
            <div className="neon-sample neon-sample--full-lime">
              <h3>Full Lime Outline</h3>
              <p>High-priority card style for standout market states.</p>
            </div>
            <div className="neon-sample neon-sample--thick-violet">
              <h3>Thicker Violet Line</h3>
              <p>Thick 3px border variant for premium feature callouts.</p>
            </div>
            <div className="neon-sample neon-sample--thick-amber">
              <h3>Thicker Amber Line</h3>
              <p>Use for warnings, placeholders, or upcoming modules.</p>
            </div>
          </div>
        </article>

        <article className="theme-section-card">
          <h2>Academy Tiles Preview</h2>
          <p className="theme-helper">Glow-edge cards for symbols, events, and roadmap placeholders.</p>
          <div className="academy-grid">
            <div className="academy-tile academy-tile--live">
              <strong>Live Signal Radar</strong>
              <span>SYMBOLS + ALERTS</span>
            </div>
            <div className="academy-tile academy-tile--news">
              <strong>News Pulse</strong>
              <span>EVENT DRIVEN</span>
            </div>
            <div className="academy-tile academy-tile--soon">
              <strong>Macro Calendar</strong>
              <span>COMING SOON</span>
            </div>
            <div className="academy-tile academy-tile--soon">
              <strong>Sentiment Queue</strong>
              <span>COMING SOON</span>
            </div>
          </div>
        </article>

        <article className="theme-section-card">
          <h2>In-Content Menu + Accordions</h2>
          <div className="guide-layout">
            <aside className="guide-menu">
              <button type="button" className="guide-menu-item active">Market Sessions</button>
              <button type="button" className="guide-menu-item">Scoring Rules</button>
              <button type="button" className="guide-menu-item">Risk Gates</button>
            </aside>
            <div className="guide-accordion-stack">
              <details open className="guide-accordion">
                <summary>Directive Pipeline</summary>
                <p>Collect bars, score directives, emit strategy signal, and route to execution guardrails.</p>
              </details>
              <details className="guide-accordion">
                <summary>Execution Window Controls</summary>
                <p>Market session windows can gate signal execution and queue deferred orders.</p>
              </details>
            </div>
          </div>
        </article>

        <article className="theme-section-card">
          <h2>Dark Panel Data Style</h2>
          <p className="theme-helper">A black-panel variant for live input and telemetry sections.</p>
          <div className="dark-panel">
            <table className="dark-panel-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Mapping</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Directive D19</td>
                  <td>Oversold RSI</td>
                  <td><span className="state-ok">READY</span></td>
                </tr>
                <tr>
                  <td>Directive D44</td>
                  <td>Panic Exhaustion</td>
                  <td><span className="state-warn">UNASSIGNED</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  )
}
