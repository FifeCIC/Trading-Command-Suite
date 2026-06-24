/**
 * User Watchlists Page
 * ====================
 * Two-column layout: accordion list on left, symbols in right panel.
 * Protocol assignment has been removed — protocols will reference watchlists
 * (many-to-many), not the other way around.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
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

  const handleSelect = (id) => setSelectedId(prev => prev === id ? null : id);

  const totalSymbols = watchlists?.reduce((s, w) => s + (w.symbolCount || 0), 0) || 0;

  return (
    <div className="wl-page">
      <header className="wl-header">
        <div>
          <h2>User Watchlists</h2>
          <p className="wl-subtitle">
            {isLoading ? 'Loading…' : `${watchlists?.length || 0} watchlists · ${totalSymbols} total symbols`}
            {' · '}
            <a href="/watchlists/create-watchlist" style={{ color: 'var(--accent)' }}>Create New</a>
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
          <a href="/watchlists/create-watchlist" className="wl-create-link">Create your first watchlist →</a>
        </div>
      )}

      {!isLoading && !error && watchlists?.length > 0 && (
        <div className="wl-split">
          {/* ── Left: Accordion List ── */}
          <div className="wl-list-pane">
            {watchlists.map((wl, i) => (
              <motion.div
                key={wl.id}
                className={`wl-list-item${selectedId === wl.id ? ' wl-selected' : ''}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
              >
                <div className="wl-list-header" onClick={() => handleSelect(wl.id)}>
                  <div className="wl-list-main">
                    <span className="wl-list-name">{cleanLabel(wl.label)}</span>
                    <span className="wl-list-count">{wl.symbolCount} symbols</span>
                  </div>
                  <div className="wl-list-meta">
                    {wl.source && (
                      <span className="wl-list-source">
                        {wl.source.includes('CSV') ? '📄 CSV' : wl.source === 'manual' ? '✏️ Manual' : wl.source}
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>

          {/* ── Right: Symbols Panel ── */}
          <aside className="wl-detail-pane">
            {!selectedWl ? (
              <div className="wl-detail-empty">
                <p>Select a watchlist to view its symbols.</p>
              </div>
            ) : (
              <div className="wl-detail-content">
                <h3>{cleanLabel(selectedWl.label)}</h3>
                <div className="wl-symbols-count">{symbols.length} symbols</div>
                <div className="wl-symbols-grid">
                  {symbols.map(s => (
                    <a
                      key={s.ticker || s.symbol}
                      href={`/research/symbol/${s.ticker || s.symbol}`}
                      className="wl-symbol-chip"
                    >
                      {s.ticker || s.symbol}
                      {s.name && s.name !== (s.ticker || s.symbol) && (
                        <span className="wl-symbol-name">{s.name}</span>
                      )}
                    </a>
                  ))}
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
