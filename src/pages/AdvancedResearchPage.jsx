import { useState } from 'react';

const RESEARCH_AREAS = [
  { id: 'technical', name: 'Technical Indicators', desc: 'RSI, MACD, Bollinger, Ichimoku — drill into any indicator across all symbols', icon: '📈' },
  { id: 'fundamental', name: 'Fundamentals', desc: 'Earnings, P/E ratios, dividend yields, market cap analysis', icon: '📋' },
  { id: 'correlation', name: 'Correlation Matrix', desc: 'How symbols move together — pair trading and diversification insights', icon: '🔗' },
  { id: 'seasonal', name: 'Seasonal Patterns', desc: 'Month-of-year, day-of-week, and earnings season effects', icon: '📅' },
  { id: 'sentiment', name: 'Sentiment Analysis', desc: 'News sentiment, social media buzz, Fear & Greed index', icon: '💬' },
  { id: 'volatility', name: 'Volatility Surface', desc: 'IV rank, term structure, volatility cones across timeframes', icon: '📊' },
];

export default function AdvancedResearchPage() {
  const [selected, setSelected] = useState(null);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 20 }}>
        <h1>Advanced Research Engine</h1>
        <p style={{ color: '#64748b' }}>Deep-dive analysis tools for serious research</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {RESEARCH_AREAS.map(area => (
          <div key={area.id} onClick={() => setSelected(area.id)}
            style={{
              background: selected === area.id ? '#1e3a5f' : '#1a1d2e',
              border: `1px solid ${selected === area.id ? '#3b82f6' : '#2d3040'}`,
              borderRadius: 10, padding: 16, cursor: 'pointer', transition: 'all 0.2s'
            }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{area.icon}</div>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{area.name}</h3>
            <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>{area.desc}</p>
          </div>
        ))}
      </div>

      {selected && (
        <div style={{ marginTop: 20, padding: 16, background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10 }}>
          <h3>{RESEARCH_AREAS.find(a => a.id === selected)?.name}</h3>
          <p style={{ color: '#475569', fontSize: 13 }}>Research module coming soon. This area will provide deep-dive analysis tools.</p>
        </div>
      )}
    </div>
  );
}
