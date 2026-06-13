const DIRECTIVES = [
  { id: 'rsi-oversold', name: 'RSI Oversold', momentum: true, trend: false, volatility: false, volume: false, pattern: false },
  { id: 'macd-crossover', name: 'MACD Crossover', momentum: true, trend: true, volatility: false, volume: false, pattern: false },
  { id: 'ema-structure', name: 'EMA Structure', momentum: false, trend: true, volatility: false, volume: false, pattern: false },
  { id: 'atr-dip', name: 'ATR Dip', momentum: false, trend: false, volatility: true, volume: false, pattern: false },
  { id: 'volume-confirmation', name: 'Volume Conf.', momentum: false, trend: false, volatility: false, volume: true, pattern: false },
  { id: 'engulfing-pattern', name: 'Engulfing', momentum: false, trend: false, volatility: false, volume: false, pattern: true },
  { id: 'williams-r', name: 'Williams %R', momentum: true, trend: false, volatility: false, volume: false, pattern: false },
  { id: 'supertrend', name: 'SuperTrend', momentum: false, trend: true, volatility: true, volume: false, pattern: false },
  { id: 'ichimoku-cloud', name: 'Ichimoku', momentum: false, trend: true, volatility: false, volume: false, pattern: true },
  { id: 'chaikin-mf', name: 'Chaikin MF', momentum: false, trend: false, volatility: false, volume: true, pattern: false },
  { id: 'donchian-breakout', name: 'Donchian', momentum: false, trend: true, volatility: true, volume: false, pattern: false },
  { id: 'bollinger-pct-b', name: 'Boll. %B', momentum: false, trend: false, volatility: true, volume: false, pattern: false },
  { id: 'parabolic-sar', name: 'Parabolic SAR', momentum: false, trend: true, volatility: false, volume: false, pattern: false },
  { id: 'adx-di-crossover', name: 'ADX DI Cross', momentum: true, trend: true, volatility: false, volume: false, pattern: false },
  { id: 'momentum-roc', name: 'Momentum ROC', momentum: true, trend: false, volatility: false, volume: false, pattern: false },
];
const CAPS = ['momentum', 'trend', 'volatility', 'volume', 'pattern'];

export default function DirectiveCapabilitiesMatrixPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16 }}>
        <h1>Directive Capabilities Matrix</h1>
        <p style={{ color: '#64748b' }}>Which directive covers which capability — helps identify gaps and overlaps</p>
      </header>

      <div style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3040' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b' }}>Directive</th>
              {CAPS.map(c => <th key={c} style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b', textTransform: 'uppercase', fontSize: 10 }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {DIRECTIVES.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid #111318' }}>
                <td style={{ padding: '8px 14px', fontWeight: 500 }}>{d.name}</td>
                {CAPS.map(c => (
                  <td key={c} style={{ padding: '8px', textAlign: 'center' }}>
                    {d[c] ? <span style={{ color: '#4ade80', fontSize: 14 }}>●</span> : <span style={{ color: '#374151', fontSize: 14 }}>○</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
