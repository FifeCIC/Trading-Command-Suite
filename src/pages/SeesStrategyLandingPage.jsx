/**
 * SEES Strategy Landing Page
 * ==========================
 * In-app introduction to the Watchlist + Protocol pairing concept.
 * Serves as both documentation and a launch point into creating strategies.
 */
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { usePreferences } from '../core/hooks/usePreferences';
import './sees-strategy-landing.css';

export default function SeesStrategyLandingPage() {
  const navigate = useNavigate();
  const prefs = usePreferences();
  const trainingMode = prefs.experienceLevel === 'beginner';
  const [showConcept, setShowConcept] = useState(false);

  // Static pipeline stages (salvaged from Algorithm Lab)
  const PIPELINE_STAGES = [
    { id: 'fetch', label: 'Fetch Data', desc: 'Market bars, news, fundamentals — pulled from providers' },
    { id: 'score', label: 'Score Directives', desc: 'Each directive evaluates one aspect of the symbol' },
    { id: 'rank', label: 'Rank Symbols', desc: 'Composite scores sort symbols from best to worst' },
    { id: 'filter', label: 'Filter Noise', desc: 'Risk gates, dominance rules, and cancellation pairs clean the signal' },
    { id: 'signal', label: 'Signal Out', desc: 'BUY / SELL / HOLD surfaced to the Live Ordering Stack' },
  ];

  return (
    <main className="ssl-page">
      <header className="ssl-hero">
        <p className="ssl-eyebrow">SEES Strategy</p>
        <h1>One concept. Every decision.</h1>
        <p className="ssl-hero-sub">
          Pair a Watchlist with a Protocol. Get a live-ranked decision surface.
        </p>
      </header>

      {/* ── Core concept diagram ── */}
      <section className="ssl-diagram">
        <div className="ssl-diagram-box ssl-diagram-watchlist">
          <span className="ssl-diagram-label">Watchlist</span>
          <span className="ssl-diagram-desc">What to score</span>
          <code>Tech Earnings</code>
        </div>
        <span className="ssl-diagram-plus">+</span>
        <div className="ssl-diagram-box ssl-diagram-protocol">
          <span className="ssl-diagram-label">Protocol</span>
          <span className="ssl-diagram-desc">How to score</span>
          <code>momentum-short</code>
        </div>
        <span className="ssl-diagram-equals">→</span>
        <div className="ssl-diagram-box ssl-diagram-result">
          <span className="ssl-diagram-label">Live Ordering Stack</span>
          <span className="ssl-diagram-desc">Ranked in real time</span>
          <code>NVDA 94.2 · MSTR 88.7 · TSLA 76.1</code>
        </div>
      </section>

      {/* ── Three-column benefits ── */}
      <section className="ssl-benefits">
        <article className="ssl-benefit-card">
          <h3>🎯 Fewer Directives</h3>
          <p>Protocols use 15–25 targeted directives, not all 87. Each one is chosen for the strategy's time horizon and asset class.</p>
        </article>
        <article className="ssl-benefit-card">
          <h3>📊 Relevant Symbols</h3>
          <p>Only the symbols in your watchlist are scored. No noise from assets you don't trade or monitor.</p>
        </article>
        <article className="ssl-benefit-card">
          <h3>🛡️ Risk Gating</h3>
          <p>Risk directives multiplicatively gate the final score. A perfect technical setup means nothing if volatility or correlation says no.</p>
        </article>
      </section>

      {/* ── The Live Ordering Stack preview ── */}
      <section className="ssl-stack-preview">
        <h2>The Live Ordering Stack</h2>
        <p className="ssl-section-sub">Every symbol in your watchlist, ranked by composite SEES score, in real time.</p>
        <div className="ssl-stack-mock">
          <div className="ssl-stack-header">
            <strong>Strategy: Tech Earnings · momentum-short</strong>
            <span className="ssl-stack-badge">Live</span>
          </div>
          <div className="ssl-stack-row ssl-stack-top">
            <span className="ssl-rank">#1</span>
            <span className="ssl-ticker">NVDA</span>
            <span className="ssl-bar"><span style={{ width: '94%' }} /></span>
            <span className="ssl-score">94.2</span>
          </div>
          <div className="ssl-stack-row">
            <span className="ssl-rank">#2</span>
            <span className="ssl-ticker">MSTR</span>
            <span className="ssl-bar"><span style={{ width: '88%' }} /></span>
            <span className="ssl-score">88.7</span>
          </div>
          <div className="ssl-stack-row">
            <span className="ssl-rank">#3</span>
            <span className="ssl-ticker">TSLA</span>
            <span className="ssl-bar"><span style={{ width: '76%' }} /></span>
            <span className="ssl-score">76.1</span>
          </div>
          <div className="ssl-stack-row">
            <span className="ssl-rank">#4</span>
            <span className="ssl-ticker">AAPL</span>
            <span className="ssl-bar"><span style={{ width: '62%' }} /></span>
            <span className="ssl-score">62.4</span>
          </div>
          <div className="ssl-stack-row ssl-stack-gated">
            <span className="ssl-rank">#18</span>
            <span className="ssl-ticker">INTC</span>
            <span className="ssl-bar"><span style={{ width: '14%' }} /></span>
            <span className="ssl-score">14.3</span>
            <span className="ssl-gate-tag">risk kill</span>
          </div>
        </div>
      </section>

      {/* ── The engine ── */}
      <section className="ssl-engine">
        <h2>Not an average. A voting system.</h2>
        <div className="ssl-engine-grid">
          <div className="ssl-engine-item">
            <strong>Entry directives</strong> vote for action — RSI oversold, MACD crossover, volume surge
          </div>
          <div className="ssl-engine-item">
            <strong>Exit directives</strong> vote against entry — overbought, regime shift, time stop
          </div>
          <div className="ssl-engine-item">
            <strong>Risk directives</strong> multiplicatively gate — 90% technical × 0.3 risk = 27%
          </div>
          <div className="ssl-engine-item">
            <strong>Dominance rules</strong> let high-priority directives suppress lower ones
          </div>
          <div className="ssl-engine-item">
            <strong>Cancellation pairs</strong> use 2:1 weighted voting (oversold vs overbought)
          </div>
        </div>
      </section>

      {/* ── Default strategy ── */}
      <section className="ssl-default">
        <h2>Star a default. Use it everywhere.</h2>
        <p className="ssl-section-sub">
          One strategy starred as your primary. Every part of the app that needs to answer "what should I score right now?" uses it.
        </p>
        <div className="ssl-default-grid">
          <div className="ssl-default-item"><strong>Live Ordering Stack</strong><span>Default view on load</span></div>
          <div className="ssl-default-item"><strong>Speed Trading</strong><span>Best symbol selection</span></div>
          <div className="ssl-default-item"><strong>Backtest Runner</strong><span>Default symbol set + protocol</span></div>
          <div className="ssl-default-item"><strong>Portfolio Monitor</strong><span>Cross-reference holdings</span></div>
        </div>
      </section>

      {/* ── Pipeline Stages (Training Mode) ── */}
      {trainingMode && (
        <section className="ssl-pipeline">
          <h2>Pipeline Stages</h2>
          <p className="ssl-section-sub">How a symbol becomes a signal — five stages from raw data to trade decision.</p>
          <div className="ssl-pipe-wrapper">
            {PIPELINE_STAGES.map((stage, i) => (
              <div key={stage.id} className="ssl-pipe-node">
                <div className="ssl-pipe-icon">
                  {i === 0 ? '📡' : i === 1 ? '📊' : i === 2 ? '🏆' : i === 3 ? '🔍' : '📢'}
                </div>
                <div className="ssl-pipe-label">{stage.label}</div>
                <div className="ssl-pipe-desc">{stage.desc}</div>
                {i < PIPELINE_STAGES.length - 1 && <div className="ssl-pipe-arrow">→</div>}
              </div>
            ))}
          </div>

          {/* Concept Explainer */}
          <div className="ssl-concept">
            <button
              type="button"
              className="ssl-concept-toggle"
              onClick={() => setShowConcept(!showConcept)}
            >
              {showConcept ? '▾' : '▸'} How the Algorithm Works
            </button>
            {showConcept && (
              <div className="ssl-concept-body">
                <p>
                  The <strong>"algorithm"</strong> in Trading Command Suite is{' '}
                  <em>not</em> a single monolithic algorithm. It's a{' '}
                  <strong>pipeline</strong>:
                </p>
                <ol>
                  <li><strong>Directives</strong> evaluate data — each directive is a focused rule that scores one aspect of a symbol.</li>
                  <li><strong>Strategy weights</strong> aggregate directive scores into a composite per-symbol score.</li>
                  <li><strong>SEES</strong> (Scoring Engine Execution System) ranks all symbols and produces BUY / SELL / HOLD signals.</li>
                </ol>
                <p>Multiple scoring procedures can run independently on different symbol groups — they are separate pipelines, not one algorithm.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="ssl-cta">
        <h2>Ready to create your first strategy?</h2>
        <div className="ssl-cta-steps">
          <div className="ssl-cta-step">
            <span className="ssl-step-num">1</span>
            <span>Pick a Watchlist</span>
          </div>
          <span className="ssl-step-arrow">→</span>
          <div className="ssl-cta-step">
            <span className="ssl-step-num">2</span>
            <span>Pick a Protocol</span>
          </div>
          <span className="ssl-step-arrow">→</span>
          <div className="ssl-cta-step">
            <span className="ssl-step-num">3</span>
            <span>Name it & Star it</span>
          </div>
          <span className="ssl-step-arrow">→</span>
          <div className="ssl-cta-step">
            <span className="ssl-step-num">4</span>
            <span>Open the Live Stack</span>
          </div>
        </div>
        <button className="ssl-cta-btn" onClick={() => navigate('/scoring/live-ordering-stack')}>
          Go to Live Ordering Stack →
        </button>
      </section>
    </main>
  );
}
