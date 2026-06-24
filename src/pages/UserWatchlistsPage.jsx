/**
 * User Watchlists Page
 * ====================
 * Lists saved watchlists, CSV import from Trading212, preview.
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './watchlists.css';

export default function UserWatchlistsPage() {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [listName, setListName] = useState('');
  const [preview, setPreview] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const fileRef = useRef(null);

  // ── List saved watchlists ───────────────────────────
  const { data: watchlists, isLoading } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 30_000,
  });

  // ── CSV Import ──────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const result = await apiPost('/api/watchlists/import-csv', {
        csv: text,
        listName: listName || file.name.replace(/\.csv$/i, ''),
      });
      setPreview(result);
      if (result.saved) queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    } catch (err) {
      setPreview({ error: err.message });
    }
    setImporting(false);
  };

  return (
    <div className="wl-page">
      <header className="wl-header">
        <h2>User Watchlists</h2>
        <p className="wl-subtitle">Import CSV from Trading212 or manage your watchlists</p>
      </header>

      {/* ── CSV Import ── */}
      <div className="wl-card">
        <h3>Import CSV</h3>
        <p className="wl-hint">Export your Trading212 wishlist as CSV, upload here. Symbols are saved as repo files.</p>
        <div className="wl-import-row">
          <input
            type="text"
            placeholder="Watchlist name (e.g. euros-tech)"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            className="wl-input"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="wl-file"
          />
          {importing && <span className="wl-loading">Importing…</span>}
        </div>

        {preview && !preview.error && (
          <div className="wl-preview">
            <strong>Imported {preview.total} symbols</strong>
            {preview.skipped > 0 && <span className="wl-skipped"> ({preview.skipped} skipped)</span>}
            {preview.saved && <span className="wl-saved"> ✓ Saved</span>}
            <div className="wl-symbol-chips">
              {preview.symbols.map((s) => (
                <span key={s.ticker} className="wl-chip" title={s.name}>{s.ticker}</span>
              ))}
              {preview.total > 50 && <span className="wl-chip wl-more">+{preview.total - 50} more</span>}
            </div>
          </div>
        )}
        {preview?.error && <p className="wl-error">{preview.error}</p>}
      </div>

      {/* ── Saved Watchlists ── */}
      <div className="wl-card">
        <h3>Saved Watchlists</h3>
        {isLoading && <p className="wl-loading">Loading…</p>}
        {!isLoading && (!watchlists || watchlists.length === 0) && (
          <p className="wl-empty">No watchlists saved yet. Import a CSV above.</p>
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
                <p className="wl-hint">Stored in: src/data/watchlists/{wl.id}.json</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
