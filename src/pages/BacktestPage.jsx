import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReplayPlayer from '../components/ReplayPlayer';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import BacktestChartPane from '../components/backtest/BacktestChartPane';
import EquityCurveChart from '../components/backtest/EquityCurveChart';
import BacktestRunsPanel from '../components/backtest/BacktestRunsPanel';
import ProtocolScoreDetail from '../components/backtest/ProtocolScoreDetail';
import ProtocolCarousel from '../components/ProtocolCarousel';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import '../core/forms.css';
import './backtest-lab.css';

/**
 * BacktestPage — the BACKTEST LAB (#1134).
 *
 * ── WHAT THIS PAGE IS ────────────────────────────────────────────────────────────────────────────
 * One instrument for "change one thing, measure it on the same data". It merges the two backtest
 * surfaces that existed until 2026-10-22, because each held exactly the half the other lacked:
 *
 *   · `/lab/backtest` (this route) selected a BOT, stored every run in `backtestrun`, and could
 *     compare two of them — but had no way to choose a PROTOCOL.
 *   · `/lab/protocol-backtest` had the protocol carousel and the per-bar score table — but called
 *     `POST /api/replay/run`, which persists NOTHING (verified 2026-10-22: the only run-creating
 *     prisma write in `replay.service.ts` is `marketBar.createMany` at line 284, which fetches
 *     bars). A protocol backtest was produced, displayed, and discarded — so there was nothing to
 *     compare against, which is why "adjust and then test" could not be done on that page.
 *
 * ⚠️ THE TWO ENGINES DO NOT DISAGREE ABOUT MATHS. Both call
 * `ProtocolGatingService.scoreWithGating`, guarded by `validate-single-scoring-path.cjs`, and the
 * 2026-10-17 measurement in #823 showed two `SCORING_MODE` values producing byte-identical output.
 * The split was about STORAGE and OUTPUT SHAPE, never about scoring.
 *
 * So: the Lab runs the STORING engine (`/api/backtest/run`) for both subjects, and the per-bar score
 * table survives as a DRILL-DOWN (`ProtocolScoreDetail`) that explains a window without pretending
 * to be a measurement.
 *
 * ── THE WINDOW DEFAULTS TO THE FROZEN DEVELOPMENT PERIOD ─────────────────────────────────────────
 * `dev-window-v1` was seeded on 2026-10-22 (21 rows, one per symbol × timeframe) and until this
 * page existed NOTHING read it. Selecting it by default is what makes a run made today comparable
 * with a run made next week: `compareRuns()` prefers a shared `periodId` over comparing dates, so
 * the #1132 window warning does not even fire. Moving this window silently invalidates every
 * earlier comparison — see `nest/src/modules/backtest/dev-test-window.ts`.
 */

/**
 * The settings inventory is REFERENCE material, not a step in the workflow, so it is code-split out
 * of the boot bundle. That is not a micro-optimisation: the main chunk sits against the PWA precache
 * cap (`vite.config.js` → `maximumFileSizeToCacheInBytes`, 4 MB), and the build FAILS when it is
 * exceeded. Measured 2026-10-22 on adding this panel: 4,195.82 kB against a 4,194,304-byte cap —
 * 1.5 kB over. Splitting the panel is the fix that keeps the cap meaningful instead of raising it
 * again.
 */
const BacktestSettingsInventory = lazy(
  () => import('../components/backtest/BacktestSettingsInventory'),
);

// ── Preset profiles (#50) ──
const EXECUTION_PRESETS = {
  forex: {
    label: '💱 Forex',
    slippage: 0.0001,
    spread: 0.0001,
    commission: 0,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'forex',
  },
  stocks: {
    label: '📈 US Stocks',
    slippage: 0.01,
    spread: 0.01,
    commission: 0,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'stock',
  },
  crypto: {
    label: '₿ Crypto',
    slippage: 0.002,
    spread: 0.001,
    commission: 0.1,
    positionModel: 'fixedPercent',
    accountSize: 10000,
    riskPct: 2,
    assetClass: 'crypto',
  },
};

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

/**
 * The canonical development window's NAME — not its dates.
 *
 * ⚠️ Matching on the name rather than on `2026-09-09` means bumping the window (which the frozen
 * window's own docblock requires instead of an in-place edit) keeps this page pointed at the right
 * rows. Hard-coding the dates here would silently stop matching the moment the window moved.
 */
const FROZEN_WINDOW_NAME = 'dev-window-v1';

/**
 * A protocol advertises `recommendedTimeframe`; use it only if we can offer it.
 *
 * ⚠️ WHOLE-TOKEN MATCH FIRST, and that is not fussiness. "15m–1d" CONTAINS "5m" as a substring, so a
 * plain `.includes` scan resolves BTC Investment Monitor's recommendation to 5m the moment 5m is in
 * `TIMEFRAMES`. Measured 2026-10-22 on the merged page: it did exactly that, differing from the
 * retired protocol page (whose list omitted 5m, so the same scan found 15m). A window defaulted to
 * the wrong timeframe is a run that measures something other than what the card says it measures.
 */
function pickTimeframe(recommended) {
  if (!recommended) return '1h';
  const norm = String(recommended).toLowerCase().replace(/\s/g, '');
  const tokens = norm.split(/[^a-z0-9]+/);
  const exact = TIMEFRAMES.find((tf) => tokens.includes(tf));
  if (exact) return exact;
  return TIMEFRAMES.find((tf) => norm.includes(tf)) ?? '1h';
}

const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '—');

/** A percentage, or an explicit dash when the number was never recorded. Never a fabricated 0. */
const pctOrDash = (v) => (v == null ? '—' : `${v}%`);

