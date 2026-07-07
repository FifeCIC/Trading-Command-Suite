import { useState } from 'react';
import { motion } from 'motion/react';

/**
 * News Dissipation Curve Demo — Visualises how news event effects decay over time.
 * Interactive half-life slider shows exponential decay of market impact.
 */
export default function NewsDissipationDemo() {
  const [halfLife, setHalfLife] = useState(30); // minutes
  const [elapsed, setElapsed] = useState(0);

  const totalDuration = 120; // show 2 hours
  const points = Array.from({ length: totalDuration }, (_, i) => {
    const t = i; // minutes
    const impact = 100 * Math.pow(0.5, t / halfLife);
    return { t, impact };
  });

  const currentImpact = 100 * Math.pow(0.5, elapsed / halfLife);
  const impactLabel = currentImpact > 60 ? 'High Impact' : currentImpact > 20 ? 'Moderate' : 'Faded';

  return (
    <div>
      {/* Dissipation curve */}
      <div style={{ position: 'relative', height: 120, background: 'rgba(0,0,0,0.15)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${totalDuration} 100`} preserveAspectRatio="none">
          {/* Grid lines */}
          {[25, 50, 75].map(y => (
            <line key={y} x1={0} y1={y} x2={totalDuration} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
          ))}
          {/* Curve */}
          <motion.polyline
            points={points.map(p => `${p.t},${100 - p.impact}`).join(' ')}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            style={{ strokeLinecap: 'round' }}
          />
          {/* Current position dot */}
          {elapsed > 0 && (
            <circle cx={elapsed} cy={100 - currentImpact} r="3" fill="#f59e0b">
              <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
        {/* Labels */}
        <div style={{ position: 'absolute', top: 4, left: 6, fontSize: '0.55rem', color: 'var(--ink-soft)' }}>Impact 100%</div>
        <div style={{ position: 'absolute', bottom: 4, left: 6, fontSize: '0.55rem', color: 'var(--ink-soft)' }}>0%</div>
      </div>

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', marginBottom: 4 }}>
            Half-life: {halfLife}min
          </div>
          <input
            type="range" min={5} max={90} step={5} value={halfLife}
            onChange={(e) => setHalfLife(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--ink-soft)' }}>
            <span>Fast decay (5m)</span>
            <span>Slow decay (90m)</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', marginBottom: 4 }}>
            Time elapsed: {elapsed}min
          </div>
          <input
            type="range" min={0} max={120} step={1} value={elapsed}
            onChange={(e) => setElapsed(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
        <StatMini label="Remaining Impact" value={`${currentImpact.toFixed(1)}%`} color="#f59e0b" />
        <StatMini label="Label" value={impactLabel} color={currentImpact > 60 ? '#ef4444' : currentImpact > 20 ? '#f59e0b' : '#22c55e'} />
        <StatMini label="Half-life" value={`${halfLife}m`} color="#94a3b8" />
        <StatMini
          label="Time to 5%"
          value={`${Math.ceil(halfLife * Math.log2(100 / 5))}m`}
          color="#64748b"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, fontSize: '0.72rem', color: '#fbbf24' }}
      >
        💡 After {halfLife}min, 50% of the news impact has dissipated. After {halfLife * 2}min, only 25% remains.
        Trade the residual, not the headline.
      </motion.div>
    </div>
  );
}

function StatMini({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.55rem', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}
