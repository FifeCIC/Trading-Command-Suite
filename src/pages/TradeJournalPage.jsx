import { useState } from 'react';

const MOCK_TRADES = [
  { id: 't1', date: '2026-06-13', symbol: 'EURUSD', direction: 'BUY', entry: 1.0850, exit: 1.0920, qty: 0.10, pnl: 70.00, notes: 'RSI oversold bounce — mean reversion play' },
  { id: 't2', date: '2026-06-13', symbol: 'NVDA', direction: 'BUY', entry: 870, exit: 885, qty: 5, pnl: 75.00, notes: 'Breakout above Donchian channel' },
  { id: 't3', date: '2026-06-12', symbol: 'BTC-USD', direction: 'SELL', entry: 67200, exit: 66800, qty: 0.01, pnl: 4.00, notes: 'Short scalp — RSI overbought on 15m' },
  { id: 't4', date: '2026-06-12', symbol: 'TSLA', direction: 'BUY', entry: 245, exit: 238, qty: 10, pnl: -70.00, notes: 'Dip buy failed — stopped out at -2.8%' },
  { id: 't5', date: '2026-06-11', symbol: 'GBPUSD', direction: 'SELL', entry: 1.2710, exit: 1.2680, qty: 0.10, pnl: 30.00, notes: 'London breakout fade' },
];

export default function TradeJournalPage() {
  const [trades] = useState(MOCK_TRADES);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, color: '#e2e8f0' }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>Trade Journal</h1><p style={{ color: '#64748b' }}>Manual trade log and performance review</p></div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: totalPnl >= 0 ? '#4ade80' : '#f87171' }}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{trades.length} trades · {wins} wins</div>
        </div>
      </header>

      <div style={{ background: '#1a1d2e', border: '1px solid #2d3040', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3040', color: '#64748b', fontSize: 11 }}>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Symbol</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Dir</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Entry</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Exit</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Qty</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>P&L</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #111318' }}>
                <td style={{ padding: '10px 14px' }}>{t.date}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{t.symbol}</td>
                <td style={{ padding: '10px 14px', color: t.direction === 'BUY' ? '#4ade80' : '#f87171' }}>{t.direction}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{t.entry}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{t.exit}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{t.qty}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: t.pnl >= 0 ? '#4ade80' : '#f87171' }}>{t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}</td>
                <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 12, maxWidth: 250 }}>{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
