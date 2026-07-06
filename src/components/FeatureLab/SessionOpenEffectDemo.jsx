import { useState, useMemo } from 'react';
import { motion } from 'motion/react';

const SESSIONS = [
  { id: 'london', label: 'London', time: '3am–12pm ET', color: '#3b82f6', bias: 0.55, desc: 'Highest FX volume. GBP/EUR pairs show directional bias in first 2 hours.' },
  { id: 'ny', label: 'New York', time: '9:30am–4pm ET', color: '#22c55e', bias: 0.48, desc: 'Equity-driven. SPY/QQQ show opening range breakouts 62% of sessions.' },
  { id: 'asian', label: 'Asian', time: '7pm–4am ET', color: '#f59e0b', bias: 0.42, desc: 'Range-bound. AUD/JPY pairs tend to mean-revert during Sydney/Tokyo overlap.' },
];

function SessionBar({ session, active }) {
  const barWidth = session.bias * 100;
  const direction = session.bias >= 0.5 ? 'Bullish' : 'Bearish';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        padding: '10px 12px', borderRadius: 8, marginBottom: 8,
        background: active ? `${session.color}15` : 'rgba(0,0,0,0.1)',
        border: `1px solid ${active ? session.color + '44' : 'var(--line)'}`,
        transition: 'background 0.3s, border-color 0.3s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: session.color }}>{session.label}</span>
          <span style={{ fontSize: '0.65rem', color: 'var(--ink-soft)', marginLeft: 8 }}>{session.time}</span>
        </div>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: direction === 'Bullish' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: direction === 'Bullish' ? '#22c55e' : '#ef4444',
        }}>
          {direction} {(session.bias * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${barWidth}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${session.color}, ${session.color}88)` }}
        />
      </div>
      <div style={{ fontSize: '0.65rem', color: 'var(--ink-soft)' }}>{session.desc}</div>
    </motion.div>
  );
}

export default function SessionOpenEffectDemo() {
  const [activeSession, setActiveSession] = useState(null);

  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentSession = currentHour >= 8 && currentHour < 17 ? 'london'
    : currentHour >= 13 && currentHour < 22 ? 'ny'
    : 'asian';

  const displayText = useMemo(() => {
    if (!activeSession) return 'Click a session to see its opening bias prediction.';
    const s = SESSIONS.find(x => x.id === activeSession);
    return s
      ? `${s.label} open: ${s.bias >= 0.5 ? 'slight bullish edge' : 'slight bearish edge'} (${(s.bias * 100).toFixed(0)}% historical bias). ${s.bias >= 0.5 ? 'Consider buying the first pullback.' : 'Consider fading the opening spike.'}`
      : '';
  }, [activeSession]);

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: '0.7rem', color: 'var(--ink-soft)' }}>
        Current session: <span style={{ color: SESSIONS.find(s => s.id === currentSession)?.color, fontWeight: 600 }}>
          {SESSIONS.find(s => s.id === currentSession)?.label}
        </span>
      </div>

      {SESSIONS.map(s => (
        <div key={s.id} onClick={() => setActiveSession(s.id)} style={{ cursor: 'pointer' }}>
          <SessionBar session={s} active={activeSession === s.id} />
        </div>
      ))}

      {activeSession && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ overflow: 'hidden' }}
        >
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginTop: 8,
            background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
            fontSize: '0.75rem', color: 'var(--ink)',
          }}>
            📊 {displayText}
          </div>
        </motion.div>
      )}
    </div>
  );
}
