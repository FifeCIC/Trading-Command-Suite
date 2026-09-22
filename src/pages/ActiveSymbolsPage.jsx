import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../core/api/client';
import { exportCsv } from '../utils/exportCsv';
import {
  POSITIONS_QUERY_KEY,
  POSITIONS_REFETCH_MS,
  indexPositionsByTicker,
  positionForTicker,
} from '../core/symbol-positions';
import CopyViewData from '../components/CopyViewData';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './trading-platforms.css';

const SYMBOL_TYPES = ['stock', 'crypto', 'forex'];

/** Keys sorted numerically rather than as strings. Module scope — a fresh Set each render would
 *  make it unusable as a `useMemo` dependency (new identity ⇒ recompute every render). */
const NUMERIC_SORT_KEYS = new Set(['openTradeCount', 'currentPnl', 'histPnl']);

// ── Column visibility (localStorage-backed, per-view) ──
const COLS_KEY = 'tcs:active-symbols:columns';
const DEFAULT_COLS = { openTrade: true, current: true, pnl: true, protocols: true, exchange: true, type: true };

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
  const [sortKey, setSortKey] = useState('currentPnl');
  const [sortDir, setSortDir] = useState('desc');
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

  // ⚠️ `/api/symbols/positions`, NOT `/api/portfolio?source=mt5`.
  //
  // This page used the MT5-only portfolio endpoint, so it could only ever see the handful of open
  // FX positions (5 at the time of writing) and was BLIND to every stock holding on Trading212
  // (24 of them). SymbolsBrowserPage — the same per-symbol P&L column on a different page — read
  // the all-provider endpoint and showed 32. Two pages, one column, two different answers.
  // Both now go through `core/symbol-positions.js` so they cannot drift again. (2026-09-22)
  const positionsQuery = useQuery({
    queryKey: POSITIONS_QUERY_KEY,
    queryFn: () => apiGet('/api/symbols/positions').catch(() => ({ positions: [] })),
    refetchInterval: POSITIONS_REFETCH_MS,
  });

  // Historical (REALISED) P&L per symbol.
  //
  // ⚠️ `bySymbol` is quarantine-aware: it excludes `pnlInvalid` rows (the exit was never captured,
  // so `pnl` is a placeholder 0) BEFORE any statistic, and each bucket carries `reliability`, which
  // is `'noise'` below 20 trades. Measured 2026-09-22: 99 of 186 closed trades are quarantined, and
  // EVERY symbol is currently `noise`. Do NOT present `totalPnl` without its reliability band — the
  // repo has twice stated a confident P&L verdict that the sample could not support (#805).
  // `days=365` rather than the 90-day default so "historical" means historical.
  const histPnlQuery = useQuery({
    queryKey: ['symbol-historical-pnl'],
    queryFn: () => apiGet('/api/scoring/edge/pnl?days=365').catch(() => null),
    staleTime: 300_000,
  });

  // Directives for protocol count per symbol
  const directivesQuery = useQuery({
    queryKey: ['directives-for-symbols'],
    queryFn: () => apiGet('/api/directives').catch(() => []),
    staleTime: 120_000,
  });

  const syms = Array.isArray(symbols.data?.symbols) ? symbols.data.symbols : [];
  const mode = symbols.data?.mode ?? '...';
  const positions = Array.isArray(positionsQuery.data?.positions) ? positionsQuery.data.positions : [];
  const directives = Array.isArray(directivesQuery.data) ? directivesQuery.data : [];

  // Build lookup maps
  // One row per symbol (not an aggregate) — the endpoint already collapses per-symbol holdings.
  const positionBySymbol = useMemo(() => indexPositionsByTicker(positions), [positions]);

  // Historical P&L keyed by ticker. `label` is the symbol as stored on the trade row.
  const histPnlBySymbol = useMemo(() => {
    const rows = Array.isArray(histPnlQuery.data?.bySymbol) ? histPnlQuery.data.bySymbol : [];
    const map = {};
    for (const b of rows) {
      if (b?.label) map[String(b.label).toUpperCase()] = b;
    }
    return map;
  }, [histPnlQuery.data]);

  // ⚠️ Historical P&L is only meaningful relative to its population. Surface the exclusion count
  // rather than letting the column's numbers imply a complete book.
  const histSample = histPnlQuery.data?.sample ?? null;
  const histExcluded = histSample?.excludedInvalid ?? null;

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
      const pos = positionForTicker(positionBySymbol, s.ticker);
      const hist = histPnlBySymbol[(s.ticker || '').toUpperCase()];
      return {
        ...s,
        hasPosition: !!pos,
        // `count` stays for the pre-existing Open Trade indicator; the endpoint is one row/symbol.
        openTradeCount: pos ? 1 : 0,
        currentPnl: pos?.pnl ?? null,
        currentProvider: pos?.provider ?? null,
        currentPnlPct: pos?.pnlPct ?? null,
        histPnl: hist?.totalPnl ?? null,
        histTrades: hist?.trades ?? null,
        histReliability: hist?.reliability ?? null,
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
    // ⚠️ `positionBySymbol` and `histPnlBySymbol` are REQUIRED here: the derived `currentPnl` /
    // `histPnl` fields are built inside this memo. Without them, positions or historical P/L
    // arriving AFTER first render would leave the two new columns blank until something else
    // happened to change — a silently empty column, not an error.
  }, [syms, filterActive, filterType, search, sortKey, sortDir, positionBySymbol, histPnlBySymbol]);

  const activeCount = syms.filter((s) => s.active !== false).length;
  const inactiveCount = syms.length - activeCount;

  async function toggleActive(sym) {
    setError(null);
    try {
      await apiPatch(`/api/symbols/${sym.id}`, { active: !(sym.active !== false) });
      queryClient.invalidateQueries({ queryKey: ['active-symbols'] });
    } catch (e) {
      setError(noticeFromError(e, 'TCS-SYS-007', { operation: `update ${sym.ticker}` }));
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
      setError(noticeFromError(e, 'TCS-SYS-007', { operation: 'create the watchlist' }));
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
          <NoticeBlock notice={error} compact />
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
                  <input type="checkbox" checked={cols.current} onChange={() => toggleCol('current')} />
                  Current Position
                </label>
                <label className="tp-col-option">
                  <input type="checkbox" checked={cols.pnl} onChange={() => toggleCol('pnl')} />
                  Historical P/L
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
                {cols.current && <th onClick={() => toggleSort('currentPnl')} style={{ cursor: 'pointer' }} title="Current holding — broker, unrealised P&L and P&L%. Sorts by P&L; symbols with no open position sort last.">Current{sortIcon('currentPnl')}</th>}
                {cols.pnl && <th onClick={() => toggleSort('histPnl')} style={{ cursor: 'pointer' }} title="Realised P&L from closed trades. Excludes quarantined rows (exit price never captured). Sample size and reliability are shown in the cell.">Historical P/L{sortIcon('histPnl')}</th>}
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
                const protoCount = protocolCountBySymbol[tickerUpper] || 0;
                const hasOpenTrade = sym.hasPosition;
                const currentPnl = sym.currentPnl;
                const histPnl = sym.histPnl;
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
                          <span className="tp-chip tp-chip--ok" title={`1 open position`}>● Open</span>
                        ) : (
                          <span className="tp-chip tp-chip--neutral">—</span>
                        )}
                      </td>
                    )}
                    {cols.current && (
                      <td>
                        {hasOpenTrade ? (
                          <span
                            className="tp-pos-cell"
                            title={`${sym.currentProvider ?? 'unknown broker'} · ${currentPnl != null ? currentPnl.toFixed(2) : 'no P&L'}`}
                          >
                            <span className="tp-pos-provider">{sym.currentProvider ?? '—'}</span>
                            {currentPnl != null ? (
                              <span className={`tp-pos-pnl ${currentPnl >= 0 ? 'is-pos' : 'is-neg'}`}>
                                {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}
                                {sym.currentPnlPct != null && (
                                  <span className="tp-pos-pct">{sym.currentPnlPct >= 0 ? '+' : ''}{sym.currentPnlPct.toFixed(1)}%</span>
                                )}
                              </span>
                            ) : (
                              <span className="tp-pos-none">no P&amp;L</span>
                            )}
                          </span>
                        ) : (
                          <span className="tp-pos-none">—</span>
                        )}
                      </td>
                    )}
                    {cols.pnl && (
                      <td>
                        {histPnl != null ? (
                          <span className="tp-pos-cell" title={`Realised over ${sym.histTrades} trade(s) — reliability: ${sym.histReliability}`}>
                            <span className={`tp-pos-pnl ${histPnl >= 0 ? 'is-pos' : 'is-neg'}`}>
                              {histPnl >= 0 ? '+' : ''}{histPnl.toFixed(2)}
                            </span>
                            <span className="tp-pos-meta">
                              n={sym.histTrades}
                              {/* ⚠️ `noise` = fewer than 20 trades. Shown, not hidden: a +54.68 from 7
                                  trades is not evidence and must not read like a proven edge. */}
                              {sym.histReliability && sym.histReliability !== 'strong' && (
                                <em className={`tp-rel tp-rel--${sym.histReliability}`}>{sym.histReliability}</em>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-soft)' }} title="No closed trades">—</span>
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
          `> Current = unrealised on an open position (all providers). Historical = realised from closed trades.`,
          histExcluded != null
            ? `> ⚠️ Historical P/L excludes ${histExcluded} quarantined closed trade(s) whose exit price was never captured.`
            : '',
          '',
          '| Symbol | Type | Broker | Current P/L | Current % | Historical P/L | n | Reliability |',
          '|--------|------|--------|-------------|-----------|----------------|---|-------------|',
        ].filter(Boolean);
        filtered.slice(0, 50).forEach(s => {
          const ticker = s.ticker || s.symbol;
          const cur = positionForTicker(positionBySymbol, ticker);
          const hist = histPnlBySymbol[String(ticker).toUpperCase()];
          const curPnl = cur?.pnl != null ? `${cur.pnl >= 0 ? '+' : ''}${cur.pnl.toFixed(2)}` : '—';
          const curPct = cur?.pnlPct != null ? `${cur.pnlPct >= 0 ? '+' : ''}${cur.pnlPct.toFixed(1)}%` : '—';
          const histPnl = hist?.totalPnl != null ? `${hist.totalPnl >= 0 ? '+' : ''}${hist.totalPnl.toFixed(2)}` : '—';
          lines.push(`| ${ticker} | ${s.type || '—'} | ${cur?.provider || '—'} | ${curPnl} | ${curPct} | ${histPnl} | ${hist?.trades ?? '—'} | ${hist?.reliability ?? '—'} |`);
        });
        return lines.join('\n');
      }} />
    </div>
  );
}
