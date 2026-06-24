import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../core/api/client';
import { exportCsv } from '../utils/exportCsv';
import './trading-platforms.css';

const SYMBOL_TYPES = ['stock', 'crypto', 'forex'];

export default function ActiveSymbolsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filterActive, setFilterActive] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('ticker');
  const [sortDir, setSortDir] = useState('asc');
  const [error, setError] = useState(null);

  const symbols = useQuery({
    queryKey: ['active-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: 30_000,
  });

  const syms = Array.isArray(symbols.data?.symbols) ? symbols.data.symbols : [];
  const mode = symbols.data?.mode ?? '...';

  const filtered = useMemo(() => {
    let list = [...syms];
    if (filterActive === 'active') list = list.filter((s) => s.active !== false);
    if (filterActive === 'inactive') list = list.filter((s) => s.active === false);
    if (filterType !== 'all') list = list.filter((s) => s.type === filterType);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const aVal = (a[sortKey] ?? '').toString().toLowerCase();
      const bVal = (b[sortKey] ?? '').toString().toLowerCase();
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    return list;
  }, [syms, filterActive, filterType, search, sortKey, sortDir]);

  const activeCount = syms.filter((s) => s.active !== false).length;
  const inactiveCount = syms.length - activeCount;

  async function toggleActive(sym) {
    setError(null);
    try {
      await apiPatch(`/api/symbols/${sym.id}`, { active: !(sym.active !== false) });
      queryClient.invalidateQueries({ queryKey: ['active-symbols'] });
    } catch (e) {
      setError(`Failed to update ${sym.ticker}: ${e.message}`);
    }
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function sortIcon(key) {
    return sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Active Symbols</h1>
        <p>
          {syms.length} symbol{syms.length !== 1 ? 's' : ''} total · {activeCount} active · {inactiveCount} inactive · Mode: {mode}
        </p>
      </header>

      {error && (
        <div className="tp-banner-retry" style={{ marginBottom: 16 }}>
          {error}
          <button type="button" onClick={() => setError(null)} style={{ marginLeft: 12 }}>Dismiss</button>
        </div>
      )}

      <section className="tp-card tp-controls-card">
        <h3>Filters &amp; Actions</h3>
        <div className="tp-controls-grid">
          <label className="tp-control">
            <span>Status</span>
            <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
              <option value="all">All ({syms.length})</option>
              <option value="active">Active ({activeCount})</option>
              <option value="inactive">Inactive ({inactiveCount})</option>
            </select>
          </label>
          <label className="tp-control">
            <span>Type</span>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="tp-control">
            <span>Search</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter..." />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/watchlists/add-symbol')}
            style={{ padding: '6px 14px', fontWeight: 600, fontSize: '0.82rem' }}
          >
            ➕ Add Symbol
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => exportCsv(filtered, ['ticker', 'name', 'exchange', 'type'], 'active-symbols.csv')}
          >
            Export CSV
          </button>
        </div>
      </section>

      <section className="tp-card tp-comparison-card">
        <h3>Symbols ({filtered.length})</h3>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer' }}>Ticker{sortIcon('ticker')}</th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortIcon('name')}</th>
                <th onClick={() => toggleSort('exchange')} style={{ cursor: 'pointer' }}>Exchange{sortIcon('exchange')}</th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type{sortIcon('type')}</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sym) => {
                const isActive = sym.active !== false;
                return (
                  <tr key={sym.id}>
                    <td><strong>{sym.ticker}</strong></td>
                    <td>{sym.name}</td>
                    <td>{sym.exchange}</td>
                    <td><span className="tp-chip tp-chip--neutral">{sym.type}</span></td>
                    <td>
                      <span className={`tp-chip ${isActive ? 'tp-chip--ok' : 'tp-chip--warn'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn ${isActive ? '' : 'btn-primary'}`}
                        onClick={() => toggleActive(sym)}
                        style={{ padding: '4px 12px', fontSize: '0.85rem' }}
                      >
                        {isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
