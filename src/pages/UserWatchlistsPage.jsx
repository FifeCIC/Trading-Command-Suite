/**
 * Watchlists Page
 * ===============
 * Two-column layout: watchlist list on left, symbols in right panel.
 * Inline creation replaces the old standalone CreateWatchlistPage (#301).
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './watchlists.css';

/** Clean watchlist label: strip timestamp suffixes */
function cleanLabel(label) {
  return (label || '')
    .replace(/-?\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z/gi, '')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function UserWatchlistsPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSymbols, setNewSymbols] = useState('');
  const queryClient = useQueryClient();

  const { data: watchlists, isLoading, error } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists'),
    staleTime: 30_000,
    retry: 1,
  });

  const { data: detail } = useQuery({
    queryKey: ['watchlist-symbols', selectedId],
    queryFn: async () => {
      try {
        const res = await apiGet(`/api/watchlists/${selectedId}`);
        return res;
      } catch {
        return { symbols: [] };
      }
    },
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  const selectedWl = watchlists?.find(w => w.id === selectedId);
  // Watchlist detail `symbols` is normally an array, but some legacy lists
  // (e.g. the `default` watchlist) return a comma-separated string. Normalise
  // to an array so `.map()` / `.length` always work.
  const rawSymbols = detail?.symbols;
  const symbols = Array.isArray(rawSymbols)
    ? rawSymbols
    : typeof rawSymbols === 'string'
      ? rawSymbols.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  // Fetch all symbols to get company names
  const { data: allSymbols } = useQuery({
    queryKey: ['all-symbols-names'],
    queryFn: () => apiGet('/api/symbols').catch(() => ({ symbols: [] })),
    staleTime: 120_000,
  });
  const symbolNameMap = {};
  if (allSymbols?.symbols) {
    allSymbols.symbols.forEach(s => {
      if (s.ticker && s.name && s.name !== s.ticker) {
        symbolNameMap[s.ticker.toUpperCase()] = s.name;
      }
    });
  }

  // Lock status for selected watchlist
  const lockQuery = useQuery({
    queryKey: ['watchlist-lock', selectedId],
    queryFn: () => apiGet(`/api/watchlists/${selectedId}/lock-status`).catch(() => ({ locked: false })),
    enabled: !!selectedId && !selectedWl?.isDefault,
    staleTime: 30_000,
  });
  const isLocked = lockQuery.data?.locked || false;

  // "Colour" view mode (activity colouring). Only 'traded' is shipped now;
  // heatmap / day-move are roadmap (#741). Reads STORED open positions only —
  // this page never triggers imports or live scoring. The read is lazy: it
  // only fires when the user actually picks the Traded view.
  const [viewMode, setViewMode] = useState('neutral'); // 'neutral' | 'traded'
  const positionsQuery = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions'),
    enabled: viewMode === 'traded',
    staleTime: 60_000,
  });
  const posRows = Array.isArray(positionsQuery.data?.positions) ? positionsQuery.data.positions : [];
  const positionSymbols = useMemo(() => {
    const set = new Set();
    posRows.forEach((p) => { if (p?.symbol) set.add(String(p.symbol).toUpperCase()); });
    return set;
  }, [posRows]);

  // Delete watchlist mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => apiPost('/api/watchlists/delete', { id }).catch(async () => {
      // Fallback: use fetch for DELETE
      await fetch(`/api/watchlists/${id}`, { method: 'DELETE' });
    }),
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    },
  });

  // Remove symbol mutation
  const removeSymbolMutation = useMutation({
    mutationFn: ({ watchlistId, ticker }) =>
      fetch(`/api/watchlists/${watchlistId}/symbols/${ticker}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist-symbols', selectedId] });
    },
  });

  // Auto-select the default watchlist on first load
  useEffect(() => {
    if (!selectedId && watchlists?.length > 0) {
      const defaultWl = watchlists.find(w => w.isDefault) ?? watchlists[0];
      setSelectedId(defaultWl.id);
    }
  }, [watchlists, selectedId]);

  // Sync Trading212 Portfolio when selected (once per mount)
  const syncAttempted = useRef(false);

  function doSync() {
    setSyncing(true);
    apiPost('/api/watchlists/trading212-portfolio/sync', {}).then(() => {
      setLastSync(new Date().toLocaleTimeString());
      queryClient.invalidateQueries({ queryKey: ['watchlists'] });
      queryClient.invalidateQueries({ queryKey: ['watchlist-symbols', 'trading212-portfolio'] });
      setSyncing(false);
    }).catch(() => setSyncing(false));
  }

  useEffect(() => {
    if (selectedId === 'trading212-portfolio' && !syncAttempted.current) {
      syncAttempted.current = true;
      setSyncing(true);
      apiPost('/api/watchlists/trading212-portfolio/sync', {}).then(() => {
        setLastSync(new Date().toLocaleTimeString());
        queryClient.invalidateQueries({ queryKey: ['watchlists'] });
        queryClient.invalidateQueries({ queryKey: ['watchlist-symbols', selectedId] });
        setSyncing(false);
      }).catch(() => setSyncing(false));
    }
  }, [selectedId, queryClient]);

  const handleSelect = (id) => {
    setCreatingNew(false);
    setSelectedId(id);
  };

  async function handleCreateWatchlist() {
    if (!newName.trim()) return;
    const symbols = newSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    try {
      await apiPost('/api/watchlists', { name: newName.trim(), symbols });
      setNewName('');
      setNewSymbols('');
      setCreatingNew(false);
      queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    } catch (e) {
      // error handled silently
    }
  }

  const totalSymbols = watchlists?.reduce((s, w) => s + (w.symbolCount || 0), 0) || 0;

  function renderWatchlistItem(wl, i) {
    return (
      <motion.div
        key={wl.id}
        className={`wl-list-item${selectedId === wl.id ? ' wl-selected' : ''}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: i * 0.04 }}
      >
        <div className="wl-list-header" onClick={() => handleSelect(wl.id)}>
          <div className="wl-list-main">
            <span className="wl-list-name">
              {wl.isDefault && <span className="wl-default-star" title="Default watchlist">★ </span>}
              {isLocked && selectedId === wl.id && <span className="wl-lock-icon" title="Locked — in use by active strategies">🔒 </span>}
              {cleanLabel(wl.label)}
            </span>
            <span className="wl-list-count">{wl.symbolCount} symbols</span>
          </div>
          <div className="wl-list-meta">
            {wl.source && (
              <span className="wl-list-source">
                {wl.source.includes('CSV') ? '📄 CSV' : wl.source === 'manual' ? '✏️ Manual' : wl.kind === 'built-in' ? '🔗 Built-in' : wl.source}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="wl-page">

      {isLoading && <p className="wl-loading">Loading…</p>}

      {error && (
        <div className="wl-error">
          <p>Failed to load watchlists: {error.message}</p>
          <p className="wl-hint">Check that the API server is running on port 3201.</p>
        </div>
      )}

      {!isLoading && !error && (!watchlists || watchlists.length === 0) && (
        <div className="wl-empty-state">
          <p>No watchlists saved yet.</p>
          <button className="wl-create-link" onClick={() => setCreatingNew(true)}>Create your first watchlist →</button>
        </div>
      )}

      {!isLoading && !error && watchlists?.length > 0 && (
        <div className="wl-split">
          {/* ── Left: Accordion List ── */}
          <div className="wl-list-pane">
            {/* Built-in Watchlists */}
            {watchlists.some(w => w.kind === 'built-in') && (
              <div className="wl-group">
                <div className="wl-group-label">Built-in Watchlists</div>
                {watchlists.filter(w => w.kind === 'built-in').map((wl, i) => renderWatchlistItem(wl, i))}
              </div>
            )}
            {/* Watchlists */}
            <div className="wl-group">
              <div className="wl-group-label">{isLoading ? 'Loading…' : `${watchlists?.length || 0} watchlists · ${totalSymbols} total symbols`}</div>
              {watchlists.filter(w => w.kind !== 'built-in').map((wl, i) => renderWatchlistItem(wl, i))}
              {/* Inline "Create New Watchlist" entry */}
              <motion.div
                className={`wl-list-item wl-create-new ${creatingNew ? 'wl-selected' : ''}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => { setCreatingNew(true); setSelectedId(null); }}
              >
                <div className="wl-list-header">
                  <div className="wl-list-main">
                    <span className="wl-list-name" style={{ color: 'var(--accent)' }}>⊞ Create New Watchlist</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* ── Right: Symbols Panel ── */}
          <aside className="wl-detail-pane">
            {creatingNew ? (
              <div className="wl-detail-content">
                <h3>Create New Watchlist</h3>
                <div className="wl-create-form">
                  <label>
                    <span>Watchlist Name</span>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g., Tech Watchlist"
                      className="wl-input"
                      autoFocus
                    />
                  </label>
                  <label>
                    <span>Symbols (comma-separated tickers)</span>
                    <input
                      type="text"
                      value={newSymbols}
                      onChange={(e) => setNewSymbols(e.target.value)}
                      placeholder="e.g., AAPL, MSFT, NVDA"
                      className="wl-input"
                    />
                  </label>
                  <div className="wl-create-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleCreateWatchlist}
                      disabled={!newName.trim()}
                    >
                      Create Watchlist
                    </button>
                    <button className="btn" onClick={() => { setCreatingNew(false); setNewName(''); setNewSymbols(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : !selectedWl ? (
              <div className="wl-detail-empty">
                <p>Select a watchlist to view its symbols.</p>
              </div>
            ) : (
              <div className="wl-detail-content">
                <div className="wl-detail-header-row">
                  <h3>{cleanLabel(selectedWl.label)}</h3>
                  {!selectedWl.isDefault && (
                    <button
                      className="wl-delete-btn"
                      onClick={() => { if (confirm(`Delete "${cleanLabel(selectedWl.label)}"?`)) { deleteMutation.mutate(selectedWl.id); } }}
                      disabled={isLocked}
                      title={isLocked ? 'Locked by active strategies' : 'Delete watchlist'}
                    >
                      🗑️ Delete
                    </button>
                  )}
                </div>
                <div className="wl-symbols-count">
                  {symbols.length} symbols
                  {selectedId === 'trading212-portfolio' && (
                    <span style={{ marginLeft: 12 }}>
                      <button
                        className="wl-sync-btn"
                        disabled={syncing}
                        onClick={doSync}
                      >
                        {syncing ? '⟳ Syncing…' : '⟳ Sync Now'}
                      </button>
                      {lastSync && <span className="wl-sync-time">Last: {lastSync}</span>}
                    </span>
                  )}
                </div>
                {symbols.length > 0 && (
                  <div className="wl-viewbar" role="group" aria-label="Colour symbols by activity">
                    <span className="wl-viewbar-label">Colour</span>
                    <button type="button" className={`wl-view-btn${viewMode === 'neutral' ? ' wl-view-btn--active' : ''}`} onClick={() => setViewMode('neutral')} title="No colouring">Default</button>
                    <button type="button" className={`wl-view-btn${viewMode === 'traded' ? ' wl-view-btn--active' : ''}`} onClick={() => setViewMode('traded')} title="Highlight symbols with an open position">Traded</button>
                  </div>
                )}
                <div className="wl-symbols-grid">
                  {symbols.map(s => {
                    const ticker = typeof s === 'string' ? s : (s.ticker || s.symbol || s.name || '');
                    const cleanTicker = ticker.includes('_') ? ticker.split('_')[0] : ticker;
                    const companyName = symbolNameMap[cleanTicker.toUpperCase()] || '';
                    const traded = viewMode === 'traded' && positionSymbols.has(String(cleanTicker).toUpperCase());
                    return (
                      <div key={ticker || Math.random()} className="wl-symbol-chip-wrap">
                        <a
                          href={`/research/symbol/${cleanTicker}`}
                          className={`wl-symbol-chip${viewMode === 'traded' ? (traded ? ' wl-symbol-chip--traded' : ' wl-symbol-chip--flat') : ''}`}
                          title={traded ? `Open position — ${cleanTicker}` : undefined}
                        >
                          <span className="wl-symbol-ticker">{cleanTicker}</span>
                          {companyName && (
                            <span className="wl-symbol-name">{companyName}</span>
                          )}
                        </a>
                        {!isLocked && (
                          <button
                            className="wl-symbol-remove"
                            onClick={(e) => { e.preventDefault(); removeSymbolMutation.mutate({ watchlistId: selectedId, ticker: cleanTicker }); }}
                            title={`Remove ${cleanTicker}`}
                            aria-label={`Remove ${cleanTicker}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {symbols.length === 0 && selectedId && (
                  <p className="wl-hint">No symbol data available for this list.</p>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
