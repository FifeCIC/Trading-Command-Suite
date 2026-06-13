import { useState } from 'react';
import './scored-runs.css';

const MOCK_RUNS = [
  { id: 'r1', time: '2026-06-13 14:32:01', strategy: 'Forex Mean Reversion', symbols: 12, signals: 5, topScore: 87, topSymbol: 'EURUSD', duration: 234, status: 'completed', details: [
    { symbol: 'EURUSD', score: 87, signal: 'BUY' },
    { symbol: 'GBPUSD', score: 72, signal: 'BUY' },
    { symbol: 'USDJPY', score: 55, signal: 'HOLD' },
    { symbol: 'AUDUSD', score: 42, signal: 'SELL' },
    { symbol: 'NZDUSD', score: 38, signal: 'SELL' },
  ]},
  { id: 'r2', time: '2026-06-13 14:15:22', strategy: 'Tech Breakout', symbols: 8, signals: 3, topScore: 92, topSymbol: 'NVDA', duration: 187, status: 'completed', details: [
    { symbol: 'NVDA', score: 92, signal: 'BUY' },
    { symbol: 'AAPL', score: 68, signal: 'BUY' },
    { symbol: 'MSFT', score: 61, signal: 'HOLD' },
  ]},
  { id: 'r3', time: '2026-06-13 13:58:45', strategy: 'Conviction Dip', symbols: 15, signals: 8, topScore: 78, topSymbol: 'TSLA', duration: 312, status: 'completed', details: [
    { symbol: 'TSLA', score: 78, signal: 'BUY' },
    { symbol: 'META', score: 74, signal: 'BUY' },
    { symbol: 'GOOGL', score: 65, signal: 'BUY' },
  ]},
  { id: 'r4', time: '2026-06-13 13:42:10', strategy: 'Crypto Scalp', symbols: 6, signals: 2, topScore: 45, topSymbol: 'BTC-USD', duration: 156, status: 'partial', details: [
    { symbol: 'BTC-USD', score: 45, signal: 'HOLD' },
    { symbol: 'ETH-USD', score: 52, signal: 'HOLD' },
  ]},
  { id: 'r5', time: '2026-06-13 13:25:00', strategy: 'VIX Spike Fade', symbols: 3, signals: 0, topScore: 0, topSymbol: '—', duration: 0, status: 'failed', details: [] },
];

function statusIcon(status) {
  return { completed: '✅', partial: '⚠️', failed: '❌' }[status] || '⬜';
}

export default function ScoredRunsPage() {
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="sr-page">
      <header className="sr-header">
        <h1>Scored Runs</h1>
        <p>Historical scoring runs with expandable details</p>
      </header>

      <div className="sr-table-wrap">
        <table className="sr-table">
          <thead>
            <tr>
              <th></th>
              <th>Run Time</th>
              <th>Strategy</th>
              <th>Symbols</th>
              <th>Signals</th>
              <th>Top Score</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_RUNS.map((run) => (
              <>
                <tr
                  key={run.id}
                  className={`sr-row sr-${run.status} ${expanded === run.id ? 'sr-expanded' : ''}`}
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                >
                  <td><span className="sr-expand-icon">{expanded === run.id ? '▼' : '▶'}</span></td>
                  <td>{run.time}</td>
                  <td>{run.strategy}</td>
                  <td>{run.symbols}</td>
                  <td>{run.signals}</td>
                  <td className={run.topScore >= 60 ? 'sr-buy' : run.topScore >= 40 ? 'sr-hold' : 'sr-sell'}>
                    {run.topSymbol} {run.topScore || ''}
                  </td>
                  <td>{run.duration > 0 ? `${run.duration}ms` : '—'}</td>
                  <td>{statusIcon(run.status)} {run.status}</td>
                </tr>
                {expanded === run.id && run.details.length > 0 && (
                  <tr className="sr-detail-row">
                    <td colSpan={8}>
                      <div className="sr-detail-panel">
                        <h4>Symbol Scores</h4>
                        {run.details.map((d) => (
                          <div key={d.symbol} className="sr-detail-item">
                            <span className="sr-detail-symbol">{d.symbol}</span>
                            <span className="sr-detail-score">{d.score}/100</span>
                            <span className={`sr-detail-signal sr-${d.signal.toLowerCase()}`}>{d.signal}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
