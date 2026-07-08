import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { DIRECTIVE_SEED } from '../pages/directives-manager.seed';
import EmptyState from './EmptyState';

const PROVIDERS = [
  { id: 'trading212', name: 'Trading 212' },
  { id: 'alpaca', name: 'Alpaca' },
  { id: 'alpha_vantage', name: 'Alpha Vantage' },
  { id: 'polygon', name: 'Polygon' },
  { id: 'tradier', name: 'Tradier' },
  { id: 'ibkr', name: 'Interactive Brokers' },
];

const DEBOUNCE_MS = 300;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Fetch symbols
  const symbolsQuery = useQuery({
    queryKey: ['global-search-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    staleTime: 60_000,
    enabled: debouncedQuery.length >= 2,
  });

  // Global Ctrl+K / / shortcut
  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Search results
  const results = useMemo(() => {
    if (debouncedQuery.length < 2) return [];
    const q = debouncedQuery.toLowerCase();

    const symbols = (Array.isArray(symbolsQuery.data?.symbols) ? symbolsQuery.data.symbols : [])
      .filter((s) => s.ticker?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))
      .slice(0, 5)
      .map((s) => ({ type: 'symbol', id: s.id, label: s.ticker, sub: s.name, navigate: `/research/symbols-browser` }));

    const directives = DIRECTIVE_SEED
      .filter((d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q))
      .slice(0, 5)
      .map((d) => ({ type: 'directive', id: d.id, label: d.name, sub: d.category, navigate: `/scoring/directives-manager` }));

    const providers = PROVIDERS
      .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .slice(0, 3)
      .map((p) => ({ type: 'provider', id: p.id, label: p.name, sub: p.id, navigate: `/trading-platforms/trading-platforms` }));

    return [...symbols, ...directives, ...providers];
  }, [debouncedQuery, symbolsQuery.data]);

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(0); }, [results.length]);

  const total = results.length;

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => (i + 1) % Math.max(total, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => (i - 1 + total) % Math.max(total, 1)); }
    else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      navigate(results[selectedIndex].navigate);
      setQuery('');
      setIsOpen(false);
    }
    else if (e.key === 'Escape') { setIsOpen(false); inputRef.current?.blur(); }
  }

  function handleSelect(result) {
    navigate(result.navigate);
    setQuery('');
    setIsOpen(false);
  }

  const groupLabel = { symbol: 'Symbols', directive: 'Directives', provider: 'Providers' };
  let lastType = '';

  return (
    <div className="global-search">
      <input
        ref={inputRef}
        type="search"
        className="global-search-input"
        placeholder="Search symbols, directives, providers… (Ctrl+K)"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={() => { if (query.length >= 2) setIsOpen(true); }}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && results.length > 0 && (
        <div className="global-search-results">
          {results.map((r, i) => {
            const showGroup = r.type !== lastType;
            lastType = r.type;
            return (
              <div key={`${r.type}-${r.id}`}>
                {showGroup && <div className="global-search-group">{groupLabel[r.type]}</div>}
                <button
                  type="button"
                  className={`global-search-item ${i === selectedIndex ? 'global-search-item--selected' : ''}`}
                  onMouseDown={() => handleSelect(r)}
                >
                  <span className="global-search-item-label">{r.label}</span>
                  <span className="global-search-item-sub">{r.sub}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {isOpen && debouncedQuery.length >= 2 && results.length === 0 && !symbolsQuery.isLoading && (
        <div className="global-search-results">
          <EmptyState icon="🔍" title={`No results for "${debouncedQuery}"`} />
        </div>
      )}
    </div>
  );
}
