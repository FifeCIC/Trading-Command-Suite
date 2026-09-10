import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../core/api/client';
import { exportCsv } from '../utils/exportCsv';
import CopyViewData from '../components/CopyViewData';
import './trading-platforms.css';

const SYMBOL_TYPES = ['stock', 'crypto', 'forex'];

// ── Column visibility (localStorage-backed, per-view) ──
const COLS_KEY = 'tcs:active-symbols:columns';
const DEFAULT_COLS = { openTrade: true, pnl: true, protocols: true, exchange: true, type: true };

function loadCols() {
  try { return { ...DEFAULT_COLS, ...JSON.parse(localStorage.getItem(COLS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_COLS }; }
}
function saveCols(cols) {
  localStorage.setItem(COLS_KEY, JSON.stringify(cols));
}

export default function ActiveSymbolsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filterActive, setFilterActive] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const NUMERIC_SORT_KEYS = new Set(['openTradeCount', 'pnl']);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [cols, setCols] = useState(loadCols);
  const [showColOptions, setShowColOptions] = useState(false);

  const toggleCol = useCallback((key) => {
    setCols((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveCols(next);
      return next;
    });
  }, []);

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
    // Compute derived sort fields before sorting
    list = list.map((s) => {
      const posData = positionBySymbol[(s.ticker || '').toUpperCase()];
      return {
        ...s,
        openTradeCount: posData?.count ?? 0,
        pnl: posData?.totalPnl ?? null,
      };
    });

    list.sort((a, b) => {
      if (NUMERIC_SORT_KEYS.has(sortKey)) {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        // Push nulls to the end
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
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
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setShowColOptions((v) => !v)}
            >
              ⚙ Columns
            </button>
            {showColOptions && (
              <div className="tp-col-options-dropdown">
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.openTrade} onChange={() => toggleCol('openTrade')} />
                  Open Trade
                </label>
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.pnl} onChange={() => toggleCol('pnl')} />
                  P/L
                </label>
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.protocols} onChange={() => toggleCol('protocols')} />
                  Protocols
                </label>
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.exchange} onChange={() => toggleCol('exchange')} />
                  Exchange
                </label>
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.type} onChange={() => toggleCol('type')} />
                  Type
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                </th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortIcon('name')}</th>
                {cols.openTrade && <th onClick={() => toggleSort('openTradeCount')} style={{ cursor: 'pointer' }}>Open Trade{sortIcon('openTradeCount')}</th>}
                {cols.pnl && <th onClick={() => toggleSort('pnl')} style={{ cursor: 'pointer' }}>P/L{sortIcon('pnl')}</th>}
                {cols.protocols && <th>Protocols</th>}
                {cols.exchange && <th onClick={() => toggleSort('exchange')} style={{ cursor: 'pointer' }}>Exchange{sortIcon('exchange')}</th>}
                {cols.type && <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type{sortIcon('type')}</th>}
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
                const hasCompanyName = sym.name && sym.name !== sym.ticker;
                return (
                  <tr key={sym.id} className={selectedIds.has(sym.id) ? 'tp-row-selected' : ''}>
                    <td>
                      <input type="checkbox" checked={selectedIds.has(sym.id)} onChange={() => toggleSelect(sym.id)} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                          onClick={() => navigate(`/research/symbol/${sym.ticker}`)} title={`Research ${sym.ticker}`}>
                          {hasCompanyName ? sym.name : sym.ticker}
                        </span>
                        {hasCompanyName && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', fontFamily: 'monospace' }}>{sym.ticker}</span>
                        )}
                        {!hasCompanyName && sym.name && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No company name</span>
                        )}
                        <span style={{ fontSize: '0.7rem' }}>
                          <a
                            href={`/automation/decision-trail?symbol=${sym.ticker}`}
                            onClick={(e) => { e.preventDefault(); navigate(`/automation/decision-trail?symbol=${sym.ticker}`); }}
                            title={`Inspect decision trail for ${sym.ticker}`}
                            style={{ color: 'var(--ink-soft)', textDecoration: 'none' }}
                          >
                            🔗 Trail
                          </a>
                        </span>
                      </div>
                    </td>
                    {cols.openTrade && (
                      <td>
                        {hasOpenTrade ? (
                          <span className="tp-chip tp-chip--ok" title={`${posData.count} open position(s)`}>● Open ({posData.count})</span>
                        ) : (
                          <span className="tp-chip tp-chip--neutral">—</span>
                        )}
                      </td>
                    )}
                    {cols.pnl && (
                      <td>
                        {pnl != null ? (
                          <span style={{ color: pnl >= 0 ? 'var(--color-profit)' : 'var(--color-loss)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-soft)' }}>—</span>
                        )}
                      </td>
                    )}
                    {cols.protocols && (
                      <td>
                        <span className="tp-chip tp-chip--neutral">{protoCount}</span>
                      </td>
                    )}
                    {cols.exchange && <td>{sym.exchange}</td>}
                    {cols.type && <td><span className="tp-chip tp-chip--neutral">{sym.type}</span></td>}
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
      <CopyViewData getMarkdown={() => {
        const lines = [
          `# Active Symbols`,
          `> ${new Date().toISOString()}`,
          `> ${filtered.length} symbols · ${activeCount} active · ${inactiveCount} inactive`,
          '',
          '| Symbol | Type | Open Trade | P/L |',
          '|--------|------|------------|-----|',
        ];
        filtered.slice(0, 50).forEach(s => {
          const p = positionBySymbol[(s.ticker || '').toUpperCase()];
          const pnl = p?.totalPnl != null ? `${p.totalPnl >= 0 ? '+' : ''}${p.totalPnl.toFixed(2)}` : '—';
          lines.push(`| ${s.ticker || s.symbol} | ${s.type || '—'} | ${p?.count || 0} | ${pnl} |`);
        });
        return lines.join('\n');
      }} />
    </div>
  );
}
