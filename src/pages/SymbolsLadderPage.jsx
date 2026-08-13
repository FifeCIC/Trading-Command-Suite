/**
 * Symbols Ladder — All symbols across all active protocols with scores.
 * =====================================================================
 * Uses protocol.resolvedSymbols (server-computed via ProtocolDbService.resolveSymbols())
 * for single-symbol protocols (xau-speed-v1 → XAUUSD) and watchlist-based protocols
 * (forex-session-v1 → EURUSD, GBPUSD, …).
 *
 * Scores come from GET /api/scoring/runs — the protocol-driven scoring pipeline
 * that the automation loop feeds on each tick.
 *
 * Refreshes silently using keepPreviousData to avoid content blink.
 */
import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import { TopRowSlotContent } from '../core/top-row-slot';
import './protocols-ladder.css';

import { scoreClass, signalBadge } from '../core/signal-utils';

/** Seconds to wait after the automation loop tick before refreshing. */
const REFRESH_AFTER_TICK_MS = 2000;

export default function SymbolsLadderPage() {
  const [sortBy, setSortBy] = useState('score');
  const [protocolFilter, setProtocolFilter] = useState('all');
  const [countdown, setCountdown] = useState(null);

  // Automation status — gives us nextTickAt so refresh syncs with the loop
  const { data: automation } = useQuery({
    queryKey: ['sl-automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const nextTickAt = automation?.nextTickAt;

  // Countdown to next loop tick — ticks every second
  useEffect(() => {
    if (!nextTickAt) { setCountdown(null); return; }
    const tick = () => {
      const remain = new Date(nextTickAt).getTime() - Date.now();
      setCountdown(remain > 0 ? Math.ceil(remain / 1000) : 0);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nextTickAt]);

  // Active protocols — now includes resolvedSymbols from the server
  const { data: protocolsData, isLoading: pLoading } = useQuery({
    queryKey: ['sl-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });

  // Build: protocolId → { name, symbols[], maxScore }
  const protocolMap = useMemo(() => {
    const protos = (protocolsData?.protocols || []).filter(p => p.active !== false);
    const map = {};
    for (const p of protos) {
      map[p.id] = {
        name: p.name || p.id,
        symbols: p.resolvedSymbols || [],
        maxScore: p.maxScore ?? 0,
      };
    }
    return map;
  }, [protocolsData]);

  // Latest scoring runs — refreshed in sync with the automation loop tick.
  // refetchInterval is dynamic: schedules the next refetch ~2s after nextTickAt,
  // falling back to 30s if automation status is unavailable.
  const { data: runsData } = useQuery({
    queryKey: ['sl-scores'],
    queryFn: () => apiGet('/api/scoring/runs').catch(() => ({ runs: [] })),
    staleTime: 10_000,
    refetchInterval: () => {
      if (nextTickAt) {
        const delay = new Date(nextTickAt).getTime() - Date.now() + REFRESH_AFTER_TICK_MS;
        return Math.max(5000, delay); // min 5s floor
      }
      return 30_000; // fallback if no automation status
    },
    placeholderData: keepPreviousData,
  });

  // Build a symbol→score lookup from the runs
  const scoreMap = useMemo(() => {
    const map = {};
    const runs = runsData?.runs || [];
    for (const run of runs) {
      const scores = run.scores || [];
      const protoId = run.protocolId || run.strategyId;
      for (const s of scores) {
        const ticker = (s.ticker || '').toUpperCase();
        if (!ticker) continue;
        const key = `${ticker}::${protoId}`;
        // Keep the highest score if multiple runs for same symbol+protocol
        if (!map[key] || s.value > map[key].score) {
          map[key] = { score: s.value, timestamp: run.timestamp, protocolId: protoId, runId: s.id };
        }
      }
    }
    return map;
  }, [runsData]);

  /** Relative time: "12s ago", "5m ago", "2h ago" */
  function timeAgo(iso) {
    if (!iso) return '—';
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 0) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  // Build entries: protocol → resolvedSymbols, enriched with scores from /api/scoring/runs
  const entries = useMemo(() => {
    let result = [];
    for (const [protoId, proto] of Object.entries(protocolMap)) {
      for (const sym of proto.symbols) {
        const ticker = sym.toUpperCase();
        const key = `${ticker}::${protoId}`;
        const data = scoreMap[key];
        result.push({
          symbol: ticker,
          protocolId: protoId,
          protocolName: proto.name,
          score: data?.score ?? null,
          lastScored: data?.timestamp ?? null,
          runId: data?.runId ?? null,
        });
      }
    }

    if (protocolFilter !== 'all') result = result.filter(e => e.protocolId === protocolFilter);

    if (sortBy === 'score') result.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sortBy === 'alpha') result.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (sortBy === 'protocol') result.sort((a, b) => a.protocolName.localeCompare(b.protocolName));

    return result;
  }, [protocolMap, sortBy, protocolFilter, scoreMap]);

  const protoIds = useMemo(() => {
    const set = new Set(entries.map(e => e.protocolId));
    return ['all', ...set].filter(Boolean).sort();
  }, [entries]);

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Symbols Ladder
          <PageInfoPopover>
            Every symbol resolved from each active protocol — single-symbol protocols (e.g. XAUUSD) and watchlist-based protocols (e.g. Forex Majors). Scores come from the live protocol-driven pipeline.
          </PageInfoPopover>
        </h1>
      </motion.header>

      <div className="pl-toolbar">
        <label className="pl-filter">
          Sort:
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="score">By Score</option>
            <option value="protocol">By Protocol</option>
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

      {countdown != null && (
        <TopRowSlotContent>
          <span className="pl-refresh" title="Time until the next automation loop tick and ladder refresh">
            ⟳ {countdown > 0 ? `${countdown}s` : 'refreshing…'}
          </span>
        </TopRowSlotContent>
      )}

      {pLoading ? <LoadingSkeleton variant="card" count={8} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr><th>#</th><th>Symbol</th><th>Score</th><th>%</th><th>Signal</th><th>Protocol</th><th>Time</th></tr>
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
                    {e.score != null ? (
                      <Link
                        to={`/protocols/protocol-trail?symbol=${encodeURIComponent(e.symbol)}&protocol=${encodeURIComponent(e.protocolId)}${e.runId ? `&runId=${encodeURIComponent(e.runId)}` : ''}`}
                        className="pl-score-link"
                        title={`View directive breakdown for ${e.symbol}`}
                      >
                        <span className={scoreClass(pct)}>
                          {e.score.toLocaleString()}
                        </span>
                        {max > 0 && (
                          <span className="pl-score-max"> / {max.toLocaleString()}</span>
                        )}
                      </Link>
                    ) : (
                      <span className="pl-muted">—</span>
                    )}
                  </td>
                  <td>
                    {pct != null ? (
                      <span className={scoreClass(pct)}>{pct}%</span>
                    ) : (
                      <span className="pl-muted">—</span>
                    )}
                  </td>
                  <td>{signalBadge(pct)}</td>
                  <td className="pl-muted">
                    <Link to={`/protocols/protocols-registry?proto=${encodeURIComponent(e.protocolId)}`} className="pl-proto-link">{e.protocolName}</Link>
                  </td>
                  <td className="pl-muted pl-time">{timeAgo(e.lastScored)}</td>
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
