import { useState } from 'react';

const MOCK_ALERTS = [
  { id: 'a1', time: '14:32', type: 'signal', title: 'EURUSD Entry Signal', detail: 'Score 87 — RSI oversold bounce confirmed', read: false },
  { id: 'a2', time: '14:15', type: 'drawdown', title: 'Portfolio Drawdown 8.2%', detail: 'Approaching 10% warning threshold', read: false },
  { id: 'a3', time: '13:58', type: 'daily', title: 'Daily Limit: Alpaca 193/200', detail: '7 calls remaining this minute', read: true },
  { id: 'a4', time: '13:42', type: 'backtest', title: 'NVDA Backtest Complete', detail: '5yr, 68% win rate, +24% annual', read: true },
  { id: 'a5', time: '12:30', type: 'system', title: 'MT5 Bridge Reconnected', detail: 'ICMarkets-Demo, account 12345', read: true },
];

const TYPE_COLORS = { signal: '#4ade80', drawdown: '#f87171', daily: '#fbbf24', backtest: '#60a5fa', system: '#94a3b8' };

export default function AlertCenterPage() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.type === filter);
  const unread = alerts.filter(a => !a.read).length;

  const markRead = (id) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
  const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, read: true })));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><h1>Alert Center</h1><p style={{ color: '#64748b' }}>{unread} unread</p></div>
        <button onClick={markAllRead} style={{ padding: '6px 14px', background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Mark All Read</button>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'signal', 'drawdown', 'daily', 'system'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '4px 12px', border: '1px solid #334155', borderRadius: 6, background: filter === f ? '#1e40af' : '#0f1117', color: filter === f ? '#fff' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(a => (
          <div key={a.id} onClick={() => markRead(a.id)}
            style={{
              background: a.read ? '#1a1d2e' : '#111827', border: `1px solid ${a.read ? '#2d3040' : a.type === 'drawdown' ? '#7f1d1d' : '#1e3a5f'}`,
              borderLeft: `3px solid ${TYPE_COLORS[a.type]}`, borderRadius: 8, padding: '12px 14px', cursor: 'pointer', opacity: a.read ? 0.7 : 1
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 14 }}>{a.read ? '' : '● '}{a.title}</strong>
              <span style={{ fontSize: 11, color: '#64748b' }}>{a.time}</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{a.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
