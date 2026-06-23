import { useState } from 'react';
import { motion } from 'motion/react';

export default function AutoRiskSizingDemo() {
  const [accountSize, setAccountSize] = useState(10000);
  const [riskPct, setRiskPct] = useState(2);
  const [positionCount, setPositionCount] = useState(3);
  const [showDynamic, setShowDynamic] = useState(false);

  const maxRiskAmount = accountSize * (riskPct / 100);
  const perPositionRisk = maxRiskAmount / Math.max(1, positionCount);
  const perPositionPct = (perPositionRisk / accountSize * 100);

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 12 }}>
        <label style={fieldStyle}>
          <span>Account Size (£)</span>
          <input type="range" min={1000} max={100000} step={500} value={accountSize} onChange={(e) => setAccountSize(Number(e.target.value))} style={sliderStyle} />
          <span style={valueStyle}>£{accountSize.toLocaleString()}</span>
        </label>
        <label style={fieldStyle}>
          <span>Risk Per Trade (%)</span>
          <input type="range" min={0.5} max={10} step={0.5} value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} style={sliderStyle} />
          <span style={valueStyle}>{riskPct}%</span>
        </label>
        <label style={fieldStyle}>
          <span>Open Positions</span>
          <input type="range" min={1} max={10} step={1} value={positionCount} onChange={(e) => setPositionCount(Number(e.target.value))} style={sliderStyle} />
          <span style={valueStyle}>{positionCount}</span>
        </label>
      </div>

      {/* Results */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        <ResultCard label="Total Risk Budget" value={`£${maxRiskAmount.toFixed(0)}`} color="var(--accent)" />
        <ResultCard label="Per Position Risk" value={`£${perPositionRisk.toFixed(0)}`} color="#f59e0b" />
        <ResultCard label="Per Position %" value={`${perPositionPct.toFixed(1)}%`} color="#22c55e" />
        <ResultCard label="Remaining Budget" value={`£${(maxRiskAmount - perPositionRisk * positionCount).toFixed(0)}`} color={maxRiskAmount - perPositionRisk * positionCount >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      {/* Visual bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>Risk Allocation Visual</div>
        <div style={{ height: 32, borderRadius: 6, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', display: 'flex' }}>
          {Array.from({ length: positionCount }, (_, i) => (
            <motion.div
              key={i}
              initial={{ width: 0 }}
              animate={{ width: `${(perPositionRisk / accountSize * 100)}%` }}
              style={{ height: '100%', background: i % 2 === 0 ? 'var(--accent)' : '#0ea5a6aa', borderRight: '2px solid var(--panel)' }}
            />
          ))}
          <motion.div
            initial={{ flex: 1 }}
            animate={{ flex: 1 }}
            style={{ height: '100%', background: 'rgba(255,255,255,0.03)' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink-soft)', marginTop: 2 }}>
          <span>Allocated: £{(perPositionRisk * positionCount).toFixed(0)}</span>
          <span>Available: £{(accountSize - perPositionRisk * positionCount).toFixed(0)}</span>
        </div>
      </div>

      {/* Dynamic rules toggle */}
      <button
        type="button"
        onClick={() => setShowDynamic(!showDynamic)}
        style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: showDynamic ? 'rgba(99,102,241,0.1)' : 'transparent', color: showDynamic ? '#818cf8' : 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, marginBottom: 8 }}
      >
        {showDynamic ? '− Hide' : '+ Show'} Dynamic Rules (Q293 spec)
      </button>

      {showDynamic && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ overflow: 'hidden' }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>
              Dynamic rules (config structure only — logic implementation deferred):
            </div>
            {[
              { condition: 'positions_in_profit', note: 'If aggregate P&L > 5%, allocate 20% more' },
              { condition: 'margin_utilisation_above', note: 'If margin > 80%, reduce allocation by 30%' },
              { condition: 'strong_opportunity', note: 'If score > 85 and no funds, free 50% from slowest profitable position' },
              { condition: 'margin_protection_floor', note: 'Never allocate below £200 (margin protection)' },
            ].map((rule, i) => (
              <div key={i} style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.08)', marginBottom: 3, display: 'flex', gap: 6 }}>
                <span style={{ color: '#818cf8', fontFamily: 'monospace', fontSize: 10, flexShrink: 0 }}>{rule.condition}</span>
                <span style={{ color: 'var(--ink-soft)' }}>{rule.note}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Math */}
      <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.08)', border: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'monospace' }}>
        MaxRisk = £{accountSize.toLocaleString()} × {riskPct}% = <strong style={{ color: 'var(--accent)' }}>£{maxRiskAmount.toFixed(0)}</strong> |
        PerPosition = £{maxRiskAmount.toFixed(0)} ÷ {positionCount} = <strong style={{ color: '#f59e0b' }}>£{perPositionRisk.toFixed(0)}</strong>
      </div>
    </div>
  );
}

function ResultCard({ label, value, color }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 9, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-soft)' };
const sliderStyle = { width: '100%', height: 4, appearance: 'none', WebkitAppearance: 'none', background: 'rgba(255,255,255,0.08)', borderRadius: 2, outline: 'none', cursor: 'pointer' };
const valueStyle = { fontSize: 13, fontWeight: 700, color: 'var(--ink)' };
