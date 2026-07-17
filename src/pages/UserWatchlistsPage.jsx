/**
 * Watchlists Page
 * ===============
 * Two-column layout: watchlist list on left, symbols in right panel.
 * Inline creation replaces the old standalone CreateWatchlistPage (#301).
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const symbols = detail?.symbols ?? [];

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
    setSelectedId(prev => prev === id ? null : id);
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
            <span className="wl-chevron">{selectedId === wl.id ? '▴' : '▾'}</span>
          </div>
        </div>

        <AnimatePresence>
          {selectedId === wl.id && (
            <motion.div
              className="wl-list-detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {wl.importedAt && (
                <span className="wl-list-date">
                  Imported {new Date(wl.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {wl.kind === 'built-in' && (
                <span className="wl-list-date" style={{ marginLeft: 8, color: 'var(--accent)' }}>
                  {syncing && selectedId === wl.id ? 'Syncing…' : 'Auto-synced'}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <div className="wl-page">
      <header className="wl-header">
        <div>
          <h2>Watchlists</h2>
          <p className="wl-subtitle">
            {isLoading ? 'Loading…' : `${watchlists?.length || 0} watchlists · ${totalSymbols} total symbols`}
          </p>
        </div>
      </header>

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
              <div className="wl-group-label">Watchlists</div>
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
                <h3>{cleanLabel(selectedWl.label)}</h3>
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
                <div className="wl-symbols-grid">
                  {symbols.map(s => {
                    // Handle both object {ticker, name} and plain string formats
                    const ticker = typeof s === 'string' ? s : (s.ticker || s.symbol || s.name || '');
                    const displayName = typeof s === 'string' ? s : (s.name || s.ticker || s.symbol || '');
                    // Clean Trading212 IDs like "RBLX_US_EQ" → "RBLX"
                    const cleanTicker = ticker.includes('_') ? ticker.split('_')[0] : ticker;
                    return (
                      <a
                        key={ticker || Math.random()}
                        href={`/research/symbol/${cleanTicker}`}
                        className="wl-symbol-chip"
                      >
                        {cleanTicker}
                        {displayName && displayName !== cleanTicker && (
                          <span className="wl-symbol-name">{displayName}</span>
                        )}
                      </a>
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
