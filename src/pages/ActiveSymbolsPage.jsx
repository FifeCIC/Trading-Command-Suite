import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../core/api/client';
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);

  const symbols = useQuery({
    queryKey: ['active-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: 30_000,
  });

  // Portfolio positions for P/L and open trade indicators
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-positions-for-symbols'],
    queryFn: () => apiGet('/api/portfolio?source=mt5').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });

  // Directives for protocol count per symbol
  const directivesQuery = useQuery({
    queryKey: ['directives-for-symbols'],
    queryFn: () => apiGet('/api/directives').catch(() => []),
    staleTime: 120_000,
  });

  const syms = Array.isArray(symbols.data?.symbols) ? symbols.data.symbols : [];
  const mode = symbols.data?.mode ?? '...';
  const positions = Array.isArray(portfolioQuery.data?.positions) ? portfolioQuery.data.positions : [];
  const directives = Array.isArray(directivesQuery.data) ? directivesQuery.data : [];

  // Build lookup maps
  const positionBySymbol = useMemo(() => {
    const map = {};
    for (const p of positions) {
      const sym = (p.symbol || p.ticker || '').toUpperCase();
      if (!map[sym]) map[sym] = { count: 0, totalPnl: 0 };
      map[sym].count += 1;
      map[sym].totalPnl += (p.unrealizedPnl || p.pnl || 0);
    }
    return map;
  }, [positions]);

  const protocolCountBySymbol = useMemo(() => {
    const map = {};
    for (const d of directives) {
      const syms = d.symbols || [];
      for (const s of syms) {
        const key = (typeof s === 'string' ? s : s.ticker || s.symbol || '').toUpperCase();
        if (key) map[key] = (map[key] || 0) + 1;
      }
    }
    return map;
  }, [directives]);

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

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.id)));
    }
  }

  async function handleCreateWatchlist() {
    if (selectedIds.size === 0) return;
    setCreatingWatchlist(true);
    try {
      const selectedSyms = filtered.filter((s) => selectedIds.has(s.id));
      const name = `Watchlist ${new Date().toLocaleDateString()}`;
      await apiPost('/api/watchlists', {
        name,
        symbols: selectedSyms.map((s) => s.ticker),
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    } catch (e) {
      setError(`Failed to create watchlist: ${e.message}`);
    } finally {
      setCreatingWatchlist(false);
    }
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
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateWatchlist}
              disabled={creatingWatchlist}
              style={{ padding: '6px 14px', fontWeight: 600, fontSize: '0.82rem', background: 'var(--accent)', color: '#fff' }}
            >
              {creatingWatchlist ? 'Creating...' : `📋 Create Watchlist (${selectedIds.size})`}
            </button>
          )}
        </div>
      </section>

      <section className="tp-card tp-comparison-card">
        <h3>Symbols ({filtered.length})</h3>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                </th>
                <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer' }}>Ticker{sortIcon('ticker')}</th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortIcon('name')}</th>
                <th>Open Trade</th>
                <th>P/L</th>
                <th>Protocols</th>
                <th onClick={() => toggleSort('exchange')} style={{ cursor: 'pointer' }}>Exchange{sortIcon('exchange')}</th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type{sortIcon('type')}</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sym) => {
                const isActive = sym.active !== false;
                const tickerUpper = (sym.ticker || '').toUpperCase();
                const posData = positionBySymbol[tickerUpper];
                const protoCount = protocolCountBySymbol[tickerUpper] || 0;
                const hasOpenTrade = posData && posData.count > 0;
                const pnl = posData?.totalPnl ?? null;
                return (
                  <tr key={sym.id} className={selectedIds.has(sym.id) ? 'tp-row-selected' : ''}>
                    <td>
                      <input type="checkbox" checked={selectedIds.has(sym.id)} onChange={() => toggleSelect(sym.id)} />
                    </td>
                    <td><strong style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/research/symbol/${sym.ticker}`)} title={`Research ${sym.ticker}`}>{sym.ticker}</strong></td>
                    <td>{sym.name !== sym.ticker ? sym.name : <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic' }}>—</span>}</td>
                    <td>
                      {hasOpenTrade ? (
                        <span className="tp-chip tp-chip--ok" title={`${posData.count} open position(s)`}>● Open ({posData.count})</span>
                      ) : (
                        <span className="tp-chip tp-chip--neutral">—</span>
                      )}
                    </td>
                    <td>
                      {pnl != null ? (
                        <span style={{ color: pnl >= 0 ? 'var(--color-profit)' : 'var(--color-loss)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ink-soft)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="tp-chip tp-chip--neutral">{protoCount}</span>
                    </td>
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
