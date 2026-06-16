import { useState, useEffect, useCallback } from 'react';
import './Mt5ConnectionManagerPage.css';

const BRIDGE_URL = 'http://localhost:5000';

export default function Mt5ConnectionManagerPage() {
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [health, setHealth] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ login: '', password: '', server: '', label: '' });
  const [testResult, setTestResult] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);

  const addLog = (msg, type = 'info') => {
    setLog((prev) => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev.slice(0, 19)]);
  };

  const fetchData = useCallback(async () => {
    try {
      const [accRes, healthRes] = await Promise.all([
        fetch(`${BRIDGE_URL}/accounts`),
        fetch(`${BRIDGE_URL}/health`),
      ]);
      const accData = await accRes.json();
      const healthData = await healthRes.json();

      if (accData.accounts) {
        const enriched = accData.accounts.map((a) => ({
          ...a,
          connected: a.active ? healthData.connected : false,
          balance: a.active ? healthData.balance : null,
          equity: a.active ? healthData.equity : null,
          server: healthData.server || a.server,
        }));
        setAccounts(enriched);
        setActiveAccount(accData.active);
      }
      setHealth(healthData);
    } catch (err) {
      addLog(`Bridge unreachable: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15000); return () => clearInterval(i); }, [fetchData]);

  const handleSwitch = async (num) => {
    addLog(`Switching to account #${num}...`);
    const res = await fetch(`${BRIDGE_URL}/switch/${num}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      addLog(`Switched to ${data.account} @ ${data.server}`, 'success');
      fetchData();
    } else {
      addLog(`Switch failed: ${data.error}`, 'error');
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    const res = await fetch(`${BRIDGE_URL}/accounts/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: form.login, password: form.password, server: form.server }),
    });
    const data = await res.json();
    setTestResult(data);
    addLog(data.success ? `Test OK: ${data.login} balance=${data.balance}` : `Test failed: ${data.error}`, data.success ? 'success' : 'error');
  };

  const handleAdd = async () => {
    const res = await fetch(`${BRIDGE_URL}/accounts/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      addLog(`Account added: ${form.login}`, 'success');
      setShowAdd(false);
      setForm({ login: '', password: '', server: '', label: '' });
      fetchData();
    }
  };

  if (loading) return <div className="mt5cm-page"><p>Loading MT5 accounts...</p></div>;

  return (
    <div className="mt5cm-page">
      <header className="mt5cm-header">
        <h2>MT5 Connection Manager</h2>
        <p>Manage MetaTrader 5 accounts, test connections, and switch active accounts.</p>
      </header>

      {/* Status bar */}
      <div className={`mt5cm-status ${health?.connected ? 'online' : 'offline'}`}>
        <span className="mt5cm-dot" />
        {health?.connected
          ? `Connected — Account ${health.account} @ ${health.server} | Balance: $${health.balance?.toLocaleString()} | Equity: $${health.equity?.toLocaleString()}`
          : 'Not connected — ensure MT5 terminal is running'}
      </div>

      {/* Account cards */}
      <section className="mt5cm-section">
        <h3>Accounts</h3>
        <div className="mt5cm-accounts">
          {accounts.map((acc) => (
            <div key={acc.number} className={`mt5cm-card ${acc.active ? 'active' : ''}`}>
              <div className="mt5cm-card-header">
                <span className="mt5cm-card-num">#{acc.number}</span>
                <span className={`mt5cm-badge ${acc.connected ? 'live' : ''}`}>
                  {acc.active ? 'Active' : acc.connected ? 'Demo' : 'Offline'}
                </span>
              </div>
              <div className="mt5cm-card-body">
                <p><strong>Login:</strong> {acc.login}</p>
                <p><strong>Server:</strong> {acc.server}</p>
                {acc.balance != null && <p><strong>Balance:</strong> ${acc.balance.toLocaleString()}</p>}
                {acc.equity != null && <p><strong>Equity:</strong> ${acc.equity.toLocaleString()}</p>}
              </div>
              <div className="mt5cm-card-actions">
                {!acc.active && (
                  <button className="mt5cm-btn primary" onClick={() => handleSwitch(acc.number)}>
                    Set Active
                  </button>
                )}
                {acc.active && <span className="mt5cm-active-label">✓ Active Account</span>}
              </div>
            </div>
          ))}
          <div className="mt5cm-card add-card" onClick={() => setShowAdd(true)}>
            <span className="mt5cm-add-icon">+</span>
            <span>Add Account</span>
          </div>
        </div>
      </section>

      {/* Add Account form */}
      {showAdd && (
        <section className="mt5cm-section">
          <h3>Add Account</h3>
          <div className="mt5cm-form">
            <input placeholder="Account Number" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
            <input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <input placeholder="Server (e.g. ICMarkets-Demo)" value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} />
            <input placeholder="Label (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <div className="mt5cm-form-actions">
              <button className="mt5cm-btn outline" onClick={handleTest}>Test Connection</button>
              <button className="mt5cm-btn primary" onClick={handleAdd}>Add Account</button>
              <button className="mt5cm-btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
            {testResult && (
              <div className={`mt5cm-test-result ${testResult.success ? 'success' : 'fail'}`}>
                {testResult.success ? '✓ Connection OK' : `✗ ${testResult.error}`}
                {testResult.balance != null && ` — Balance: $${testResult.balance.toLocaleString()}`}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Connection log */}
      <section className="mt5cm-section">
        <h3>Connection Log</h3>
        <div className="mt5cm-log">
          {log.length === 0 && <p className="mt5cm-muted">No events yet.</p>}
          {log.map((entry, i) => (
            <div key={i} className={`mt5cm-log-entry ${entry.type}`}>
              <span className="mt5cm-log-time">{entry.time}</span>
              <span>{entry.msg}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
