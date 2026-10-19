/**
 * ProtocolBacktestPage — PROTOCOL backtesting: scores only, no trades (#823).
 * =============================================================================
 *
 * Pipeline position:
 *   protocol + symbol + window  →  POST /api/replay/run  →  a TIMELINE of scores
 *   the same steps the live loop would produce, one row per bar, in order.
 *
 * ⚠️ WHY A SECOND VIEW, AND WHAT IT IS NOT.
 * The owner's direction, 2026-10-16: *"we should have 'Protocol Backtesting' (generates scores) and
 * 'Strategy Backtesting' (generates trades): two different views."* A protocol's job is to decide
 * whether an opportunity exists. A bot's job is what to do about it — money, gates, limits. The
 * existing `/lab/backtest` answers the SECOND question (it stores TRADES and SIGNALS) but never
 * exposed the range of scores behind those signals. Squashing both into one page was the owner's
 * own conclusion: *"It would be alot to squash into one page so lets go with my two separate ones."*
 *
 * ⚠️ NO NEW SCORING PATH. This page calls the SAME endpoint the Snapshot Replay uses, which calls
 * `ProtocolGatingService.scoreWithGating` — the canonical engine
 * (`validate-single-scoring-path.cjs` fails a second one in prebuild). Nothing here re-derives
 * BUY/HOLD/SELL from a percentage; the signal is the ENGINE's, and the badge is the app's one
 * signal renderer (`SignalBadge` via `buildScoreDisplay`).
 *
 * ⚠️ SYMBOL IS NOT TYPED BY HAND. The owner: *"manual entry of symbol … is wrong and we should
 * only be able to select a symbol from the watchlist that the protocol consumes."* The choices come
 * from the protocol's own `resolvedSymbols`, so a symbol the protocol does not score is not
 * offerable at all.
 *
 * ⚠️ WHAT THIS IS NOT: it is not a RECORD of what happened. `/api/replay/run` RE-SCORES the window
 * from bars; it does not read stored snapshots. Measured 2026-08-15 — `replay.service.ts` has zero
 * references to `scoreSnapshot`/`directiveOutcome`. So the table is a COUNTERFACTUAL: "the engine,
 * run over this window today". Say so on the page, because the numbers look identical either way.
 *
 * @uses POST /api/replay/run                      (the canonical scorer)
 * @uses GET  /api/scoring/gated/protocols          (protocols + their resolvedSymbols)
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import ProtocolCarousel from '../components/ProtocolCarousel';
import SignalBadge from '../components/SignalBadge';
import { buildScoreDisplay } from '../core/score-display';
// ⚠️ The canonical Form System (`src/core/forms.css`, `.ff-*`). It is NOT global — each page that
// has a form imports it. Using it is what keeps the fields readable under the active theme; see the
// note on the fields block below for the measured failure of the hand-rolled version.
import '../core/forms.css';
import './protocol-backtest.css';

/** Timeframes the store actually holds (measured: 1m, 5m, 15m, 1h, 4h, 1d). */
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

/**
 * Bars the engine needs before it will score a single window.
 *
 * ⚠️ ONE constant, sent to BOTH endpoints: `/api/replay/run` as `windowSize`, and
 * `/api/backtest/timeframe-coverage` as `minBars`. If those two disagreed, the menu would mark a
 * timeframe usable and the run would then refuse it — the exact "offered then refused" defect the
 * coverage endpoint exists to remove.
 */
const WINDOW_SIZE = 30;

/**
 * The window to default to for each timeframe.
 *
 * ⚠️ PER-TIMEFRAME BECAUSE THE BUDGET IS BARS × DIRECTIVES. Measured 2026-10-17: a flat 14 days is
 * comfortable at 1h (~212 bars) and hopeless at 15m (1,163 bars), which made the FIRST click fail
 * for the first protocol alphabetically. These are starting points the user can change, not limits.
 */
const DEFAULT_DAYS = { '15m': 2, '1h': 10, '4h': 20, '1d': 60 };

/**
 * The engine's REAL limits, from `replay.service.ts`.
 *
 *   REPLAY_OP_FAST_REFUSE = 1,700 operations — refused IMMEDIATELY, before any work is done.
 *   REPLAY_DEADLINE_MS    = 20s              — checked inside the loop; refused however far it got.
 *
 * ⚠️ WHY THIS PAGE PREDICTS NOTHING FROM THEM. An earlier version multiplied a bars-per-day table by
 * the directive count and announced a verdict. Measured 2026-10-17: it declared a run "over the
 * 1,700-operation ceiling — refused immediately" for a window that then completed in 4s with 11
 * rows. The table was wrong — BTC 15m yields ~83 bars/day across 14 days but only ~20/day across the
 * last 2 — and no endpoint exposes a per-(symbol, timeframe) bar count, so no figure computed here
 * can be trusted. A warning that cries wolf is worse than none: it teaches the reader to ignore it.
 *
 * So the page STATES the limits and the measured spread, and lets the engine answer — in ~0.09s when
 * it refuses outright, or with the exact count it reached when it hits the deadline.
 */
