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
import { formatDateTime } from '../core/format-utils';

/** Seconds to wait after the automation loop tick before refreshing. */
const REFRESH_AFTER_TICK_MS = 2000;

/**
 * StatusCell — inline status badge + popover for one ladder row.
 * Communicates WHY a symbol is showing a low/zero score: a closed market
 * hard-gates the composite to 0, but the protocol still produced a real
 * pre-gate signal. The popover explains the distinction.
 */
function StatusCell({ entry }) {
  const popId = `pl-status-${entry.protocolId}-${entry.symbol}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (entry.score == null) {
    return <span className="pl-muted">—</span>;
  }

  const ms = entry.marketStatus;
  const closed = ms && ms.open === false;

  if (closed) {
    return (
      <>
        <button type="button" className="pl-status pl-status-closed" popovertarget={popId} title="Why isn't this symbol being scored?">
          <span className="pl-status-dot" /> Market closed
        </button>
        <div id={popId} popover="auto" className="pl-status-popover">
          <div className="pl-status-pop-title">Market closed</div>
          <div className="pl-status-pop-body">
            <p>{ms?.reason || 'The market is closed — this symbol is not producing fresh bars right now.'}</p>
            {ms?.asOf && <p className="pl-status-pop-meta">Last real bar: {formatDateTime(ms.asOf)}</p>}
            <p className="pl-status-pop-meta">
              Shown score ({Math.round(entry.rawScore ?? entry.score)}) is the pre-gate signal
              strength, frozen at the last close — it is not a live tradable signal.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <button type="button" className="pl-status pl-status-live" popovertarget={popId} title="Scoring status">
        <span className="pl-status-dot" /> Live
      </button>
      <div id={popId} popover="auto" className="pl-status-popover">
        <div className="pl-status-pop-title">Market live</div>
        <div className="pl-status-pop-body">
          <p>The market is open and producing fresh bars. This score is computed from the latest data.</p>
        </div>
      </div>
    </>
  );
}

export default function SymbolsLadderPage() {
  const [sortBy, setSortBy] = useState('score');
  const [scoreMode, setScoreMode] = useState('signal');
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
        // Keep the LATEST run for each symbol+protocol (runs are timestamp-desc,
        // so the first match is the most recent). A closed market hard-gates
        // `value` to 0 — using the historical highest would hide the current
        // "market closed" status and surface stale red zeros.
        if (!map[key]) {
          map[key] = {
            score: s.value,
            rawScore: s.rawComposite ?? s.value,
            rawMax: s.rawMax ?? null,
            opportunityScore: s.opportunityScore ?? null,
            opportunityMax: s.opportunityMax ?? null,
            marketStatus: s.marketStatus ?? null,
            timestamp: run.timestamp,
            protocolId: protoId,
            runId: s.id,
          };
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
          score: data?.score ?? null,               // gated composite (0 when market closed)
          rawScore: data?.rawScore ?? data?.score ?? null, // pre-gate signal strength
          rawMax: data?.rawMax ?? null,             // directional denominator (Phase C)
          opportunityScore: data?.opportunityScore ?? null,
          opportunityMax: data?.opportunityMax ?? null,
          marketStatus: data?.marketStatus ?? null,
          lastScored: data?.timestamp ?? null,
          runId: data?.runId ?? null,
        });
      }
    }

    if (protocolFilter !== 'all') result = result.filter(e => e.protocolId === protocolFilter);

    if (sortBy === 'score') result.sort((a, b) => (b.rawScore ?? -1) - (a.rawScore ?? -1));
    else if (sortBy === 'opportunity') result.sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1));
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
            <option value="opportunity">By Opportunity</option>
            <option value="protocol">By Protocol</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <label className="pl-filter" title="Which score to display: Signal (directional conviction, for timing) or Opportunity (additive, for ranking/screening).">
          Score:
          <select value={scoreMode} onChange={e => setScoreMode(e.target.value)}>
            <option value="signal">Signal</option>
            <option value="opportunity">Opportunity</option>
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
              <tr><th>#</th><th>Symbol</th><th>Score</th><th>%</th><th>Signal</th><th>Status</th><th>Protocol</th><th>Time</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                // Phase C: two scores. Signal = directional conviction (timing);
                // Opportunity = additive "everything counts" (ranking). Toggle
                // via the Score: filter. Use each score's own denominator.
                const isOpp = scoreMode === 'opportunity';
                const protoMax = protocolMap[e.protocolId]?.maxScore;
                const max = isOpp
                  ? (e.opportunityMax ?? protoMax) || 1
                  : (e.rawMax ?? protoMax) || 1;
                const displayScore = isOpp
                  ? e.opportunityScore
                  : (e.rawScore ?? e.score);
                const pct = displayScore != null && max > 0 ? Math.round((displayScore / max) * 100) : null;
                const closed = e.marketStatus && e.marketStatus.open === false;
                return (
                <tr key={`${e.protocolId}:${e.symbol}`}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{e.symbol}</td>
                  <td>
                    {displayScore != null ? (
                      <Link
                        to={`/protocols/protocol-trail?symbol=${encodeURIComponent(e.symbol)}&protocol=${encodeURIComponent(e.protocolId)}${e.runId ? `&runId=${encodeURIComponent(e.runId)}` : ''}`}
                        className="pl-score-link"
                        title={`View directive breakdown for ${e.symbol}`}
                      >
                        <span className={scoreClass(pct)}>
                          {displayScore.toLocaleString()}
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
                  <td>
                    {isOpp ? (
                      <span className="pl-muted" title="Directional signal shown when the Score filter is set to 'Signal'.">—</span>
                    ) : closed ? (
                      <span
                        className="pl-badge pl-badge-paused"
                        title={e.marketStatus?.reason || 'Market closed — no live signal'}
                      >
                        PAUSED
                      </span>
                    ) : (
                      signalBadge(pct)
                    )}
                  </td>
                  <td><StatusCell entry={e} /></td>
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
