import { Link } from 'react-router-dom';
import { useState } from 'react';
import TrailingStopDemo from '../components/FeatureLab/TrailingStopDemo';
import TimezoneDecisionDemo from '../components/FeatureLab/TimezoneDecisionDemo';
import AutoRiskSizingDemo from '../components/FeatureLab/AutoRiskSizingDemo';

const DEMOS = [
  { id: 'trailing-stop', label: 'Trailing Stop', status: 'active', desc: 'Animated trailing stop following price with ATR-based calculation. Visual demo with chart overlay.' },
  { id: 'partial-tp', label: 'Partial Take-Profit', status: 'planned', desc: 'Take 50% at 1:1, let rest run. Fund reallocation visualisation.' },
  { id: 'auto-risk', label: 'Auto Risk Sizing', status: 'active', desc: 'Dynamic position sizing from account risk %. Visual slider showing how risk % scales position size.' },
  { id: 'session-open', label: 'Session Open Effect', status: 'planned', desc: 'Directional bias prediction at US/London/Asian opens.' },
  { id: 'news-dissipation', label: 'News Dissipation Curve', status: 'planned', desc: 'How news event effects decay over time.' },
];

const DECISIONS = [
  { id: 'timezone', label: 'Timezone Handling', status: 'active', desc: 'IANA timezone strings vs UTC offsets — visual DST comparison for time-gated directives.' },
  { id: 'directive-config', label: 'Default vs Custom Config', status: 'planned', desc: 'Visual comparison of directive behaviour with default weights vs customised weights.' },
];

export default function FeatureLabPage() {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem', color: 'var(--ink, #e2e8f0)' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.3rem', fontSize: '1.4rem' }}>Feature Lab</h1>
        <p style={{ color: 'var(--ink-soft, #94a3b8)', fontSize: '0.85rem', margin: 0 }}>
          Visual demonstrations of trading automation concepts and design decisions. Each demo shows the logic and events before full implementation.
        </p>
        <Link to="/lab/lab-landing" style={{ fontSize: '0.78rem', color: 'var(--accent, #0ea5a6)' }}>← Back to Lab Overview</Link>
      </header>

      <h2 style={{ fontSize: '1rem', margin: '1.25rem 0 0.6rem', color: 'var(--ink-soft, #94a3b8)' }}>Feature Demos</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{demo.label}</h3>
                {demo.status === 'active' && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>LIVE</span>
                )}
                {demo.status === 'planned' && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: 'rgba(255,255,255,0.05)', color: 'var(--ink-soft, #94a3b8)' }}>PLANNED</span>
                )}
                {demo.status === 'active' && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft, #94a3b8)' }}>{expanded === demo.id ? '▾' : '▸'}</span>
                )}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft, #94a3b8)', margin: 0 }}>{demo.desc}</p>
            </button>
            {demo.id === 'trailing-stop' && expanded === 'trailing-stop' && (
              <div style={{ padding: '0 1rem 1rem' }}>
                <TrailingStopDemo />
              </div>
            )}
            {demo.id === 'auto-risk' && expanded === 'auto-risk' && (
              <div style={{ padding: '0 1rem 1rem' }}>
                <AutoRiskSizingDemo />
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '1rem', margin: '1.5rem 0 0.6rem', color: 'var(--ink-soft, #94a3b8)' }}>Design Decisions</h2>
      <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft, #94a3b8)', margin: '0 0 0.75rem' }}>
        Visual comparisons to help make architectural choices. See the trade-offs before committing.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '1rem' }}>🔬</span>
                <h3 style={{ margin: 0, fontSize: '0.9rem' }}>{d.label}</h3>
                {d.status === 'active' ? (
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>LIVE</span>
                ) : (
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: 'rgba(255,255,255,0.05)', color: 'var(--ink-soft, #94a3b8)' }}>PLANNED</span>
                )}
                {d.status === 'active' && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft, #94a3b8)' }}>{expanded === d.id ? '▾' : '▸'}</span>
                )}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft, #94a3b8)', margin: 0 }}>{d.desc}</p>
            </button>
            {d.id === 'timezone' && expanded === 'timezone' && (
              <div style={{ padding: '0 1rem 1rem' }}>
                <TimezoneDecisionDemo />
              </div>
            )}
            {d.id === 'auto-risk' && expanded === 'auto-risk' && (
              <div style={{ padding: '0 1rem 1rem' }}>
                <AutoRiskSizingDemo />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
