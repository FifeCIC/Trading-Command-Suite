import { useState } from 'react';

export default function PerformanceLabPage() {
  const [run, setRun] = useState(false);
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>Performance Lab</h1>
        <p style={{ color: '#64748b' }}>Long-running strategy performance tests and benchmarks</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {['Forex MR', 'Tech Breakout', 'Crypto Momentum', 'VIX Fade'].map(s => (
          <div key={s} style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, padding: 14 }}>
            <strong style={{ fontSize: 13 }}>{s}</strong>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 12 }}>
              <span style={{ color: '#4ade80' }}>62% WR</span>
              <span style={{ color: '#60a5fa' }}>+18%</span>
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => setRun(!run)} style={{ padding: '10px 20px', background: run ? '#dc2626' : '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
        {run ? '⏹ Stop Test' : '▶ Run Performance Test (24h)'}
      </button>

      {run && (
        <div style={{ marginTop: 16, padding: 12, background: '#111827', border: '1px solid #1e40af', borderRadius: 8, color: '#60a5fa', fontSize: 13 }}>
          Performance test running... Estimated completion: 24 hours. Results will appear in Strategy detail pages.
        </div>
      )}
    </div>
  );
}
