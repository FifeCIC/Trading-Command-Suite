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
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import { TopRowSlotContent } from '../core/top-row-slot';
import './protocols-ladder.css';

import { scoreClass, DIRECTION_MODE_LABELS } from '../core/signal-utils';
import { formatDateTime, timeAgo } from '../core/format-utils';
import { buildScoreDisplay } from '../core/score-display';
import SignalBadge from '../components/SignalBadge';

/** Seconds to wait after the automation loop tick before refreshing. */
const REFRESH_AFTER_TICK_MS = 2000;

/**
 * StatusCell — inline status badge + popover for one ladder row.
 * Communicates WHY a symbol is showing a low/zero score: a closed market
 * hard-gates the composite to 0, but the protocol still produced a real
 * pre-gate signal. The popover explains the distinction.
 */
function StatusCell({ display, entry }) {
  const popId = `pl-status-${entry.protocolId}-${entry.symbol}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (!display || display.state === 'unscored') {
    return <span className="pl-muted">—</span>;
  }

  const ms = display.marketStatus;
  const frozen = display.frozen;

  if (frozen) {
    return (
      <>
        <button type="button" className="pl-status pl-status-closed" popovertarget={popId} title="Why isn't this symbol being scored?">
          <span className="pl-status-dot" /> {display.state === 'stale' ? 'Stale' : 'Market closed'}
        </button>
        <div id={popId} popover="auto" className="pl-status-popover">
          <div className="pl-status-pop-title">{display.state === 'stale' ? 'Data stale' : 'Market closed'}</div>
          <div className="pl-status-pop-body">
            <p>{ms?.reason || 'The market is closed — this symbol is not producing fresh bars right now.'}</p>
            {ms?.asOf && <p className="pl-status-pop-meta">Last real bar: {formatDateTime(ms.asOf)}</p>}
            <p className="pl-status-pop-meta">
              Shown score ({Math.round(display.score ?? 0)}) is the pre-gate signal
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

/** Read the Screen Options "Score Display" preference (raw | percent | both). */
function readScoreDisplay() {
  try { return localStorage.getItem('sl-score-display') || 'both'; }
  catch { return 'both'; }
}

/**
 * ScoreCell — renders one score value (Signal or Opportunity) according to the
 * user's Screen Options preference: raw only, percent only, or both stacked.
 */
function ScoreCell({ value, max, pct, trailLink, symbol, mode }) {
  if (value == null) {
    return <td><span className="pl-muted">—</span></td>;
  }
  const cls = scoreClass(pct);
  const raw = (
    <>
      <span className={cls}>{value.toLocaleString()}</span>
      {max > 0 && <span className="pl-score-max"> / {max.toLocaleString()}</span>}
    </>
  );
  const pctNode = pct != null ? <span className={cls}>{pct}%</span> : null;
  return (
    <td>
      <Link to={trailLink} className="pl-score-link" title={`View directive breakdown for ${symbol}`}>
        {mode === 'percent' ? (
          pctNode ?? <span className="pl-muted">—</span>
        ) : mode === 'raw' ? (
          raw
        ) : (
          <span className="pl-score-stack">
            <span className="pl-score-line">{raw}</span>
            {pctNode}
          </span>
        )}
      </Link>
    </td>
  );
}

export default function SymbolsLadderPage() {
  // Deep-linkable filter state (#631, Option D) — variant B (default) reads
  // the filters from the URL and keeps them in sync so any ladder scope is
  // bookmarkable/shareable. Variant A (`?variant=A`) is the legacy ladder:
  // filters stay in local state only, URL untouched. Toggle via ABSwitcher.
  const [searchParams, setSearchParams] = useSearchParams();
  const isVariantA = searchParams.get('variant') === 'A';
  const urlInit = (key) => (isVariantA ? null : searchParams.get(key));

  const [protocolFilter, setProtocolFilter] = useState(urlInit('protocol') || 'all');
  // Filter 1/3 (#634): symbol scope — all | single symbol | watchlist
  const [symbolScope, setSymbolScope] = useState(urlInit('scope') || 'all');
  const [scopeSymbol, setScopeSymbol] = useState(urlInit('symbol') || '');
  const [scopeWatchlist, setScopeWatchlist] = useState(urlInit('watchlist') || '');
  // Filter 2/3 (#635): signal — All | BUY | HOLD | SELL
  const [signalFilter, setSignalFilter] = useState(urlInit('signal') || 'all');
  // Filter 3/3 (#636): score age in minutes — 'all' or 1..60
  const [ageFilter, setAgeFilter] = useState(urlInit('age') || 'all');
  // Filter 4/4: direction mode — all | LONG_ONLY | SHORT_ONLY | BOTH
  const [directionFilter, setDirectionFilter] = useState(urlInit('dir') || 'all');
  const [countdown, setCountdown] = useState(null);
  // Screen Options: how to render score cells (raw | percent | both)
  const [scoreDisplay, setScoreDisplay] = useState(readScoreDisplay);

  // Poll localStorage for Screen Options changes (same-tab doesn't fire 'storage')
  useEffect(() => {
    const interval = setInterval(() => {
      setScoreDisplay((prev) => {
        const current = readScoreDisplay();
        return prev !== current ? current : prev;
      });
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Deep-link sync (#631) — keep the query string in lockstep with the
  // filters (variant B only). Copying from the current params preserves
  // unrelated keys such as `variant`. Replace, not push: every keystroke in
  // a filter must not spam the history stack.
  useEffect(() => {
    if (isVariantA) return;
    const next = new URLSearchParams(searchParams);
    const sync = (key, value) => {
      if (value && value !== 'all' && value !== '') next.set(key, value);
      else next.delete(key);
    };
    sync('protocol', protocolFilter);
    sync('scope', symbolScope);
    sync('symbol', scopeSymbol);
    sync('watchlist', scopeWatchlist);
    sync('signal', signalFilter);
    sync('age', ageFilter);
    sync('dir', directionFilter);
    const qs = next.toString();
    if (qs !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [isVariantA, searchParams, setSearchParams, protocolFilter, symbolScope, scopeSymbol, scopeWatchlist, signalFilter, ageFilter, directionFilter]);

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

  // Watchlists for the symbol-scope filter (#634)
  const { data: watchlists } = useQuery({
    queryKey: ['sl-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 120_000,
  });

  // Full symbol list of the selected watchlist (only fetched when scoped)
  const { data: watchlistDetail } = useQuery({
    queryKey: ['sl-watchlist', scopeWatchlist],
    queryFn: () => apiGet(`/api/watchlists/${scopeWatchlist}`).catch(() => null),
    enabled: symbolScope === 'watchlist' && !!scopeWatchlist,
    staleTime: 60_000,
  });
  const watchlistSymbols = useMemo(() => {
    if (symbolScope !== 'watchlist' || !watchlistDetail) return null;
    return new Set((Array.isArray(watchlistDetail.symbols) ? watchlistDetail.symbols : []).map((s) =>
      typeof s === 'string' ? s.toUpperCase() : (s?.ticker || s?.symbol || '').toUpperCase()
    ).filter(Boolean));
  }, [symbolScope, watchlistDetail]);

  // Build: protocolId → { name, symbols[], maxScore }
  const protocolMap = useMemo(() => {
    const protos = (protocolsData?.protocols || []).filter(p => p.active !== false);
    const map = {};
    for (const p of protos) {
      map[p.id] = {
        name: p.name || p.id,
        symbols: p.resolvedSymbols || [],
        maxScore: p.maxScore ?? 0,
        directionMode: p.directionMode || 'BOTH',
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
            signal: s.signal ?? null,
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

  // : protocol → resolvedSymbols, enriched with scores from /api/scoring/runs
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
          signal: data?.signal ?? null,             // server-owned classification
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

    // Filter 1/3 (#634): symbol scope — single symbol / watchlist / all.
    if (symbolScope === 'symbol' && scopeSymbol) {
      result = result.filter(e => e.symbol === scopeSymbol);
    } else if (symbolScope === 'watchlist' && watchlistSymbols) {
      result = result.filter(e => watchlistSymbols.has(e.symbol));
    }

    // Filter 2/3 (#635): signal — server-owned BUY/HOLD/SELL.
    if (signalFilter !== 'all') {
      result = result.filter(e => e.signal === signalFilter);
    }

    // Filter 3/3 (#636): score age — drop rows older than the selected minutes.
    if (ageFilter !== 'all') {
      const cutoff = Date.now() - Number(ageFilter) * 60_000;
      result = result.filter(e => e.lastScored && new Date(e.lastScored).getTime() >= cutoff);
    }

    // Filter 4/4: direction — only protocols in the selected direction mode.
    if (directionFilter !== 'all') {
      result = result.filter(e => (protocolMap[e.protocolId]?.directionMode || 'BOTH') === directionFilter);
    }

    // Attach the canonical display model ONCE — ranking and rendering share it.
    result = result.map((e) => ({
      ...e,
      vm: buildScoreDisplay({
        signal: e.signal,
        value: e.score,
        rawComposite: e.rawScore,
        rawMax: e.rawMax,
        opportunityScore: e.opportunityScore,
        opportunityMax: e.opportunityMax,
        marketStatus: e.marketStatus,
      }),
    }));

    // The ladder is always score-ranked (#634 removed the Sort dropdown).
    // Rank by the NORMALISED Opportunity % (falling back to Signal %).
    // Raw composites are not comparable across protocols — each protocol has
    // its own denominator — which previously ranked GBPUSD 33% above XAUUSD 45%.
    result.sort((a, b) => {
      const ka = a.vm.opportunityPct ?? a.vm.pct ?? -1;
      const kb = b.vm.opportunityPct ?? b.vm.pct ?? -1;
      return kb - ka;
    });

    return result;
  }, [protocolMap, protocolFilter, symbolScope, scopeSymbol, watchlistSymbols, signalFilter, ageFilter, directionFilter, scoreMap]);

  const protoIds = useMemo(() => {
    const set = new Set(entries.map(e => e.protocolId));
    return ['all', ...set].filter(Boolean).sort();
  }, [entries]);

  // Unique symbols across all protocols (for the single-symbol scope dropdown).
  const allSymbols = useMemo(() => {
    const set = new Set();
    for (const proto of Object.values(protocolMap)) {
      for (const s of proto.symbols) set.add((s || '').toUpperCase());
    }
    return [...set].filter(Boolean).sort();
  }, [protocolMap]);

  const AGE_OPTIONS = ['1', '2', '3', '4', '5', '10', '15', '20', '30', '60'];

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
          Scope:
          <select value={symbolScope} onChange={e => { setSymbolScope(e.target.value); setScopeSymbol(''); setScopeWatchlist(''); }}>
            <option value="all">All symbols</option>
            <option value="symbol">Single symbol</option>
            <option value="watchlist">Watchlist</option>
          </select>
        </label>
        {symbolScope === 'symbol' && (
          <label className="pl-filter">
            Symbol:
            <select value={scopeSymbol} onChange={e => setScopeSymbol(e.target.value)}>
              <option value="">Choose…</option>
              {allSymbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {symbolScope === 'watchlist' && (
          <label className="pl-filter">
            Watchlist:
            <select value={scopeWatchlist} onChange={e => setScopeWatchlist(e.target.value)}>
              <option value="">Choose…</option>
              {(watchlists || []).map(w => (
                <option key={w.id} value={w.id}>{w.label} ({w.symbolCount})</option>
              ))}
            </select>
          </label>
        )}
        <label className="pl-filter">
          Signal:
          <select value={signalFilter} onChange={e => setSignalFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="BUY">BUY</option>
            <option value="HOLD">HOLD</option>
            <option value="SELL">SELL</option>
          </select>
        </label>
        <label className="pl-filter">
          Direction:
          <select value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(DIRECTION_MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </label>
        <label className="pl-filter">
          Score age:
          <select value={ageFilter} onChange={e => setAgeFilter(e.target.value)}>
            <option value="all">All</option>
            {AGE_OPTIONS.map(m => <option key={m} value={m}>≤ {m}m</option>)}
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
              <tr><th>#</th><th>Symbol</th><th>Signal</th><th>Opportunity</th><th>Action</th><th>Status</th><th>Protocol</th><th>Time</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                // Output layer: one view model decides signal/tone/state/pct.
                const vm = e.vm;
                // Two scores, both shown with named columns:
                // Signal = directional conviction (timing); Opportunity =
                // additive "everything counts" (ranking/screening).
                const protoMax = protocolMap[e.protocolId]?.maxScore;
                const signalMax = (vm.scoreMax ?? protoMax) || 1;
                const oppMax = (vm.opportunityMax ?? protoMax) || 1;
                const trailLink = `/protocols/protocol-trail?symbol=${encodeURIComponent(e.symbol)}&protocol=${encodeURIComponent(e.protocolId)}${e.runId ? `&runId=${encodeURIComponent(e.runId)}` : ''}`;
                return (
                <tr key={`${e.protocolId}:${e.symbol}`}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{e.symbol}</td>
                  <ScoreCell value={vm.score} max={signalMax} pct={vm.pct} trailLink={trailLink} symbol={e.symbol} mode={scoreDisplay} />
                  <ScoreCell value={vm.opportunityScore} max={oppMax} pct={vm.opportunityPct} trailLink={trailLink} symbol={e.symbol} mode={scoreDisplay} />
                  <td>
                    <SignalBadge display={vm} />
                  </td>
                  <td><StatusCell display={vm} entry={e} /></td>
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
