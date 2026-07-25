import { Link } from 'react-router-dom';
import { useState } from 'react';
import TrailingStopDemo from '../components/FeatureLab/TrailingStopDemo';
import TimezoneDecisionDemo from '../components/FeatureLab/TimezoneDecisionDemo';
import AutoRiskSizingDemo from '../components/FeatureLab/AutoRiskSizingDemo';
import PartialTakeProfitDemo from '../components/FeatureLab/PartialTakeProfitDemo';
import SessionOpenEffectDemo from '../components/FeatureLab/SessionOpenEffectDemo';
import NewsDissipationDemo from '../components/FeatureLab/NewsDissipationDemo';
import DirectiveConfigDemo from '../components/FeatureLab/DirectiveConfigDemo';

const DEMOS = [
  { id: 'trailing-stop', label: 'Trailing Stop', status: 'active', desc: 'Animated trailing stop following price with ATR-based calculation. Visual demo with chart overlay.' },
  { id: 'partial-tp', label: 'Partial Take-Profit', status: 'active', desc: 'Take 50% at 1:1, let rest run. Fund reallocation visualisation.' },
  { id: 'auto-risk', label: 'Auto Risk Sizing', status: 'active', desc: 'Dynamic position sizing from account risk %. Visual slider showing how risk % scales position size.' },
  { id: 'session-open', label: 'Session Open Effect', status: 'active', desc: 'Directional bias prediction at US/London/Asian opens.' },
  { id: 'news-dissipation', label: 'News Dissipation Curve', status: 'active', desc: 'How news event effects decay over time.' },
];

const DECISIONS = [
  { id: 'timezone', label: 'Timezone Handling', status: 'active', desc: 'IANA timezone strings vs UTC offsets — visual DST comparison for time-gated directives.' },
  { id: 'directive-config', label: 'Default vs Custom Config', status: 'active', desc: 'Visual comparison of directive behaviour with default weights vs customised weights.' },
];

import './feature-lab.css';

export default function FeatureLabPage() {
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="fl-page">
      <header className="fl-header">
        <h1 className="fl-title">Feature Lab</h1>
        <p className="fl-desc">
          Visual demonstrations of trading automation concepts and design decisions. Each demo shows the logic and events before full implementation.
        </p>
        <Link to="/lab/lab-landing" className="fl-back-link">← Back to Lab Overview</Link>
      </header>

      <h2 className="fl-section-head">Feature Demos</h2>
      <div className="fl-list">
        {DEMOS.map((demo) => (
          <div
            key={demo.id}
            style={{
              background: 'var(--panel, #141a2e)',
              border: `1px solid ${demo.status === 'active' ? 'rgba(99,102,241,0.3)' : 'var(--line, #1e2a45)'}`,
              borderRadius: 10,
              opacity: demo.status === 'planned' ? 0.6 : 1,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => demo.status === 'active' && setExpanded(expanded === demo.id ? null : demo.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '1rem', background: 'none', border: 'none',
                color: 'var(--ink, #e2e8f0)', cursor: demo.status === 'active' ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              <div className="fl-card-head">
                <h3 className="fl-card-title">{demo.label}</h3>
                {demo.status === 'active' && (
                  <span className="fl-badge-live">LIVE</span>
                )}
                {demo.status === 'planned' && (
                  <span className="fl-badge-planned">PLANNED</span>
                )}
                {demo.status === 'active' && (
                  <span className="fl-expand-arrow">{expanded === demo.id ? '▾' : '▸'}</span>
                )}
              </div>
              <p className="fl-card-desc">{demo.desc}</p>
            </button>
            {demo.id === 'trailing-stop' && expanded === 'trailing-stop' && (
              <div className="fl-expanded">
                <TrailingStopDemo />
              </div>
            )}
            {demo.id === 'auto-risk' && expanded === 'auto-risk' && (
              <div className="fl-expanded">
                <AutoRiskSizingDemo />
              </div>
            )}
            {demo.id === 'partial-tp' && expanded === 'partial-tp' && (
              <div className="fl-expanded">
                <PartialTakeProfitDemo />
              </div>
            )}
            {demo.id === 'session-open' && expanded === 'session-open' && (
              <div className="fl-expanded">
                <SessionOpenEffectDemo />
              </div>
            )}
            {demo.id === 'news-dissipation' && expanded === 'news-dissipation' && (
              <div className="fl-expanded">
                <NewsDissipationDemo />
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="fl-section-head fl-section-head-last">Design Decisions</h2>
      <p className="fl-dd-desc">
        Visual comparisons to help make architectural choices. See the trade-offs before committing.
      </p>
      <div className="fl-list fl-list-last">
        {DECISIONS.map((d) => (
          <div
            key={d.id}
            style={{
              background: 'var(--panel, #141a2e)',
              border: `1px solid ${d.status === 'active' ? 'rgba(34,197,94,0.25)' : 'var(--line, #1e2a45)'}`,
              borderRadius: 10,
              opacity: d.status === 'planned' ? 0.6 : 1,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => d.status === 'active' && setExpanded(expanded === d.id ? null : d.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '1rem', background: 'none', border: 'none',
                color: 'var(--ink, #e2e8f0)', cursor: d.status === 'active' ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              <div className="fl-card-head">
                <span className="fl-icon">🔬</span>
                <h3 className="fl-card-title-sm">{d.label}</h3>
                {d.status === 'active' ? (
                  <span className="fl-badge-live">LIVE</span>
                ) : (
                  <span className="fl-badge-planned">PLANNED</span>
                )}
                {d.status === 'active' && (
                  <span className="fl-expand-arrow">{expanded === d.id ? '▾' : '▸'}</span>
                )}
              </div>
              <p className="fl-card-desc">{d.desc}</p>
            </button>
            {d.id === 'timezone' && expanded === 'timezone' && (
              <div className="fl-expanded">
                <TimezoneDecisionDemo />
              </div>
            )}
            {d.id === 'directive-config' && expanded === 'directive-config' && (
              <div className="fl-expanded">
                <DirectiveConfigDemo />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