const ENGINE_MAX_OPS = 1700;
const ENGINE_DEADLINE_S = 20;
const MS_PER_BAR_MIN = 11.5;
const MS_PER_BAR_MAX = 59.7;

const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

/**
 * `days` before an ISO day, in UTC.
 *
 * ⚠️ Exists because the default window must be anchored to the DATA, not to today. Measured
 * 2026-10-17: VIX bars stop at 2026-10-13, so a today-anchored 2-day window held **zero** bars and
 * the timeframe menu showed "0 bars — needs 30" for every option — which reads as "the store is
 * empty" when the store in fact holds 3,000+ bars ending four days earlier.
 */
function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}

/** A protocol advertises `recommendedTimeframe`; use it only if we can offer it. */
function pickTimeframe(recommended) {
  if (!recommended) return '1h';
  const norm = String(recommended).toLowerCase().replace(/\s/g, '');
  return TIMEFRAMES.find((tf) => norm.includes(tf)) ?? '1h';
}

const isSignal = (signal) =>
  signal === 'BUY' || signal === 'STRONG_BUY' || signal === 'SELL' || signal === 'STRONG_SELL';

// Sort signals from strongest bearish to strongest bullish; NO_DATA stays at the end.
const SIGNAL_SORT_ORDER = {
  STRONG_SELL: 0,
  SELL: 1,
  HOLD: 2,
  BUY: 3,
  STRONG_BUY: 4,
};

const sortNumber = (value) => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const RESULT_SORT_FIELDS = {
  signal: {
    label: 'Signal',
    get: (step) => (step.signal == null || step.signal === 'NO_DATA'
      ? null
      : SIGNAL_SORT_ORDER[step.signal] ?? null),
    firstDir: 'asc',
  },
  score: { label: 'Score', get: (step) => sortNumber(step.signalRaw), firstDir: 'desc' },
  percent: {
    label: '%',
    ariaLabel: 'percentage',
    get: (step) => sortNumber(step.normalizedScore),
    firstDir: 'desc',
  },
  opportunity: {
    label: 'Opportunity',
    get: (step) => sortNumber(step.opportunityPct),
    firstDir: 'desc',
  },
  correct: {
    label: 'Correct',
    get: (step) => (step.signalCorrect === undefined ? null : Number(Boolean(step.signalCorrect))),
    firstDir: 'desc',
  },
};

const EMPTY_STEPS = Object.freeze([]);

const fmtTime = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ');
};

const n1 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

