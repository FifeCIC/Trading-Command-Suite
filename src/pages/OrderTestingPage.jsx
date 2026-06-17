import { useState } from 'react';
import { apiGet } from '../core/api/client';
import './trading-platforms.css';
import './order-test.css';

const ENDPOINTS = [
  { id: 1, method: 'GET', path: '/api/portfolio/trading212/validate', label: 'Account Info', desc: 'Account details, balance, currency' },
  { id: 2, method: 'GET', path: '/api/portfolio/summary', label: 'Account Cash', desc: 'Available cash, blocked, free' },
  { id: 3, method: 'GET', path: '/api/portfolio/summary', label: 'Portfolio Positions', desc: 'Open positions' },
  { id: 4, method: 'GET', path: '/api/portfolio/trading212/history', label: 'Order History', desc: 'Order history' },
  { id: 5, method: 'GET', path: '/api/symbols', label: 'Instruments', desc: 'Available instruments (via DB symbols)' },
  { id: 6, method: 'GET', path: '/api/portfolio/summary', label: 'Real-time Quote', desc: 'Position quotes from portfolio' },
  { id: 7, method: 'POST', path: '/api/portfolio/trading212/validate', label: 'Market Order', desc: 'Place market order (will be rejected — no funds)' },
  { id: 8, method: 'POST', path: '/api/portfolio/trading212/validate', label: 'Limit Order', desc: 'Place limit order (will be rejected)' },
  { id: 9, method: 'POST', path: '/api/portfolio/trading212/validate', label: 'Stop Order', desc: 'Place stop order (will be rejected)' },
  { id: 10, method: 'DELETE', path: null, label: 'Cancel Order', desc: 'Cancel order (needs order ID from a placed order)' },
  { id: 11, method: 'GET', path: null, label: 'Order Status', desc: 'Get order status (needs order ID)' },
];

const ACCOUNTS = [
  { id: 'investment', label: 'Investment', key: 'TRADING212_API_KEY' },
  { id: 'isa', label: 'Stocks ISA', key: 'TRADING212_ISA_API_KEY' },
];

export default function OrderTestingPage() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState({});
  const [account, setAccount] = useState('investment');

  async function runTest(endpoint) {
    const key = `${account}-${endpoint.id}`;
    setRunning((p) => ({ ...p, [key]: true }));
    const start = Date.now();

    try {
      const res = await apiGet(endpoint.path);
      const ms = Date.now() - start;
      setResults((p) => ({
        ...p,
        [key]: {
          status: res ? 200 : 204,
          ms,
          data: res,
          error: null,
          time: new Date().toLocaleTimeString(),
        },
      }));
    } catch (err) {
      const ms = Date.now() - start;
      setResults((p) => ({
        ...p,
        [key]: {
          status: err.status || err.code || 'ERROR',
          ms,
          data: null,
          error: err.message,
          time: new Date().toLocaleTimeString(),
        },
      }));
    } finally {
      setRunning((p) => ({ ...p, [key]: false }));
    }
  }

  async function runAll() {
    for (const ep of ENDPOINTS) {
      if (ep.path) {
        await runTest(ep);
      }
    }
  }

  function resultBadge(r) {
    if (!r) return <span className="ot-badge ot-badge--idle">Not run</span>;
    if (r.error) return <span className="ot-badge ot-badge--fail">❌ {r.status}</span>;
    return <span className="ot-badge ot-badge--ok">✅ {r.status} · {r.ms}ms</span>;
  }

  return (
    <div className="trading-platforms-page ot-page">
      <header className="tp-page-header">
        <h1>Trading212 Order Testing</h1>
        <p>Test all 11 permitted API endpoints against both accounts. Orders will be rejected (no funds) — the test validates error handling.</p>
      </header>

      {/* Account selector */}
      <section className="tp-card">
        <div className="ot-account-select">
          <span>Account:</span>
          {ACCOUNTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`ot-account-btn ${account === a.id ? 'ot-account-btn--active' : ''}`}
              onClick={() => setAccount(a.id)}
            >
              {a.label}
            </button>
          ))}
          <button type="button" className="btn btn-primary" onClick={runAll} style={{ marginLeft: 'auto' }}>
            ▶ Run All Tests
          </button>
        </div>
      </section>

      {/* Endpoint test table */}
      <section className="tp-card">
        <table className="ot-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Description</th>
              <th>Result</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((ep) => {
              const key = `${account}-${ep.id}`;
              const r = results[key];
              const loading = running[key];
              return (
                <tr key={key} className={r?.error ? 'ot-row--fail' : r ? 'ot-row--ok' : ''}>
                  <td>{ep.id}</td>
                  <td><span className={`ot-method ot-method--${ep.method}`}>{ep.method}</span></td>
                  <td className="ot-path">{ep.path || '—'}</td>
                  <td>{ep.label}<br /><small>{ep.desc}</small></td>
                  <td>{resultBadge(r)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => runTest(ep)}
                      disabled={loading || !ep.path}
                      style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                    >
                      {loading ? '⏳' : 'Test'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Response details */}
      {Object.keys(results).length > 0 && (
        <section className="tp-card">
          <h2>Response Details</h2>
          {ENDPOINTS.map((ep) => {
            const key = `${account}-${ep.id}`;
            const r = results[key];
            if (!r) return null;
            return (
              <details key={key} className="ot-detail">
                <summary>
                  #{ep.id} {ep.label} — {r.status} ({r.ms}ms) · {r.time}
                </summary>
                <pre className="ot-pre">
                  {r.error
                    ? `ERROR: ${r.error}`
                    : JSON.stringify(r.data, null, 2).slice(0, 2000)}
                </pre>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
