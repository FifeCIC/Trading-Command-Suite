import { useState } from 'react';

const MOCK_LOG = Array.from({ length: 20 }, (_, i) => ({
  id: `log-${i}`,
  time: new Date(Date.now() - (i * 3 + Math.random() * 2) * 60000).toLocaleTimeString(),
  type: ['score', 'signal', 'import', 'error', 'system'][Math.floor(Math.random() * 5)],
  message: [
    'EURUSD scored 87/100 — entry signal generated',
    'NVDA scored 92/100 — breakout confirmed',
    'Market data imported for AAPL (100 bars, 1d)',
    'BTC-USD scored 45/100 — no action',
    'Scheduler daily run completed (12 symbols, 3 signals)',
    'GBPUSD scored 72/100 — buy signal',
    'Data freshness check: 15/18 symbols OK',
    'TSLA scored 78/100 — dip buy opportunity',
    'Import failed for SPY: rate limit exceeded',
    'Scoring pipeline completed in 234ms',
  ][Math.floor(Math.random() * 10)],
}));

const TYPE_ICONS = { score: '📊', signal: '📢', import: '📥', error: '❌', system: '⚙️' };

export default function ScoringActivityLogPage() {
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? MOCK_LOG : MOCK_LOG.filter(l => l.type === filter);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>Scoring Activity Log</h1>
        <p style={{ color: '#64748b' }}>Real-time scoring pipeline events</p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'score', 'signal', 'import', 'error'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '4px 12px', border: '1px solid #334155', borderRadius: 6,
              background: filter === f ? '#1e40af' : '#0f1117', color: filter === f ? '#fff' : '#94a3b8',
              fontSize: 12, cursor: 'pointer'
            }}>
            {f.toUpperCase()} ({filter === 'all' ? MOCK_LOG.length : MOCK_LOG.filter(l => l.type === f).length})
          </button>
        ))}
      </div>

      <div style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, overflow: 'hidden' }}>
        {filtered.map(log => (
          <div key={log.id} style={{
            display: 'flex', gap: 12, padding: '8px 14px', borderBottom: '1px solid #111318',
            fontSize: 13, alignItems: 'center'
          }}>
            <span style={{ color: '#64748b', fontSize: 11, minWidth: 72 }}>{log.time}</span>
            <span>{TYPE_ICONS[log.type]}</span>
            <span style={{ flex: 1 }}>{log.message}</span>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4,
              background: { score: '#1e293b', signal: '#14532d', import: '#1e3a5f', error: '#450a0a', system: '#1e293b' }[log.type],
              color: { score: '#94a3b8', signal: '#4ade80', import: '#60a5fa', error: '#f87171', system: '#94a3b8' }[log.type]
            }}>{log.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
