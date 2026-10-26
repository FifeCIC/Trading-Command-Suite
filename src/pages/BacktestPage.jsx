import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReplayPlayer from '../components/ReplayPlayer';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import BacktestChartPane from '../components/backtest/BacktestChartPane';
import EquityCurveChart from '../components/backtest/EquityCurveChart';
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
 * ⚠️ ALL THREE REFERENCE PANELS ARE CODE-SPLIT NOW (2026-10-26). This is not a micro-optimisation:
 * the main chunk sits against the PWA precache cap (`vite.config.js` →
 * `maximumFileSizeToCacheInBytes`, 4 MiB) and the BUILD FAILS when it is exceeded. Measured that
 * day: 4,194,909 bytes against the 4,194,304-byte cap — 605 bytes over, caused by the step rail.
 * The documented fix is to split, not to raise the cap again; and the reference panels are the
 * correct things to split, because they are consulted on demand and never needed to paint the
 * step form.
 */
const BacktestSettingsInventory = lazy(
  () => import('../components/backtest/BacktestSettingsInventory'),
);
const BacktestRunsPanel = lazy(() => import('../components/backtest/BacktestRunsPanel'));
const ProtocolScoreDetail = lazy(() => import('../components/backtest/ProtocolScoreDetail'));

/**
 * The Lab's steps (#1138, owner direction 2026-10-26).
 *
 * `n` is the number shown in the rail and the ONLY ordering authority — the rail, the panel
 * heading and the "of 5" counter all read from this array, so they cannot disagree.
 *
 * ⚠️ Step 1 is the owner's definition (subject header + track). Steps 2-5 are the blocks that
 * already existed, grouped into the sequence they were already written in. Re-framing them is
 * expected; adding a step means adding a row here AND a `stepDone`/`stepUnlocked` entry, and the
 * `validate-*`-free nature of that pair is stated in the code rather than left to be discovered.
 */
const STEPS = [
  { n: 1, id: 'subject', label: 'Choose the subject' },
  { n: 2, id: 'window', label: 'Instrument & window' },
  { n: 3, id: 'info', label: 'Information sources' },
  { n: 4, id: 'execution', label: 'Execution realism' },
  { n: 5, id: 'run', label: 'Run' },
  { n: 6, id: 'result', label: 'Result' },
];

/**
 * Information sources a directive can read that are NOT the price window (#1139).
 *
 * ⚠️ HOW THIS LIST WAS MEASURED, so the next reader can re-measure it:
 *   · every `nest/src/modules/directives/implementations/*.directive.ts` was scanned for
 *     `this.prisma.` or `fetch(` — exactly five matched: crypto-fear-greed (fetch),
 *     dilution-impact / earnings-momentum / insider-activity / social-buzz (prisma).
 *   · `news-catalyst` does not appear in that scan because it reads `input.news`, which nothing
 *     supplies — its own docblock says "INERT UNTIL A PRODUCER EXISTS".
 *
 * `honest` answers ONE question: does the backtester reproduce this directive per bar?
 * The scoring path sets `asOf` from the evaluated candle (`protocol-gating.service.ts`: "The
 * evaluated candle, not the process clock, defines scoring time"), so a directive that reads
 * `asOf` is historically faithful. `crypto-fear-greed` fetches a live API on a 1-hour cache and
 * `dilution-impact` reads a CURRENT `companyMetric` snapshot — both give every historical bar
 * TODAY's value.
 *
 * ⚠️ THIS IS A HAND-MAINTAINED MAP, AND THAT IS THE WEAKNESS. A new external directive will not
 * appear here. The fix is a `dataSource`/`historical` pair on the directive registry so this list
 * is derived rather than typed — filed as an issue rather than done here.
 */
