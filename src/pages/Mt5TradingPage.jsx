import { useState, useEffect, useCallback } from 'react';
import AccountSummary from '../components/mt5/AccountSummary';
import PositionsTable from '../components/mt5/PositionsTable';
import OrderForm from '../components/mt5/OrderForm';

export default function Mt5TradingPage() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [quote, setQuote] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const diagRes = await fetch('/api/providers/mt5/diagnostics');
      const diag = await diagRes.json();
      setConnected(diag.connected);
      setAccount(diag.account ? { ...diag.account, balance: diag.balance, equity: diag.equity, server: diag.server } : null);
      if (diag.lastQuote) setQuote(diag.lastQuote);

      if (diag.connected) {
        const [posRes, histRes] = await Promise.all([
          fetch('/api/providers/mt5/positions'),
          fetch('/api/providers/mt5/history'),
        ]);
        const posData = await posRes.json();
        const histData = await histRes.json();
        setPositions(Array.isArray(posData.positions) ? posData.positions : posData);
        setHistory(Array.isArray(histData.orders) ? histData.orders : histData);
      }
      setError('');
    } catch (err) {
      setError('MT5 bridge unreachable — start the Python bridge');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handlePlaceOrder(order) {
    try {
      const res = await fetch('/api/providers/mt5/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`Order placed: ${order.volume} ${order.symbol}`);
        setTimeout(() => setMsg(''), 4000);
        fetchData();
      } else {
        setError(data.error || 'Order failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClosePosition(ticket) {
    try {
      const res = await fetch(`/api/providers/mt5/close/${ticket}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMsg(`Position #${ticket} closed`);
        setTimeout(() => setMsg(''), 4000);
        fetchData();
      } else {
        setError(data.error || 'Close failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="mt5-page"><p>Connecting to MT5…</p></div>;

  return (
    <div className="mt5-page">
      <h1>MT5 Trading</h1>

      {msg && <div className="mt5-msg">{msg}</div>}
      {error && <div className="mt5-error">{error} <button type="button" onClick={() => setError('')}>✕</button></div>}

      <AccountSummary account={account} connected={connected} />

      <div className="mt5-panels">
        <div className="mt5-panel mt5-panel-positions">
          <div className="mt5-panel-header">
            <h2>Open Positions</h2>
            {positions.length > 0 && (
              <button type="button" className="mt5-close-all" onClick={() => positions.forEach((p) => handleClosePosition(p.ticket))}>
                Close All
              </button>
            )}
          </div>
          <PositionsTable positions={positions} onClose={handleClosePosition} />
        </div>

        <div className="mt5-panel mt5-panel-order">
          <h2>Place Order</h2>
          <OrderForm quote={quote} onPlaceOrder={handlePlaceOrder} />
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt5-panel mt5-panel-history">
          <h2>Recent History</h2>
          <table className="mt5-table">
            <thead>
              <tr><th>Time</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Status</th></tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((h, i) => (
                <tr key={h.ticket || i}>
                  <td>{h.time ? new Date(h.time * 1000).toLocaleTimeString() : '—'}</td>
                  <td><strong>{h.symbol}</strong></td>
                  <td className={h.type === 0 ? 'mt5-green' : 'mt5-red'}>{h.type === 0 ? 'BUY' : 'SELL'}</td>
                  <td>{h.volume?.toFixed(2)}</td>
                  <td>{h.price?.toFixed(5)}</td>
                  <td>{h.state || h.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
