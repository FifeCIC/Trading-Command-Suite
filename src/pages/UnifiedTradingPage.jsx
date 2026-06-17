import { useState, useEffect, useCallback } from 'react';
import AccountSummary from '../components/mt5/AccountSummary';
import PositionsTable from '../components/mt5/PositionsTable';
import OrderForm from '../components/mt5/OrderForm';
import './UnifiedTradingPage.css';

export default function UnifiedTradingPage() {
  const [mode, setMode] = useState('demo'); // 'demo' | 'live'
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [quote, setQuote] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [activeTab, setActiveTab] = useState('positions');

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
        setPositions(Array.isArray(posData.positions) ? posData.positions : posData || []);
        setHistory(Array.isArray(histData.orders) ? histData.orders : histData || []);
      }
      setError('');
    } catch (err) {
      setError('MT5 bridge unreachable — start the Python bridge from Server Controls');
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

  async function handleCloseAll() {
    if (!window.confirm('Close ALL open positions?')) return;
    try {
      const res = await fetch('/api/providers/mt5/close-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMsg(`Closed ${data.closed || 'all'} positions`);
        setTimeout(() => setMsg(''), 4000);
        fetchData();
      } else {
        setError(data.error || 'Close all failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="utp-page"><p>Loading MT5 data...</p></div>;

  return (
    <div className="utp-page">
      <header className="utp-header">
        <h2>MT5 Trading</h2>
        <p>Unified trading interface — demo and live accounts.</p>
      </header>

      {/* Mode toggle */}
      <div className="utp-mode-bar">
        <div className="utp-mode-toggle">
          <button className={`utp-mode-btn ${mode === 'demo' ? 'active' : ''}`} onClick={() => setMode('demo')}>
            🟡 Demo
          </button>
          <button className={`utp-mode-btn ${mode === 'live' ? 'active' : ''}`} onClick={() => setMode('live')}>
            🔴 Live
          </button>
        </div>
        <div className="utp-mode-info">
          {mode === 'demo' ? (
            <span className="utp-badge utp-badge-demo">Demo Mode — Paper Trading</span>
          ) : (
            <span className="utp-badge utp-badge-live">
              {connected ? `Live — ${account?.server || 'Connected'}` : '⚠️ Live mode — connect a live account'}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && <div className="utp-msg utp-msg-error">{error}<button onClick={() => setError('')}>✕</button></div>}
      {msg && <div className="utp-msg utp-msg-success">{msg}</div>}

      {/* Account Summary */}
      {account && <AccountSummary account={account} />}
      {!connected && !account && <p className="utp-muted">Not connected to MT5. Start the bridge and ensure MT5 terminal is running.</p>}

      {/* Quick Trade Panel */}
      <section className="utp-section">
        <h3>Quick Trade</h3>
        <OrderForm onPlaceOrder={handlePlaceOrder} quote={quote} connected={connected} />
      </section>

      {/* Tab bar */}
      <div className="utp-tabs">
        <button className={`utp-tab ${activeTab === 'positions' ? 'active' : ''}`} onClick={() => setActiveTab('positions')}>
          Positions ({positions.length})
        </button>
        <button className={`utp-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          History
        </button>
        <div className="utp-tab-actions">
          {positions.length > 0 && (
            <button className="utp-btn utp-btn-danger" onClick={handleCloseAll}>Close All</button>
          )}
        </div>
      </div>

      {/* Positions */}
      {activeTab === 'positions' && (
        <section className="utp-section">
          <PositionsTable positions={positions} onClose={handleClosePosition} />
        </section>
      )}

      {/* History */}
      {activeTab === 'history' && (
        <section className="utp-section">
          {history.length === 0 ? (
            <p className="utp-muted">No trade history available.</p>
          ) : (
            <table className="utp-table">
              <thead>
                <tr>
                  <th>Ticket</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th>
                  <th>SL</th><th>TP</th><th>Time</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 50).map((h, i) => (
                  <tr key={i}>
                    <td>{h.ticket}</td><td>{h.symbol}</td>
                    <td className={h.type === 'buy' ? 'utp-buy' : 'utp-sell'}>{h.type}</td>
                    <td>{h.volume}</td><td>{h.price}</td>
                    <td>{h.sl || '—'}</td><td>{h.tp || '—'}</td>
                    <td>{h.time ? new Date(h.time).toLocaleString() : '—'}</td>
                    <td>{h.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
