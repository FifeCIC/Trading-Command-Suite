/**
 * User Watchlists Page
 * ====================
 * Lists all saved watchlists. Import/create is on the Create Watchlist page.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './watchlists.css';

export default function UserWatchlistsPage() {
  const [expanded, setExpanded] = useState(null);

  const { data: watchlists, isLoading } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 30_000,
  });

  return (
    <div className="wl-page">
      <header className="wl-header">
        <h2>User Watchlists</h2>
        <p className="wl-subtitle">Saved watchlists — import new ones via Create Watchlist</p>
      </header>

      <div className="wl-card">
        <h3>Saved Watchlists</h3>
        {isLoading && <p className="wl-loading">Loading…</p>}
        {!isLoading && (!watchlists || watchlists.length === 0) && (
          <p className="wl-empty">
            No watchlists saved yet.{' '}
            <a href="/watchlists/create-watchlist" style={{ color: 'var(--accent)' }}>Create one</a>
          </p>
        )}
        {watchlists?.map((wl) => (
          <div key={wl.id} className="wl-list-item">
            <div className="wl-list-header" onClick={() => setExpanded(expanded === wl.id ? null : wl.id)}>
              <span className="wl-list-name">{wl.label}</span>
              <span className="wl-list-count">{wl.symbolCount} symbols</span>
              {wl.source && <span className="wl-list-source">{wl.source}</span>}
              {wl.importedAt && <span className="wl-list-date">{new Date(wl.importedAt).toLocaleDateString()}</span>}
            </div>
            {expanded === wl.id && (
              <div className="wl-list-detail">
                <p className="wl-hint">File: src/data/watchlists/{wl.id}.json</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
