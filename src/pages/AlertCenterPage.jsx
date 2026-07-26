import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

const TYPE_COLORS = { signal: '#4ade80', drawdown: '#f87171', daily: '#fbbf24', backtest: '#60a5fa', system: '#94a3b8' };

// Fallback routes by alert type when no ticker/link is available
const TYPE_FALLBACKS = {
  signal: '/scoring/live-ordering-stack',
  drawdown: '/trading/portfolio-overview',
  backtest: '/training/backtest',
  system: '/status/setup',
  daily: '/dashboard',
};

export default function AlertCenterPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [readIds, setReadIds] = useState(new Set());

  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: () => apiGet('/api/alerts/active').catch(() => []),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const alerts = (alertsQuery.data || []).map((a) => ({
    ...a,
    read: readIds.has(a.id),
  }));

  const filtered = filter === 'all' ? alerts : alerts.filter((a) => a.type === filter);
  const unread = alerts.filter((a) => !a.read).length;

  const markRead = (id) => setReadIds((prev) => new Set([...prev, id]));
  const markAllRead = () => setReadIds(new Set(alerts.map((a) => a.id)));

  const handleAlertClick = (alert) => {
    markRead(alert.id);
    if (alert.ticker) {
      navigate(`/research/symbol/${alert.ticker}`);
    } else if (alert.link) {
      window.location.href = alert.link;
    } else {
      const fallback = TYPE_FALLBACKS[alert.type];
      if (fallback) navigate(fallback);
    }
  };

  return (
    <div className="ac-page">
      <header className="ac-header-row">
        <div><h1>Alert Center</h1><p style={{ color: '#64748b' }}>{unread} unread</p></div>
        <button onClick={markAllRead} style={{ padding: '6px 14px', background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Mark All Read</button>
      </header>

      <div className="ac-tabs-row">
        {['all', 'signal', 'drawdown', 'daily', 'system'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '4px 12px', border: '1px solid #334155', borderRadius: 6, background: filter === f ? '#1e40af' : '#0f1117', color: filter === f ? '#fff' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="ac-alert-list">
        {filtered.map(a => (
          <div key={a.id} onClick={() => handleAlertClick(a)}
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
