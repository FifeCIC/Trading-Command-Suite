import { useState } from 'react';
import { motion } from 'motion/react';

/**
 * Default vs Custom Config Demo — Side-by-side comparison showing how
 * calibration overrides change directive scoring outcomes.
 */
const DIRECTIVES = [
  { id: 'rsi-oversold', name: 'RSI Oversold', defaultWeight: 1.0, customWeight: 1.5, defaultScore: 62, customScore: 78, reason: 'RSI threshold tightened from 30→25 for this symbol' },
  { id: 'macd-crossover', name: 'MACD Crossover', defaultWeight: 1.0, customWeight: 0.7, defaultScore: 55, customScore: 42, reason: 'MACD less reliable in ranging markets — reduced weight' },
  { id: 'volume-spike', name: 'Volume Spike', defaultWeight: 1.0, customWeight: 1.3, defaultScore: 48, customScore: 63, reason: 'Insider activity detected — volume signals amplified' },
  { id: 'ema-structure', name: 'EMA Structure', defaultWeight: 1.0, customWeight: 1.0, defaultScore: 70, customScore: 70, reason: 'No override — using default weight' },
];

export default function DirectiveConfigDemo() {
  const [selected, setSelected] = useState(null);

  const totalDefault = DIRECTIVES.reduce((s, d) => s + d.defaultScore, 0);
  const totalCustom = DIRECTIVES.reduce((s, d) => s + d.customScore, 0);
  const deltaPercent = (((totalCustom - totalDefault) / totalDefault) * 100).toFixed(1);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 12, border: '1px solid var(--line)' }}
        >
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6 }}>Default Weights</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#94a3b8' }}>{totalDefault}</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--ink-soft)' }}>Composite Score</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          style={{ background: 'rgba(99,102,241,0.06)', borderRadius: 8, padding: 12, border: '1px solid rgba(99,102,241,0.2)' }}
        >
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#a5b4fc', marginBottom: 6 }}>Custom Weights</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#818cf8' }}>{totalCustom}</div>
          <div style={{ fontSize: '0.62rem', color: deltaPercent.startsWith('-') ? '#ef4444' : '#22c55e' }}>
            {deltaPercent.startsWith('-') ? '↓' : '↑'} {deltaPercent}% vs default
          </div>
        </motion.div>
      </div>

      {/* Directive comparison rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DIRECTIVES.map(d => {
          const diff = d.customScore - d.defaultScore;
          const changed = d.defaultWeight !== d.customWeight;
          return (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => setSelected(selected === d.id ? null : d.id)}
              style={{
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: selected === d.id ? 'rgba(99,102,241,0.08)' : 'rgba(0,0,0,0.1)',
                border: `1px solid ${selected === d.id ? 'rgba(99,102,241,0.25)' : 'var(--line)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{d.name}</span>
                  {changed && (
                    <span style={{
                      fontSize: '0.55rem', padding: '1px 5px', borderRadius: 3,
                      background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
                    }}>
                      ×{d.customWeight}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  <span style={{ color: '#94a3b8' }}>{d.defaultScore}</span>
                  <span style={{ color: 'var(--ink-soft)' }}>→</span>
                  <span style={{ color: diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>
                    {d.customScore}
                  </span>
                </div>
              </div>

              {/* Score comparison bar */}
              <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4, gap: 1 }}>
                <div style={{ flex: d.defaultScore, background: '#475569', borderRadius: 2 }} />
                <div style={{ flex: 100 - d.defaultScore, background: 'transparent' }} />
              </div>
              <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 1, gap: 1 }}>
                <div style={{ flex: d.customScore, background: changed ? '#818cf8' : '#475569', borderRadius: 2 }} />
                <div style={{ flex: 100 - d.customScore, background: 'transparent' }} />
              </div>

              {selected === d.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  style={{ overflow: 'hidden', marginTop: 6, fontSize: '0.68rem', color: 'var(--ink-soft)', paddingLeft: 4, borderLeft: '2px solid rgba(99,102,241,0.3)' }}
                >
                  {d.reason}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 6, fontSize: '0.72rem', color: '#a5b4fc' }}
      >
        🔧 Click any directive to see why its weight was changed. Weights are calibrated per symbol
        based on historical directive accuracy and market regime.
      </motion.div>
    </div>
  );
}
