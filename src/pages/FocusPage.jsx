import { useState } from 'react';

const FOCUS_AREAS = [
  { id: 'priority', name: 'Priority', desc: 'What needs attention RIGHT NOW', items: ['EURUSD — Entry signal 87/100', 'Portfolio drawdown 8.2%', 'Daily scoring completed'] },
  { id: 'daily', name: 'Daily Focus', desc: 'Today\'s plan and active strategies', items: ['Run Forex Mean Reversion on EURUSD/GBPUSD', 'Check NVDA breakout', 'Review yesterday\'s signals'] },
  { id: 'weekly', name: 'Weekly Focus', desc: 'This week\'s goals and watchlist', items: ['Finish backtesting Crypto Momentum', 'Setup MT5 bridge for live forex data', 'Build 3 new ETF strategies'] },
  { id: 'advisor', name: 'Advisor', desc: 'System-generated recommendations', items: ['Consider adding ATR Trailing Stop to Forex MR', 'NVDA 5yr backtest shows 68% win rate — activate?', 'VIX elevated — consider hedging'] },
];

export default function FocusPage() {
  const [tab, setTab] = useState('priority');

  const area = FOCUS_AREAS.find(a => a.id === tab);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>Focus</h1>
        <p style={{ color: '#64748b' }}>What needs your attention — priority-driven task management</p>
      </header>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {FOCUS_AREAS.map(a => (
          <button key={a.id} onClick={() => setTab(a.id)}
            style={{
              padding: '8px 16px', border: 'none', borderBottom: `2px solid ${tab === a.id ? '#3b82f6' : 'transparent'}`,
              background: 'none', color: tab === a.id ? '#e2e8f0' : '#64748b', fontSize: 13, cursor: 'pointer', fontWeight: 600
            }}>{a.name}</button>
        ))}
      </div>

      {area && (
        <div style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, padding: 16 }}>
          <h3 style={{ margin: '0 0 4px' }}>{area.name}</h3>
          <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>{area.desc}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {area.items.map((item, i) => (
              <div key={i} style={{ padding: '8px 12px', background: '#0f1117', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
                {i + 1}. {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
