/**
 * User Watchlists Page
 * ====================
 * Two-column layout: accordion list on left, symbols + protocol in right panel.
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

const PROTOCOLS = [
  { id: 'none', label: 'No protocol' },
  { id: 'conviction-dip', label: 'Conviction Dip Accumulation' },
  { id: 'momentum-breakout', label: 'Momentum Breakout' },
  { id: 'mean-reversion-swing', label: 'Mean Reversion Swing' },
  { id: 'btc-speed-v1', label: 'BTC Speed Scalp' },
  { id: 'earnings-whisper', label: 'Earnings Whisper' },
  { id: 'trend-following', label: 'Trend Following' },
];

export default function UserWatchlistsPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [protocolMap, setProtocolMap] = useState({});

  const { data: watchlists, isLoading } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 30_000,
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
  const currentProtocol = protocolMap[selectedId] || 'none';

  const handleSelect = (id) => setSelectedId(prev => prev === id ? null : id);

  const setProtocol = (id, proto) => {
    setProtocolMap(prev => ({ ...prev, [id]: proto }));
    // Persist to database
    apiPost(`/api/watchlists/${id}`, { protocolId: proto === 'none' ? null : proto }).catch(() => {});
  };

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

      {!isLoading && (!watchlists || watchlists.length === 0) && (
        <div className="wl-empty-state">
          <p>No watchlists saved yet.</p>
          <a href="/watchlists/create-watchlist" className="wl-create-link">Create your first watchlist →</a>
        </div>
      )}

      {!isLoading && watchlists?.length > 0 && (
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
                      <label className="wl-proto-label">
                        Protocol:
                        <select
                          className="wl-proto-select"
                          value={currentProtocol}
                          onChange={e => setProtocol(wl.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                        >
                          {PROTOCOLS.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                          ))}
                        </select>
                      </label>
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
                {currentProtocol !== 'none' && (
                  <div className="wl-proto-badge">
                    🔗 {PROTOCOLS.find(p => p.id === currentProtocol)?.label}
                  </div>
                )}
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
