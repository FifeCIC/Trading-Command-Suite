import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';

// ── Simulated trading hours ──
const MARKET_OPEN = 9.5; // 09:30
const MARKET_CLOSE = 16; // 16:00
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIMEZONES = [
  { id: 'America/New_York', label: 'New York (EST/EDT)', offset: -5, dstOffset: -4, dstStart: 2, dstEnd: 10 },
  { id: 'Europe/London', label: 'London (GMT/BST)', offset: 0, dstOffset: 1, dstStart: 2, dstEnd: 9 },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: 9, dstOffset: 9, dstStart: -1, dstEnd: -1 },
];

export default function TimezoneDecisionDemo() {
  const [tz, setTz] = useState(TIMEZONES[0]);
  const [dstEnabled, setDstEnabled] = useState(true);
  const [month, setMonth] = useState(0); // 0=Jan ... 11=Dec
  const [playing, setPlaying] = useState(false);
  const animRef = useRef(null);

  const hasDST = tz.dstStart >= 0;
  const inDST = dstEnabled && hasDST && month >= tz.dstStart && month <= tz.dstEnd;
  const effectiveOffset = inDST ? tz.dstOffset : tz.offset;

  // Advance month
  const advance = useCallback(() => {
    setMonth((m) => (m + 1) % 12);
  }, []);

  useEffect(() => {
    if (!playing) return;
    animRef.current = setInterval(advance, 600);
    return () => clearInterval(animRef.current);
  }, [playing, advance]);

  // ── Clock angle for a given hour (0 = 12 o'clock) ──
  const hourAngle = (hour) => ((hour % 12) / 12) * 360 - 90;

  // Market open in UTC = 09:30 - offset
  const marketOpenUTC = MARKET_OPEN - effectiveOffset;
  const utcOffsetClockHour = MARKET_OPEN; // what the UTC-offset user sees
  const ianaClockHour = MARKET_OPEN; // IANA always shows correct local market time

  // For the "wrong" clock: if we use fixed UTC offset and DST changes
  const fixedOffset = tz.offset; // never adjusts
  const fixedOpenLocal = MARKET_OPEN - (effectiveOffset - fixedOffset); // drifts in DST

  const comparisonRows = [
    { label: 'Always correct?', offset: inDST ? '✗ (Mar–Nov)' : '✓', iana: '✓' },
    { label: 'Handles DST?', offset: '✗', iana: hasDST ? '✓' : 'N/A' },
    { label: 'Library needed?', offset: 'No', iana: 'date-fns-tz or luxon' },
    { label: 'Implementation', offset: '1 line', iana: '3 lines + 1 import' },
    { label: 'Selection', offset: '24 offsets', iana: '500+ IANA IDs' },
    { label: 'Risk of error', offset: 'HIGH', iana: 'LOW' },
  ];

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'var(--accent, #0ea5a6)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          }}
        >
          {playing ? '⏸ Pause' : '▶ Auto-Play'}
        </button>
        <button type="button" onClick={advance} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line, #1e2a45)', background: 'transparent', color: 'var(--ink-soft, #94a3b8)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>⏭ Next Month</button>
        <label style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={dstEnabled} onChange={(e) => setDstEnabled(e.target.checked)} disabled={!hasDST} />
          DST {!hasDST ? '(N/A)' : ''}
        </label>
        <select
          value={tz.id}
          onChange={(e) => { setTz(TIMEZONES.find((t) => t.id === e.target.value) || TIMEZONES[0]); setMonth(0); }}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--line, #1e2a45)', background: 'var(--panel, #141a2e)', color: 'var(--ink, #e2e8f0)', fontFamily: 'inherit', fontSize: 12 }}
        >
          {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', marginLeft: 'auto', fontWeight: 600 }}>
          {MONTHS[month]} {inDST ? '(DST)' : hasDST ? '(Standard)' : ''}
        </span>
      </div>

      {/* Three columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {/* Column A — UTC Offset */}
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#ef4444' }}>A: UTC Offset ({tz.offset >= 0 ? '+' : ''}{tz.offset}:00)</h4>

          {/* Clock */}
          <Clock hour={fixedOpenLocal} color="#ef4444" label="Market open on this clock" />

          {/* Calendar strip */}
          <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
            {MONTHS.map((m, i) => (
              <div
                key={m}
                style={{
                  flex: 1, textAlign: 'center', fontSize: 9, padding: '3px 0', borderRadius: 3,
                  background: i === month ? 'var(--accent, #0ea5a6)' : 'rgba(255,255,255,0.04)',
                  color: i === month ? '#fff' : 'var(--ink-soft, #94a3b8)',
                  fontWeight: i === month ? 700 : 400,
                }}
              >
                {m[0]}
              </div>
            ))}
          </div>

          {/* DST jump indicator */}
          {inDST && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ marginTop: 8, fontSize: 11, color: '#ef4444', fontWeight: 600, textAlign: 'center' }}
            >
              ⚡ Clock jumped — market open now {formatHour(fixedOpenLocal)} instead of {formatHour(MARKET_OPEN)}
            </motion.div>
          )}
          {!inDST && hasDST && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#22c55e', textAlign: 'center' }}>✓ On time (standard time)</div>
          )}
          {!hasDST && <div style={{ marginTop: 8, fontSize: 11, color: '#22c55e', textAlign: 'center' }}>✓ No DST — always correct</div>}

          {/* Activation bar */}
          <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: inDST ? 'rgba(239,68,68,0.15)' : '#22c55e44', overflow: 'hidden' }}>
            <motion.div
              animate={{ width: inDST ? '70%' : '100%' }}
              style={{ height: '100%', borderRadius: 3, background: inDST ? '#ef4444' : '#22c55e' }}
            />
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-soft, #94a3b8)', marginTop: 2, textAlign: 'center' }}>
            {inDST ? '⚠ 1 hour late for 8 months/year' : 'Directive active at correct time'}
          </div>
        </div>

        {/* Column B — IANA */}
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#22c55e' }}>B: IANA ({tz.id})</h4>

          <Clock hour={ianaClockHour} color="#22c55e" label="Market open (always correct)" />

          <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
            {MONTHS.map((m, i) => (
              <div
                key={m}
                style={{
                  flex: 1, textAlign: 'center', fontSize: 9, padding: '3px 0', borderRadius: 3,
                  background: i === month ? 'var(--accent, #0ea5a6)' : 'rgba(255,255,255,0.04)',
                  color: i === month ? '#fff' : 'var(--ink-soft, #94a3b8)',
                  fontWeight: i === month ? 700 : 400,
                }}
              >
                {m[0]}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: '#22c55e', textAlign: 'center', fontWeight: 600 }}>
            ✓ Always {formatHour(MARKET_OPEN)} — DST handled automatically
          </div>

          <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: '#22c55e44', overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 3, background: '#22c55e' }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-soft, #94a3b8)', marginTop: 2, textAlign: 'center' }}>Directive active at correct time</div>
        </div>

        {/* Column C — Comparison */}
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(0,0,0,0.08)', border: '1px solid var(--line, #1e2a45)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink, #e2e8f0)' }}>C: Comparison</h4>
          <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-soft, #94a3b8)', borderBottom: '1px solid var(--line, #1e2a45)' }}>
                <th style={{ textAlign: 'left', padding: '3px 4px' }}></th>
                <th style={{ textAlign: 'center', padding: '3px 4px', color: '#ef4444' }}>Offset</th>
                <th style={{ textAlign: 'center', padding: '3px 4px', color: '#22c55e' }}>IANA</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '3px 4px', color: 'var(--ink-soft, #94a3b8)' }}>{row.label}</td>
                  <td style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 600, color: row.offset === '✗' || row.offset === 'HIGH' || row.offset.startsWith('✗') ? '#ef4444' : 'var(--ink, #e2e8f0)' }}>{row.offset}</td>
                  <td style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 600, color: row.iana === '✓' || row.iana === 'LOW' ? '#22c55e' : 'var(--ink, #e2e8f0)' }}>{row.iana}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Clock sub-component ──