export default function BacktestPage() {
  const queryClient = useQueryClient();

  // ── Subject ──────────────────────────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState('protocol');
  const [protocolId, setProtocolId] = useState('');
  const [botId, setBotId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');

  // ── Window ───────────────────────────────────────────────────────────────────────────────────
  // ⚠️ `bars` IS NOT DAYS. `BacktestRunRequest.days` sets `take: days + 120`, a ROW LIMIT walked
  // back from the newest bar — so 30 "days" on a 1h series is about 30 HOURS. Measured 2026-10-22:
  // `days: 30` on a 1h protocol produced `period: 2026-08-17 → 2026-08-19`. The control is labelled
  // "Bars" because that is what it is; a DATED window must come from a stored period.
  const [windowMode, setWindowMode] = useState('period');
  const [periodId, setPeriodId] = useState('');
  const [bars, setBars] = useState(500);

  const [runId, setRunId] = useState('');
  const [showChart, setShowChart] = useState(false);
  const [newsExclusion, setNewsExclusion] = useState('none');
  const [showExecution, setShowExecution] = useState(false);

  /**
   * ── RUN-SCOPED OVERRIDES (#1136) ───────────────────────────────────────────────────────────────
   * Held as STRINGS, because "blank" and "0" are different answers: blank means "use the subject's
   * own value", zero means "disable the bracket". Collapsing them into a number would silently turn
   * an untouched field into `slPct: 0` — and `doBrackets = slPct > 0 && tpPct > 0` would then stop
   * bracketing the trades without the operator asking.
   *
   * ⚠️ THESE DO NOT WRITE ANYTHING. `BacktestRunRequest.slPct` / `tpPct` / `timeframe` are read from
   * the REQUEST before the bot's own values (`mergeBotConfig`), and `mergeBotConfig` records the
   * difference in `drivenBy.overridden`. That makes "this bot, but with a tighter stop" one call that
   * changes one thing and is measurable — which is the point of the whole page.
   */
  const [overrides, setOverrides] = useState({ minComposite: '', slPct: '', tpPct: '', timeframe: '' });
  const setOverride = (key, value) => setOverrides((prev) => ({ ...prev, [key]: value }));

  /** Which reference panel is showing. The three are consulted, not stepped through — see the tabs. */
  const [refTab, setRefTab] = useState('runs');

  // Execution realism state (#50)
  const [slippage, setSlippage] = useState(0.01);
  const [spread, setSpread] = useState(0.01);
  const [commission, setCommission] = useState(0);
  const [positionModel, setPositionModel] = useState('fixedPercent');
  const [accountSize, setAccountSize] = useState(10000);
  const [riskPct, setRiskPct] = useState(2);
  const [kellyCapPct, setKellyCapPct] = useState(25);
  const [atrPeriod, setAtrPeriod] = useState(14);
  const [atrMultiplier, setAtrMultiplier] = useState(1.5);
  const [activePreset, setActivePreset] = useState('stocks');

  const applyPreset = (key) => {
    const p = EXECUTION_PRESETS[key];
    if (!p) return;
    setSlippage(p.slippage);
    setSpread(p.spread);
    setCommission(p.commission);
    setPositionModel(p.positionModel);
    setAccountSize(p.accountSize);
    setRiskPct(p.riskPct);
    setActivePreset(key);
  };

  const botsQuery = useQuery({
    queryKey: ['bt-bots'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => null),
  });
  const bots = useMemo(() => {
    const raw = botsQuery.data;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.strategies ?? []);
    return Array.isArray(list) ? list.filter((b) => b && b.id) : [];
  }, [botsQuery.data]);

  const protocolsQuery = useQuery({
    queryKey: ['pb-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protocols = useMemo(
    () => protocolsQuery.data?.protocols ?? [],
    [protocolsQuery.data],
  );

  const periodsQuery = useQuery({
    queryKey: ['bt-periods'],
    queryFn: () => apiGet('/api/backtest/periods?limit=200').catch(() => null),
    staleTime: 120_000,
  });
  const periods = useMemo(() => {
    const raw = periodsQuery.data;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.periods ?? []);
    return Array.isArray(list) ? list : [];
  }, [periodsQuery.data]);

  // ── Protocol search / filters ───────────────────────────────────────────────────────────────
  // ⚠️ These narrow the CAROUSEL, not the API call. Every protocol is already in memory, so
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
      // "Runnable" = resolves at least one symbol. A protocol that resolves none can never score
      // anything; worth hiding, but not worth hiding BY DEFAULT.
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
   * Strategy-track items.
   *
   * ⚠️ THE SAME TRACK COMPONENT LISTS STRATEGIES. A bot has no directive count and no ceiling of its
   * own — those belong to its protocol — so `ProtocolCarousel` renders only the fields that exist
   * (`directiveCount` / `maxScore` became nullable on 2026-10-22 for exactly this). Without that,
   * this list printed "undefined directives · ceiling undefined", which reads as a broken protocol
   * rather than as a bot.
   */
  const botItems = useMemo(() => bots.map((b) => ({
    id: b.id,
    name: b.name,
    description: [b.symbol, b.mode, b.timeframe, b.active ? 'ACTIVE' : 'paused']
      .filter(Boolean)
      .join(' · '),
    tradingStyle: b.protocolId ? `protocol ${b.protocolId}` : null,
    resolvedSymbols: b.symbol ? [b.symbol] : [],
  })), [bots]);

  const selectedProtocol = useMemo(
    () => protocols.find((p) => p.id === protocolId) ?? null,
    [protocols, protocolId],
  );
  const selectedBot = useMemo(
    () => bots.find((b) => b.id === botId) ?? null,
    [bots, botId],
  );

  /**
   * Keep the protocol selection inside the filtered list.
   *
   * ⚠️ Without this a filter could leave `protocolId` pointing at a protocol the carousel no longer
   * shows — the panel would display one protocol while the run used another. Silent, and exactly
   * the class of defect the two retired pages kept finding.
   */
  useEffect(() => {
    if (subject !== 'protocol') return;
    if (filteredProtocols.length === 0) return;
    if (filteredProtocols.some((p) => p.id === protocolId)) return;
    setProtocolId(filteredProtocols[0].id);
  }, [filteredProtocols, protocolId, subject]);

  // A bot's symbol and timeframe are FACTS ABOUT THE BOT, not choices. Deriving them here means the
  // run cannot be assembled from a pairing the bot does not have.
  const marketSymbol = subject === 'strategy' ? (selectedBot?.symbol ?? '') : symbol;
  const marketTimeframe = subject === 'strategy' ? (selectedBot?.timeframe ?? '') : timeframe;

  // Choosing a protocol sets the symbol (its first) and its own recommended timeframe. The symbol
  // list belongs to the protocol, so changing protocol MUST re-resolve the symbol rather than keep
  // a pairing the protocol does not cover.
  useEffect(() => {
    if (subject !== 'protocol' || !selectedProtocol) return;
    const symbols = selectedProtocol.resolvedSymbols ?? [];
    setSymbol((prev) => (symbols.includes(prev) ? prev : (symbols[0] ?? '')));
    setTimeframe(pickTimeframe(selectedProtocol.recommendedTimeframe));
  }, [subject, selectedProtocol]);

  // ── Window resolution ──────────────────────────────────────────────────────────────────────
  const matchingPeriods = useMemo(
    () => periods.filter((p) => p.symbol === marketSymbol && p.timeframe === marketTimeframe),
    [periods, marketSymbol, marketTimeframe],
  );
  const frozenPeriod = useMemo(
    () => matchingPeriods.find((p) => p.name === FROZEN_WINDOW_NAME) ?? null,
    [matchingPeriods],
  );
  const selectedPeriod = useMemo(
    () => matchingPeriods.find((p) => p.id === periodId) ?? null,
    [matchingPeriods, periodId],
  );

  /**
   * Default to the FROZEN window whenever the subject or market changes.
   *
   * ⚠️ Falls back to another stored period, then to none — never to a bar count silently. A run
   * whose window came from somewhere other than where the page says it came from is the defect
   * `resolvePeriod` refuses on the server, and there is no reason to reintroduce it here.
   */
  useEffect(() => {
    if (matchingPeriods.length === 0) {
      setPeriodId('');
      return;
    }
    if (matchingPeriods.some((p) => p.id === periodId)) return;
    setPeriodId((frozenPeriod ?? matchingPeriods[0]).id);
  }, [matchingPeriods, frozenPeriod, periodId]);

  const usePeriod = windowMode === 'period' && Boolean(periodId);

  const runMutation = useMutation({
    mutationFn: () => {
      // Execution realism travels with every run — it describes HOW the fill was modelled, which is
      // independent of WHERE in time the run looked.
      const execution = {
        newsExclusion,
        slippage,
        spread,
        commission,
        positionModel,
        accountSize,
        riskPct,
        kellyCapPct,
        atrPeriod,
        atrMultiplier,
      };

      // ⚠️ A PERIOD RUN SENDS NO `symbol`, NO `timeframe` AND NO `days`. The period is AUTHORITATIVE
      // for the market and the window; sending them would be dead weight at best and misleading at
      // worst — a `days` value in the request suggests the window came from this form when it did
      // not.
      const scope = usePeriod
        ? { periodId }
        : { symbol: marketSymbol, timeframe: marketTimeframe, days: bars };

      // ⚠️ ONLY NON-BLANK OVERRIDES ARE SENT. An absent key means "use the subject's own value" —
      // sending `slPct: ''` or `0` would be a decision the operator never made.
      const runOverrides = {};
      if (overrides.minComposite.trim() !== '') runOverrides.minComposite = Number(overrides.minComposite);
      if (overrides.slPct.trim() !== '') runOverrides.slPct = Number(overrides.slPct);
      if (overrides.tpPct.trim() !== '') runOverrides.tpPct = Number(overrides.tpPct);
      // A period owns the timeframe, so overriding it there would be a value the server ignores while
      // the form appeared to set it.
      if (!usePeriod && overrides.timeframe.trim() !== '') {
        runOverrides.timeframe = String(overrides.timeframe).trim();
      }

      return apiPost('/api/backtest/run', {
        ...(subject === 'protocol' ? { protocolId } : { botId }),
        ...scope,
        ...runOverrides,
        ...execution,
      }, {
        // ⚠️ MEASURED, NOT GUESSED. A BTC 15m run over the frozen development window (~3,000 bars ×
        // 14 directives) completed server-side in about 3.7 minutes on 2026-10-22 and was correctly
        // stored — while the client abandoned it at the 28 s default and the page showed nothing at
        // all. This endpoint is simply slow; the default is for endpoints that are not.
        timeoutMs: 300_000,
      });
    },
    onError: () => {
      // A timed-out run is NOT a failed run: the engine may have finished and stored it after the
      // browser stopped waiting (observed 2026-10-22 — the row existed, the response did not). Refresh
      // the list so a completed run surfaces by itself rather than being stranded in the database.
      queryClient.invalidateQueries({ queryKey: ['bt-runs'] });
    },
    onSuccess: (data) => {
      setRunId(data.id);
      setShowChart(true);
      // A new run must appear in the completed-runs panel immediately: that panel IS the comparison
      // surface, and a run that exists but is not listed cannot be compared.
      queryClient.invalidateQueries({ queryKey: ['bt-runs'] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id) => apiPost(`/api/trading/strategies/${id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bt-bots'] }),
  });

  const resultQuery = useQuery({
    queryKey: ['backtest-result', runId],
    queryFn: () => apiGet(`/api/backtest/results/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: false,
  });

  const equityQuery = useQuery({
    queryKey: ['backtest-equity', runId],
    queryFn: () => apiGet(`/api/backtest/equity/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: false,
  });

  const result = resultQuery.data;
  const equityData = equityQuery.data;
  const stats = result?.stats;
  const executionUsed = result?.execution;

  /**
   * ── PAUSED-SUBJECT DISCIPLINE ────────────────────────────────────────────────────────────────
   * ⚠️ The owner's reading — *"pausing probably/should already ensures no existing positions else it
   * wouldn't pause"* — is FALSE as measured 2026-10-22. `TradingStrategyService.toggle()` sets
   * `active = false` and nothing else (`trading-strategy.service.ts:1062-1075`); only ACTIVATION is
   * gated, by #905's ceiling check. So this guard must never claim a paused bot is flat.
   *
   * Why block at all, when a backtest cannot place an order: the risk is epistemic. A bot trading
   * the thing being measured changes state underneath the comparison, and the run stops being
   * reproducible. Pausing is cheap and reversible, so it is offered right here.
   */
  const blockedByActiveBot = subject === 'strategy' && Boolean(selectedBot?.active);
  const activeBotsOnProtocol = useMemo(
    () => (subject === 'protocol' && protocolId
      ? bots.filter((b) => b.active && b.protocolId === protocolId)
      : []),
    [subject, protocolId, bots],
  );

  const canRun = subject === 'protocol'
    ? Boolean(protocolId) && filteredProtocols.length > 0
    : Boolean(botId) && !blockedByActiveBot;

  const subjectLabel = subject === 'protocol'
    ? (selectedProtocol?.name ?? protocolId)
    : (selectedBot?.name ?? botId);

  if (protocolsQuery.isLoading) return <LoadingSkeleton variant="card" count={3} />;

  const windowLabel = usePeriod && selectedPeriod
    ? `${selectedPeriod.name} · ${fmtDay(selectedPeriod.from)} → ${fmtDay(selectedPeriod.to)}`
    : `last ${bars} bars · ${marketTimeframe || '—'}`;
  const onFrozenWindow = usePeriod && selectedPeriod?.name === FROZEN_WINDOW_NAME;

  return (
    <div className="pb-page">
      <header className="pb-header">
        <h1>
          Backtest Lab
          <PageInfoPopover label="What the Backtest Lab does">
            <strong>One subject, one window, one stored run — so two runs can be compared.</strong>
            <br />
            Pick a <strong>protocol</strong> (scores only) or a <strong>strategy</strong> (scores plus
            execution), choose a window, and run. Every run is stored, listed under “Completed runs”,
            and any two can be compared on the same window.
            <br />
            <br />
            A protocol decides <em>whether an opportunity exists</em>; a bot decides <em>what to do
            about it</em>. Testing a protocol isolates the reading; testing a bot includes sizing,
            stops and costs.
            <br />
            <br />
            <strong>Score detail</strong> (protocol runs only) re-scores the same window bar by bar
            and explains the numbers. It is a diagnostic — nothing about it is stored, so it is not a
            measurement to compare.
          </PageInfoPopover>
        </h1>
      </header>

      <section className="pb-panel">
        <div className="pb-run-head">
          <div className="pb-subject" role="radiogroup" aria-label="What to backtest">
            <button
              type="button"
              role="radio"
              aria-checked={subject === 'protocol'}
              className={`pb-subject-btn${subject === 'protocol' ? ' pb-subject-btn--on' : ''}`}
              onClick={() => setSubject('protocol')}
            >
              Protocols
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={subject === 'strategy'}
              className={`pb-subject-btn${subject === 'strategy' ? ' pb-subject-btn--on' : ''}`}
              onClick={() => setSubject('strategy')}
            >
              Strategies
            </button>
          </div>
          <span className="pb-count" aria-live="polite">
            {subject === 'protocol'
              ? `${filteredProtocols.length} of ${protocols.length} protocols`
              : `${bots.length} strategies`}
          </span>
        </div>

        {/* Search + filters narrow the PROTOCOL track only — a bot list is short enough to read. */}
        {subject === 'protocol' && (
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
        )}

        {subject === 'protocol' ? (
          <ProtocolCarousel
            items={filteredProtocols}
            value={protocolId}
            onChange={setProtocolId}
            label="Protocol"
            emptyMessage="No protocols match these filters."
          />
        ) : (
          <ProtocolCarousel
            items={botItems}
            value={botId}
            onChange={setBotId}
            label="Strategy"
            emptyMessage="No trading strategies are configured."
          />
        )}

        <div className="pb-fields">
          {/* Symbol + timeframe. Read-only for a bot: they are facts about the bot, not choices. */}
          {subject === 'strategy' ? (
            <>
              <div className="ff-field">
                <span className="ff-label">Symbol</span>
                <p className="pb-strip-item pb-strip-item--text">
                  <strong>{selectedBot?.symbol || 'none'}</strong>
                </p>
              </div>
              <div className="ff-field">
                <span className="ff-label">Timeframe</span>
                <p className="pb-strip-item pb-strip-item--text">
                  <strong>{selectedBot?.timeframe || 'none'}</strong>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="ff-field">
                <label className="ff-label" htmlFor="bt-symbol">Symbol</label>
                <select
                  id="bt-symbol"
                  className="ff-select"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {(selectedProtocol?.resolvedSymbols ?? []).length === 0 && (
                    <option value="">No symbols resolve</option>
                  )}
                  {(selectedProtocol?.resolvedSymbols ?? []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="ff-field">
                <label className="ff-label" htmlFor="bt-timeframe">Timeframe</label>
                <select
                  id="bt-timeframe"
                  className="ff-select"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Window. A stored period is a DATED window; `bars` is a row count. Both are offered, and
              each says which it is — conflating them is how "30 days" came to mean 30 hours. */}
          <div className="ff-field">
            <label className="ff-label" htmlFor="bt-window">Window</label>
            <select
              id="bt-window"
              className="ff-select"
              value={windowMode}
              onChange={(e) => setWindowMode(e.target.value)}
            >
              <option value="period">Stored period</option>
              <option value="bars">Last N bars</option>
            </select>
          </div>

          {windowMode === 'period' ? (
            <div className="ff-field">
              <label className="ff-label" htmlFor="bt-period">Period</label>
              {matchingPeriods.length === 0 ? (
                <>
                  <select id="bt-period" className="ff-select" value="" disabled>
                    <option value="">No stored period for this market</option>
                  </select>
                  <span className="pb-field-note">
                    Capture one on <strong>Backtest Data</strong>, or switch the Window to “Last N bars”.
                  </span>
                </>
              ) : (
                <select
                  id="bt-period"
                  className="ff-select"
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                >
                  {matchingPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {fmtDay(p.from)} → {fmtDay(p.to)}
                      {p.name === FROZEN_WINDOW_NAME ? ' · frozen' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="ff-field">
              <label className="ff-label" htmlFor="bt-bars">Bars</label>
              <input
                id="bt-bars"
                className="ff-input"
                type="number"
                min={30}
                step={50}
                value={bars}
                onChange={(e) => setBars(Math.max(30, Number(e.target.value) || 30))}
              />
              <span className="pb-field-note">
                Walked back from the newest bar — not calendar days.
              </span>
            </div>
          )}

          <div className="ff-field">
            <label className="ff-label" htmlFor="bt-news">News</label>
            <select
              id="bt-news"
              className="ff-select"
              value={newsExclusion}
              onChange={(e) => setNewsExclusion(e.target.value)}
              title="Filter out news-driven signals to isolate protocol performance"
            >
              <option value="none">📰 Include (realistic)</option>
              <option value="exclude">🚫 Exclude (protocol purity)</option>
              <option value="only">📡 News-only (sensitivity)</option>
              <option value="reduce">📉 Reduce weight</option>
            </select>
          </div>

          <button
            type="button"
            className="ff-btn ff-btn-primary"
            disabled={!canRun || runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending
              ? 'Running…'
              : blockedByActiveBot
                ? 'Pause the strategy first'
                : !subjectLabel
                  ? `Select a ${subject === 'protocol' ? 'protocol' : 'strategy'}`
                  : 'Run backtest'}
          </button>
        </div>

        {/* ── PAUSED-SUBJECT GUARD ──────────────────────────────────────────────────────────────
            States the pause state, refuses the run, and offers the one action that unblocks it.
            ⚠️ It says plainly that pausing does NOT close a position — see `blockedByActiveBot`. */}
        {blockedByActiveBot && (
          <div className="pb-guard" role="status">
            <strong>⏸ {selectedBot.name} is active.</strong>
            <span className="pb-guard-note">
              Pause it to make this comparison reproducible — an active bot keeps changing state
              underneath the run. Pausing stops new entries; it does <em>not</em> close a position
              that is already open.
            </span>
            <button
              type="button"
              className="ff-btn pb-clear"
              disabled={pauseMutation.isPending}
              onClick={() => pauseMutation.mutate(selectedBot.id)}
            >
              {pauseMutation.isPending ? 'Pausing…' : 'Pause this strategy'}
            </button>
          </div>
        )}

        {/* A protocol is not itself active, so a protocol run is never blocked. But a change to the
            thing a live bot trades contaminates the comparison just the same — say so. */}
        {activeBotsOnProtocol.length > 0 && (
          <div className="pb-guard" role="status">
            <strong>
              ⚠ {activeBotsOnProtocol.length} active bot{activeBotsOnProtocol.length === 1 ? '' : 's'} trade this protocol
            </strong>
            <span className="pb-guard-note">
              The run is allowed — a protocol backtest places no order — but while those bots trade,
              the protocol&rsquo;s inputs keep moving. {activeBotsOnProtocol.map((b) => b.name).join(', ')}.
            </span>
          </div>
        )}

        {pauseMutation.isError && <NoticeBlock notice={noticeFromError(pauseMutation.error)} compact />}

        {/* ── THE RUN, AS FACTS ─────────────────────────────────────────────────────────────────
            Every number here is one that is NOT already on another control: the market, the window
            in full, and the subject's ceiling. The facts the menus already state are behind the ℹ
            overlay — repeating a fact is not reassurance, it reads as volume (owner report,
            2026-10-18). */}
        {subjectLabel && (
          <div className="pb-facts">
            <div className="pb-strip">
              <div className="pb-strip-item pb-strip-item--text">
                <span>Subject</span>
                <strong>{subjectLabel}</strong>
              </div>
              <div className="pb-strip-item">
                <span>Market</span>
                <strong>{marketSymbol || '—'} {marketTimeframe || ''}</strong>
              </div>
              <div className={`pb-strip-item pb-strip-item--text${onFrozenWindow ? '' : ' pb-strip-item--warn'}`}>
                <span>Window</span>
                <strong>{windowLabel}</strong>
              </div>
              {subject === 'protocol' && selectedProtocol?.directiveCount != null && (
                <div className="pb-strip-item">
                  <span>Directives</span>
                  <strong>{selectedProtocol.directiveCount}</strong>
                </div>
              )}
              {subject === 'protocol' && selectedProtocol?.maxScore != null && (
                <div className="pb-strip-item">
                  <span>Configured capacity</span>
                  <strong>{selectedProtocol.maxScore}</strong>
                </div>
              )}
              {/* An override must be visible AT THE MOMENT OF THE RUN, not only in the panel far below.
                  A stop you set and forgot is a comparison against the wrong baseline. */}
              {(overrides.minComposite.trim() !== '' || overrides.slPct.trim() !== ''
                || overrides.tpPct.trim() !== ''
                || (!usePeriod && overrides.timeframe.trim() !== '')) && (
                <div className="pb-strip-item pb-strip-item--text pb-strip-item--warn">
                  <span>Run overrides</span>
                  <strong>
                    {[
                      overrides.minComposite.trim() !== '' ? `BAR ${overrides.minComposite}%` : null,
                      overrides.slPct.trim() !== '' ? `SL ${overrides.slPct}%` : null,
                      overrides.tpPct.trim() !== '' ? `TP ${overrides.tpPct}%` : null,
                      !usePeriod && overrides.timeframe.trim() !== '' ? `TF ${overrides.timeframe}` : null,
                    ].filter(Boolean).join(' · ')}
                  </strong>
                </div>
              )}
            </div>

            <PageInfoPopover label="Why the window matters">
              <strong>A stored period is a DATE RANGE. “Last N bars” is a ROW COUNT.</strong>
              <br />
              They are not interchangeable: the engine walks backwards from the newest bar, so 30
              bars on a 1h series covers about 30 hours, not 30 days. A run whose window is a row
              count cannot be compared with one whose window is a date range — the comparison guard
              refuses to name a winner across them.
              <br />
              <br />
              <strong>Why {FROZEN_WINDOW_NAME} is the default.</strong> It is frozen so that work done
              today is measured on the same data as work done last week. Moving it silently
              invalidates every earlier comparison, which is why it is versioned rather than edited.
              <br />
              <br />
              <strong>What a comparison can and cannot claim.</strong> Two runs on the same period,
              same code, differing in one configuration field, is an experiment. Two runs on different
              windows is two unrelated measurements printed next to each other.
            </PageInfoPopover>
          </div>
        )}
      </section>

      {/* ── Execution Realism Panel (#50) ── */}
      <div className="bt-execution-section">
        <button
          type="button"
          className={`bt-execution-toggle ${showExecution ? 'open' : ''}`}
          onClick={() => setShowExecution(!showExecution)}
        >
          ⚙ Execution Realism {showExecution ? '▾' : '▸'}
          {activePreset && <span className="bt-preset-badge">{EXECUTION_PRESETS[activePreset].label}</span>}
        </button>

        {showExecution && (
          <div className="bt-execution-panel">
            {/* Preset buttons */}
            <div className="bt-presets">
              {Object.entries(EXECUTION_PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  className={`bt-preset-btn ${activePreset === key ? 'active' : ''}`}
                  onClick={() => applyPreset(key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="bt-execution-grid">
              <label title="Slippage as decimal (0.01 = 1%)">
                Slippage
                <input type="number" step="0.0001" min="0" value={slippage} onChange={e => { setSlippage(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Spread as decimal (0.01 = 1%)">
                Spread
                <input type="number" step="0.0001" min="0" value={spread} onChange={e => { setSpread(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Per-share/contract commission ($)">
                Commission $
                <input type="number" step="0.01" min="0" value={commission} onChange={e => { setCommission(parseFloat(e.target.value) || 0); setActivePreset(''); }} />
              </label>
              <label title="Position sizing model">
                Sizing Model
                <select value={positionModel} onChange={e => { setPositionModel(e.target.value); setActivePreset(''); }}>
                  <option value="fixedPercent">% of Equity</option>
                  <option value="fixedDollar">Fixed $</option>
                  <option value="atrEqualRisk">ATR Equal Risk</option>
                  <option value="kellyFull">Kelly (full)</option>
                  <option value="kellyHalf">Kelly (half)</option>
                </select>
              </label>
              {(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Maximum % of account allowed per trade. Kelly can be aggressive — cap it.">
                  Kelly Cap %
                  <input type="number" step="5" min="5" max="50" value={kellyCapPct} onChange={e => { setKellyCapPct(parseFloat(e.target.value) || 25); setActivePreset(''); }} />
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="Stop distance = ATR × multiplier. Higher = wider stop, smaller position.">
                  ATR Multiplier
                  <input type="number" step="0.5" min="0.5" max="5" value={atrMultiplier} onChange={e => { setAtrMultiplier(parseFloat(e.target.value) || 1.5); setActivePreset(''); }} />
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="ATR lookback period. 14 = standard, 10 = more responsive, 20 = smoother.">
                  ATR Period
                  <input type="number" step="1" min="5" max="50" value={atrPeriod} onChange={e => { setAtrPeriod(parseInt(e.target.value, 10) || 14); setActivePreset(''); }} />
                </label>
              )}
              {!(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Risk per trade as % of account. Position size = (account * risk%) / stopDistance">
                  Risk %
                  <input type="number" step="0.5" min="0.5" max="20" value={riskPct} onChange={e => { setRiskPct(parseFloat(e.target.value) || 2); setActivePreset(''); }} />
                </label>
              )}
              <label title="Starting account balance for position sizing">
                Account Size
                <input type="number" step="1000" min="1000" value={accountSize} onChange={e => { setAccountSize(parseInt(e.target.value) || 10000); setActivePreset(''); }} />
              </label>
            </div>
          </div>
        )}
      </div>

      {runMutation.isError && (
        runMutation.error?.timedOut ? (
          <div className="pb-guard" role="status">
            <strong>⏱ The browser stopped waiting after {runMutation.error.timeoutSeconds}s.</strong>
            <span className="pb-guard-note">
              A long window can still be running on the server after the page gives up, and when it
              finishes the run IS stored. Check <strong>Completed runs</strong> below before running it
              again — a second attempt would duplicate a run that already succeeded. Narrow the window
              if this keeps happening.
            </span>
          </div>
        ) : (
          <NoticeBlock notice={noticeFromError(runMutation.error)} compact />
        )
      )}

      {/* ⚠️ THE CAPTURED-WINDOWS PANEL IS NOT HERE ANY MORE (2026-10-22, owner direction). It moved to
          `/lab/backtest-data`, which is the inventory of DATA — a captured period is a named, noted,
          imported window of bars, and putting storage management beside a measurement form was the
          wrong control on the wrong page. This page only CONSUMES periods: the Window control above
          lists every one the data page creates. */}

      {/* ── REFERENCE MATERIAL, IN ONE TAB STRIP ──────────────────────────────────────────────────
          ⚠️ WHY TABS AND NOT THREE STACKED PANELS (owner report, 2026-10-22: *"the new page is
          actually a mess"*). This page had grown to NINE vertically stacked blocks — run form,
          execution panel, runs list, stats grid, equity chart, price chart, trades table, settings
          inventory of four/five sub-tables, and the score-detail table. Everything was present and
          nothing was findable.

          These three are REFERENCE, not steps in the run: you consult one when you need it. Showing
          one at a time keeps the run form and its result adjacent, which is the only adjacency that
          matters during measurement.

          The result blocks above are deliberately NOT tabbed — a result you have to click to see is
          the opposite of the point. */}
      <nav className="bt-ref-tabs" aria-label="Reference panels">
        {[
          { id: 'runs', label: 'Completed runs', hint: 'Stored runs, and the comparison of two of them.' },
          { id: 'settings', label: 'Settings inventory', hint: 'Every knob, and whether a run honours it.' },
          { id: 'scores', label: 'Score detail', hint: 'Bar-by-bar scores for the same window.' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`bt-ref-tab${refTab === t.id ? ' bt-ref-tab--on' : ''}`}
            aria-current={refTab === t.id ? 'true' : undefined}
            title={t.hint}
            onClick={() => setRefTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {refTab === 'runs' && (
        /* #823 Stage 2 — the stored runs were invisible. Measured 2026-10-15: 26 runs stored and
           served by `GET /api/backtest/runs`, with ZERO frontend references to the list. This panel
           is load-bearing: it is the only place two runs can be set against each other, and it
           carries the #1132 guard that refuses to name a winner across two windows. */
        <BacktestRunsPanel />
      )}

      {refTab === 'settings' && (
        <Suspense fallback={<p className="pb-none">Loading the settings inventory…</p>}>
          <BacktestSettingsInventory
            subject={subject}
            protocolId={protocolId}
            botId={subject === 'strategy' ? botId : ''}
            overrides={overrides}
            onOverride={setOverride}
            allowTimeframe={!usePeriod}
          />
        </Suspense>
      )}

      {refTab === 'scores' && (
        /* Available for PROTOCOL runs on a DATED window. It needs dates: `/api/replay/run` takes
           `from`/`to`, and a bar count has none — so a "last N bars" run correctly has no drill-down
           rather than one measured over a guessed range. */
        <ProtocolScoreDetail
          protocolId={protocolId}
          symbol={marketSymbol}
          timeframe={marketTimeframe}
          periodId={usePeriod ? periodId : ''}
          blockedReason={
            subject !== 'protocol'
              ? 'Score detail scores one PROTOCOL over a window. Switch the subject to Protocols.'
              : !protocolId
                ? 'Select a protocol to score a window.'
                : !usePeriod
                  ? 'Score detail needs a dated window. Choose a stored period as the Window.'
                  : null
          }
        />
      )}

      {stats && (
        <div className="bt-results">
          <div className="bt-stats-grid">
            <div className="bt-stat"><div className="bt-stat-value">{stats.totalSignals}</div><div>Entry Signals</div></div>
            {/* ⚠️ #980 — `stats.winRate` is a SIGNAL rate (profitable entry signals ÷ entry
                signals). Labelling it "Win Rate" invited reading it as a trade rate, and run
                `0dd94ddd` stored 100% here beside 0 winners of 3 trades. The two populations are
                now labelled as what they are. */}
            <div className="bt-stat"><div className="bt-stat-value">{(stats.winRate * 100).toFixed(0)}%</div><div>Entry Signals Profitable</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{pctOrDash(stats.averageReturn10d)}</div><div>Avg Return (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{pctOrDash(stats.maxReturn10d)}</div><div>Max Return (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.maxDrawdown10d}%</div><div>Max Drawdown (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.profitFactor}</div><div>Profit Factor</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.sharpeApproximation}</div><div>Sharpe (approx)</div></div>
            {/* Bracket trade stats */}
            {stats.totalTrades != null && (
              <>
                <div className="bt-stat"><div className="bt-stat-value">{stats.totalTrades}</div><div>Bracket Trades</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{(stats.tradeWinRate * 100).toFixed(0)}%</div><div>Trade Win Rate</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.avgTradePnl}%</div><div>Avg Trade PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">${stats.totalPnl?.toFixed(2)}</div><div>Total PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.grossPnl != null ? `$${stats.grossPnl.toFixed(2)}` : '—'}</div><div>Gross PnL</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.totalCommission != null ? `$${stats.totalCommission.toFixed(2)}` : '—'}</div><div>Total Commission</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.avgPositionSize != null ? Math.round(stats.avgPositionSize) : '—'}</div><div>Avg Pos Size</div></div>
                <div className="bt-stat"><div className="bt-stat-value">{stats.maxTradeDrawdown != null ? `$${stats.maxTradeDrawdown.toFixed(2)}` : '—'}</div><div>Max Trade DD</div></div>
              </>
            )}
          </div>

          {result?.period && <p className="bt-period">Period: {result.period}</p>}

          {/* ⚠️ #986 — WHICH STORED PERIOD this measured, by name and note. `result.period` above
              is a date range; on its own it does not say why the window mattered, and a result
              from a captured window must never read as an ordinary day-range run. */}
          {result?.measuredPeriod && (
            <p className="bt-measured-period">
              Captured period: <strong>{result.measuredPeriod.name}</strong>
              {result.measuredPeriod.note ? ` — ${result.measuredPeriod.note}` : ''}
              {result.measuredPeriod.from && (
                <span className="bt-measured-bars">
                  {' '}· {result.measuredPeriod.from} → {result.measuredPeriod.to}
                  {result.measuredPeriod.bars != null
                    ? ` · ${result.measuredPeriod.bars} bars imported`
                    : ' · bar count not recorded'}
                </span>
              )}
            </p>
          )}

          {/* Execution realism info */}
          {/* ⚠️ What this run CANNOT claim, stated with the numbers rather than left to the reader —
              a bot-driven run carries the #843 sizing-divergence warning here. */}
          {result?.caveats?.length > 0 && (
            <ul className="bt-caveats">
              {result.caveats.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}

          {executionUsed && (
            <p className="bt-execution-info">
              ⚙ Slippage: {(executionUsed.slippage * 100).toFixed(2)}% · Spread: {(executionUsed.spread * 100).toFixed(2)}%
              · Commission: ${executionUsed.commission.toFixed(2)}/share · {executionUsed.positionModel === 'fixedPercent'
                ? `${executionUsed.riskPct}% risk on $${executionUsed.accountSize.toLocaleString()}`
                : executionUsed.positionModel === 'fixedDollar'
                ? `$${executionUsed.fixedAmount} fixed`
                : executionUsed.positionModel?.startsWith('kelly')
                ? <>Kelly ({executionUsed.positionModel === 'kellyHalf' ? 'half' : 'full'})
                  · f={(executionUsed.kellyFraction * 100).toFixed(1)}%
                  · Edge: {executionUsed.kellyEdge > 0 ? '+' : ''}{executionUsed.kellyEdge}%
                  · Cap: {executionUsed.kellyCapPct}%
                  {executionUsed.kellyFraction * 100 > 25 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> ⚠ Aggressive!</span>}
                </>
                : `$${executionUsed.fixedAmount} fixed`}
            </p>
          )}

          {/* News exclusion info */}
          {result?.newsExclusion && result.newsExclusion !== 'none' && (
            <p className="bt-news-info">
              📡 News mode: <strong>{result.newsExclusion}</strong>
              {result.newsDatesCount != null && <span> — {result.newsDatesCount} news dates found</span>}
            </p>
          )}

          {/* Equity curve + drawdown */}
          {equityData && !equityData.error && equityData.equity?.length > 0 && (
            <div className="bt-chart-section">
              <h3>Equity Curve &amp; Drawdown</h3>
              <EquityCurveChart equityData={equityData} symbol={result?.symbol ?? marketSymbol} height={300} />
            </div>
          )}

          {/* Chart visualization */}
          {showChart && (
            <div className="bt-chart-section">
              <h3>Price Chart &amp; Signals</h3>
              <BacktestChartPane initialSymbol={result?.symbol ?? marketSymbol} />
            </div>
          )}

          {/* ── WHAT IT TRADED ────────────────────────────────────────────────────────────────────
              ⚠️ THIS REPLACED AN ENTRY-SIGNAL TABLE THAT COULD NEVER RENDER (#1134). A stored run
              persists its TRADES, not its per-signal rows — `formatRunResult()` returns
              `entrySignals: []` — so a table keyed on those rows was structurally dead, while 1,285
              stored trades went unshown. The `caveats` block above states the gap; this shows the
              population that actually exists. Newest first, last 50. */}
          {result?.trades?.length > 0 && (
            <div className="bt-chart-section">
              <h3>Trades <span className="bt-measured-bars">· last {Math.min(50, result.trades.length)} of {result.trades.length.toLocaleString()}, newest first</span></h3>
              <table className="bt-table">
                <caption className="sr-only">
                  The trades this run recorded, newest first, with entry and exit price, realised
                  P&amp;L and why the position closed.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" title="When the position was opened.">Entry</th>
                    <th scope="col" title="Long or short.">Dir</th>
                    <th scope="col" title="Fill price at entry.">In</th>
                    <th scope="col" title="Fill price at exit.">Out</th>
                    <th scope="col" title="Realised profit or loss on the trade, as a percentage of the position.">PnL %</th>
                    <th scope="col" title="What ended the trade: the stop, the target, or end of the window.">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(-50).reverse().map((t, i) => (
                    <tr key={`${t.entryDate}-${i}`} className={t.pnlPct > 0 ? 'bt-row-win' : 'bt-row-loss'}>
                      <td className="pb-mono">{String(t.entryDate).slice(0, 16).replace('T', ' ')}</td>
                      <td>{t.direction === 'short' ? '▼ short' : '▲ long'}</td>
                      <td className="pb-mono">{t.entryPrice}</td>
                      <td className="pb-mono">{t.exitPrice}</td>
                      <td className={`pb-mono ${t.pnlPct > 0 ? 'bt-green' : 'bt-red'}`}>
                        {t.pnlPct != null ? `${Number(t.pnlPct).toFixed(2)}%` : '—'}
                      </td>
                      <td>{t.exitReason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* #819 — the replay of THIS run. Mounted here rather than as a new route: sprint #965
          item 5 names the surfaces (#819, #606) and a fourth surface is the churn it forbids. */}
      <ReplayPlayer runId={runId} />
    </div>
  );
}
