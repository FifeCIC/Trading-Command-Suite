import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../core/api/client';
import './trading-platforms.css';

export default function AddSymbolPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error'|'duplicate'|'notfound', msg }

  const doSearch = useCallback(async (q) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    try {
      const data = await apiGet(`/api/symbols?search=${encodeURIComponent(q)}`);
      const list = Array.isArray(data?.symbols) ? data.symbols : [];
      setResults(list);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    setSelected(null);
    setStatus(null);
    doSearch(v);
  };

  const selectSymbol = (sym) => {
    setSelected(sym);
    setQuery(sym.ticker);
    setResults([]);
    setStatus(null);
  };

  const handleAdd = async (stay = false) => {
    if (!selected) return;
    setAdding(true);
    setStatus(null);
    try {
      // Check if already active
      const existing = await apiGet('/api/symbols');
      const syms = Array.isArray(existing?.symbols) ? existing.symbols : [];
      const dup = syms.find((s) => s.ticker.toUpperCase() === selected.ticker.toUpperCase());
      if (dup) {
        setStatus({ type: 'duplicate', msg: `${selected.ticker} is already in the watchlist.` });
        setAdding(false);
        return;
      }

      await apiPost('/api/symbols', {
        ticker: selected.ticker,
        name: selected.name,
        exchange: selected.exchange || 'UNKNOWN',
        type: selected.type || 'stock',
      });

      setStatus({ type: 'success', msg: `${selected.ticker} added successfully.` });

      if (stay) {
        setSelected(null);
        setQuery('');
        setResults([]);
      } else {
        setTimeout(() => navigate('/watchlists/active-symbols'), 800);
      }
    } catch (e) {
      setStatus({ type: 'error', msg: `Failed: ${e.message}` });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Add Symbol</h1>
        <p>Search the database or add a new symbol to your active watchlist.</p>
      </header>

      <section className="tp-card">
        <div className="tp-control" style={{ position: 'relative' }}>
          <label htmlFor="symbol-search">Search by ticker or name</label>
          <input
            id="symbol-search"
            type="text"
            value={query}
            onChange={handleSearchChange}
            placeholder="e.g. AAPL, NVDA, EURUSD..."
            autoFocus
            style={{ width: '100%' }}
          />
          {searching && <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>Searching...</span>}

          {results.length > 0 && !selected && (
            <ul className="as-autocomplete">
              {results.map((sym) => (
                <li key={sym.id}>
                  <button type="button" onClick={() => selectSymbol(sym)}>
                    <strong>{sym.ticker}</strong>
                    <span>{sym.name}</span>
                    <small>{sym.exchange} · {sym.type}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {query.length >= 1 && results.length === 0 && !searching && !selected && (
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              No symbols found for "{query}". You can add it manually below.
            </p>
          )}
        </div>
      </section>

      {selected && (
        <section className="tp-card">
          <h3>Confirm Add</h3>
          <div className="tp-controls-grid" style={{ alignItems: 'end' }}>
            <div>
              <strong style={{ fontSize: '1.1rem' }}>{selected.ticker}</strong>
              <p style={{ color: 'var(--ink-soft)', margin: '0.2rem 0' }}>{selected.name}</p>
              <small style={{ color: 'var(--ink-soft)' }}>{selected.exchange} · {selected.type}</small>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleAdd(false)}
                disabled={adding}
              >
                {adding ? 'Adding...' : 'Add Symbol'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleAdd(true)}
                disabled={adding}
              >
                Add &amp; Add Another
              </button>
            </div>
          </div>
        </section>
      )}

      {status && (
        <section className={`tp-banner tp-banner--${status.type === 'success' ? 'ok' : status.type === 'duplicate' ? 'info' : 'warn'}`}>
          {status.type === 'success' && '✅ '}
          {status.type === 'duplicate' && 'ℹ️ '}
          {status.type === 'error' && '❌ '}
          {status.msg}
        </section>
      )}

      {/* Manual add fallback */}
      {!selected && (
        <section className="tp-card">
          <h3>Add Manually</h3>
          <ManualAddForm onSuccess={() => navigate('/watchlists/active-symbols')} />
        </section>
      )}
    </div>
  );
}

function ManualAddForm({ onSuccess }) {
  const [form, setForm] = useState({ ticker: '', name: '', exchange: '', type: 'stock' });
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.ticker || !form.name) {
      setMsg({ type: 'error', text: 'Ticker and name are required.' });
      return;
    }
    setAdding(true);
    try {
      await apiPost('/api/symbols', { ...form, exchange: form.exchange || 'UNKNOWN' });
      setMsg({ type: 'success', text: `${form.ticker} added.` });
      setTimeout(onSuccess, 800);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="tp-controls-grid" style={{ alignItems: 'end' }}>
      <label className="tp-control">
        <span>Ticker *</span>
        <input type="text" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="AAPL" maxLength={20} />
      </label>
      <label className="tp-control">
        <span>Name *</span>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Apple Inc." maxLength={200} />
      </label>
      <label className="tp-control">
        <span>Exchange</span>
        <input type="text" value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} placeholder="NASDAQ" maxLength={50} />
      </label>
      <label className="tp-control">
        <span>Type</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="stock">Stock</option>
          <option value="crypto">Crypto</option>
          <option value="forex">Forex</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={adding}>
        {adding ? 'Adding...' : 'Add Symbol'}
      </button>
      {msg && <span style={{ color: msg.type === 'error' ? '#ef4444' : '#22c55e', fontSize: '0.85rem' }}>{msg.text}</span>}
    </form>
  );
}