function Clock({ hour, color, label }) {
  const angle = ((hour % 12) / 12) * 360 - 90;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={70} height={70} viewBox="-35 -35 70 70" style={{ display: 'block', margin: '0 auto' }}>
        {/* Face */}
        <circle cx={0} cy={0} r={32} fill="none" stroke="var(--line, #1e2a45)" strokeWidth={1} />
        {/* Hour markers */}
        {[0, 3, 6, 9].map((h) => {
          const a = (h / 12) * 360 - 90;
          const rad = (a * Math.PI) / 180;
          return (
            <text key={h} x={Math.cos(rad) * 24} y={Math.sin(rad) * 24 + 4} textAnchor="middle" fontSize={9} fill="var(--ink-soft, #94a3b8)">
              {h === 0 ? 12 : h}
            </text>
          );
        })}
        {/* Hand */}
        <motion.line
          x1={0} y1={0}
          x2={Math.cos((angle * Math.PI) / 180) * 22}
          y2={Math.sin((angle * Math.PI) / 180) * 22}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          animate={{ transform: `rotate(${angle + 90}deg)` }}
          style={{ transformOrigin: '0px 0px' }}
        />
        {/* Center dot */}
        <circle cx={0} cy={0} r={2.5} fill={color} />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 4 }}>{formatHour(hour)}</div>
      <div style={{ fontSize: 9, color: 'var(--ink-soft, #94a3b8)' }}>{label}</div>
    </div>
  );
}

function formatHour(h) {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${String(mins).padStart(2, '0')}`;
}
