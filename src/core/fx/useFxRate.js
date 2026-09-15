/**
 * FX Rate Hook — useFxRate
 * ========================
 * Fetches real-time FX rate for a currency pair.
 * Returns { rate, loading, error, lastUpdated }.
 * 
 * Requires: GET /api/fx/rate/:pair (see Q289)
 * Until the endpoint exists, returns { rate: null, loading: false }.
 */

import { useState, useEffect } from 'react';
import { apiUrl } from '../api/client';
// ⚠️ No consumers found when this was migrated (2026-09-15) — the hook is currently unreferenced.
// Migrated anyway so that whoever wires it up gets a coded failure rather than a bare sentence.
import { noticeLine } from '../notices/registry.js';

const CACHE = new Map();
const CACHE_TTL = 60_000; // 1 minute

export function useFxRate(pair) {
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (!pair) return;

    const cached = CACHE.get(pair);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setRate(cached.rate);
      setLastUpdated(cached.ts);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(apiUrl(`/api/fx/rate/${encodeURIComponent(pair)}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const val = data?.status === 'unavailable' || data?.status === 'invalid_pair' ? null : data?.rate ?? null;
        setRate(val);
        setLastUpdated(Date.now());
        setError(null);
        CACHE.set(pair, { rate: val, ts: Date.now() });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(noticeLine('TCS-SYS-007', { operation: 'fetch the FX rate', detail: err }));
        setRate(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pair]);

  return { rate, loading, error, lastUpdated };
}

/**
 * Convert an amount from one currency to GBP.
 * Requires useFxRate hook data.
 */
export function convertToGbp(amount, fxRate) {
  if (fxRate == null || !amount) return null;
  return amount * fxRate;
}

/**
 * Format a GBP value with currency symbol.
 */
export function formatGbp(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
