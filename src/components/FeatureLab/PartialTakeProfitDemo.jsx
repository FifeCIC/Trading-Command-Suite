import { useState } from 'react';
import { motion } from 'motion/react';

/**
 * Partial Take-Profit Demo — Visualise taking 50% at 1:1 risk/reward
 * and letting the remainder run with a trailing stop.
 */
export default function PartialTakeProfitDemo() {
  const [phase, setPhase] = useState('entry'); // entry | tp1 | running
  const [runnerPct, setRunnerPct] = useState(50);

  const entryPrice = 100;
  const stopPrice = 98;
  const tp1Price = 102;   // 1:1 risk/reward
  const currentPrice = phase === 'entry' ? 100.5 : phase === 'tp1' ? 102 : 104.2;

  const riskPerShare = entryPrice - stopPrice;
  const rewardPerShare = tp1Price - entryPrice;
  const rrRatio = (rewardPerShare / riskPerShare).toFixed(1);

  const shares = 100;
  const tp1Shares = Math.floor(shares * (1 - runnerPct / 100));
  const runnerShares = shares - tp1Shares;
  const tp1Profit = tp1Shares * rewardPerShare;
  const runnerProfit = phase === 'running' ? runnerShares * (currentPrice - entryPrice) : 0;
  const totalProfit = tp1Profit + runnerProfit;

  const riskAmount = shares * riskPerShare;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Price ladder */}
        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 8, color: 'var(--ink-soft)' }}>Price Ladder</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'monospace', fontSize: '0.8rem' }}>
            <div style={{ color: '#4ade80' }}>TP1 — ${tp1Price.toFixed(2)} {phase !== 'entry' && '✅'}</div>
            <motion.div
              animate={{ y: phase === 'running' ? -4 : 0 }}
              style={{ color: phase === 'running' ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}
            >
              Current — ${currentPrice.toFixed(2)}
            </motion.div>
            <div style={{ color: '#94a3b8' }}>Entry — ${entryPrice.toFixed(2)}</div>
            <div style={{ color: '#ef4444' }}>Stop — ${stopPrice.toFixed(2)}</div>
          </div>
        </div>

        {/* Fund allocation */}
        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 8, color: 'var(--ink-soft)' }}>Fund Allocation</div>
          <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            <motion.div
              initial={{ flex: shares }}
              animate={{ flex: phase === 'entry' ? shares : runnerShares }}
              style={{ background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}
            >
              {phase === 'entry' ? `${shares} shares` : `${runnerShares} running`}
            </motion.div>
            {phase !== 'entry' && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: tp1Shares }}
                style={{ background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}
              >
                {tp1Shares} locked
              </motion.div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
            <span style={{ color: '#3b82f6' }}>Runner: {phase === 'entry' ? shares : runnerShares} × ${(currentPrice - entryPrice).toFixed(2)}</span>
            <span style={{ color: '#22c55e' }}>TP1: {phase === 'entry' ? 0 : tp1Shares} × $2.00</span>
          </div>
        </div>
      </div>

      {/* Runner % slider */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginBottom: 4 }}>
          Runner allocation: {runnerPct}% (TP1 takes {100 - runnerPct}%)
        </div>
        <input
          type="range" min={10} max={90} step={10} value={runnerPct}
          onChange={(e) => { setRunnerPct(Number(e.target.value)); setPhase('entry'); }}
          style={{ width: '100%' }}
        />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 12 }}>
        <StatBox label="R:R" value={`1:${rrRatio}`} color="#22c55e" />
        <StatBox label="Total Risk" value={`$${riskAmount}`} color="#ef4444" />
        <StatBox label="TP1 Profit" value={`$${tp1Profit.toFixed(0)}`} color={phase !== 'entry' ? '#22c55e' : '#64748b'} />
        <StatBox label="Runner P&L" value={`$${runnerProfit.toFixed(0)}`} color={runnerProfit > 0 ? '#22c55e' : '#64748b'} />
        <StatBox label="Total P&L" value={`$${totalProfit.toFixed(0)}`} color={totalProfit > 0 ? '#22c55e' : '#64748b'} />
      </div>

      {/* Phase controls */}
      <div style={{ display: 'flex', gap: 6 }}>
        {['entry', 'tp1', 'running'].map(p => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            style={{
              padding: '5px 14px', borderRadius: 6, border: '1px solid var(--line)',
              background: phase === p ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: phase === p ? '#3b82f6' : 'var(--ink-soft)',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600,
            }}
          >
            {p === 'entry' ? '📌 Entry' : p === 'tp1' ? '🎯 TP1 Hit' : '🚀 Running'}
          </button>
        ))}
      </div>

      {phase === 'running' && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, fontSize: '0.72rem', color: '#4ade80' }}
        >
          💡 TP1 locked in ${tp1Profit.toFixed(0)} profit. The remaining {runnerShares} shares run risk-free —
          even if price hits the stop, you're still net positive by ${(tp1Profit - runnerShares * riskPerShare).toFixed(0)}.
        </motion.div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--ink-soft)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}
