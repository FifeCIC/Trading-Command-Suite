import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
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
      const data = await apiGet(`/api/symbols?search=${encodeURIComponent(q)}&limit=10`);
      const list = (Array.isArray(data?.symbols) ? data.symbols : [])
        .map(s => ({ ...s, inDb: true }))
        // Sort: exact match first → starts with → contains
        .sort((a, b) => {
          const aExact = a.ticker.toUpperCase() === q.toUpperCase() ? 0 : 1;
          const bExact = b.ticker.toUpperCase() === q.toUpperCase() ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          const aStarts = a.ticker.toUpperCase().startsWith(q.toUpperCase()) ? 0 : 1;
          const bStarts = b.ticker.toUpperCase().startsWith(q.toUpperCase()) ? 0 : 1;
          return aStarts - bStarts;
        })
        .slice(0, 5);
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
      setStatus({ type: 'error', notice: noticeFromError(e, 'TCS-SYS-007', { operation: 'add the symbol' }) });
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
        <div className="tp-control as-search-row">
          <div className="as-search-input-wrap">
            <label htmlFor="symbol-search">Search by ticker or name...</label>
            <input
              id="symbol-search"
              type="text"
              value={query}
              onChange={handleSearchChange}
              placeholder="e.g. AAPL, NVDA, EURUSD..."
              autoFocus
            />
            {searching && <span className="as-searching">Searching...</span>}
          </div>

          {/* Results panel — appears to the right, max 5 items */}
          {results.length > 0 && !selected && (
            <div className="as-results-panel">
              <div className="as-results-header">Top matches</div>
              {results.slice(0, 5).map((sym) => (
                <button
                  key={sym.id}
                  type="button"
                  className={`as-result-item${query.length >= 4 ? ' as-result-item--detail' : ''}`}
                  onClick={() => selectSymbol(sym)}
                >
                  <span className="as-result-ticker">
                    {sym.ticker}
                    {sym.inDb && <span className="as-in-db" title="Already in database">✓ DB</span>}
                  </span>
                  {query.length >= 4 && (
                    <span className="as-result-name">{sym.name}</span>
                  )}
                  <span className="as-result-meta">{sym.exchange || '—'} · {sym.type || '—'}</span>
                </button>
              ))}
            </div>
          )}

          {query.length >= 1 && results.length === 0 && !searching && !selected && (
            <p className="as-no-results">No symbols found for "{query}".</p>
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
          {status.notice ? <NoticeBlock notice={status.notice} compact /> : status.msg}
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
      setMsg({ type: 'error', notice: noticeFromError(err, 'TCS-SYS-007', { operation: 'add the symbol' }) });
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
      {/*
        ⚠️ `msg.notice` MUST be INSIDE the `msg &&` guard.
        It was not: the span above was guarded and this line was not, so on the FIRST render — when
        `msg` is still null — `msg.notice` threw
          TypeError: Cannot read properties of null (reading 'notice')
        and took the whole Add Symbol page down before it could paint. The guarded line immediately
        above is what made it look safe: a reader checks "is msg handled?" and sees yes.
        This is a per-ROW check, not a per-PAGE one — the crash happened on a page that renders fine
        everywhere else.
      */}
      {msg && (
        <>
          {msg.text && (
            <span style={{ color: msg.type === 'error' ? '#ef4444' : '#22c55e', fontSize: '0.85rem' }}>{msg.text}</span>
          )}
          {msg.notice && <NoticeBlock notice={msg.notice} compact />}
        </>
      )}
    </form>
  );
}
