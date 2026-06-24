/**
 * Create Watchlist Page
 * =====================
 * Import CSV from Trading212, or manually enter symbols.
 * Saves as repo-backed JSON file.
 */

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../core/api/client';
import WATCHLIST_SYMBOLS from '../data/watchlist-symbols.seed';
import './watchlists.css';

export default function CreateWatchlistPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  // ── CSV Import ──────────────────────────────────────
  const [csvName, setCsvName] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const result = await apiPost('/api/watchlists/import-csv', {
        csv: text,
        listName: csvName || file.name.replace(/\.csv$/i, ''),
      });
      setPreview(result);
      if (result.saved) queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    } catch (err) {
      setPreview({ error: err.message });
    }
    setImporting(false);
  };

  // ── Manual entry ────────────────────────────────────
  const [name, setName] = useState('');
  const [symbols, setSymbols] = useState('');
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (body) => apiPost('/api/watchlists', body),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['watchlists'] });
    },
  });

  const handleSave = () => {
    if (!name.trim() || !symbols.trim()) return;
    const list = symbols.split(/[\n,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const entries = list.map((ticker) => {
      const known = WATCHLIST_SYMBOLS.find((s) => s.ticker.toUpperCase() === ticker);
      return known || { ticker, exchange: 'Trading212', type: 'stock' };
    });
    saveMutation.mutate({
      id: name.trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase(),
      label: name.trim(),
      symbols: entries,
    });
  };

  return (
    <div className="wl-page">
      <header className="wl-header">
        <h2>Create Watchlist</h2>
        <p className="wl-subtitle">Import CSV from Trading212 or manually enter symbols</p>
      </header>

      {/* ── CSV Import ── */}
      <div className="wl-card">
        <h3>Import CSV</h3>
        <p className="wl-hint">Export your Trading212 wishlist as CSV, upload here. Saved as repo file.</p>
        <div className="wl-import-row">
          <input type="text" placeholder="Watchlist name (e.g. euros-tech)" value={csvName} onChange={(e) => setCsvName(e.target.value)} className="wl-input" />
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="wl-file" />
          {importing && <span className="wl-loading">Importing…</span>}
        </div>
        {preview && !preview.error && (
          <div className="wl-preview">
            <strong>Imported {preview.total} symbols</strong>
            {preview.skipped > 0 && <span className="wl-skipped"> ({preview.skipped} skipped)</span>}
            {preview.saved && <span className="wl-saved"> ✓ Saved</span>}
            <div className="wl-symbol-chips">
              {preview.symbols.map((s) => (<span key={s.ticker} className="wl-chip" title={s.name}>{s.ticker}</span>))}
              {preview.total > 50 && <span className="wl-chip wl-more">+{preview.total - 50} more</span>}
            </div>
          </div>
        )}
        {preview?.error && <p className="wl-error">{preview.error}</p>}
      </div>

      {/* ── Manual Entry ── */}
      <div className="wl-card">
        <h3>Manual Entry</h3>
        <p className="wl-hint">Type or paste symbols — comma or newline separated</p>
        <div className="wl-field">
          <label>Watchlist Name</label>
          <input type="text" placeholder="e.g. euros-tech" value={name} onChange={(e) => setName(e.target.value)} className="wl-input" />
        </div>
        <div className="wl-field">
          <label>Symbols</label>
          <textarea value={symbols} onChange={(e) => setSymbols(e.target.value)} rows={6} className="wl-textarea" placeholder="NVDA, AAPL, TSLA, 8XP, GAW&#10;MSFT&#10;AMZN" />
          <span className="wl-hint">{symbols.split(/[\n,]+/).filter(Boolean).length} symbols entered</span>
        </div>
        <button className="wl-btn" onClick={handleSave} disabled={saveMutation.isPending || !name.trim() || !symbols.trim()}>
          {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Watchlist'}
        </button>
        {saveMutation.error && <p className="wl-error">{saveMutation.error.message}</p>}
      </div>

      {/* ── Reference ── */}
      <div className="wl-card">
        <h3>Known Symbols (seed reference)</h3>
        <div className="wl-symbol-chips">
          {WATCHLIST_SYMBOLS.map((s) => (<span key={s.ticker} className="wl-chip wl-chip-seed" title={s.name}>{s.ticker}</span>))}
        </div>
      </div>
    </div>
  );
}
