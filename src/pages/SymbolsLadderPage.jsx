/**
 * Symbols Ladder — All symbols across all active protocols with scores.
 * =====================================================================
 * Protocols → watchlists → symbols, enriched with latest scores from the
 * Score table. Does NOT trigger scoring — only reads existing data.
 *
 * Refreshes silently using keepPreviousData to avoid content blink.
 */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './protocols-ladder.css';

import { scoreClass, signalBadge } from '../core/signal-utils';

export default function SymbolsLadderPage() {
  const [sortBy, setSortBy] = useState('protocol');
  const [protocolFilter, setProtocolFilter] = useState('all');

  // Active protocols
  const { data: protocolsData, isLoading: pLoading } = useQuery({
    queryKey: ['sl-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });

  // Build: protocolId → { name, linkedWatchlistIds[] }
  const protocolMap = useMemo(() => {
    const protos = (protocolsData?.protocols || []).filter(p => p.active !== false);
    const map = {};
    for (const p of protos) {
      // linkedWatchlists is a single string like "default", not an array
      const raw = p.linkedWatchlists;
      const ids = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      map[p.id] = { name: p.name || p.id, linkedWatchlistIds: ids, maxScore: p.maxScore ?? 0 };
    }
    return map;
  }, [protocolsData]);

  // Collect unique watchlist IDs across all active protocols
  const uniqueWatchlistIds = useMemo(() => {
    const ids = new Set();
    for (const proto of Object.values(protocolMap)) {
      for (const id of proto.linkedWatchlistIds) {
        if (id) ids.add(id);
      }
    }
    return [...ids];
  }, [protocolMap]);

  // Fetch each watchlist by ID to get its symbols
  const watchlistQueries = useQueries({
    queries: uniqueWatchlistIds.map(id => ({
      queryKey: ['sl-watchlist', id],
      queryFn: () => apiGet(`/api/watchlists/${id}`).catch(() => ({ symbols: [] })),
      staleTime: 30_000,
    })),
  });

  // Build: watchlistId → symbols[]
  const watchlistSymbols = useMemo(() => {
    const map = {};
    for (let i = 0; i < uniqueWatchlistIds.length; i++) {
      const id = uniqueWatchlistIds[i];
      const query = watchlistQueries[i];
      const raw = query?.data?.symbols;
      let list = [];
      if (Array.isArray(raw)) {
        list = raw;
      } else if (typeof raw === 'string' && raw.trim()) {
        list = raw.split(',').map(s => s.trim());
      }
      map[id] = list.filter(Boolean);
    }
    return map;
  }, [uniqueWatchlistIds, watchlistQueries]);

  const queriesLoading = watchlistQueries.some(q => q.isLoading);

  // Latest scores — lightweight: { EURUSD: 1878, XAUUSD: 1829, ... }
  const { data: scoreMapRaw } = useQuery({
    queryKey: ['sl-scores'],
    queryFn: () => apiGet('/api/scoring/latest-scores').catch(() => ({})),
    staleTime: 10_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const scoreMap = scoreMapRaw || {};

  // Build entries: protocol → symbol, enriched with scores
  const entries = useMemo(() => {
    let result = [];
    for (const [protoId, proto] of Object.entries(protocolMap)) {
      const seen = new Set();
      for (const wlId of proto.linkedWatchlistIds) {
        const symbols = watchlistSymbols[wlId] || [];
        for (const sym of symbols) {
          if (!seen.has(sym)) {
            seen.add(sym);
            const ticker = sym.toUpperCase();
            const score = scoreMap[ticker] ?? null;
            result.push({
              symbol: ticker,
              protocolId: protoId,
              protocolName: proto.name,
              score,
            });
          }
        }
      }
    }

    if (protocolFilter !== 'all') result = result.filter(e => e.protocolId === protocolFilter);

    if (sortBy === 'score') result.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sortBy === 'alpha') result.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (sortBy === 'protocol') result.sort((a, b) => a.protocolName.localeCompare(b.protocolName));

    return result;
  }, [protocolMap, watchlistSymbols, sortBy, protocolFilter, scoreMap]);

  const protoIds = useMemo(() => {
    const set = new Set(entries.map(e => e.protocolId));
    return ['all', ...set].filter(Boolean).sort();
  }, [entries]);

  const isLoading = pLoading || queriesLoading;

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Symbols Ladder
          <PageInfoPopover>
            Every symbol from every active protocol, resolved from watchlists and single-symbol protocol definitions.
          </PageInfoPopover>
        </h1>
      </motion.header>

      <div className="pl-toolbar">
        <label className="pl-filter">
          Sort:
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="protocol">By Protocol</option>
            <option value="score">By Score</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <label className="pl-filter">
          Protocol:
          <select value={protocolFilter} onChange={e => setProtocolFilter(e.target.value)}>
            <option value="all">All</option>
            {protoIds.filter(n => n !== 'all').map(id => (
              <option key={id} value={id}>{protocolMap[id]?.name || id}</option>
            ))}
          </select>
        </label>
        <span className="pl-count">{entries.length} symbols</span>
      </div>

      {isLoading ? <LoadingSkeleton variant="card" count={8} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr><th>#</th><th>Symbol</th><th>Score</th><th>Signal</th><th>Protocol</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const max = protocolMap[e.protocolId]?.maxScore || 1;
                const pct = e.score != null && max > 0 ? Math.round((e.score / max) * 100) : null;
                return (
                <tr key={`${e.protocolId}:${e.symbol}`}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{e.symbol}</td>
                  <td>
                    <span className={scoreClass(pct)}>
                      {e.score != null ? e.score.toLocaleString() : '—'}
                    </span>
                    {e.score != null && max > 0 && (
                      <span className="pl-score-max"> / {max.toLocaleString()}</span>
                    )}
                  </td>
                  <td>{signalBadge(pct)}</td>
                  <td className="pl-muted">
                    <Link to={`/protocols/protocols-registry?proto=${encodeURIComponent(e.protocolId)}`} className="pl-proto-link">{e.protocolName}</Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
