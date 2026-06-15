import { useState, useEffect, useCallback } from 'react';
import './Mt5DemoTradingPage.css';

const SYMBOLS = ['EURUSD','GBPUSD','USDJPY','AUDUSD','NZDUSD','USDCAD','XAUUSD','BTCUSD'];
const SIZE_PRESETS = [0.01, 0.1, 0.5, 1.0];

export default function Mt5DemoTradingPage() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('positions');
  const [symbol, setSymbol] = useState('EURUSD');
  const [type, setType] = useState('BUY');
  const [volume, setVolume] = useState(0.01);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [acc, pos] = await Promise.all([
        fetch('/api/trading/mt5/account').then(r => r.json()),
        fetch('/api/trading/mt5/positions').then(r => r.json()),
      ]);
      setAccount(acc);
      setPositions(Array.isArray(pos) ? pos : []);
    } catch { /* bridge offline */ }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 3000); return () => clearInterval(i); }, [fetchData]);

  const placeOrder = async () => {
    setLoading(true); setMsg('');
    const body = { symbol, type, volume: Number(volume) };
    if (sl) body.sl = Number(sl);
    if (tp) body.tp = Number(tp);
    try {
      const r = await fetch('/api/trading/mt5/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      setMsg(d.success ? `✅ Order placed — ticket #${d.ticket}` : `❌ ${d.error}`);
      fetchData();
    } catch { setMsg('❌ Bridge offline'); }
    setLoading(false);
  };

  const closePosition = async (ticket) => {
    await fetch(`/api/trading/mt5/close/${ticket}`, { method: 'DELETE' });
    fetchData();
  };

  const closeAll = async () => {
    if (!confirm('Close ALL positions?')) return;
    await fetch('/api/trading/mt5/close-all', { method: 'POST' });
    fetchData();
  };

  const loadHistory = async () => {
    try { const r = await fetch('/api/trading/mt5/history'); setHistory(await r.json()); setTab('history'); } catch {}
  };

  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);

  return (
    <div className="mt5-trading-page">
      <div className="mt5-header">
        <h1>💰 MT5 Demo Trading</h1>
        <span className="mt5-demo-badge">📝 MetaQuotes-Demo #10011309743</span>
      </div>

      {account && (
        <div className="mt5-account-bar">
          <div className="mt5-acct-card"><span>Balance</span><strong>${account.balance?.toFixed(2)}</strong></div>
          <div className="mt5-acct-card"><span>Equity</span><strong>${account.equity?.toFixed(2)}</strong></div>
          <div className="mt5-acct-card"><span>Margin</span><strong>${account.margin?.toFixed(2)}</strong></div>
          <div className="mt5-acct-card"><span>Free</span><strong>${account.margin_free?.toFixed(2)}</strong></div>
          <div className={`mt5-acct-card ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
            <span>P&L</span><strong>${totalPnl.toFixed(2)}</strong>
          </div>
        </div>
      )}

      {!account && <div className="mt5-offline">⚠️ MT5 Bridge offline — start mt5_bridge.py on port 5000</div>}

      <div className="mt5-layout">
        <div className="mt5-trade-panel">
          <h3>Quick Trade</h3>
          <div className="mt5-form">
            <select value={symbol} onChange={e => setSymbol(e.target.value)}>
              {SYMBOLS.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="mt5-type-btns">
              <button className={type === 'BUY' ? 'buy active' : 'buy'} onClick={() => setType('BUY')}>BUY</button>
              <button className={type === 'SELL' ? 'sell active' : 'sell'} onClick={() => setType('SELL')}>SELL</button>
            </div>
            <label>Volume</label>
            <div className="mt5-volume-presets">
              {SIZE_PRESETS.map(s => (
                <button key={s} className={volume === s ? 'active' : ''} onClick={() => setVolume(s)}>{s}</button>
              ))}
            </div>
            <input type="number" value={volume} onChange={e => setVolume(Number(e.target.value))} step="0.01" min="0.01" />
            <input type="number" placeholder="SL (price)" value={sl} onChange={e => setSl(e.target.value)} />
            <input type="number" placeholder="TP (price)" value={tp} onChange={e => setTp(e.target.value)} />
            <button className="mt5-place-btn" onClick={placeOrder} disabled={loading}>
              {loading ? '⏳' : type === 'BUY' ? '🟢 BUY' : '🔴 SELL'} {symbol} {volume}
            </button>
            {msg && <div className={`mt5-msg ${msg.includes('✅') ? 'ok' : 'err'}`}>{msg}</div>}
          </div>
        </div>

        <div className="mt5-positions-area">
          <div className="mt5-tabs">
            <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>
              Positions ({positions.length})
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={loadHistory}>History</button>
            {positions.length > 0 && (
              <button className="mt5-close-all" onClick={closeAll}>Close All</button>
            )}
          </div>

          {tab === 'positions' && (
            <table className="mt5-table">
              <thead><tr><th>Ticket</th><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Current</th><th>SL</th><th>TP</th><th>P&L</th><th></th></tr></thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.ticket} className={p.profit >= 0 ? 'positive' : 'negative'}>
                    <td>{p.ticket}</td><td><strong>{p.symbol}</strong></td>
                    <td>{p.type === 0 ? '🟢 BUY' : '🔴 SELL'}</td>
                    <td>{p.volume}</td>
                    <td>{p.price_open?.toFixed(5)}</td>
                    <td>{p.price_current?.toFixed(5)}</td>
                    <td>{p.sl || '—'}</td><td>{p.tp || '—'}</td>
                    <td className={p.profit >= 0 ? 'profit' : 'loss'}>${p.profit?.toFixed(2)}</td>
                    <td><button className="mt5-close-btn" onClick={() => closePosition(p.ticket)}>Close</button></td>
                  </tr>
                ))}
                {positions.length === 0 && <tr><td colSpan="10" className="empty">No open positions</td></tr>}
              </tbody>
            </table>
          )}

          {tab === 'history' && (
            <table className="mt5-table">
              <thead><tr><th>Ticket</th><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Close</th><th>P&L</th><th>Time</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className={h.profit >= 0 ? 'positive' : 'negative'}>
                    <td>{h.ticket || h.position}</td><td><strong>{h.symbol}</strong></td>
                    <td>{h.type === 0 ? 'BUY' : 'SELL'}</td><td>{h.volume}</td>
                    <td>{h.price_open?.toFixed(5)}</td><td>{h.price_close?.toFixed(5)}</td>
                    <td className={h.profit >= 0 ? 'profit' : 'loss'}>${h.profit?.toFixed(2)}</td>
                    <td>{h.time ? new Date(h.time * 1000).toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan="8" className="empty">No history</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