export default function ProtocolBacktestPage() {
  const [protocolId, setProtocolId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');
  const [fromDate, setFromDate] = useState(() => daysAgo(DEFAULT_DAYS['1h']));
  const [toDate, setToDate] = useState(() => isoDay(new Date()));
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  const protocolsQuery = useQuery({
    queryKey: ['pb-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protocols = protocolsQuery.data?.protocols ?? [];

  // ── Search / filters ────────────────────────────────────────────────────────────────────────
  // ⚠️ These narrow the CAROUSEL, not the API call. All 47 protocols are already in memory, so
  // filtering client-side keeps the scroll position and avoids a round trip per keystroke.
  const [query, setQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [runnableOnly, setRunnableOnly] = useState(false);

  const directionOptions = useMemo(
    () => [...new Set(protocols.map((p) => p.directionMode).filter(Boolean))].sort(),
    [protocols],
  );
  const styleOptions = useMemo(
    () => [...new Set(protocols.map((p) => p.tradingStyle).filter(Boolean))].sort(),
    [protocols],
  );

  const filteredProtocols = useMemo(() => {
    const q = query.trim().toLowerCase();
    return protocols.filter((p) => {
      if (directionFilter && p.directionMode !== directionFilter) return false;
      if (styleFilter && p.tradingStyle !== styleFilter) return false;
      // "Runnable" = resolves at least one symbol. Four protocols resolve none and can never
      // score anything; they are worth hiding but not worth hiding BY DEFAULT.
      if (runnableOnly && !(p.resolvedSymbols?.length > 0)) return false;
      if (!q) return true;
      const haystack = [
        p.name,
        p.id,
        p.description,
        p.tradingStyle,
        p.directionMode,
        ...(p.resolvedSymbols ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [protocols, query, directionFilter, styleFilter, runnableOnly]);

  /**
   * Keep the selection inside the filtered list.
   *
   * ⚠️ Without this a filter could leave `protocolId` pointing at a protocol the carousel no longer
   * shows — the panel would display one protocol while the run used another. Silent, and exactly
   * the class of defect this page keeps finding.
   */
  useEffect(() => {
    if (filteredProtocols.length === 0) return;
    if (filteredProtocols.some((p) => p.id === protocolId)) return;
    setProtocolId(filteredProtocols[0].id);
  }, [filteredProtocols, protocolId]);

  /**
   * Which timeframes this symbol can ACTUALLY be scored at, in this window.
   *
   * ⚠️ `/api/backtest/data-inventory` cannot answer this. It lists the timeframes a symbol has EVER
   * held — VIX lists `1h` there and still cannot be scored at `1h` over three days (measured
   * 2026-10-17: 10 bars, needs 30). So the menu used to offer a choice and let the RUN refuse it.
   *
   * `catch(() => null)` is deliberate: if the endpoint is unavailable the menu falls back to
   * offering every timeframe, exactly as before. Losing the annotation must not lose the page.
   */
  const coverageQuery = useQuery({
    queryKey: ['pb-coverage', symbol, fromDate, toDate],
    queryFn: () =>
      apiGet(
        `/api/backtest/timeframe-coverage?symbol=${encodeURIComponent(symbol)}` +
          `&from=${fromDate}&to=${toDate}&minBars=${WINDOW_SIZE}`,
      ).catch(() => null),
    enabled: Boolean(symbol),
    staleTime: 30_000,
  });
  const coverage = coverageQuery.data ?? null;

  /**
   * The store's range for this symbol, INDEPENDENT of the chosen window.
   *
   * ⚠️ Needed because the window defaults are derived from it. Asking only for the window is
   * circular: you cannot know which dates to default to without first knowing which dates exist.
   * With no `from`/`to` the endpoint reports the full series per timeframe.
   */
  const heldQuery = useQuery({
    queryKey: ['pb-held', symbol],
    queryFn: () =>
      apiGet(`/api/backtest/timeframe-coverage?symbol=${encodeURIComponent(symbol)}`).catch(() => null),
    enabled: Boolean(symbol),
    staleTime: 5 * 60_000,
  });
  const heldRow = useMemo(
    () => (heldQuery.data?.timeframes ?? []).find((t) => t.timeframe === timeframe) ?? null,
    [heldQuery.data, timeframe],
  );
  const tfBars = useMemo(() => {
    const map = new Map();
    for (const row of coverage?.timeframes ?? []) map.set(row.timeframe, row.bars);
    return map;
  }, [coverage]);

  /** The selected timeframe's coverage row: bars IN the window, and what the store holds at all. */
  const tfRow = useMemo(
    () => (coverage?.timeframes ?? []).find((t) => t.timeframe === timeframe) ?? null,
    [coverage, timeframe],
  );

  /**
   * True when this window cannot be scored from stored bars alone — the engine will call the MT5
   * bridge for bars before it scores. Stated BEFORE the click, because a run that silently spends
   * seconds fetching looks identical to one that hung.
   */
  const willFetchBars = Boolean(tfRow) && tfRow.bars < WINDOW_SIZE;

  const heldRange = useMemo(() => {
    if (!tfRow?.heldFrom) return null;
    return { from: tfRow.heldFrom, to: tfRow.heldTo };
  }, [tfRow]);

  const protocol = useMemo(
    () => protocols.find((p) => p.id === protocolId) ?? null,
    [protocols, protocolId],
  );
  const symbols = protocol?.resolvedSymbols ?? [];

  // Choosing a protocol sets the symbol (its first) and its own recommended timeframe. The symbol
  // list belongs to the protocol, so changing protocol MUST re-resolve the symbol rather than keep
  // a pairing the protocol does not cover.
  useEffect(() => {
    if (!protocol) return;
    setSymbol((prev) => (symbols.includes(prev) ? prev : (symbols[0] ?? '')));
    setTimeframe(pickTimeframe(protocol.recommendedTimeframe));
  }, [protocol, symbols]);

  // Changing the TIMEFRAME re-scopes the window, because the budget is bars × directives: 10 days
  // is comfortable at 1h and hopeless at 15m. ⚠️ This resets a hand-edited date range when the
  // timeframe changes — deliberate, since the new timeframe invalidates the old window's cost.
  //
  // ⚠️ ANCHORED TO THE END OF THE STORED DATA, NOT TO TODAY. A today-anchored window silently
  // contains nothing whenever the symbol's bars stop earlier — VIX stops at 2026-10-13, so every
  // timeframe read "0 bars — needs 30" while the store held thousands four days back.
  useEffect(() => {
    const span = DEFAULT_DAYS[timeframe] ?? 10;
    const anchor = heldRow?.heldTo ?? null;
    setToDate(anchor ?? isoDay(new Date()));
    setFromDate(anchor ? shiftDays(anchor, span) : daysAgo(span));
  }, [timeframe, heldRow?.heldTo]);

  /** Move the window onto the most recent data the store holds for this timeframe. */
  const useLatestData = () => {
    const anchor = heldRow?.heldTo;
    if (!anchor) return;
    const span = DEFAULT_DAYS[timeframe] ?? 10;
    setToDate(anchor);
    setFromDate(shiftDays(anchor, span));
  };

  /**
   * Move off a timeframe the window cannot support.
   *
   * Only fires once coverage is KNOWN, and prefers the protocol's recommended timeframe when that
   * one is usable. Without this the menu could leave a disabled option selected and the run button
   * would fail with a message about bars the user was never shown.
   */
  useEffect(() => {
    if (!coverage?.symbolKnown) return;
    const bars = tfBars.get(timeframe);
    if (bars !== undefined && bars >= WINDOW_SIZE) return;

    const usable = TIMEFRAMES.filter((tf) => {
      const b = tfBars.get(tf);
      return b !== undefined && b >= WINDOW_SIZE;
    });
    if (usable.length === 0) return;

    const recommended = pickTimeframe(protocol?.recommendedTimeframe);
    const next = usable.includes(recommended) ? recommended : usable[0];
    if (next !== timeframe) setTimeframe(next);
  }, [coverage, tfBars, timeframe, protocol]);

  // ── The window in context. This computes NO prediction — see the note on ENGINE_MAX_OPS: an
  //    estimate here was measured crying wolf, and a warning nobody can trust teaches the reader
  //    to ignore warnings. The limits are stated; the engine decides. ──
  const windowDays = Math.max(
    1,
    Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000),
  );

  const replayMutation = useMutation({
    mutationFn: (config) => apiPost('/api/replay/run', config),
    onSuccess: () => setSelectedIdx(null),
  });

  // A replay is CPU-bound (~11-60ms per bar, measured) so a slow load must not read as a hang.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!replayMutation.isPending) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 400);
    return () => clearInterval(id);
  }, [replayMutation.isPending]);

  const result = replayMutation.data;
  const steps = result?.steps ?? EMPTY_STEPS;
  const selected = selectedIdx != null ? steps[selectedIdx] : null;
  // Keep each original bar index attached so sorting cannot break row selection or its detail view.
  const sortedSteps = useMemo(() => {
    const indexedSteps = steps.map((step, index) => ({ step, index }));
    if (!sort.key) return indexedSteps;

    const { get } = RESULT_SORT_FIELDS[sort.key];
    const direction = sort.dir === 'asc' ? 1 : -1;
    return indexedSteps.sort((a, b) => {
      const left = get(a.step);
      const right = get(b.step);
      if (left == null || right == null) {
        if (left == null && right == null) return a.index - b.index;
        return left == null ? 1 : -1;
      }
      const difference = (left - right) * direction;
      return difference || a.index - b.index;
    });
  }, [steps, sort]);

  const toggleSort = (key) => {
    setSort((current) => (
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: RESULT_SORT_FIELDS[key].firstDir }
    ));
  };

  const sortableHeader = (key, title) => {
    const field = RESULT_SORT_FIELDS[key];
    const active = sort.key === key;
    const nextDirection = active
      ? sort.dir === 'asc' ? 'desc' : 'asc'
      : field.firstDir;

    return (
      <th
        scope="col"
        title={title}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          className="pb-sort"
          onClick={() => toggleSort(key)}
          aria-label={`Sort ${field.ariaLabel ?? field.label} ${nextDirection}`}
        >
          {field.label}
          <span className="pb-sort-indicator" aria-hidden="true">
            {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  const run = () => {
    if (!protocolId || !symbol) return;
    replayMutation.mutate({
      symbol,
      timeframe,
      from: fromDate,
      to: toDate,
      windowSize: WINDOW_SIZE,
      protocolIds: [protocolId],
    });
  };

  if (protocolsQuery.isLoading) return <LoadingSkeleton variant="card" count={3} />;

  // ⚠️ `filteredProtocols.length > 0` is part of the guard, not decoration. With every protocol
  // filtered out the carousel renders its empty message but `protocolId` still holds the last
  // selection — so without this the button would run a protocol that is not on screen.
  const canRun =
    Boolean(protocolId && symbol) &&
    filteredProtocols.length > 0 &&
    !replayMutation.isPending;

  return (
    <div className="pb-page">
      <header className="pb-header">
        <h1>
          Protocol Backtesting
          <PageInfoPopover>
            <strong>Scores only — no bot, no trades, no money.</strong> Runs one protocol over a
            historical window and lists every score it produced, in order: the timeline behind the
            signals.
            <br />
            <br />
            For trade execution and position management there is a separate{' '}
            <strong>Strategy Backtesting</strong> view (planned). A protocol decides{' '}
            <em>whether an opportunity exists</em>; a bot decides <em>what to do about it</em>.
          </PageInfoPopover>
        </h1>
      </header>

      {/* Search + filters. Sits ABOVE the panel so the thing being narrowed is visible before the
          list, and stays put while the carousel scrolls. */}
      <div className="pb-toolbar">
        <input
          className="ff-input pb-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search protocols, symbols…"
          aria-label="Search protocols by name, id, description or symbol"
        />

        <select
          className="ff-select"
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value)}
          aria-label="Filter by direction mode"
        >
          <option value="">Any direction</option>
          {directionOptions.map((d) => (
            <option key={d} value={d}>{String(d).replace('_ONLY', ' only')}</option>
          ))}
        </select>

        <select
          className="ff-select"
          value={styleFilter}
          onChange={(e) => setStyleFilter(e.target.value)}
          aria-label="Filter by trading style"
        >
          <option value="">Any style</option>
          {styleOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="pb-check">
          <input
            type="checkbox"
            checked={runnableOnly}
            onChange={(e) => setRunnableOnly(e.target.checked)}
          />
          Has symbols
        </label>

        <span className="pb-count" aria-live="polite">
          {filteredProtocols.length} of {protocols.length}
        </span>

        {(query || directionFilter || styleFilter || runnableOnly) && (
          <button
            type="button"
            className="ff-btn pb-clear"
            onClick={() => {
              setQuery('');
              setDirectionFilter('');
              setStyleFilter('');
              setRunnableOnly(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      <section className="pb-panel">
        {/* ⚠️ LAYOUT ONLY — the control styling is the canonical Form System, not this page's.
            Measured 2026-10-17 (owner report: "the fields are dark and text cannot be read"): this
            block was hand-styled with `background: var(--color-input-bg)` — a fixed `#111318`, an
            INPUT surface that ignores the theme — and never styled `.ff-select option`, so the
            dropdown list was dark-on-dark. `.ff-input`/`.ff-select` use `var(--panel)` and style
            their `option` children; that is the entire point of one shared form standard. */}

        {/* Protocol is a SNAP PANEL, not a <select> (#1128, owner direction 2026-10-17: a fixed
            panel showing one protocol that the wheel scrolls through, sliding and locking into
            place). Symbol and timeframe sit UNDER it and refresh on each change. */}
        <ProtocolCarousel
          items={filteredProtocols}
          value={protocolId}
          onChange={setProtocolId}
          label="Protocol"
          emptyMessage={
            protocols.length === 0
              ? 'No protocols are available to backtest.'
              : 'No protocol matches those filters.'
          }
        />

        <div className="pb-fields">
          {/* ⚠️ NO FREE-TEXT SYMBOL. The choices are the protocol's OWN resolved symbols, so an
              instrument the protocol does not score cannot be offered. */}
          <div className="ff-field">
            <label className="ff-label" htmlFor="pb-symbol">Symbol</label>
            <select
              id="pb-symbol"
              className="ff-select"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={!protocolId || symbols.length === 0}
            >
              {symbols.length === 0 && (
                <option value="">
                  {protocolId ? 'this protocol resolves no symbols' : 'choose a protocol first'}
                </option>
              )}
              {symbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="ff-field">
            <label className="ff-label" htmlFor="pb-timeframe">Timeframe</label>
            {/* ⚠️ Each option states what the STORE holds for this symbol in this window, so a
                choice that cannot be scored is visibly not a choice. Before this, every timeframe
                looked available and the run returned "found 10 bars, needs 30+" AFTER the click. */}
            <select
              id="pb-timeframe"
              className="ff-select"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
            >
              {TIMEFRAMES.map((tf) => {
                const bars = tfBars.get(tf);
                const known = bars !== undefined;
                const usable = !known || bars >= WINDOW_SIZE;
                return (
                  <option key={tf} value={tf} disabled={!usable}>
                    {tf}
                    {known
                      ? usable
                        ? ` · ${bars} bars`
                        : ` · ${bars} bars — needs ${WINDOW_SIZE}`
                      : coverage?.symbolKnown
                        ? ' · no bars'
                        : ''}
                  </option>
                );
              })}
            </select>
            {coverage?.symbolKnown && tfBars.size === 0 && (
              <span className="pb-field-note">
                No bars for {symbol} in this window at any timeframe.
              </span>
            )}
          </div>

          <div className="ff-field">
            <label className="ff-label" htmlFor="pb-from">From</label>
            {/* ⚠️ Bounded by what the store actually holds for this symbol/timeframe. A date the
                series does not cover cannot be produced by the engine, so offering it would be the
                same "offered then refused" defect the timeframe menu just lost. `min` is omitted
                until coverage is known, so a failed coverage read never blocks a run. */}
            <input
              id="pb-from"
              className="ff-input"
              type="date"
              value={fromDate}
              min={heldRange?.from ?? undefined}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="ff-field">
            <label className="ff-label" htmlFor="pb-to">To</label>
            <input
              id="pb-to"
              className="ff-input"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="ff-btn ff-btn-primary"
            onClick={run}
            disabled={!canRun}
          >
            {replayMutation.isPending
              ? willFetchBars
                ? `Fetching bars, then scoring… ${elapsed}s`
                : `Scoring… ${elapsed}s`
              : !protocolId
                ? 'Select a protocol'
                : !symbol
                  ? 'No symbol'
                  : willFetchBars
                    ? 'Fetch bars + score this window'
                    : 'Score this window'}
          </button>
        </div>

        {/* ── THE RUN, AS FACTS ────────────────────────────────────────────────────────────────
            ⚠️ WHY THREE SENTENCES BECAME ONE STRIP (owner report, 2026-10-18: "the page is busy
            with sentences … the first sentence is essentially confirmation of the menu inputs").
            Each of the three named a number the reader could already see:
              · "this window holds 1,056 bars" sat beside a timeframe menu already reading
                "1h · 1,056 bars";
              · the protocol line RESTATED THE SELECTED CAROUSEL CARD — `ProtocolCarousel` renders
                name, directive count, `ceiling {maxScore}`, recommended timeframe and style for
                the chosen protocol, immediately above this panel;
              · the engine line repeated the window length and the directive count a third time.
            Repeating a fact is not reassurance: it reads as volume and it buries the numbers that
            are NOT on screen. Those are the ones in this strip. Nothing was deleted — the full
            wording, including why the engine may refuse a run, is behind the ℹ overlay. */}
        {protocol && (
          <div className="pb-facts">
            <div className="pb-strip">
              {symbol && (
                <div className="pb-strip-item">
                  <span>Window</span>
                  <strong>{windowDays} d · {timeframe}</strong>
                </div>
              )}
              {symbol && tfRow && (
                <div className={`pb-strip-item${willFetchBars ? ' pb-strip-item--warn' : ''}`}>
                  <span>Bars in window</span>
                  <strong>{tfRow.bars.toLocaleString()}</strong>
                </div>
              )}
              {symbol && willFetchBars && (
                <div className="pb-strip-item pb-strip-item--warn">
                  <span>Needs</span>
                  <strong>{WINDOW_SIZE}</strong>
                </div>
              )}
              {symbol && tfRow && (
                <div className="pb-strip-item">
                  <span>Stored</span>
                  <strong>{tfRow.heldBars.toLocaleString()}</strong>
                </div>
              )}
              {symbol && tfRow?.heldFrom && (
                <div className="pb-strip-item pb-strip-item--text">
                  <span>Data range</span>
                  <strong>{tfRow.heldFrom} → {tfRow.heldTo}</strong>
                </div>
              )}
              <div className="pb-strip-item pb-strip-item--text pb-strip-item--muted">
                <span>Engine cap</span>
                <strong>{ENGINE_MAX_OPS.toLocaleString()} ops · {ENGINE_DEADLINE_S} s</strong>
              </div>
            </div>

            <PageInfoPopover label="Run facts and engine limits">
              {symbol && tfRow && (
                <>
                  <strong>What the store holds</strong>
                  <br />
                  <strong>{symbol} {timeframe}</strong> · this window holds{' '}
                  <strong>{tfRow.bars.toLocaleString()}</strong> bar{tfRow.bars === 1 ? '' : 's'}
                  {willFetchBars ? ` (needs ${WINDOW_SIZE})` : ''} · stored overall{' '}
                  <strong>{tfRow.heldBars.toLocaleString()}</strong>
                  {tfRow.heldFrom ? ` — ${tfRow.heldFrom} → ${tfRow.heldTo}` : ''}.{' '}
                  {willFetchBars && (
                    <>
                      The engine walks STORED bars, and this window is shorter than the{' '}
                      {WINDOW_SIZE} it needs, so it will ask the MT5 bridge on this run. The bridge
                      returns its <em>latest</em> 200 bars, so a recent window can be filled this
                      way and an older one cannot — if it comes back empty you will be told, not
                      given zeroes.
                    </>
                  )}
                  <br />
                  <br />
                </>
              )}
              <strong>The selected protocol</strong>
              <br />
              {protocol.name || protocol.id} · {protocol.directiveCount} directives · configured
              capacity <strong>{protocol.maxScore}</strong> · recommended timeframe{' '}
              {protocol.recommendedTimeframe || '—'}
              {protocol.tradingStyle ? ` · style ${protocol.tradingStyle}` : ''}
              <br />
              <br />
              <strong>The engine&rsquo;s limits</strong>
              <br />
              Window: {windowDays} day(s) at {timeframe} · protocol has {protocol.directiveCount}{' '}
              directives. The engine refuses a replay it cannot finish: over{' '}
              {ENGINE_MAX_OPS.toLocaleString()} scoring operations (bars × protocols) it refuses
              instantly, and it stops any run at {ENGINE_DEADLINE_S}s. Cost per bar varies 5.2×
              between protocols ({MS_PER_BAR_MIN}–{MS_PER_BAR_MAX} ms measured), so nothing here
              predicts which side you land on — if it is refused, the reason appears above with the
              count it reached.
            </PageInfoPopover>
          </div>
        )}

        {/* The window is OUTSIDE the stored series. Without this the menu just reads "0 bars"
            for every timeframe, which is indistinguishable from "this symbol has no data". */}
        {coverage?.symbolKnown && tfRow && tfRow.bars === 0 && tfRow.heldBars > 0 && (
          <p className="ff-hint pb-coverage pb-coverage--warn">
            ⚠ No <strong>{timeframe}</strong> bars between {fromDate} and {toDate}. This symbol&apos;s{' '}
            {timeframe} data runs <strong>{tfRow.heldFrom}</strong> → <strong>{tfRow.heldTo}</strong>{' '}
            ({tfRow.heldBars.toLocaleString()} bars).{' '}
            <button type="button" className="ff-btn pb-clear" onClick={useLatestData}>
              Use latest data
            </button>
          </p>
        )}

        {/* The selected protocol's own facts (directives, ceiling, timeframe, style) are rendered
            by the carousel card above — repeating them here was the duplication this page lost on
            2026-10-18. Only the BLOCKING case gets a line, because a protocol that resolves no
            symbols can never score anything. */}
        {protocol && symbols.length === 0 && (
          <p className="ff-hint pb-coverage pb-coverage--warn">
            ⚠️ This protocol resolves <strong>no symbols</strong>, so there is nothing it can score.
          </p>
        )}

        {/* The engine's limits are stated in the ℹ overlay above, with the rest of the prose those
            limits explain — see the note on ENGINE_MAX_OPS for the measured case where a predicted
            verdict contradicted the run it described. */}


        {/* The engine refuses a window it cannot finish inside its budget, with the count and the
            fix. That refusal is a RESULT, not a failure — render it verbatim. */}
        {replayMutation.isError && (
          <NoticeBlock notice={noticeFromError(replayMutation.error)} />
        )}
      </section>

      {result && steps.length > 0 && (
        <section className="pb-results">
          <div className="pb-strip">
            <div className="pb-strip-item"><span>Bars</span><strong>{result.totalBars}</strong></div>
            <div className="pb-strip-item"><span>Steps</span><strong>{steps.length}</strong></div>
            <div className="pb-strip-item pb-strip-item--signal"><span>Became a signal</span><strong>{result.summary.buySignals + result.summary.sellSignals}</strong></div>
            <div className="pb-strip-item"><span>HOLD</span><strong>{result.summary.holdSignals}</strong></div>
            <div className="pb-strip-item"><span>No data</span><strong>{result.summary.noDataSignals}</strong></div>
            <div className="pb-strip-item pb-strip-item--muted"><span>Entry bar to signal</span><strong>{result.thresholds?.entry}%</strong></div>
            <div className="pb-strip-item pb-strip-item--muted"><span>Strong at</span><strong>{result.thresholds?.strong}%</strong></div>
          </div>

          {/* ⚠️ THE HONESTY STATEMENT — VISIBLE AS A MARKER, FULL WORDING ON REQUEST.
              Owner, 2026-10-18: "the screen is just too busy with sentences… a smaller alert".
              ⚠️ The CLAIM may not be hidden — a reader who never opens the overlay must still learn
              that these numbers are a COUNTERFACTUAL, which is why "Counterfactual, not a record"
              stays on screen and only the four clauses that justify it moved inside.
              Uses the canonical `.app-notice--warning` (ui-standards pattern 7) rather than the
              page's own left-stripe box — the owner disfavours stripe-bordered callouts. */}
          <div className="app-notice app-notice--warning pb-counterfactual">
            <span className="app-notice-icon" aria-hidden="true">⚠️</span>
            <div className="app-notice-body">
              <strong>Counterfactual, not a record</strong>
              <PageInfoPopover label="Why these numbers are a counterfactual">
                This RE-SCORES {symbol} {timeframe} over stored bars using the engine as it is today
                — it does not read the scores the app stored at the time. Bars before this
                protocol&rsquo;s data begins are absent, so a short window is shorter than its dates
                suggest. Scores are measured against the protocol&rsquo;s <strong>configured</strong>{' '}
                capacity ({result.thresholds?.scale}).
              </PageInfoPopover>
            </div>
          </div>

          {/* Column explanations are per-header `title` tooltips — the pattern already used by
              Capability Map, Screener, Backtest Data and Scoring Overview. A single block-level
              popover was tried first and replaced on the owner's direction (2026-10-17): the
              explanation belongs on the column you are looking at, not in a paragraph away from it. */}
          <div className="pb-table-wrap">
            <table className="bt-table">
              <caption className="sr-only">
                Every score this protocol produced, initially in time order, with the signal the
                engine derived from it. Sortable by signal, score, percentage, opportunity, and
                correctness.
              </caption>
              <thead>
                <tr>
                  <th scope="col" title="The bar's close timestamp, in UTC. One row per bar the engine scored.">Time (UTC)</th>
                  {sortableHeader('signal', 'What the engine concluded on this bar: STRONG_BUY, BUY, HOLD, SELL or STRONG_SELL — or NO_DATA when it could not read enough to judge.')}
                  <th scope="col" title="YES when the score cleared the entry threshold. 'no' is HOLD — a reading, just not strong enough. 'no reading' is NO_DATA: nothing to measure, which is NOT the same as the market being quiet.">→ Signal?</th>
                  {sortableHeader('score', "Raw directional score over its denominator: the protocol's CONFIGURED directional capacity. Never compare this number to a percentage threshold.")}
                  {sortableHeader('percent', 'That score as a percentage of the configured directional capacity. This is the figure the thresholds compare — both thresholds are shown in the strip above.')}
                  {sortableHeader('opportunity', "The dual score's second reading: every directive counted, risk gates included. It shows how much of the protocol produced any reading at all. High opportunity with a low % means the capacity existed but pointed nowhere; low opportunity means most directives stayed silent.")}
                  <th scope="col" title="Directives that produced a non-zero reading, out of the protocol's total.">Directives</th>
                  <th scope="col" title="Price change over the NEXT bar, as a percentage. Blank where the window ends before that bar exists.">Fwd 1</th>
                  <th scope="col" title="Price change over the next 5 bars, as a percentage. Blank where the window ends before those bars exist.">Fwd 5</th>
                  {sortableHeader('correct', 'Whether the call matched Fwd 1: a BUY is right if price rose, a SELL if it fell. Blank for HOLD and NO_DATA, which make no directional claim.')}
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map(({ step: s, index: i }) => {
                  const vm = buildScoreDisplay({
                    rawComposite: s.signalRaw,
                    rawMax: s.signalMax,
                    signal: s.signal,
                    // opportunity arrives as its percentage; 100 is the percentage scale, so
                    // buildScoreDisplay derives the same figure rather than a second one.
                    opportunityScore: s.opportunityPct,
                    opportunityMax: 100,
                  });
                  const signalled = isSignal(s.signal);
                  return (
                    <tr
                      key={`${s.timestamp}-${i}`}
                      className={`pb-row ${signalled ? 'pb-row--signal' : ''} ${i === selectedIdx ? 'pb-row--selected' : ''}`}
                      onClick={() => setSelectedIdx(i === selectedIdx ? null : i)}
                      title="Select for the per-directive breakdown of this bar"
                    >
                      <td className="pb-mono">{fmtTime(s.timestamp)}</td>
                      <td><SignalBadge display={vm} /></td>
                      <td>
                        <span className={signalled ? 'pb-yes' : 'pb-no'}>
                          {signalled ? 'YES' : (s.signal === 'NO_DATA' ? 'no reading' : 'no')}
                        </span>
                      </td>
                      <td className="pb-mono">{s.signalRaw} / {s.signalMax}</td>
                      <td className="pb-mono pb-mono--strong">{Number(s.normalizedScore).toFixed(1)}%</td>
                      <td className="pb-mono">{s.opportunityPct == null ? '—' : `${s.opportunityPct}%`}</td>
                      <td className="pb-mono">{s.activeDirectives} / {s.totalDirectives}</td>
                      <td className={`pb-mono ${s.forwardReturn1 >= 0 ? 'pb-up' : 'pb-down'}`}>{n1(s.forwardReturn1)}</td>
                      <td className={`pb-mono ${s.forwardReturn5 >= 0 ? 'pb-up' : 'pb-down'}`}>{n1(s.forwardReturn5)}</td>
                      <td>{s.signalCorrect === undefined ? '—' : s.signalCorrect ? '✓' : '✗'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="pb-detail">
              <h3>
                Bar {selectedIdx + 1} · {fmtTime(selected.timestamp)} · {selected.signal}
              </h3>
              {selected.directiveBreakdown?.length ? (
                <table className="bt-table">
                  <caption className="sr-only">Directive scores at the selected bar.</caption>
                  <thead>
                    <tr>
                      <th scope="col" title="The directive whose reading is shown for this bar.">Directive</th>
                      <th scope="col" title="This directive's score out of its OWN maximum — not the protocol's.">Reading</th>
                      <th scope="col" title="The same reading as a percentage of that directive's own maximum.">Score</th>
                      <th scope="col" title="The directive's own conclusion for this bar — e.g. BULLISH, BEARISH, NEUTRAL.">Class</th>
                      <th scope="col" title="The directive's own explanation of why it produced that reading.">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.directiveBreakdown.map((d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td className="pb-mono">{d.score} / {d.maxScore}</td>
                        <td className="pb-mono">{Number(d.score / Math.max(1, d.maxScore) * 100).toFixed(0)}%</td>
                        <td>{d.signalClass}</td>
                        <td className="pb-reason">{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="pb-none">
                  No directive produced a reading on this bar — that is what <code>NO_DATA</code>{' '}
                  means: nothing to classify, which is a different thing from a neutral HOLD.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {result && steps.length === 0 && (
        <p className="pb-none">The window produced no steps. That is a finding, not a zero.</p>
      )}
    </div>
  );
}
