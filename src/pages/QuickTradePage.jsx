import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './quick-trade.css';

const SYMBOLS = ['EURUSD', 'GBPUSD', 'BTCUSD', 'ETHUSD', 'AAPL', 'NVDA'];
const TRADE_AMOUNTS = [1, 5, 10, 25, 50, 100];

export default function QuickTradePage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [amount, setAmount] = useState(1);
  const [positions, setPositions] = useState([]);
  const [tradeLog, setTradeLog] = useState([]);

  // Fetch scoring data for quick reference
  const scoresQuery = useQuery({
    queryKey: ['quick-scores'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=10'),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const ranked = scoresQuery.data?.ranked || [];
  const symbolScore = ranked.find(r => r.ticker === symbol) || {};

  function executeTrade(direction) {
    const now = new Date();
    const price = symbolScore.score ? 100 + symbolScore.score / 10 : 100;
    const pnl = direction === 'buy' ? amount * 0.1 : -amount * 0.05;
    const trade = {
      id: `qt-${Date.now()}`,
      symbol,
      direction,
      amount,
      price: price.toFixed(2),
      pnl: pnl.toFixed(2),
      time: now.toLocaleTimeString(),
    };
    setTradeLog(prev => [trade, ...prev].slice(0, 50));

    if (direction === 'buy') {
      setPositions(prev => [...prev, { ...trade, status: 'open' }]);
    } else {
      // Close longest-held position
      setPositions(prev => {
        const idx = prev.findIndex(p => p.symbol === symbol && p.status === 'open');
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'closed', exitPrice: price.toFixed(2), pnl: (price - Number(updated[idx].price)).toFixed(2) };
          return updated;
        }
        return [...prev, { ...trade, status: 'open' }]; // short open
      });
    }
  }

  const openPositions = positions.filter(p => p.status === 'open');
  const totalPnl = tradeLog.reduce((s, t) => s + Number(t.pnl), 0);

  return (
    <div className="qt-page">
      <div className="qt-panels">
        {/* Left: Scoring Panel */}
        <div className="qt-panel qt-scoring">
          <h3>Top Signals</h3>
          <div className="qt-signal-list">
            {ranked.slice(0, 6).map((s) => (
              <button
                key={s.ticker}
                type="button"
                className={`qt-signal-row ${s.ticker === symbol ? 'qt-active' : ''}`}
                onClick={() => setSymbol(s.ticker)}
              >
                <span className="qt-sig-symbol">{s.ticker}</span>
                <span className={`qt-sig-score ${s.signal === 'entry' ? 'qt-bullish' : s.signal === 'defensive' ? 'qt-bearish' : ''}`}>
                  {s.score?.toFixed(0) || '—'}
                </span>
                <span className="qt-sig-signal">{s.signal}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Center: Chart Area (placeholder) */}
        <div className="qt-panel qt-chart">
          <h3>{symbol}</h3>
          <div className="qt-chart-placeholder">
            <div className="qt-price-display">
              <span className="qt-price-label">Score</span>
              <span className="qt-price-value">{symbolScore.score?.toFixed(1) || '—'}</span>
              <span className="qt-price-signal">{symbolScore.signal || 'no data'}</span>
            </div>
            <p className="qt-chart-hint">Connect a provider for live chart data</p>
          </div>
        </div>

        {/* Right: Trade Controls */}
        <div className="qt-panel qt-controls">
          <h3>Quick Trade</h3>

          <div className="qt-symbol-select">
            <label>Symbol</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="qt-amount-select">
            <label>Amount ($)</label>
            <div className="qt-amount-grid">
              {TRADE_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`qt-amount-btn ${amount === a ? 'qt-active' : ''}`}
                  onClick={() => setAmount(a)}
                >
                  ${a}
                </button>
              ))}
            </div>
          </div>

          <div className="qt-trade-buttons">
            <button type="button" className="qt-buy-btn" onClick={() => executeTrade('buy')}>
              ▲ BUY ${amount}
            </button>
            <button type="button" className="qt-sell-btn" onClick={() => executeTrade('sell')}>
              ▼ SELL ${amount}
            </button>
          </div>

          <div className="qt-summary">
            <div className="qt-summary-row">
              <span>P&L Today</span>
              <span className={totalPnl >= 0 ? 'qt-profit' : 'qt-loss'}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
              </span>
            </div>
            <div className="qt-summary-row">
              <span>Open Positions</span>
              <span>{openPositions.length}</span>
            </div>
          </div>

          {openPositions.length > 0 && (
            <div className="qt-positions">
              <h4>Positions</h4>
              {openPositions.map((p) => (
                <div key={p.id} className="qt-position-row">
                  <span>{p.symbol}</span>
                  <span>{p.direction.toUpperCase()}</span>
                  <span>${p.amount}</span>
                  <span>@ {p.price}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trade Log */}
      {tradeLog.length > 0 && (
        <div className="qt-log">
          <h4>Trade Log</h4>
          <div className="qt-log-entries">
            {tradeLog.slice(0, 20).map((t) => (
              <div key={t.id} className={`qt-log-entry ${t.direction === 'buy' ? 'qt-log-buy' : 'qt-log-sell'}`}>
                <span>{t.time}</span>
                <span>{t.symbol}</span>
                <span>{t.direction.toUpperCase()}</span>
                <span>${t.amount}</span>
                <span className={Number(t.pnl) >= 0 ? 'qt-profit' : 'qt-loss'}>
                  {Number(t.pnl) >= 0 ? '+' : ''}{t.pnl}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="qt-disclaimer">
        <p>⚠️ Demo mode — no real trades executed. Connect Trading212 or MT5 for live trading. See docs/TRADING-CONSTRAINTS.md for minimum trade sizes.</p>
      </div>
    </div>
  );
}
