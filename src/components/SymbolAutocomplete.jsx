/**
 * SymbolAutocomplete — DB-backed symbol search with autocomplete dropdown.
 *
 * Props:
 *   value       — current comma-separated ticker string (e.g. "AAPL, NVDA")
 *   onChange    — called with updated ticker string
 *   onSymbolsChange — called with parsed array of { ticker, symbolId } objects
 *   placeholder — input placeholder
 *   className   — optional wrapper class
 *
 * Behavior:
 *   - As the user types, queries GET /api/symbols?search=... for matching tickers
 *   - Shows a dropdown with ticker + name; click inserts the ticker
 *   - Supports comma/space-separated multi-symbol entry
 *   - Resolves DB symbol IDs for any ticker matched from the autocomplete
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './symbol-autocomplete.css';

export default function SymbolAutocomplete({
  value = '',
  onChange,
  onSymbolsChange,
  placeholder = 'AAPL, NVDA, MSFT...',
  className = '',
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedSymbolIds, setSelectedSymbolIds] = useState({});
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Parse current partial entry
  const { parts, partial } = useMemo(() => {
    const p = value.split(/[,\s]+/).filter(Boolean);
    const last = p.length > 0 ? p[p.length - 1].trim().toUpperCase() : '';
    return { parts: p, partial: last };
  }, [value]);

  // Search symbols as user types
  const searchQuery = useQuery({
    queryKey: ['symbol-search', partial],
    queryFn: () => apiGet(`/api/symbols?search=${encodeURIComponent(partial)}`).catch(() => []),
    enabled: partial.length >= 1,
    staleTime: 30_000,
  });

  const suggestions = useMemo(() => {
    const raw = searchQuery.data;
    const data = Array.isArray(raw) ? raw : (raw?.symbols ?? []);
    // Filter out already-selected tickers
    const alreadySelected = new Set(parts.slice(0, -1).map(s => s.toUpperCase()));
    return data
      .filter(s => !alreadySelected.has(s.ticker?.toUpperCase?.() ?? ''))
      .slice(0, 8);
  }, [searchQuery.data, parts]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const insertSymbol = useCallback(
    (ticker, symbolId) => {
      const existing = value.split(/[,\s]+/).filter(Boolean);
      // Replace the partial with the selected ticker
      existing[existing.length - 1] = ticker;
      const newValue = existing.join(', ') + (existing.length > 0 ? ', ' : '');
      onChange?.(newValue);
      if (symbolId) {
        setSelectedSymbolIds(prev => ({ ...prev, [ticker.toUpperCase()]: symbolId }));
      }
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  // Notify parent of resolved symbol IDs whenever value changes
  useEffect(() => {
    const currentTickers = value
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const resolved = currentTickers.map(ticker => ({
      ticker,
      symbolId: selectedSymbolIds[ticker] || null,
    }));
    onSymbolsChange?.(resolved);
  }, [value, selectedSymbolIds]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [],
  );

  return (
    <div className={`sa-wrap ${className}`} ref={dropdownRef}>
      <input
        ref={inputRef}
        type="text"
        className="sa-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange?.(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => partial.length >= 1 && setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        aria-label="Enter ticker symbols"
        autoComplete="off"
        spellCheck="false"
      />
      {showDropdown && suggestions.length > 0 && (
        <div className="sa-dropdown">
          {searchQuery.isFetching && (
            <div className="sa-dropdown-loading">Searching…</div>
          )}
          {suggestions.map((s) => {
            const ticker = s.ticker || s;
            const name = s.name || s.exchange || '';
            return (
              <button
                key={ticker}
                type="button"
                className="sa-dropdown-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertSymbol(ticker, s.id || null);
                }}
              >
                <span className="sa-item-ticker">{ticker}</span>
                {name && <span className="sa-item-name">{name}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
