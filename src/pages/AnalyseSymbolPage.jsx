import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { useCurrentSymbolStore } from '../stores/useCurrentSymbolStore';
import './trading-platforms.css';
import './analyse-symbol.css';

export default function AnalyseSymbolPage() {
  const navigate = useNavigate();
  const { symbol: currentSymbol, setSymbol: setCurrentSymbol, clearSymbol } = useCurrentSymbolStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(currentSymbol);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Fetch symbols for autocomplete
  const symbolsQuery = useQuery({
    queryKey: ['analyse-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    retry: 1,
  });
  const syms = Array.isArray(symbolsQuery.data?.symbols) ? symbolsQuery.data.symbols : [];

  // Fetch scoring data for selected symbol
  const scoringQuery = useQuery({
    queryKey: ['analyse-scoring', selected?.ticker],
    queryFn: () => apiGet('/api/scoring/ranked?limit=50'),
    enabled: !!selected,
    retry: 1,
  });
  const ranked = Array.isArray(scoringQuery.data?.ranked) ? scoringQuery.data.ranked : [];
  const symbolScore = ranked.find((r) => r.ticker?.toUpperCase() === selected?.ticker?.toUpperCase());

  // Search
  const doSearch = useCallback((q) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    const lower = q.toLowerCase();
    const matches = syms.filter(
      (s) => s.ticker.toLowerCase().includes(lower) || s.name.toLowerCase().includes(lower),
    ).slice(0, 8);
    setResults(matches);
    setSearching(false);
  }, [syms]);

  useEffect(() => {
    if (syms.length > 0 && query) doSearch(query);
  }, [syms, query, doSearch]);

  const selectSymbol = (sym) => {
    setSelected(sym);
    setCurrentSymbol(sym);
    setQuery(sym.ticker);
    setResults([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setResults([]); setQuery(''); }
  };

  // Actions
  const actions = [
    {
      label: 'Add to Watchlist',
      icon: '➕',
      action: () => navigate('/watchlists/add-symbol'),
    },
    {
      label: 'Trade',
      icon: '📈',
      action: () => navigate('/trading/mt5-trading'),
    },
  ];

  return (
    <div className="trading-platforms-page as-page">
      <header className="tp-page-header">
        <h1>Analyse Symbol</h1>
        <p>Select a symbol to view scoring data, directives, and run AI analysis.</p>
      </header>

      {/* Symbol Selector */}
      <section className="tp-card">
        <div style={{ position: 'relative' }}>
          <label htmlFor="as-search" className="as-search-label">Symbol</label>
          <input
            id="as-search"
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            onKeyDown={handleKeyDown}
            placeholder="Search by ticker or name..."
            className="as-search-input"
            autoFocus
          />
          {searching && <span className="as-searching">Searching...</span>}
          {results.length > 0 && !selected && (
            <ul className="as-autocomplete">
              {results.map((sym) => (
                <li key={sym.id}>
                  <button type="button" onClick={() => selectSymbol(sym)}>
                    <strong>{sym.ticker}</strong>
                    <span>{sym.name}</span>
                    <small>{sym.exchange} · {sym.type}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {currentSymbol && !selected && (
          <p className="as-current-hint">
            Current: <strong>{currentSymbol.ticker}</strong> —{' '}
            <button type="button" className="as-link" onClick={() => selectSymbol(currentSymbol)}>Analyse now</button>
            {' · '}
            <button type="button" className="as-link" onClick={clearSymbol}>Clear</button>
          </p>
        )}
      </section>

      {selected && (
        <>
          {/* Data Snapshot */}
          <section className="tp-card">
            <h2>Data Snapshot: {selected.ticker}</h2>
            <div className="as-snapshot-grid">
              <div className="as-snap-card">
                <span className="as-snap-label">Name</span>
                <span className="as-snap-value">{selected.name}</span>
              </div>
              <div className="as-snap-card">
                <span className="as-snap-label">Exchange</span>
                <span className="as-snap-value">{selected.exchange}</span>
              </div>
              <div className="as-snap-card">
                <span className="as-snap-label">Type</span>
                <span className="as-snap-value">{selected.type}</span>
              </div>
              <div className="as-snap-card">
                <span className="as-snap-label">Status</span>
                <span className={`as-snap-value ${selected.active !== false ? 'as-ok' : 'as-warn'}`}>
                  {selected.active !== false ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </section>

          {/* Scoring Data */}
          {symbolScore && (
            <section className="tp-card">
              <h2>Scoring</h2>
              <div className="as-score-row">
                <div className="as-score-main">
                  <span className="as-score-value">{symbolScore.score}</span>
                  <span className="as-score-max">/ {symbolScore.maxPossibleScore} max</span>
                </div>
                <span className={`as-signal as-signal--${symbolScore.signal}`}>
                  {symbolScore.signal?.toUpperCase()}
                </span>
                <span className="as-confidence">
                  {(symbolScore.normalizedScore ?? 0).toFixed(0)}% of max
                </span>
              </div>
              {symbolScore.breakdown?.length > 0 && (
                <div className="as-breakdown">
                  <h3>Directive Breakdown</h3>
                  {symbolScore.breakdown.slice(0, 8).map((d) => (
                    <div key={d.directiveId} className="as-dir-row">
                      <span className="as-dir-name">{d.name}</span>
                      <span className={`as-dir-sig as-dir-sig--${d.signalClass}`}>{d.signalClass?.toUpperCase()}</span>
                      <span className="as-dir-score">{d.score}</span>
                      <span className="as-dir-max">/ {d.maxScore}</span>
                      <span className="as-dir-conf">{(d.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {!symbolScore && !scoringQuery.isLoading && (
            <section className="tp-card">
              <p className="as-no-data">No scoring data available for {selected.ticker}. Ensure the symbol has price data and is active.</p>
            </section>
          )}

          {/* AI Analysis (placeholder) */}
          <section className="tp-card as-ai-placeholder">
            <h2>🤖 AI Analysis</h2>
            <p>Multi-AI comparison coming soon. Configure DeepSeek, Gemini, or other providers in Settings to run analysis across multiple AIs simultaneously.</p>
            <div className="as-ai-teaser">
              <span>Providers: DeepSeek · Gemini · (configurable)</span>
              <span>Compare: Side-by-side output · Agreement highlighting · Confidence scores</span>
            </div>
          </section>

          {/* Actions */}
          <section className="tp-card">
            <h2>Actions</h2>
            <div className="as-actions">
              {actions.map((a) => (
                <button key={a.label} type="button" className="as-action-btn" onClick={a.action}>
                  <span>{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
