import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReplayPlayer from '../components/ReplayPlayer';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import BacktestChartPane from '../components/backtest/BacktestChartPane';
import EquityCurveChart from '../components/backtest/EquityCurveChart';
import BacktestPeriodsPanel from '../components/backtest/BacktestPeriodsPanel';
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

/** A protocol advertises `recommendedTimeframe`; use it only if we can offer it. */
function pickTimeframe(recommended) {
  if (!recommended) return '1h';
  const norm = String(recommended).toLowerCase().replace(/\s/g, '');
  return TIMEFRAMES.find((tf) => norm.includes(tf)) ?? '1h';
}

const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '—');

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
  const protocols = protocolsQuery.data?.protocols ?? [];

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

      return apiPost('/api/backtest/run', {
        ...(subject === 'protocol' ? { protocolId } : { botId }),
        ...scope,
        ...execution,
      });
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
    <div className="bt-page">
      <p className="bt-sub">Run the Conviction Dip Accumulation strategy against historical data and measure entry signal outcomes.</p>

      <div className="bt-form">
        <label>
          Bot
          <select value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">— none (ad-hoc symbol run) —</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.symbol ? ` · ${b.symbol}` : ''}{b.protocolId ? ` · ${b.protocolId}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Symbol
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA" />
        </label>
        <label>
          Days
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={90}>90</option>
            <option value={180}>180</option>
            <option value={365}>365 (1 year)</option>
            <option value={730}>730 (2 years)</option>
            <option value={1825}>1825 (5 years)</option>
          </select>
        </label>
        <label>
          News
          <select value={newsExclusion} onChange={(e) => setNewsExclusion(e.target.value)} title="Filter out news-driven signals to isolate protocol performance">
            <option value="none">📰 Include (realistic)</option>
            <option value="exclude">🚫 Exclude (protocol purity)</option>
            <option value="only">📡 News-only (sensitivity)</option>
            <option value="reduce">📉 Reduce weight</option>
          </select>
        </label>
        <button type="button" className="bt-run" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
          {runMutation.isPending ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

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

      {runMutation.isError && <NoticeBlock notice={noticeFromError(runMutation.error)} compact />}

      {/* #986 — capture a window, name it, and run against it. Placed ABOVE the results so the
          control that scopes a run sits with the run, and mounted here rather than as a new route
          because a fourth surface for the same job is the churn #965 item 5 forbids. */}
      <BacktestPeriodsPanel
        onRunPeriod={(p) => {
          setPeriodId(p.id);
          setPeriodName(p.name);
          runMutation.mutate();
        }}
      />

      {periodId && (
        <p className="bt-active-period">
          Next run targets the captured period <strong>{periodName}</strong>.
          <button type="button" className="bt-clear-period" onClick={() => { setPeriodId(''); setPeriodName(''); }}>
            Clear
          </button>
        </p>
      )}

      {/* #823 Stage 2 — the stored runs were invisible. Measured 2026-10-15: 26 runs stored and
          served by `GET /api/backtest/runs`, with ZERO frontend references to the list. Placed
          beside the periods panel for the same reason it is mounted here rather than as a route:
          the engine, the window capture and the history all belong to the page that runs them, and
          #823 Stage 1 says explicitly not to design a second backtest view while the first sits
          unused. */}
      <BacktestRunsPanel />

      {stats && (
        <div className="bt-results">
          <div className="bt-stats-grid">
            <div className="bt-stat"><div className="bt-stat-value">{stats.totalSignals}</div><div>Entry Signals</div></div>
            {/* ⚠️ #980 — `stats.winRate` is a SIGNAL rate (profitable entry signals ÷ entry
                signals). Labelling it "Win Rate" invited reading it as a trade rate, and run
                `0dd94ddd` stored 100% here beside 0 winners of 3 trades. The two populations are
                now labelled as what they are. */}
            <div className="bt-stat"><div className="bt-stat-value">{(stats.winRate * 100).toFixed(0)}%</div><div>Entry Signals Profitable</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.averageReturn10d}%</div><div>Avg Return (10d)</div></div>
            <div className="bt-stat"><div className="bt-stat-value">{stats.maxReturn10d}%</div><div>Max Return (10d)</div></div>
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
              <span className="bt-measured-bars"> · {result.measuredPeriod.bars} bars loaded</span>
            </p>
          )}

          {/* Execution realism info */}
          {execution && (
            <p className="bt-execution-info">
              ⚙ Slippage: {(execution.slippage * 100).toFixed(2)}% · Spread: {(execution.spread * 100).toFixed(2)}%
              · Commission: ${execution.commission.toFixed(2)}/share · {execution.positionModel === 'fixedPercent'
                ? `${execution.riskPct}% risk on $${execution.accountSize.toLocaleString()}`
                : execution.positionModel === 'fixedDollar'
                ? `$${execution.fixedAmount} fixed`
                : execution.positionModel?.startsWith('kelly')
                ? <>Kelly ({execution.positionModel === 'kellyHalf' ? 'half' : 'full'})
                  · f={(execution.kellyFraction * 100).toFixed(1)}%
                  · Edge: {execution.kellyEdge > 0 ? '+' : ''}{execution.kellyEdge}%
                  · Cap: {execution.kellyCapPct}%
                  {execution.kellyFraction * 100 > 25 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> ⚠ Aggressive!</span>}
                </>
                : `$${execution.fixedAmount} fixed`}
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
              <EquityCurveChart equityData={equityData} symbol={symbol} height={300} />
            </div>
          )}

          {/* Chart visualization */}
          {showChart && (
            <div className="bt-chart-section">
              <h3>Price Chart &amp; Signals</h3>
              <BacktestChartPane initialSymbol={symbol} />
            </div>
          )}

          {result?.entrySignals?.length > 0 && (
            <table className="bt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Score</th>
                  <th>5d Return</th>
                  <th>10d Return</th>
                  <th>20d Return</th>
                </tr>
              </thead>
              <tbody>
                {result.entrySignals.slice(-50).reverse().map((s, i) => (
                  <tr key={i} className={s.wasProfitable ? 'bt-row-win' : 'bt-row-loss'}>
                    <td>{s.date}</td>
                    <td>{s.score}</td>
                    <td className={s.return5d > 0 ? 'bt-green' : 'bt-red'}>{s.return5d != null ? `${s.return5d}%` : '—'}</td>
                    <td className={s.return10d > 0 ? 'bt-green' : 'bt-red'}>{s.return10d != null ? `${s.return10d}%` : '—'}</td>
                    <td className={s.return20d > 0 ? 'bt-green' : 'bt-red'}>{s.return20d != null ? `${s.return20d}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* #819 — the replay of THIS run. Mounted here rather than as a new route: sprint #965
          item 5 names the surfaces (#819, #606) and a fourth surface is the churn it forbids. */}
      <ReplayPlayer runId={runId} />
    </div>
  );
}
