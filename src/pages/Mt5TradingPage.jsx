import { useState, useEffect, useCallback, useRef } from 'react';
import PositionsTable from '../components/mt5/PositionsTable';
import OrderForm from '../components/mt5/OrderForm';
import { PAGE_WIDTHS, readPageWidth } from '../core/page-width';
import './mt5-trading-page.css';

const PLATFORMS = [
  { id: 'mt5', label: 'MT5', icon: '📊', available: true },
  { id: 'trading212', label: 'Trading 212', icon: '📈', available: false },
  { id: 'alpaca', label: 'Alpaca', icon: '🦙', available: false },
];

export default function Mt5TradingPage() {
  // ── Mode & Platform ──
  const [mode, setMode] = useState('demo'); // 'demo' | 'live'
  const [platform, setPlatform] = useState('mt5');

  // ── Layout ──
  // ⚠️ THE WIDTH CONTROL MOVED TO SCREEN OPTIONS (owner direction, 2026-10-08). It was an in-page
  // bar (`.mt5u-layout-bar`) — a page-layout preference sitting somewhere different from every other
  // page's settings. It now lives in the global Screen Options rail, under the key declared in
  // src/core/page-width.js, which the registry imports too so the two cannot disagree.
  //
  // Read DURING RENDER, not into state: the Screen Options rail writes localStorage and then closes,
  // which re-renders this page and picks the new value up. This mirrors ScreenerPage's readTopPicks().
  // Do NOT convert it to a mount-time effect — the width would then only change on a full reload,
  // which reads as "the setting does nothing".
  const layoutWidth = readPageWidth();

  // ── Data State ──
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [quote, setQuote] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // ── Accounts ──
  const [accounts, setAccounts] = useState([]);
  const [activeAccountNum, setActiveAccountNum] = useState(null);

  // ── UI Tabs ──
  const [activeTab, setActiveTab] = useState('positions');

  // ── Live Safety ──
  const [liveWarningAcknowledged, setLiveWarningAcknowledged] = useState(false);

  // ── Connection Tracking ──
  const wasEverConnected = useRef(false);
  const [offlineReason, setOfflineReason] = useState('initial'); // 'initial' | 'lost' | 'error'

  // Track connection transitions
  useEffect(() => {
    if (connected) {
      wasEverConnected.current = true;
      setOfflineReason('initial');
    } else if (!loading && wasEverConnected.current) {
      setOfflineReason('lost');
    }
  }, [connected, loading]);

  // ── Fetch Accounts ──
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/providers/mt5/accounts');
      const data = await res.json();
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch { /* silent */ }
  }, []);

  // ── Main Data Fetch ──
  const fetchData = useCallback(async () => {
    try {
      const diagRes = await fetch('/api/providers/mt5/diagnostics');
      const diag = await diagRes.json();
      const isConnected = diag.connected === true;
      setConnected(isConnected);
      setAccount(diag.account
        ? { ...diag.account, balance: diag.balance, equity: diag.equity, server: diag.server }
        : null);
      if (diag.lastQuote) setQuote(diag.lastQuote);
      if (diag.activeAccount) setActiveAccountNum(diag.activeAccount);

      if (isConnected) {
        const [posRes, histRes] = await Promise.all([
          fetch('/api/providers/mt5/positions'),
          fetch('/api/providers/mt5/history'),
        ]);
        const posData = await posRes.json();
        const histData = await histRes.json();
        setPositions(Array.isArray(posData.positions) ? posData.positions : posData || []);
        setHistory(Array.isArray(histData.orders) ? histData.orders : histData || []);
      } else {
        // Bridge responded but is not connected — clear stale data
        setPositions([]);
        setHistory([]);
      }
      setError('');
    } catch {
      // Bridge unreachable — force offline state, clear stale data
      setConnected(false);
      setPositions([]);
      setHistory([]);
      setAccount(null);
      setError('MT5 bridge unreachable — start the Python bridge from Server Controls');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Refresh All ──
  const refreshAll = useCallback(() => {
    setLoading(true);
    fetchAccounts();
    fetchData();
  }, [fetchAccounts, fetchData]);

  useEffect(() => {
    refreshAll();
    if (!connected) return; // don't poll when offline
    const interval = setInterval(refreshAll, 10000);
    return () => clearInterval(interval);
  }, [refreshAll, connected]);

  // ── Account Switching ──
  async function handleSwitchAccount(accountNum) {
    try {
      const res = await fetch(`/api/providers/mt5/switch/${accountNum}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMsg(`Switched to account #${accountNum}`);
        setTimeout(() => setMsg(''), 4000);
        setLoading(true);
        setTimeout(refreshAll, 2000); // Give bridge time to reconnect
      } else {
        setError(data.error || 'Account switch failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // ── Remove Account ──
  async function handleRemoveAccount(accountNum) {
    if (!window.confirm(`Remove account #${accountNum} from the bridge?`)) return;
    try {
      const res = await fetch('/api/providers/mt5/accounts/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: accountNum }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`Removed account ${data.removed}`);
        setTimeout(() => setMsg(''), 4000);
        fetchAccounts();
      } else {
        setError(data.error || 'Remove failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // ── Mode Toggle ──
  function handleModeChange(newMode) {
    if (newMode === 'live' && !liveWarningAcknowledged) {
      const confirmed = window.confirm(
        '⚠️ You are switching to LIVE trading mode.\n\n' +
        'Real money will be used for all orders.\n' +
        'Position size limits and confirmations are enabled.\n\n' +
        'Are you sure you want to proceed?'
      );
      if (!confirmed) return;
      setLiveWarningAcknowledged(true);
    }
    setMode(newMode);
  }

  // ── Place Order ──
  async function handlePlaceOrder(order) {
    if (mode === 'live') {
      const confirmed = window.confirm(
        `⚠️ LIVE ORDER CONFIRMATION\n\n` +
        `${order.type?.toUpperCase() || 'MARKET'} ${order.volume} ${order.symbol}\n` +
        `SL: ${order.sl || 'none'} | TP: ${order.tp || 'none'}\n\n` +
        `This will execute on your LIVE account. Proceed?`
      );
      if (!confirmed) return;
    }

    try {
      const res = await fetch('/api/trading/mt5/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...order, origin: 'user' }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`✅ Order placed: ${order.volume} ${order.symbol} — Ticket #${data.ticket || '—'}`);
        setTimeout(() => setMsg(''), 5000);
        fetchData();
      } else {
        setError(data.error || 'Order failed');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // ── Close Position ──
  async function handleClosePosition(ticket) {
    if (mode === 'live') {
      const confirmed = window.confirm(`⚠️ Close live position #${ticket}?`);
      if (!confirmed) return;
    }
    try {
      const res = await fetch(`/api/trading/mt5/close/${ticket}`, { method: 'DELETE' });
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

  // ── Close All ──
  async function handleCloseAll() {
    const count = positions.length;
    const warning = mode === 'live'
      ? `⚠️ LIVE ACCOUNT — Close ALL ${count} open position${count !== 1 ? 's' : ''}? This cannot be undone.`
      : `Close ALL ${count} open position${count !== 1 ? 's' : ''}?`;

    if (!window.confirm(warning)) return;

    try {
      const res = await fetch('/api/trading/mt5/close-all', { method: 'POST' });
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

  // ── Load History ──
  async function loadHistory() {
    try {
      const res = await fetch('/api/providers/mt5/history');
      const data = await res.json();
      setHistory(Array.isArray(data.orders) ? data.orders : data || []);
      setActiveTab('history');
    } catch { /* silent */ }
  }

  // ── Computed ──
  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const activeAccountInfo = accounts.find(a => String(a.number) === String(activeAccountNum));

  // ── Loading State ──
  if (loading) {
    return (
      <div className="mt5u-page">
        <div className="mt5u-loading">
          <div className="mt5u-spinner" />
          <p>Connecting to MT5…</p>
        </div>
      </div>
    );
  }

  // ── Offline State (after initial load attempt fails, or connection lost) ──
  if (!connected) {
    const isReconnecting = offlineReason === 'lost';
    return (
      <div className="mt5u-page">
        <div className={`mt5u-offline-full ${isReconnecting ? 'mt5u-offline-reconnecting' : ''}`}>
          <div className="mt5u-offline-icon">{isReconnecting ? '🔌' : '📡'}</div>
          <h2>{isReconnecting ? 'Connection Lost' : 'MT5 Bridge Offline'}</h2>
          <p>
            {isReconnecting
              ? 'The MT5 bridge connection was lost. All trading panels have been suspended.'
              : 'Start the MT5 bridge to enable trading.'}
          </p>
          <div className="mt5u-offline-steps">
            <div className="mt5u-offline-step">
              <span className="mt5u-offline-step-num">1</span>
              <span>Run <code>mt5_bridge.py</code> or use Server Controls</span>
            </div>
            <div className="mt5u-offline-step">
              <span className="mt5u-offline-step-num">2</span>
              <span>Ensure MetaTrader 5 is logged in to your account</span>
            </div>
            <div className="mt5u-offline-step">
              <span className="mt5u-offline-step-num">3</span>
              <span>Click <strong>Retry Connection</strong> below</span>
            </div>
          </div>
          <button
            type="button"
            className="mt5u-offline-retry"
            onClick={() => { setLoading(true); setError(''); refreshAll(); }}
          >
            {isReconnecting ? 'Reconnect to Bridge' : 'Retry Connection'}
          </button>
          {error && <p className="mt5u-offline-error">{error}</p>}
          <p className="mt5u-offline-hint">
            Tip: Check Server Controls → MT5 Bridge status, or run <code>python mt5_bridge.py</code> in a terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt5u-page" style={{ '--page-max-width': PAGE_WIDTHS[layoutWidth].maxWidth }}>
      {/* Width is set in the global Screen Options rail — see the note on `layoutWidth` above. */}

      {/* ── Header ── */}
      <div className="mt5u-header">
        <div className="mt5u-header-left">
          <h1>Manual Trading</h1>
          {activeAccountInfo && (
            <span className={`mt5u-account-badge ${mode === 'demo' ? 'mt5u-badge-demo' : 'mt5u-badge-live'}`}>
              {mode === 'demo' ? '🟡' : '🟢'} {activeAccountInfo.login} @ {activeAccountInfo.server || '—'}
            </span>
          )}
        </div>

        {/* Platform Selector */}
        <div className="mt5u-platform-selector">
          <span className="mt5u-platform-label">Execute on:</span>
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              className={`mt5u-platform-btn ${platform === p.id ? 'active' : ''}`}
              disabled={!p.available}
              onClick={() => p.available && setPlatform(p.id)}
              title={p.available ? `Trade via ${p.label}` : `${p.label} — coming soon`}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mode Toggle ── */}
      <div className="mt5u-mode-bar">
        <div className="mt5u-mode-toggle">
          <button
            className={`mt5u-mode-btn ${mode === 'demo' ? 'active demo' : ''}`}
            onClick={() => handleModeChange('demo')}
          >
            🟡 Demo
          </button>
          <button
            className={`mt5u-mode-btn ${mode === 'live' ? 'active live' : ''}`}
            onClick={() => handleModeChange('live')}
          >
            🔴 Live
          </button>
        </div>

        {/* Account Dropdown */}
        {accounts.length > 0 && (
          <div className="mt5u-account-selector">
            <label>Account:</label>
            <select
              value={activeAccountNum || ''}
              onChange={(e) => handleSwitchAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.number} value={a.number}>
                  {a.login} @ {a.server} {String(a.number) === String(activeAccountNum) ? '(active)' : ''}
                </option>
              ))}
            </select>
            {accounts.map((a) => (
              <button
                key={`rm-${a.number}`}
                type="button"
                className="mt5u-remove-btn"
                onClick={() => handleRemoveAccount(a.number)}
                title={`Remove ${a.login}`}
              >
                ✕
              </button>
            ))}
          </div>
        )}

        <div className="mt5u-mode-warning">
          {mode === 'demo' ? (
            <span className="mt5u-badge mt5u-badge-demo">📝 Demo Mode — Paper Trading</span>
          ) : (
            <span className="mt5u-badge mt5u-badge-live">
              ⚠️ LIVE TRADING — Real Money
            </span>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      {msg && <div className="mt5u-msg mt5u-msg-success">{msg}</div>}
      {error && (
        <div className="mt5u-msg mt5u-msg-error">
          {error}
          <button type="button" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* ── Account Summary ── */}
      {account && (
        <div className="mt5u-account-bar">
          <div className="mt5u-acct-card">
            <span>Balance</span>
            <strong>${account.balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}</strong>
          </div>
          <div className="mt5u-acct-card">
            <span>Equity</span>
            <strong>${account.equity?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}</strong>
          </div>
          <div className="mt5u-acct-card">
            <span>Margin</span>
            <strong>${account.margin?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}</strong>
          </div>
          <div className="mt5u-acct-card">
            <span>Free Margin</span>
            <strong>${account.freeMargin?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}</strong>
          </div>
          <div className={`mt5u-acct-card ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
            <span>Unrealized P&amp;L</span>
            <strong>{totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="mt5u-acct-card">
            <span>Server</span>
            <strong>{account.server || '—'}</strong>
          </div>
        </div>
      )}
      {/* ── Main Layout ── */}
      <div className="mt5u-layout">
        {/* Quick Trade Panel */}
        <div className="mt5u-trade-panel">
          <h3>Quick Trade</h3>
          <OrderForm quote={quote} onPlaceOrder={handlePlaceOrder} />
        </div>

        {/* Positions Area */}
        <div className="mt5u-positions-area">
          <div className="mt5u-tabs">
            <button
              className={`mt5u-tab ${activeTab === 'positions' ? 'active' : ''}`}
              onClick={() => setActiveTab('positions')}
            >
              Positions ({positions.length})
            </button>
            <button
              className={`mt5u-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={loadHistory}
            >
              History
            </button>
            {positions.length > 0 && (
              <button className="mt5u-close-all" onClick={handleCloseAll}>
                Close All
              </button>
            )}
          </div>

          {/* Positions Table */}
          {activeTab === 'positions' && (
            <div className="mt5u-table-wrap">
              <PositionsTable positions={positions} onClose={handleClosePosition} />
            </div>
          )}

          {/* History Table */}
          {activeTab === 'history' && (
            <div className="mt5u-table-wrap">
              {history.length === 0 ? (
                <p className="mt5u-empty">No trade history available.</p>
              ) : (
                <table className="mt5u-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Symbol</th>
                      <th>Type</th>
                      <th>Volume</th>
                      <th>Open</th>
                      <th>Close</th>
                      <th>P&amp;L</th>
                      <th>Time</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 50).map((h, i) => (
                      <tr key={i} className={(h.profit || 0) >= 0 ? 'mt5u-row-positive' : 'mt5u-row-negative'}>
                        <td>{h.ticket || h.position || '—'}</td>
                        <td><strong>{h.symbol}</strong></td>
                        <td className={h.type === 0 || h.type === 'buy' ? 'mt5u-buy' : 'mt5u-sell'}>
                          {h.type === 0 ? 'BUY' : h.type === 1 ? 'SELL' : (h.type || '—').toString().toUpperCase()}
                        </td>
                        <td>{h.volume?.toFixed?.(2) || h.volume || '—'}</td>
                        <td>{h.price_open?.toFixed?.(5) || h.price?.toFixed?.(5) || '—'}</td>
                        <td>{h.price_close?.toFixed?.(5) || '—'}</td>
                        <td className={(h.profit || 0) >= 0 ? 'mt5u-profit' : 'mt5u-loss'}>
                          ${h.profit?.toFixed?.(2) || '0.00'}
                        </td>
                        <td>{h.time ? new Date(typeof h.time === 'number' ? h.time * 1000 : h.time).toLocaleString() : '—'}</td>
                        <td>{h.state || h.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
