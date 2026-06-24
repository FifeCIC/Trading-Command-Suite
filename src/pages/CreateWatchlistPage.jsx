/**
 * Create Watchlist Page
 * =====================
 * Manually enter symbols to create a repo-backed JSON watchlist.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../core/api/client';
import WATCHLIST_SYMBOLS from '../data/watchlist-symbols.seed';
import './watchlists.css';

export default function CreateWatchlistPage() {
  const queryClient = useQueryClient();

  // ── Manual entry ────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
      description: description.trim() || undefined,
      symbols: entries,
    });
  };

  return (
    <div className="wl-page">
      <header className="wl-header">
        <h2>Create Watchlist</h2>
        <p className="wl-subtitle">Enter symbol names to create a new watchlist</p>
      </header>

      {/* ── Manual Entry ── */}
      <div className="wl-card">
        <h3>Manual Entry</h3>
        <p className="wl-hint">Type or paste symbols — comma or newline separated</p>
        <div className="wl-field">
          <label>Watchlist Name</label>
          <input type="text" placeholder="e.g. Momentum Stocks" value={name} onChange={(e) => setName(e.target.value)} className="wl-input" />
        </div>
        <div className="wl-field">
          <label>Description</label>
          <input type="text" placeholder="What this watchlist tracks and why" value={description} onChange={(e) => setDescription(e.target.value)} className="wl-input" />
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