const EXTERNAL_SOURCES = {
  'news-catalyst': {
    name: 'News catalyst',
    honest: false,
    note: 'Direction-neutral and INERT: it scores relevance and recency from an `input.news` array that nothing populates yet, so it abstains on every bar in a backtest and in live scoring alike.',
  },
  'earnings-momentum': {
    name: 'Earnings momentum',
    honest: true,
    note: 'Reads earnings history around the evaluated bar’s own timestamp, so the replay and the live score see the same information.',
  },
  'insider-activity': {
    name: 'Insider filings',
    honest: true,
    note: 'Reads insider transactions within a window ending at the evaluated bar — no future filings leak in.',
  },
  'social-buzz': {
    name: 'Social buzz',
    honest: true,
    note: 'Counts mentions in the 24 hours before the evaluated bar. ⚠️ Historical coverage depends on what the mention table actually holds for that period; an empty table reads as “no buzz”, not as “not measured”.',
  },
  'dilution-impact': {
    name: 'Dilution / share count',
    honest: false,
    note: 'Reads the CURRENT company-metrics snapshot by symbol — the same value on every historical bar. A backtest that includes this directive is not a replay of it.',
  },
  'crypto-fear-greed': {
    name: 'Crypto Fear & Greed',
    honest: false,
    note: 'Fetched live from alternative.me with a one-hour cache and no `asOf` filter — every historical bar is scored against today’s index value.',
  },
};

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

  /**
   * The step the reader is on. Auto-advances ONCE per step (see the effect below); `activeStep`
   * is this value clamped to the furthest unlocked step, so this can never point at a locked or
   * re-locked step.
   */
  const [step, setStep] = useState(1);
  /** Steps already auto-advanced past — so going back to re-read step 1 does not bounce forward. */
  const autoAdvanced = useRef(new Set());

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

  // ── Track search / filters ──────────────────────────────────────────────────────────────────
  // ⚠️ These narrow the CAROUSEL, not the API call. Every protocol and bot is already in memory, so
  // filtering client-side keeps the scroll position and avoids a round trip per keystroke.
  //
  // ⚠️ STYLE AND "HAS SYMBOLS" WERE REMOVED 2026-10-25 (owner direction). Style was a descriptive tag
  // nothing branches on, and "has symbols" filtered for a BROKEN STATE rather than a property — the
  // right fix for a protocol with no symbols is to say so on its card, not to offer a checkbox that
  // hides it. ⚠️ Measured the same day: **14 of 47 protocols resolve zero symbols**, one of them
  // (`eurusd-macro-v1`) ACTIVE — so the state is real and is now shown on the card instead.
  const [query, setQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');

  const directionOptions = useMemo(
    () => [...new Set(protocols.map((p) => p.directionMode).filter(Boolean))].sort(),
    [protocols],
  );

  /**
   * A BOT'S DIRECTION IS ITS PROTOCOL'S DIRECTION — there is no direction column on a bot.
   *
   * Measured 2026-10-25: all 40 bots have `protocolId` set and `shortProtocolId` null, so a bot trades
   * the side its protocol declares (`LONG_ONLY` 45 / `SHORT_ONLY` 2 across the 47 protocols). Deriving
   * it here is what lets the SAME direction filter apply to both subjects without inventing a field.
   *
   * ⚠️ When a bot's protocol is not in the loaded list the value is `null`, not `'LONG_ONLY'`. A guess
   * would make the filter silently wrong for exactly the bots nobody has looked at.
   */
  const directionOfProtocol = useMemo(() => {
    const map = new Map();
    for (const p of protocols) if (p.directionMode) map.set(p.id, p.directionMode);
    return map;
  }, [protocols]);

  /**
   * Protocol-track items, with the one fact the removed checkbox used to carry.
   *
   * `unrunnable` is set when a protocol resolves NO symbols. It renders as a badge on the card, so a
   * protocol that cannot be run says so where the operator is looking rather than being silently
   * unselectable (`symbol` would be `''` and the Run button would read "No symbol" with no reason).
   */
  const protocolItems = useMemo(() => protocols
    .filter((p) => {
      if (directionFilter && p.directionMode !== directionFilter) return false;
      const q = query.trim().toLowerCase();
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
    })
    .map((p) => ({
      ...p,
      unrunnable: !(p.resolvedSymbols?.length > 0),
    })), [protocols, query, directionFilter]);

  /** The filtered list the selection guards use. Kept named `filteredProtocols` for its readers. */
  const filteredProtocols = protocolItems;

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
    // Derived, never guessed — see `directionOfProtocol`.
    directionMode: b.protocolId ? (directionOfProtocol.get(b.protocolId) ?? null) : null,
    resolvedSymbols: b.symbol ? [b.symbol] : [],
  })), [bots, directionOfProtocol]);

  /**
   * The search applies to BOTH subjects (owner direction, 2026-10-25).
   *
   * ⚠️ It filters bots on the same haystack principle as protocols — name, symbol, mode, timeframe,
   * protocol and id — and it is applied to the CAROUSEL, not to a query, because every bot is already
   * in memory. Searching a list you can already see should never cost a round trip.
   */
  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return botItems.filter((b) => {
      // The direction facet applies to strategies too, via the bot's protocol (see
      // `directionOfProtocol`). A bot whose protocol is not loaded has no direction and is filtered
      // OUT when a direction is chosen — stated rather than silently included.
      if (directionFilter && b.directionMode !== directionFilter) return false;
      if (!q) return true;
      const haystack = [b.name, b.id, b.description, b.tradingStyle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [botItems, query, directionFilter]);

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

  /**
   * Keep the STRATEGY selection inside the filtered list — the same guard the protocol track has.
   *
   * ⚠️ Without it a search could leave `botId` pointing at a bot the track no longer shows, so the
   * panel would display one strategy while the run used another. Silent, and the exact class of defect
   * the two retired backtest pages kept finding.
   */
  useEffect(() => {
    if (subject !== 'strategy') return;
    if (filteredBots.length === 0) return;
    if (filteredBots.some((b) => b.id === botId)) return;
    setBotId(filteredBots[0].id);
  }, [filteredBots, botId, subject]);

  // A bot's symbol and timeframe are FACTS ABOUT THE BOT, not choices. Deriving them here means the
  // run cannot be assembled from a pairing the bot does not have.
  //
  // ⚠️ A PROTOCOL'S SYMBOLS ARE FACTS ABOUT THE PROTOCOL TOO, AND THERE IS NO SYMBOL MENU (owner
  // direction, 2026-10-26: *"The symbol selection menu should be removed from Step 2. It is not
  // applicable. Backtesting system must use the protocols connected watchlist or single-symbol
  // assignment."*). `symbolPool` is exactly what `resolveSymbols()` returns — a watchlist FK or a
  // `symbol_protocol_assignment` row. The Lab may only measure markets the protocol was given, so
  // it has nothing to offer as a list of alternatives.
  //
  // Which symbol of a multi-symbol protocol gets measured is therefore decided by the STORED PERIOD,
  // because a period is a statement about one market and its dates (`#986`: "a period wins on where
  // to look"). `matchingPeriods` is filtered by the whole pool rather than by one symbol, so a
  // 15-pair protocol still offers a period for each pair — the choice lives in the window control,
  // where the symbol is already named, and not in a separate menu that could contradict it.
  // ── DECISION (2026-10-26, owner) ──
  // WHAT:      No symbol menu. `symbolPool` is the protocol's own resolved symbols; a stored period
  //            decides which of them is measured, and a bar-count window falls back to the first.
  // WHY:       A menu let the Lab assemble `protocol × any symbol` — a plausible score for a market
  //            the protocol was never given. `resolveSymbols()` already answers the legitimate
  //            question (watchlist FK or `symbol_protocol_assignment`), so the menu only offered
  //            illegitimate answers.
  // INSTEAD OF: Keeping the menu filtered to `resolvedSymbols` (rejected: it makes the reader pick
  //            the same thing twice — symbol, then period — and preserves a control whose every
  //            honest setting is already known).
  // REVERSE BY: Restore a `symbol` state and a `<select>` in step 2, and filter `matchingPeriods`
  //            by it instead of by the pool. `marketSymbol` is the only derived consumer.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 91
  // GUARD:     none — 🔴 UNGUARDED. Nothing fails if a symbol selector is reintroduced.
  const symbolPool = useMemo(
    () => (subject === 'strategy'
      ? (selectedBot?.symbol ? [selectedBot.symbol] : [])
      : (selectedProtocol?.resolvedSymbols ?? [])),
    [subject, selectedBot, selectedProtocol],
  );
  const marketTimeframe = subject === 'strategy' ? (selectedBot?.timeframe ?? '') : timeframe;

  // The protocol's own recommended timeframe is a starting point, not a constraint; a protocol may
  // legitimately be measured on a different cadence.
  useEffect(() => {
    if (subject !== 'protocol' || !selectedProtocol) return;
    setTimeframe(pickTimeframe(selectedProtocol.recommendedTimeframe));
  }, [subject, selectedProtocol]);

  // ── Window resolution ──────────────────────────────────────────────────────────────────────
  const usePeriod = windowMode === 'period' && Boolean(periodId);
  const matchingPeriods = useMemo(
    () => periods.filter((p) => p.timeframe === marketTimeframe && symbolPool.includes(p.symbol)),
    [periods, marketTimeframe, symbolPool],
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
   * The market this run measures. A stored period names it; a bar-count window has no period to ask,
   * so it falls back to the protocol's FIRST resolved symbol — and that fallback is the one place a
   * choice is being made without the reader making it, which is why the bar-count window says so
   * outright (see the Window control's note).
   */
  const marketSymbol = subject === 'strategy'
    ? (selectedBot?.symbol ?? '')
    : (usePeriod && selectedPeriod ? selectedPeriod.symbol : (symbolPool[0] ?? ''));

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
        timeoutMs: 600_000,
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

  // ── STEPS (owner direction, 2026-10-26) ──────────────────────────────────────────────────
  // The page is one ordered sequence: you cannot choose a window before you have chosen what
  // to test, and you cannot read a result before you have run one. It used to render every
  // block at once, so all of them were present and none was findable.
  //
  // ⚠️ STEP 1 IS THE OWNER'S DEFINITION; the rest are the pre-existing blocks grouped into the
  // order they already ran in. Step 3 was split out on the owner's direction (the news control and
  // every other outside information source live there now). Re-framing is still expected.
  //
  // ⚠️ ONE BLOCK RENDERS AT A TIME. A locked step is not greyed out — it is not mounted, so
  // there is nothing inside it to click, focus or accidentally submit. `aria-disabled` on the
  // rail keeps the item TABBABLE (accessibility-policy: every interactive element reachable by
  // Tab) so a keyboard user can reach the reason it is locked rather than finding a dead gap.
  const symbolReady = subject === 'protocol'
    ? (selectedProtocol?.resolvedSymbols ?? []).length > 0
    : Boolean(selectedBot?.symbol);
  const windowReady = usePeriod ? Boolean(selectedPeriod) : bars >= 100;
  const instrumentReady = symbolReady && Boolean(marketTimeframe) && windowReady;

  // Which outside information sources this subject actually reads. Derived from the protocol's own
  // directive list, so it answers "what does THIS protocol use", not "what exists".
  const externalSources = useMemo(() => {
    if (subject !== 'protocol' || !selectedProtocol) return [];
    const ids = new Set();
    for (const g of selectedProtocol.groups ?? []) {
      for (const d of g.directives ?? []) ids.add(d.id);
    }
    return Object.entries(EXTERNAL_SOURCES)
      .filter(([id]) => ids.has(id))
      .map(([id, meta]) => ({ id, ...meta }));
  }, [subject, selectedProtocol]);

  const canRunBool = Boolean(canRun);
  const hasResult = Boolean(stats);
  // `stepValid` = the VALUES for this step are usable. It governs whether the next step may be
  // entered, because an invalid step would let the reader assemble a run the engine must refuse.
  const stepValid = useMemo(
    () => ({
      1: canRunBool,
      2: instrumentReady,
      // Information sources needs no decision — every control in it has a defensible default — so it
      // is valid as soon as it is reachable. It is a step because its READING matters, not because
      // it needs an answer.
      3: canRunBool && instrumentReady,
      4: canRunBool && instrumentReady,
      5: canRunBool && instrumentReady,
      6: hasResult,
    }),
    [canRunBool, instrumentReady, hasResult],
  );
  const stepUnlocked = useMemo(
    () => ({
      1: true,
      2: stepValid[1],
      3: stepValid[1] && stepValid[2],
      4: stepValid[1] && stepValid[2],
      5: stepValid[1] && stepValid[2],
      // ⚠️ Step 6 is unlocked by the RESULT, not by step 5 being enterable — `stepValid[5]` would be
      // true before anything had been run, which made "Result" read Ready with no result in hand.
      6: stepValid[6],
    }),
    [stepValid],
  );

  // ⚠️ THE TICK IS A **SESSION** FACT, NOT A VALUE FACT (owner report, 2026-10-26: *"Refreshing the
  // page doesn't reset the steps"*). `stepValid` answers "are these values usable"; it was being
  // used for TWO jobs, so a reload restored 1-4 as ✓ Done — the values really were valid, but the
  // reader had not been anywhere near three of them, and the page looked like it had not reset.
  //
  // `reached` is which steps this reader has actually moved past. It is `useState`, so a refresh
  // clears it and the rail starts blank, which is what "reset" has to mean. Validity still gates
  // ENTRY, because an invalid step would let a run be assembled that the engine must refuse.
  const [reached, setReached] = useState(() => new Set());
  const stepDone = (n) => reached.has(n);

  // Lock reasons name the ACTUAL unmet condition. "Complete the previous step" would be true
  // and useless; "this protocol resolves no symbols" is the thing the reader has to fix.
  const lockReason = {
    2: !canRun
      ? `Pick a ${subject === 'protocol' ? 'protocol' : 'strategy'} in step 1`
      : subject === 'protocol' && (selectedProtocol?.resolvedSymbols ?? []).length === 0
        ? 'This protocol resolves no symbols — wire a watchlist or a symbol assignment'
        : 'Complete step 1',
    3: 'Finish step 2 first',
    4: 'Finish step 2 first',
    5: 'Finish step 2 first',
    6: 'Available once a run has completed',
  };

  const maxUnlocked = [6, 5, 4, 3, 2, 1].find((n) => stepUnlocked[n]) ?? 1;
  // Clamping is what makes a step RE-LOCK when its inputs stop being valid — e.g. switching to a
  // protocol with no resolvable symbols while standing on step 5 must not leave step 5 on screen.
  const activeStep = Math.min(step, maxUnlocked);
  const activeMeta = STEPS.find((s) => s.n === activeStep) ?? STEPS[0];

  // ── AUTO-ADVANCE IS DELIBERATELY NARROW ──────────────────────────────────────────────────────
  // ONLY Run → Result advances by itself, because that transition is the direct outcome of the
  // reader pressing Run. The configuration steps become satisfied silently, so advancing them
  // automatically carried the reader from step 1 to step 4 without ever showing them the structure
  // — measured on first load 2026-10-26, where a default protocol, timeframe and frozen period
  // satisfied steps 1-2 before the data had even painted. They advance on **Continue**.
  // `autoAdvanced` is what stops a manual visit to a satisfied step bouncing forward again.
  useEffect(() => {
    if (activeStep !== 5 || !hasResult) return;
    if (autoAdvanced.current.has(5)) return;
    autoAdvanced.current.add(5);
    setReached((prev) => new Set(prev).add(5));
    setStep(6);
  }, [activeStep, hasResult]);

  const goToStep = (n) => {
    if (!stepUnlocked[n]) return;
    if (n > activeStep) {
      // Moving forward past steps marks them reached — skipping over a step means accepting it, and
      // leaving it un-ticked would claim the reader never dealt with a step they walked through.
      setReached((prev) => {
        const next = new Set(prev);
        for (let i = 1; i < n; i += 1) if (stepValid[i]) next.add(i);
        return next;
      });
    } else {
      // Backward/same is "I chose to be here" — mark it so it does not push the reader on again.
      autoAdvanced.current.add(n);
    }
    setStep(n);
  };

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

      <div className="pb-steps">
        <nav className="pb-steps-rail" aria-label="Backtest steps">
          <ol>
            {STEPS.map((s) => {
              const unlocked = stepUnlocked[s.n];
              const done = stepDone(s.n);
              const state = !unlocked ? 'locked' : done ? 'done' : 'open';
              return (
                <li key={s.id} className={`pb-step-item pb-step-item--${state}`}>
                  <button
                    type="button"
                    className="pb-step-index"
                    /* ⚠️ aria-disabled, NOT `disabled`. A natively disabled button leaves the tab
                       order, so a keyboard user meets a gap where a step should be and never hears
                       why. Kept focusable, the reason is announced. */
                    aria-disabled={!unlocked || undefined}
                    aria-current={activeStep === s.n ? 'step' : undefined}
                    onClick={() => goToStep(s.n)}
                  >
                    <span className="pb-step-num" aria-hidden="true">{done ? '✓' : s.n}</span>
                    <span className="pb-step-text">
                      <span className="pb-step-label">{s.label}</span>
                      <span className="pb-step-state">
                        {state === 'locked'
                          ? `Locked — ${lockReason[s.n]}`
                          : done
                            ? 'Done'
                            : activeStep === s.n
                              ? 'In progress'
                              : 'Ready'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="pb-panel pb-step-panel" aria-labelledby="pb-step-heading">
          <header className="pb-step-panel-head">
            <span className="pb-step-panel-num" aria-hidden="true">{activeStep}</span>
            <h2 id="pb-step-heading">{activeMeta.label}</h2>
            <span className="pb-step-panel-of">
              Step {activeStep} of {STEPS.length}
            </span>
          </header>

          {activeStep === 1 && (
            <>
        <div className="pb-run-head">
          <div className="pb-subject" role="radiogroup" aria-label="What to backtest">
            <button
              type="button"
              role="radio"
              aria-checked={subject === 'protocol'}
              className={`pb-subject-btn${subject === 'protocol' ? ' pb-subject-btn--on' : ''}`}
              onClick={() => setSubject('protocol')}
            >
              Protocols (Scoring Only)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={subject === 'strategy'}
              className={`pb-subject-btn${subject === 'strategy' ? ' pb-subject-btn--on' : ''}`}
              onClick={() => setSubject('strategy')}
            >
              Complete Strategies
            </button>
          </div>

          {/* ⚠️ THE SEARCH LIVES HERE, NOT IN THE FILTER BAR, AND IT SEARCHES BOTH SUBJECTS
              (owner direction, 2026-10-25). It used to render only under Protocols, so switching
              subject made the control vanish — a field that disappears is worse than one that is
              absent, because the reader cannot tell whether the filter still applies.

              It keeps its value across the switch on purpose: a query typed against protocols is
              simply carried to strategies, and the empty-state message says which list was narrowed,
              so "no matches" can never be confused with "nothing is configured". */}
          <input
            className="ff-input pb-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              subject === 'protocol'
                ? 'Search protocols, symbols…'
                : 'Search strategies, symbols, modes…'
            }
            aria-label={
              subject === 'protocol'
                ? 'Search protocols by name, id, description or symbol'
                : 'Search strategies by name, symbol, mode or protocol'
            }
          />

          <span className="pb-count" aria-live="polite">
            {subject === 'protocol'
              ? `${filteredProtocols.length} of ${protocols.length} protocols`
              : `${filteredBots.length} of ${bots.length} strategies`}
          </span>

          {/* ⚠️ THE DIRECTION FILTER IS HERE, NOT IN A SEPARATE BAR, AND IT APPLIES TO BOTH SUBJECTS
              (owner direction, 2026-10-25). For a strategy the value is DERIVED from its protocol
              (`directionOfProtocol`) because a bot has no direction column — measured: all 40 bots
              have `protocolId` set and `shortProtocolId` null. */}
          <select
            className="ff-select pb-direction"
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            aria-label="Filter by direction mode"
          >
            <option value="">Any direction</option>
            {directionOptions.map((d) => (
              <option key={d} value={d}>{String(d).replace('_ONLY', ' only')}</option>
            ))}
          </select>

          {(query || directionFilter) && (
            <button
              type="button"
              className="ff-btn pb-clear"
              onClick={() => {
                setQuery('');
                setDirectionFilter('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        {subject === 'protocol' ? (
          <ProtocolCarousel
            items={filteredProtocols}
            value={protocolId}
            onChange={setProtocolId}
            label="Protocol"
            emptyMessage={
              query.trim()
                ? `No protocol matches “${query.trim()}”. Clear the search to see all ${protocols.length}.`
                : 'No protocols match these filters.'
            }
          />
        ) : (
          <ProtocolCarousel
            items={filteredBots}
            value={botId}
            onChange={setBotId}
            label="Strategy"
            emptyMessage={
              query.trim()
                ? `No strategy matches “${query.trim()}”. Clear the search to see all ${bots.length}.`
                : 'No trading strategies are configured.'
            }
          />
        )}
            </>
          )}

        {/* ── STEP 1 — the subject guard ────────────────────────────────────────────────────────
            ⚠️ PHYSICALLY BELOW `pb-fields` BUT RENDERED IN STEP 1. Only one step's body is mounted
            at a time, so document order and visual order are different questions here — and this
            guard belongs with the CHOICE it blocks, not with the window that has not been reached
            yet. Moving the block instead would have meant a 40-line cut for no behavioural gain. */}
        {activeStep === 1 && (
          <>
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
          </>
        )}

        {/* ── STEP 2 — instrument & window ──────────────────────────────────────────────────── */}
        {activeStep === 2 && (
        <div className="pb-fields">
          {/* ⚠️ NO SYMBOL MENU HERE — AND NO SYMBOL FIELD FOR A PROTOCOL AT ALL (owner direction,
              2026-10-26). The market is a property of the subject: a bot declares its own symbol, and
              a protocol declares a set through its watchlist or symbol assignment. A menu implied the
              Lab could measure a market the protocol was never given, which is exactly the "plausible
              score with no error" this repo keeps re-finding. For a multi-symbol protocol the PERIOD
              decides which one is measured, and the period names it. */}
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
                <span className="ff-label">Symbols (from the protocol)</span>
                {symbolPool.length === 0 ? (
                  <p className="pb-strip-item pb-strip-item--warn"><strong>none resolve</strong></p>
                ) : (
                  <p className="pb-symbol-pool" title={symbolPool.join(', ')}>
                    {symbolPool.join(' · ')}
                  </p>
                )}
                <span className="pb-field-note">
                  {symbolPool.length <= 1
                    ? 'Resolved from the protocol\u2019s watchlist or symbol assignment.'
                    : windowMode === 'period'
                      ? `The period you choose decides which of these ${symbolPool.length} is measured — each period names its own market.`
                      : `A bar-count window has no period to name a market, so it measures ${symbolPool[0]} — this protocol\u2019s first resolved symbol. Capture a period on Backtest Data to measure another.`}
                </span>
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
                    <option value="">No stored period for this protocol at this timeframe</option>
                  </select>
                  <span className="pb-field-note">
                    A stored period is what makes two runs comparable — capture one on{' '}
                    <strong>Backtest Data</strong>, or switch the Window to “Last N bars”.
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
                      {/* ⚠️ THE SYMBOL IS IN THE LABEL (2026-10-26). With the symbol menu gone, a
                          period is the only thing that names the market — so with several of a
                          protocol's symbols covered, two options reading "dev-window-v1 · 09-09 →
                          10-20" would be indistinguishable. */}
                      {p.name} · {p.symbol} · {fmtDay(p.from)} → {fmtDay(p.to)}
                      {p.name === FROZEN_WINDOW_NAME ? ' · frozen' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="ff-field">
              <label className="ff-label" htmlFor="bt-bars">Bars</label>
              {/* ⚠️ THE MINIMUM IS 100 BECAUSE THE ENGINE REFUSES FEWER. `backtest.service.ts`
                  throws "need 100+ bars" below that, so a form that accepted 30 offered a value the
                  server would always reject — measured 2026-10-26, a 60-bar run failed before it
                  started. A control must not be able to express an impossible request. */}
              <input
                id="bt-bars"
                className="ff-input"
                type="number"
                min={100}
                step={50}
                value={bars}
                onChange={(e) => setBars(Math.max(100, Number(e.target.value) || 100))}
              />
              <span className="pb-field-note">
                Walked back from the newest bar — not calendar days.
              </span>
            </div>
          )}
        </div>
        )}

        {/* ══ STEP 3 — INFORMATION SOURCES (owner direction, 2026-10-26) ═════════════════════════
            *"the News dropdown should be in a separate step. When creating that step we should
            consider other forms of information that has been setup in directives and make them each
            optional in that step."*

            ⚠️ THE INVENTORY BELOW IS MEASURED, NOT DECLARED. The five directive ids were found by
            scanning every `*.directive.ts` for `this.prisma.` or `fetch(` — they are the ONLY
            directives whose input is not the price window. Publishing a hand-written list would be a
            second source of truth that drifts the moment a directive is added.

            ⚠️ AND EACH ONE IS LABELLED WITH WHETHER THE BACKTESTER MODELS IT HISTORICALLY, because
            that is the difference between a measurement and a plausible number. The scoring path
            sets `asOf` from the bar (`protocol-gating.service.ts`: *"The evaluated candle, not the
            process clock, defines scoring time"*), so a directive that USES `asOf` is historically
            honest. Two do not:
              · `crypto-fear-greed` fetches a live API with a 1-hour cache and never reads `asOf`
              · `dilution-impact` reads a CURRENT `companyMetric` snapshot by symbol
            Those two give every historical bar TODAY's value. They are surfaced, not hidden, and
            they are not offered as a toggle: a switch the engine cannot honour is a lie. */}
        {activeStep === 3 && (
          <>
            <div className="ff-field pb-info-window">
              <label className="ff-label" htmlFor="bt-news">News days in the window</label>
              <select
                id="bt-news"
                className="ff-select"
                value={newsExclusion}
                onChange={(e) => setNewsExclusion(e.target.value)}
              >
                <option value="none">📰 Include every bar (realistic)</option>
                <option value="exclude">🚫 Skip news-day bars (protocol purity)</option>
                <option value="only">📡 News-day bars only (sensitivity)</option>
              </select>
              <span className="pb-field-note">
                A FILTER ON BARS, not a news score: bars dated on a news release are skipped or kept.
                {/* ⚠️ `reduce` WAS REMOVED HERE (2026-10-26). `backtest.service.ts` implements
                    `exclude` and `only` and nothing else — `reduce` was accepted by the type, sent
                    by the form and acted on by no code, so it read as a fourth behaviour that did
                    not exist. Re-adding it requires the engine to weight news days, not filter them. */}
                {' '}“Reduce weight” is deliberately absent — the engine has no weighting step, so it
                would have been a control that changed nothing.
              </span>
            </div>

            <h3 className="pb-info-head">Information the selected {subject === 'protocol' ? 'protocol' : 'strategy'} reads</h3>
            {externalSources.length === 0 ? (
              <p className="pb-none">
                None of this {subject === 'protocol' ? 'protocol' : 'strategy'}&rsquo;s directives read
                an outside data source — every input is the price window itself, so this run has
                nothing to caveat.
              </p>
            ) : (
              <ul className="pb-info-list">
                {externalSources.map((s) => (
                  <li key={s.id} className={`pb-info-row pb-info-row--${s.honest ? 'ok' : 'warn'}`}>
                    <div className="pb-info-row-main">
                      <strong>{s.name}</strong>
                      <span className="pb-info-badge">{s.honest ? '✓ modelled per bar' : '⚠ not modelled per bar'}</span>
                    </div>
                    <p className="pb-info-note">{s.note}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="pb-info-foot">
              Every other directive in this {subject === 'protocol' ? 'protocol' : 'strategy'} is
              computed from the bars of the window, so a backtest and a live score agree on them by
              construction. The rows above are the exceptions, and the ones marked ⚠ are the reason a
              result cannot be read as a historical replay of that directive.
            </p>
          </>
        )}

        {/* ── STEP 4 opens at the execution section below ──────────────────────────────────── */}

        {/* ── STEP 5 — the run ─────────────────────────────────────────────────────────────── */}
        {activeStep === 5 && (
          <>

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

            {/* The action sits AFTER the facts deliberately: the strip states exactly what is about
                to be measured, then the button starts it. Split into two steps, the run button used
                to live in the window step, which meant committing before the summary you were
                supposed to read. */}
            <div className="pb-run-actions">
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
          </>
        )}

      {/* ── STEP 3 — Execution Realism Panel (#50) ── */}
      {activeStep === 4 && (
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
      )}

      {/* ── a failed run is reported in the step that started it ── */}
      {activeStep === 5 && runMutation.isError && (
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


      {activeStep === 6 && stats && (
        <>
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
        </>
      )}
        {/* ── Continue ────────────────────────────────────────────────────────────────────────────
            Steps 1-3 have no action of their own — they are configuration, so "done" quietly happens
            and the reader is left with nothing to press. This is that button. It is NOT shown on
            step 5, where the Run button IS the action, or on step 6, which is terminal. */}
        {activeStep < 5 && stepValid[activeStep] && stepUnlocked[activeStep + 1] && (
          <div className="pb-step-actions">
            <button type="button" className="ff-btn ff-btn-primary" onClick={() => goToStep(activeStep + 1)}>
              Continue to step {activeStep + 1} · {STEPS[activeStep].label}
            </button>
          </div>
        )}
        </section>
      </div>
      {/* ── REFERENCE — deliberately NOT a numbered step ──────────────────────────────────────────
          (owner direction on steps, 2026-10-26.) The rail numbers a SEQUENCE; reference material is
          consulted, not sequenced. The settings inventory tells you what you CAN override *before*
          you run, and Completed runs is where two results are compared — numbering either would put
          it in a position that is wrong for the other. They stay outside the steps, always available.

          ⚠️ WHY TABS AND NOT THREE STACKED PANELS (owner report, 2026-10-22: *"the new page is
          actually a mess"*). This page had grown to NINE vertically stacked blocks. Everything was
          present and nothing was findable. One panel at a time is what makes each findable.

          ⚠️ THE CAPTURED-WINDOWS PANEL IS NOT HERE AT ALL (2026-10-22). It moved to
          `/lab/backtest-data`, the inventory of DATA: a captured period is a named, noted, imported
          window of bars, and storage management beside a measurement form is the wrong control on
          the wrong page. This page only CONSUMES periods — the step-2 Window control lists them. */}
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
        <Suspense fallback={<p className="pb-none">Loading completed runs…</p>}>
          <BacktestRunsPanel />
        </Suspense>
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
        <Suspense fallback={<p className="pb-none">Loading score detail…</p>}>
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
        </Suspense>
      )}


      {/* #819 — the replay of THIS run. Mounted here rather than as a new route: sprint #965
          item 5 names the surfaces (#819, #606) and a fourth surface is the churn it forbids. */}
      <ReplayPlayer runId={runId} />
    </div>
  );
}

