import { useState } from 'react';

const MOCK_WATCHLISTS = [
  { id: 'w1', name: 'Tech Giants', symbols: ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'META'], type: 'stocks' },
  { id: 'w2', name: 'Forex Majors', symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'], type: 'forex' },
  { id: 'w3', name: 'Crypto Top 5', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ADA-USD', 'DOT-USD'], type: 'crypto' },
  { id: 'w4', name: 'Dividend Payers', symbols: ['JNJ', 'PG', 'KO', 'XOM'], type: 'stocks' },
];

export default function WatchlistsPage() {
  const [watchlists] = useState(MOCK_WATCHLISTS);
  const [expanded, setExpanded] = useState('w1');

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>Watchlists</h1><p style={{ color: '#64748b' }}>Custom symbol groups for quick monitoring</p></div>
        <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ New Watchlist</button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {watchlists.map(w => (
          <div key={w.id} style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, overflow: 'hidden' }}>
            <div onClick={() => setExpanded(expanded === w.id ? null : w.id)}
              style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{w.name}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#1e293b', color: '#60a5fa' }}>{w.type}</span>
              </div>
              <span style={{ color: '#64748b', fontSize: 12 }}>{w.symbols.length} symbols {expanded === w.id ? '▾' : '▸'}</span>
            </div>
            {expanded === w.id && (
              <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {w.symbols.map(s => (
                  <span key={s} style={{ padding: '4px 10px', background: '#0f1117', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}>{s}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
