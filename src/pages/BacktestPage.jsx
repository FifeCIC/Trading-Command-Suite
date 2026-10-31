import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReplayPlayer from '../components/backtest/replay/ReplayPlayer';
import InfoNote from '../components/InfoNote';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import ProtocolCarousel from '../components/ProtocolCarousel';
/**
 * The trade table — shared by the Run step and both A/B panels (owner direction, 2026-10-29: *"more
 * trade based and show us profit loss"*). Imported STATICALLY, not lazily like its A/B siblings: it
 * is one small pure table, and the Run step renders it outside any Suspense boundary, so a lazy
 * import there would throw on first paint.
 */
import TradeTable from '../components/backtest/TradeTable.jsx';
import StopSweepPanel from '../components/backtest/StopSweepPanel.jsx';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import { getAssetType } from '../core/asset-types.js';
import { useBacktestBaseline } from '../core/use-backtest-baseline.js';
import {
  RUN_METRICS, TRADE_METRICS, compareMetrics, noComparisonReason, verdictClass,
} from '../core/backtest-compare.js';
import '../core/forms.css';
import './backtest-lab.css';

/**
 * ⚠️ THE TWO CHART COMPONENTS ARE CODE-SPLIT (2026-10-26). Not a micro-optimisation: the main chunk
 * had reached 4,189.97 kB against the PWA precache cap and the build FAILS when it is exceeded
 * (`vite.config.js` → `maximumFileSizeToCacheInBytes`). Measured the same day: adding the scoring
 * panel pushed the main chunk to **4,227.01 kB** and the build stopped with
 * `assets/index-*.js is 4.23 MB, and won't be precached`.
 *
 * ⚠️ AND THE DOCUMENTED FIX IS TO SPLIT, NOT TO RAISE THE CAP AGAIN. These two are the right things
 * to split rather than, say, the page: they are needed only on the RESULT step, and a chart library
 * is the heaviest dependency the Lab touches. Nothing on steps 1–5 needs either.
 */
const EquityCurveChart = lazy(() => import('../components/backtest/charts/EquityCurveChart'));

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
/** Step 4 of the PROTOCOLS page: the per-protocol directive editor (2026-10-27). */
const DirectiveSettingsPanel = lazy(() => import('../components/backtest/DirectiveSettingsPanel'));
/**
 * The manual A/B pair (#1143): A = the bot's realised record, B = the most recent stored run.
 * Lazy for the same reason as the three above — the main chunk sits against the PWA precache cap.
 */
const RunPanel = lazy(() =>
  import('../components/backtest/RunComparisonPanels').then((m) => ({ default: m.RunPanel })));
const RunDiffPanel = lazy(() =>
  import('../components/backtest/RunComparisonPanels').then((m) => ({ default: m.RunDiffPanel })));
/** The per-bar score table, shared with the A/B panels so a protocol run's own reading has one shape. */
const ScoreSeriesTable = lazy(() =>
  import('../components/backtest/RunComparisonPanels').then((m) => ({ default: m.ScoreTable })));

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
  { n: 1, id: 'subject', label: 'Choose the subject', labelForProtocol: 'Choose the protocol', labelForStrategy: 'Choose the strategy' },
  { n: 2, id: 'window', label: 'Instrument & window' },
  { n: 3, id: 'info', label: 'Information sources' },
  { n: 4, id: 'execution', label: 'Costs & sizing', labelForProtocol: 'Scores only' },
  // ── The four settings audits (owner direction, 2026-10-30: *"Strategy + Protocol + Directive
  // Overrides + Global Settings should all be separate steps"*). They were four stacked tables and 39
  // rows under one heading at the bottom of the Costs step, which is the stacking the owner objected
  // to. One group per step, and each step's lede says what that group decides.
  { n: 5, id: 'set-strategy', label: 'What the strategy sets' },
  { n: 6, id: 'set-protocol', label: 'What the protocol sets' },
  { n: 7, id: 'set-overrides', label: 'Directive overrides' },
  { n: 8, id: 'set-global', label: 'Global settings' },
  { n: 9, id: 'outputs', label: 'Outputs' },
  { n: 10, id: 'run', label: 'Run' },
  { n: 11, id: 'result', label: 'Result' },
];

/**
 * ⚠️ STEP NUMBERS ARE NAMED, NOT LITERAL. Inserting a step renumbers everything after it, and this
 * page once compared `activeStep === 5` / `=== 6` in twenty places — one missed literal renders the
 * Run panel on the Result step with no error. These derive from `STEPS`, so an insertion changes the
 * array and nothing else.
 */
const STEP_OUTPUTS = STEPS.find((s) => s.id === 'outputs').n;
const STEP_RUN = STEPS.find((s) => s.id === 'run').n;
const STEP_RESULT = STEPS.find((s) => s.id === 'result').n;

/**
 * The settings-audit steps, mapped to the inventory group each one renders.
 *
 * ⚠️ ORDER IS THE READER'S, NOT THE API'S. The API returns `run` first (the editable overrides), then
 * strategy, protocol, directive-override, settings. `run` is deliberately NOT a step here: those four
 * fields are the Costs form's own inputs, and echoing them as a second editable table is the
 * duplication this split removed.
 */
const SETTINGS_STEPS = [
  {
    step: STEPS.find((s) => s.id === 'set-strategy').n,
    group: 'strategy',
    title: 'What the strategy sets',
    lede: 'The bot’s own knobs — symbol, timeframe, size, mode — and whether a run reads each one.',
  },
  {
    step: STEPS.find((s) => s.id === 'set-protocol').n,
    group: 'protocol',
    title: 'What the protocol sets',
    lede: 'The values the SCORER reads for every bar of the run. These decide the signal, so they decide the trades.',
  },
  {
    step: STEPS.find((s) => s.id === 'set-overrides').n,
    group: 'directive-override',
    title: 'Directive overrides',
    lede: 'The per-protocol weights a scorer applies. ⚠️ Only one of these five fields is actually applied per protocol — the rest are inert.',
  },
  {
    step: STEPS.find((s) => s.id === 'set-global').n,
    group: 'settings',
    title: 'Global settings',
    lede: 'Every value the settings registry declares. ⚠️ None of them is read by a backtest run — they belong to the live loop, the scheduler and the log system.',
  },
];
/**
 * The result panels the reader can switch on, in the order they render.
 *
 * ⚠️ WHY THIS IS A STEP AND NOT A SET OF CHECKBOXES ON THE RESULT (owner direction, 2026-10-30:
 * *"maybe add a new step for the user to select what outputs they want"*). Two reasons that are about
 * the reader rather than tidiness:
 *   1. Choosing outputs BEFORE running means the result is what was asked for, not a wall of panels
 *      that then has to be turned down.
 *   2. The Replay panel animates and the stop screen makes an API call per run, so a run in a session
 *      of twenty should not pay for panels nobody looked at.
 *
 * `protocols: true` / `strategies: true` records which subject a panel belongs to. A protocol run
 * simulates no fills, so the trade, stop-screen, equity and replay panels would all be empty there —
 * they are not offered at all rather than offered and then explained away.
 */
const OUTPUT_OPTIONS = [
  {
    id: 'scores',
    label: 'Score series',
    strategies: true,
    protocols: true,
    hint: 'Every bar this run scored — the signal, the score and whether the bot’s own entry bar passed it. This is the READING, and it is what two protocol runs are compared on.',
  },
  {
    id: 'equity',
    label: 'Equity curve & drawdown',
    strategies: true,
    hint: 'Cumulative P&L trade by trade, with the drawdown at each point. One point per closed trade, not per bar.',
  },
  {
    id: 'trades',
    label: 'Trade list',
    strategies: true,
    hint: 'One row per closed trade with its P&L in % and in currency, the exit reason, the cycle column and the stat tiles.',
  },
  {
    id: 'stopScreen',
    label: 'Stop screen',
    strategies: true,
    hint: 'Re-reads this run’s excursions to ask how tight the stop could have been. Makes one API call per run.',
  },
  {
    id: 'replay',
    label: 'Replay',
    strategies: true,
    hint: 'Plays the run’s bars forward with its trades marked. Animation, so it is off until asked for.',
  },
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

// ── Cost profiles per asset class (#50, revised 2026-10-26) ────────────────────────────────────
/**
 * The costs the engine applies when it is not told any, mirrored from `backtest.service.ts`
 * (`isForex` / `isCrypto` branches — `slippage` / `spread` / `commission` defaults).
 *
 * ── DECISION (2026-10-26) ──
 * WHAT:      the three "💱 Forex / 📈 US Stocks / ₿ Crypto" buttons are GONE. The class is detected
 *            from the symbol instead, and each class's costs are applied until the reader edits one.
 * WHY:       the buttons were a SECOND source of truth for a decision the page can already answer —
 *            it knows the symbol. They also overwrote `accountSize` and `riskPct`, so a click that
 *            asked for a cost profile silently resized every position.
 * INSTEAD OF: keeping the buttons and marking the detected one (rejected: still two answers, and the
 *            detected one would only be decoration next to three pressable ones).
 * REVERSE BY: restoring a preset row that calls `applyClassCosts()` per key.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 92
 * GUARD:     none — 🔴 UNGUARDED.
 *
 * ⚠️ AND THE PAGE ALWAYS SENT `slippage`/`spread`/`commission`, so the engine's `??` class defaults
 * were UNREACHABLE from this form: every fresh page ran EVERY class at the stocks profile. Detecting the
 * class is also what fixes that.
 *
 * 🛑 2026-10-28 — THE STOCKS PROFILE SAID 1% EACH WAY AND WAS NOT EVEN CHARGED. Two separate faults met
 * here: the value was ~250x a real instrument (gold quotes 0.012% at the live broker), AND until #1146 the
 * engine added it as absolute price, so the "3% round trip" this screen printed was never applied. Fixing
 * only one of the two would have left either an impossible cost or a silent fiction. Both are fixed; the
 * stocks profile is now 0.10% round trip and the engine really charges percentages.
 */
const COST_PROFILES = {
  fx: {
    label: '💱 Forex',
    slippage: 0.0001,
    spread: 0.0001,
    commission: 0,
    note: 'A price fraction, like FX itself — 0.0001 is roughly a pip. Spread stands in for the broker markup.',
  },
  crypto: {
    label: '₿ Crypto',
    slippage: 0.002,
    spread: 0.001,
    commission: 0.1,
    note: 'Wider than FX and volatile; commission is charged per UNIT, which is negligible on BTC and punishing on a $1 coin.',
  },
  stock: {
    label: '📈 Stock / ETF',
    // ── DECISION (2026-10-28, primary) ──
    // WHAT:      the stock/ETF/index round trip drops from 3.00% to **0.10%** (spread 0.02% + slippage
    //            0.04% each way). See docs/SETTLED-DECISIONS.md row 97 — this object is what the page
    //            ACTUALLY sends, so changing only the engine default would have fixed nothing.
    // WHY:       measured from the live broker (MetaQuotes-Demo 2026-10-29 00:00Z): XAUUSD bid 4055.07 /
    //            ask 4055.56 = **0.0121%**; FX quotes showed spread 0. A 3% default is ~250x gold's, and
    //            it made a 1% target unwinnable (`tradeWinRate 0.0%` — every trade a loss).
    //            ⚠️ The old 1%+1% also predates #1146: costs were applied as ABSOLUTE price until then,
    //            so the "3%" was never actually charged — which is why this looked harmless for months.
    // INSTEAD OF: waiting for the owner to name a figure. The broker reports its spread; asking a human
    //            to guess what the machine already knows is the wrong source.
    // REVERSE BY: restoring 0.01 / 0.01 here and in `backtest.service.ts`. Every run still records what
    //            it used, and `spread`/`slippage` remain per-request fields.
    slippage: 0.0004,
    spread: 0.0002,
    commission: 0,
    note: 'Spread 0.02% + slippage 0.04% each way = a 0.10% round trip. The live broker quotes XAUUSD at 0.012%, so this already allows several times a liquid instrument’s spread plus slippage both ways. Raise it if you trade something wider.',
  },
};

/**
 * `/api/symbols` carries a real `type` per ticker (forex · crypto · commodity · index · etf · stock),
 * measured 2026-10-26 across 261 rows. That is DATA, so it is preferred over a guess.
 *
 * ⚠️ When a symbol is not in that table, `getAssetType()` is the fallback — and it is ITSELF a
 * hardcoded map whose own docstring says it should become a DB lookup. Its `'stock'` return means
 * "not recognised", not "verified equity", which is why the strip says so rather than claiming it.
 */
const COST_PROFILE_FOR_TYPE = {
  forex: 'fx',
  commodity: 'fx',
  crypto: 'crypto',
  index: 'stock',
  etf: 'stock',
  stock: 'stock',
};


const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

/**
 * The Lab's default news-window mode (#1138, owner direction 2026-10-26: *"Make this the default
 * for this menu"*). `exclude` keeps the protocol's own reading pure by dropping bars dated on a news
 * release, so a run measures the protocol rather than the news.
 *
 * ⚠️ This changed what a default run measures, and every run stored before it used `none` — which is
 * why `compareRuns()` now emits a `newsWarning` when the two sides differ. Changing a default is
 * cheap; changing it silently would make yesterday's results look comparable with today's.
 */
const DEFAULT_NEWS_MODE = 'exclude';

/**
 * Display labels for the two enum-like selects, used by the session change log.
 *
 * ⚠️ These are TRANSLATIONS, not behaviour — the values sent to the API stay the raw codes. A log that
 * printed `atrEqualRisk` would be readable to the engine and to nobody else.
 */
const NEWS_MODE_LABELS = {
  exclude: 'Skip news days',
  none: 'Include every bar',
  only: 'News days only',
};
/** #1155 — the session-log label for the direction control. Short, because it sits in a table cell. */
const DIRECTION_LABELS = {
  long: 'Long only',
  short: 'Short only',
  both: 'Both sides',
};
const SIZING_MODEL_LABELS = {
  fixedPercent: '% of Equity',
  fixedDollar: 'Fixed $',
  atrEqualRisk: 'ATR Equal Risk',
  kellyFull: 'Kelly (full)',
  kellyHalf: 'Kelly (half)',
};

/**
 * The engine's own floor: `BacktestService.run()` refuses a window with fewer than 100 bars. Used
 * here as the `minBars` sent to `/api/backtest/timeframe-coverage` and as the Bars input's minimum,
 * so the form and the engine cannot disagree about what is runnable.
 */
const MIN_RUN_BARS = 100;

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
const pctOrDash = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v)}%`);

/**
 * `moneyOrDash()` — currency, or an em dash.
 *
 * ⚠️ The sign goes BEFORE the symbol (`−$296.19`), not after it (`$-296.19`). Four tiles on this step
 * printed the latter: a P&L is negative far more often than not here, so the broken form was the
 * COMMON case, not the edge case.
 */
const moneyOrDash = (v) =>
  v == null
    ? '—'
    : `${v < 0 ? '−' : ''}$${Math.abs(Number(v)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Capitalise the first letter of a sentence fragment built elsewhere.
 *
 * ⚠️ The auto-accept details are written as mid-sentence clauses ("P&L moved +3.2% against A — under
 * the 10% gate") because they are reused inside different verdict sentences. Splicing one after a full
 * stop read as "This run stays B. P&L moved…" — two sentences where the second was written to be a
 * continuation. Capitalising at the join keeps the fragments reusable AND the result readable.
 */
const capFirst = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

export default function BacktestPage({ subject: fixedSubject }) {
  const queryClient = useQueryClient();

  // ── Subject ──────────────────────────────────────────────────────────────────────────────────
  /**
   * The subject is FIXED BY THE ROUTE (2026-10-26). Two pages, one subject each:
   * `/lab/backtest` = Backtesting Protocols, `/lab/backtest-strategies` = Backtest Strategies.
   * Defaulted to 'protocol' so the page is still valid if rendered without a prop.
   */
  const subject = fixedSubject === 'strategy' ? 'strategy' : 'protocol';
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
  /**
   * ── OUTPUTS (2026-10-30) ──────────────────────────────────────────────────────────────────────
   * Which result panels this page renders. Owner direction: *"Make this output an option … maybe add a
   * new step for the user to select what outputs they want."*
   *
   * Persisted in `localStorage` rather than per-render, because a mode of working that resets on
   * reload is a control the reader has to re-set every time — and unlike the search box, this is a
   * standing preference, not a transient filter.
   *
   * ⚠️ `replay` DEFAULTS OFF. It animates and fetches its own payload, so a run in a session of twenty
   * should not pay for a panel nobody opened.
   */
  const OUTPUT_STORAGE_KEY = `bt.outputs.${subject}`;
  const defaultOutputs = () => {
    const base = {};
    for (const o of OUTPUT_OPTIONS) {
      const on = subject === 'protocol' ? o.protocols === true : o.strategies === true;
      base[o.id] = Boolean(on) && o.id !== 'replay';
    }
    return base;
  };
  const [outputs, setOutputs] = useState(() => {
    try {
      const raw = window.localStorage.getItem(OUTPUT_STORAGE_KEY);
      if (!raw) return defaultOutputs();
      const saved = JSON.parse(raw);
      const base = defaultOutputs();
      for (const k of Object.keys(base)) if (typeof saved[k] === 'boolean') base[k] = saved[k];
      return base;
    } catch {
      return defaultOutputs();
    }
  });
  const setOutput = (id, on) => {
    setOutputs((prev) => {
      const next = { ...prev, [id]: on };
      try {
        window.localStorage.setItem(OUTPUT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* a private-mode quota failure must not break the page — the choice still applies this visit */
      }
      return next;
    });
  };
  const [newsExclusion, setNewsExclusion] = useState(DEFAULT_NEWS_MODE);
  /**
   * #1155 — which sides the run may open. `'long'` is the default and reproduces every run made before
   * 2026-10-31, when the trade loop was `if (signal === 'BUY' || signal === 'STRONG_BUY')` with
   * `const isLong = true` beneath it.
   */
  const [directionMode, setDirectionMode] = useState('long');

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
  const [refTab, setRefTab] = useState('current');

  // ── THE A/B BASELINE (2026-10-27) ────────────────────────────────────────────────────────────
  // A is the run the READER ACCEPTED, not "the first run" and not live performance. It is stored in
  // the DATABASE under the `backtestBaseline` settings family, scoped to the protocol, so it survives
  // a cache clear and is visible from any machine. See `use-backtest-baseline.js`.
  const baselineScope = protocolId || 'all';
  const baseline = useBacktestBaseline(baselineScope);
  const baselineRunId = baseline.runId;

  const acceptBaseline = (runIdToAccept) => {
    baseline.accept(runIdToAccept);
    setRefTab('current');
  };

  const clearBaseline = () => {
    baseline.clear();
    setRefTab('current');
  };

  /**
   * ⚠️ B MUST BE A RUN OF THE SAME PROTOCOL AS A. Measured 2026-10-27: `runs[0]` was the newest run
   * in the whole table, so a VIX baseline was paired with whichever run happened to be newest — a
   * different protocol, a different symbol, a different window. The panel then differenced them and
   * reported the (near-empty) overlap as if it were a result. Filtering by the selected protocol is
   * the minimum that makes "A vs B" a comparison at all; `RunDiffPanel` refuses a mismatched pair as
   * a second guard, because a filter is a claim about the request, not about the two payloads.
   */
  const scopeProtocolId = protocolId || null;
  const latestRunsQuery = useQuery({
    queryKey: ['bt-runs', 'latest', scopeProtocolId],
    queryFn: () =>
      // `limit: 20` because the B PINNER lists from this response — `limit=1` would offer a
      // one-item menu. `latestRunId` still reads `runs[0]`, so "latest" means the same thing.
      apiGet(
        `/api/backtest/runs?limit=20${scopeProtocolId ? `&protocolId=${encodeURIComponent(scopeProtocolId)}` : ''}`,
      ).catch(() => null),
    staleTime: 15_000,
  });
  /** A B run the reader PINNED. 
ull = follow the latest, which is the default. */
  const [pickedBId, setPickedBId] = useState(null);
  useEffect(() => {
    setPickedBId(null);
  }, [protocolId]);

  const latestRunId = (() => {
    const raw = latestRunsQuery.data;
    if (!raw) return runId || null;
    const runs = Array.isArray(raw) ? raw : (raw.runs ?? []);
    return runs[0]?.id ?? runId ?? null;
  })();
  /** The B the panels use: the pinned run when there is one, otherwise the latest. */
  const bRunId = pickedBId ?? latestRunId;

  /** One labelled line of the bot's LIVE record, so A/B comparisons do not erase the only live evidence. */
  const liveRefQuery = useQuery({
    queryKey: ['bt-bot-performance'],
    queryFn: () => apiGet('/api/trading/bot-performance').catch(() => null),
    enabled: subject === 'strategy' && Boolean(botId),
    staleTime: 60_000,
  });
  const liveReference = (() => {
    if (subject !== 'strategy' || !botId) return null;
    const bot = (liveRefQuery.data?.bots ?? []).find((b) => b.botId === botId);
    if (!bot) return null;
    const r = bot.realised ?? {};
    return `${r.samples ?? 0} closed trade(s) · win ${r.winRate == null ? '—' : `${(Number(r.winRate) * 100).toFixed(1)}%`} · expectancy ${r.expectancy ?? '—'} · total ${r.totalPnl ?? '—'} (reliability: ${r.reliability ?? '—'})`;
  })();

  /**
   * The step the reader is on. Auto-advances ONCE per step (see the effect below); `activeStep`
   * is this value clamped to the furthest unlocked step, so this can never point at a locked or
   * re-locked step.
   */
  const [step, setStep] = useState(1);
  /** Steps already auto-advanced past — so going back to re-read step 1 does not bounce forward. */
  const autoAdvanced = useRef(new Set());

  // Costs & sizing state (#50)
  //
  // 🛑 THESE INITIALISERS ARE THE COST A RUN ACTUALLY USES, and until 2026-10-28 they were `0.01 / 0.01`
  // — a 3% round trip — while `COST_PROFILES.stock.note` said 1% each way and the engine's own fallback
  // was being ignored entirely because the form always sends. Changing only the profile object left these
  // at 3%: measured on the running page, the NOTE updated to "0.10% round trip" and the break-even figure
  // beside it still printed "3.00%". One value, three homes, two of them stale.
  // See docs/SETTLED-DECISIONS.md row 97 for why 0.02% / 0.04% (broker XAUUSD quotes 0.012%).
  const [slippage, setSlippage] = useState(0.0004);
  const [spread, setSpread] = useState(0.0002);
  const [commission, setCommission] = useState(0);
  const [positionModel, setPositionModel] = useState('fixedPercent');
  const [accountSize, setAccountSize] = useState(10000);
  const [riskPct, setRiskPct] = useState(2);
  const [kellyCapPct, setKellyCapPct] = useState(25);
  const [atrPeriod, setAtrPeriod] = useState(14);
  const [atrMultiplier, setAtrMultiplier] = useState(1.5);
  /** `Fixed $` sizing needs an amount; the form never sent one and the engine fell back to $100. */
  const [fixedAmount, setFixedAmount] = useState(100);
  /**
   * `false` while the costs still follow the detected asset class. The moment the reader edits one the
   * class stops moving it — otherwise changing the symbol would silently rewrite a value they typed.
   */
  const [costsEdited, setCostsEdited] = useState(false);

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
  /**
   * ⚠️ THE SEARCH REMEMBERS ITSELF, PER SUBJECT (owner direction, 2026-10-30: *"Auto fill with the
   * previous search"*). A backtesting session is many runs in a row on the same handful of strategies,
   * so retyping the filter after every navigation is pure friction.
   *
   * Per subject, because a protocol query and a strategy query are different vocabularies — restoring
   * the wrong one would show an empty carousel that reads as "nothing is configured".
   *
   * `sessionStorage`, not `localStorage`: this is the state of the CURRENT sitting. A filter restored a
   * week later is a reader wondering why their list is short.
   */
  const queryKey = `bt.search.${subject}`;
  const [query, setQueryRaw] = useState(() => {
    try {
      return window.sessionStorage.getItem(queryKey) ?? '';
    } catch {
      // A blocked storage API must not break the page — the field simply starts empty.
      return '';
    }
  });
  const setQuery = (next) => {
    setQueryRaw(next);
    try {
      if (next) window.sessionStorage.setItem(queryKey, next);
      else window.sessionStorage.removeItem(queryKey);
    } catch {
      /* storage unavailable — the value still works for this render */
    }
  };
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

  /**
   * ⚠️ A PROTOCOL PRODUCES **SCORES**, NOT TRADES (owner direction, 2026-10-26: *"Lets make protocol
   * score only. Backtesting protocols will only generate scores. That means when we select a
   * protocol-only, the bot or financial fields are not required."*).
   *
   * ONE derived flag, used by three surfaces so they cannot disagree: the run payload sends
   * `slPct: 0 / tpPct: 0` (which makes the engine's `doBrackets` false, so no fills are simulated at
   * all), step 4 replaces its money form with the reason it has nothing to ask, and the result step
   * labels money figures as not applicable rather than printing a P&L nobody asked for.
   */
  const scoresOnly = subject === 'protocol';

  /**
   * THE CHANGES BEING TESTED — every field where this run departs from the bot's own settings.
   *
   * Owner direction, 2026-10-26: *"capture the changes that the user makes on this page and then
   * highlight those changes where applicable in the results so that the user has clarity on the
   * changes."* The engine already reports this (`drivenBy.overridden`), but only AFTER the run. This
   * is the same list BEFORE it, so the reader can see what they are about to test.
   *
   * ⚠️ AN OVERRIDE THAT MATCHES THE BOT IS NOT A CHANGE. Typing `11` into the entry bar of a bot
   * whose bar is 11 is not an experiment, and counting it as one would make every run look modified.
   */
  const botChanges = useMemo(() => {
    if (subject !== 'strategy' || !selectedBot) return [];
    const rows = [];
    const add = (label, raw, botValue, unit) => {
      if (String(raw).trim() === '') return;
      const value = Number(raw);
      if (Number.isFinite(botValue) && value === Number(botValue)) return;
      rows.push({ label, from: botValue ?? 'unset', to: raw + (unit ?? '') });
    };
    add('Entry bar (minComposite)', overrides.minComposite, selectedBot.minComposite, '%');
    add('Stop (SL)', overrides.slPct, selectedBot.slPct, '%');
    add('Target (TP)', overrides.tpPct, selectedBot.tpPct, '%');
    if (overrides.timeframe.trim() !== '' && selectedBot.timeframe
      && overrides.timeframe.trim() !== selectedBot.timeframe) {
      rows.push({ label: 'Timeframe', from: selectedBot.timeframe, to: overrides.timeframe.trim() });
    }
    return rows;
  }, [subject, selectedBot, overrides]);

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

  // ── ASSET CLASS → COST PROFILE (#50, 2026-10-26) ───────────────────────────────────────────
  // The class decides which costs model the fill, so it is looked up rather than asked for. The
  // lookup is `/api/symbols` (a real `type` column), NOT a list in this file.
  //
  // ⚠️ THREE OUTCOMES, KEPT APART ON PURPOSE: `null` = "cannot judge yet" (query in flight or
  // failed), `''` = "asked and absent from the table", and a value = answered. Collapsing them would
  // make a failed lookup render as 'stock' and apply the wrong costs while looking confident.
  const symbolsQuery = useQuery({
    queryKey: ['bt-symbols'],
    queryFn: () => apiGet('/api/symbols').catch(() => null),
    staleTime: 10 * 60_000,
  });
  const symbolClass = useMemo(() => {
    const raw = symbolsQuery.data;
    if (!raw) return null;
    const list = Array.isArray(raw) ? raw : (raw.symbols ?? []);
    const wanted = String(marketSymbol || '').toUpperCase();
    if (!wanted) return null;
    const hit = list.find((s) => String(s.ticker ?? '').toUpperCase() === wanted);
    if (hit?.type) return { type: hit.type, source: 'symbols' };
    return { type: getAssetType(wanted).toLowerCase(), source: 'assumed' };
  }, [symbolsQuery.data, marketSymbol]);

  const costProfileKey = COST_PROFILE_FOR_TYPE[symbolClass?.type] ?? 'stock';
  const costProfile = COST_PROFILES[costProfileKey];

  /**
   * The broker's MEASURED spread for the symbol this run would use (#1148).
   *
   * ⚠️ Shown beside the percent because the percent alone misleads — a 0.17-point VIX spread is 0.93%,
   * a 0.40-point US500 spread is 0.005%, and both are ordinary index CFDs. Fetching it also makes the
   * page honest about WHICH cost a run will use: the engine prefers this number over the class default.
   */
  const brokerSpreadQuery = useQuery({
    queryKey: ['broker-spread', marketSymbol],
    queryFn: () => apiGet(`/api/broker-symbols/spread?symbol=${encodeURIComponent(marketSymbol)}`),
    enabled: Boolean(marketSymbol) && !scoresOnly,
    staleTime: 60_000,
    retry: false,
  });
  const brokerSpread = brokerSpreadQuery.data ?? null;

  /**
   * ⚠️ THE COST THAT WILL ACTUALLY BE USED (#1148). The form's `spread` is only what the ENGINE receives
   * when the operator has edited it (`costsEdited`); otherwise the engine prefers the broker's measured
   * quote. Showing the fallback as "break-even" while the run silently uses 0.93% instead of 0.02% is the
   * same displayed-number-≠-used-number defect this page keeps producing — measured 2026-10-29: the step
   * read "Break-even move 0.10%" beside a broker quote of 0.93%.
   */
  const effectiveSpread = useMemo(() => {
    if (costsEdited) return spread;
    if (brokerSpread?.spreadPct != null) return brokerSpread.spreadPct / 100;
    return spread;
  }, [costsEdited, spread, brokerSpread]);
  const costSource = costsEdited
    ? 'custom'
    : brokerSpread?.spreadPct != null
      ? 'broker'
      : 'default';
  /** What the price has to travel before the trade is flat: the whole spread plus slippage each way. */
  const breakEvenPct = (effectiveSpread + slippage * 2) * 100;

  /**
   * HOW MUCH THE ACCOUNT IS COMMITTED PER TRADE, from the maths the engine actually runs.
   *
   * `fixedPercent` sizes from the STOP DISTANCE, not from the account: `risk$ ÷ (price × slPct%)`
   * units, so the committed notional is `risk$ × price ÷ (price × slPct%)` = **`accountSize ×
   * riskPct ÷ slPct`** — the price cancels. Two consequences a reader cannot see otherwise:
   *   · 2% risk on a 1% stop commits **2× the account**, not 2%.
   *   · a tight stop commits MULTIPLES of the account (0.2% stop ⇒ 10×), so "2%" is not a cap.
   *
   * ⚠️ AND BELOW ONE UNIT THE ENGINE ROUNDS UP (`if (positionSize < 1) positionSize = 1`), so an
   * expensive symbol can commit far more than this line says. Measured on a stored BTC run: £/$
   * notional ≈ 7.8× a $10,000 account, all of it from that floor — issue #1142.
   */
  const effectiveSlPct = Number(overrides.slPct) > 0
    ? Number(overrides.slPct)
    : (subject === 'strategy' && Number(selectedBot?.slPct) > 0 ? Number(selectedBot.slPct) : 1);
  const committedMultiple = positionModel === 'fixedPercent' && effectiveSlPct > 0
    ? riskPct / effectiveSlPct
    : null;

  const applyClassCosts = () => {
    setSlippage(costProfile.slippage);
    setSpread(costProfile.spread);
    setCommission(costProfile.commission);
    setCostsEdited(false);
  };

  // While the reader has not touched the costs, the detected class owns them. This is what makes a
  // forex run cost 3 pips instead of the 3% the old stocks-shaped default applied to every class.
  useEffect(() => {
    if (costsEdited || !symbolClass) return;
    setSlippage(costProfile.slippage);
    setSpread(costProfile.spread);
    setCommission(costProfile.commission);
  }, [costProfile, costsEdited, symbolClass]);

  // ── TIMEFRAME COVERAGE (#1128, restored 2026-10-26) ─────────────────────────────────────────
  // The old Protocol Backtesting page told the reader which timeframes the store actually holds;
  // the merge into this page dropped that, so the menu went back to offering all five and letting
  // the run refuse afterwards. `GET /api/backtest/timeframe-coverage` exists for exactly this and
  // had NO frontend caller — it was an orphaned ability, which is the same defect as a missing one.
  //
  // ⚠️ THE WINDOW MATTERS, so the window is sent. A symbol can hold 4,000 bars of 1h and still have
  // 40 of them inside a two-week period; asking without dates answers a different question.
  //
  // ⚠️ `minBars` IS THE ENGINE'S OWN FLOOR (100), not a second opinion. `BacktestService.run()`
  // throws below 100 bars, so a menu built on any other threshold would offer a choice the run then
  // rejects — the promise-keeping defect this endpoint was created to remove.
  const coverageWindow = usePeriod && selectedPeriod
    ? { from: fmtDay(selectedPeriod.from), to: fmtDay(selectedPeriod.to) }
    : { from: '', to: '' };
  /**
   * ── NEWS PREVIEW (2026-10-30) ────────────────────────────────────────────────────────────────
   * Owner direction: *"the panel should tell us what records there actually are for the symbol and the
   * selected period, what news actually applies and will be part of the backtest?"*
   *
   * ⚠️ WITHOUT THIS THE CONTROL IS UNFALSIFIABLE. "Skip news-day bars" is the default; when no news
   * rows exist for the symbol it filters nothing and the run is identical to "include every bar". The
   * reader would never know. Measured 2026-10-30 for VIX 5m: **5 articles across the whole history but
   * only 2 inside `dev-window-v1`** — so the honest number depends on the window, and the preview sends
   * the window rather than letting the API guess.
   */
  const newsPreviewQuery = useQuery({
    queryKey: ['bt-news-preview', marketSymbol, coverageWindow.from, coverageWindow.to],
    queryFn: () => {
      const qs = new URLSearchParams({ symbol: marketSymbol, timeframe: marketTimeframe || '5m' });
      if (coverageWindow.from) qs.set('from', coverageWindow.from);
      if (coverageWindow.to) qs.set('to', coverageWindow.to);
      return apiGet(`/api/backtest/news-preview?${qs.toString()}`);
    },
    enabled: Boolean(marketSymbol),
    staleTime: 120_000,
    retry: false,
  });
  const newsPreview = newsPreviewQuery.data ?? null;

  /** `true` when the current news mode cannot change this run — the case the panel must state. */
  const newsIsInert =
    newsPreview?.available === true && newsPreview.excludesAnything === false && newsExclusion !== 'none';

  const coverageQuery = useQuery({
    queryKey: ['bt-tf-coverage', marketSymbol, marketTimeframe, coverageWindow.from, coverageWindow.to],
    queryFn: () => {
      const qs = new URLSearchParams({ symbol: marketSymbol, minBars: String(MIN_RUN_BARS) });
      if (coverageWindow.from) qs.set('from', coverageWindow.from);
      if (coverageWindow.to) qs.set('to', coverageWindow.to);
      return apiGet(`/api/backtest/timeframe-coverage?${qs.toString()}`).catch(() => null);
    },
    enabled: Boolean(marketSymbol),
    staleTime: 120_000,
  });
  /** `timeframe -> { bars, usable }`, or null while unknown. NULL IS NOT "NO DATA" — see the render. */
  const timeframeCoverage = useMemo(() => {
    const rows = coverageQuery.data?.timeframes;
    if (!Array.isArray(rows)) return null;
    const map = {};
    for (const r of rows) map[r.timeframe] = { bars: Number(r.bars ?? 0), usable: Boolean(r.usable) };
    return map;
  }, [coverageQuery.data]);

  /**
   * Never leave an unusable timeframe selected. The protocol effect picks the protocol's
   * RECOMMENDED cadence, which is a wish, not a fact about the store — `forex-session-v1` recommends
   * 5m and the frozen window has no 5m bars for its pairs. Without this the select would show a
   * disabled option as the current value, which reads as "selected and fine".
   */
  useEffect(() => {
    if (subject !== 'protocol' || !timeframeCoverage) return;
    if (timeframeCoverage[timeframe]?.usable) return;
    const firstUsable = TIMEFRAMES.find((t) => timeframeCoverage[t]?.usable);
    if (firstUsable && firstUsable !== timeframe) setTimeframe(firstUsable);
  }, [subject, timeframeCoverage, timeframe]);

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
    /**
     * ⚠️ PRESSING RUN ALWAYS EARNS THE ADVANCE (found 2026-10-30 by walking the page by hand).
     *
     * The auto-advance effect skips a step already in `autoAdvanced` — which is right for a step the
     * reader deliberately revisited, and wrong for the Run step the moment they press Run. Opening the
     * Run step from the RAIL marks it (that is the "I chose to be here" branch), so a run started from
     * there finished, stored, and left the page sitting on Run with step 11 reading "Ready" and no
     * error anywhere. Reaching the same step via **Continue** did not mark it, so the same button
     * behaved differently depending on how the reader arrived.
     */
    onMutate: () => {
      autoAdvanced.current.delete(STEP_RUN);
    },
    mutationFn: () => {
      // ⚠️ A PROTOCOL PRODUCES SCORES, NOT TRADES (owner direction, 2026-10-26: *"Lets make protocol
      // score only. Backtesting protocols will only generate scores."*).
      //
      // `slPct`/`tpPct` of 0 make `doBrackets` FALSE in `backtest.service.ts` (`slPct > 0 && tpPct >
      // 0`), so the engine records entry signals and forward returns and simulates NO trades — which
      // is exactly what "scores only" means. Sending the money fields would have simulated fills at
      // a size and cost that no bot owns, then printed them beside the scores.
      //
      // ⚠️ AND IT IS NOT COSMETIC: a protocol run made before this sent the form's costs and produced
      // bracketed trades. `compareRuns()` will now see 0 trades on one side, which its sample bar
      // reports honestly rather than silently averaging two different things.
      const execution = scoresOnly
        // A protocol run opens no positions at all, so the sides it may open is meaningless — but it is
        // still sent, because a scores-only run computes `wasProfitable` per signal and a SHORT
        // protocol's forward returns must be judged in the direction it would have traded (#1155).
        ? { newsExclusion, directionMode, slPct: 0, tpPct: 0 }
        : {
          newsExclusion,
          directionMode,
          /**
           * ── DECISION (2026-10-28, primary) ──
           * WHAT:      `slippage`/`spread` are sent ONLY when the operator has edited them
           *            (`costsEdited`). Otherwise the engine resolves them itself — broker-measured
           *            first, asset-class default second.
           * WHY:       this form previously ALWAYS sent its own literals, which made the engine's
           *            defaults unreachable and would have made the broker-measured spread (#1147)
           *            unreachable too. Measured 2026-10-28: the Costs step showed "0.10% round trip"
           *            while the page still posted 3%, because one value lived in three places.
           *            ⚠️ Sending a guessed number over a measured one is the defect, not the fix.
           * INSTEAD OF: a per-symbol lookup in the browser, which would duplicate the route resolution
           *            the engine already performs (`symbol_route` → `broker_symbol.spreadPct`).
           * REVERSE BY: always sending `slippage`/`spread` again — the fields still work per request.
           * REGISTER:  docs/SETTLED-DECISIONS.md row 97
           * GUARD:     the record on every run (`execution.spread`, `execution.slippage`) shows what was
           *            actually used, so a silent revert is visible in the stored row.
           */
          ...(costsEdited ? { slippage, spread } : {}),
          commission,
          positionModel,
          accountSize,
          riskPct,
          fixedAmount,
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
      // ⚠️ STOPS AND TARGETS ARE A STRATEGY'S BUSINESS. A protocol has no bracket to place, so an
      // SL override on a protocol run would be a control that changes nothing (the very defect the
      // news menu's removed `reduce` option was).
      if (!scoresOnly && overrides.slPct.trim() !== '') runOverrides.slPct = Number(overrides.slPct);
      if (!scoresOnly && overrides.tpPct.trim() !== '') runOverrides.tpPct = Number(overrides.tpPct);
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

  // ── MODES (2026-10-30) ─────────────────────────────────────────────────────────────────────────
  /**
   * Owner direction: *"Create modes. The first Modes will be Normal and Auto-Accept (if there is an
   * improvement in the profit we auto apply Run B and that gets stored as Run A)."*
   *
   * Plus the caution, in the same message: *"I'm just a bit concerned that a small improvement is luck
   * and we might need some caution."* That caution is why this mode has TWO GATES and both are declared
   * settings (`backtest.autoAcceptMinPnlImprovePct`, `backtest.autoAcceptMinTrades`) rather than
   * constants inside this component.
   *
   * 🛑 WHAT AUTO-ACCEPT DOES **NOT** DO: it never writes to `trading_strategy`. It moves the REFERENCE
   * (the `backtest.baseline.<scope>.runId` setting) and nothing else. Applying a tested configuration
   * to the live bot is a separate, explicit action and is NOT BUILT — see the note in the Modes panel.
   */
  const MODE_STORAGE_KEY = 'bt.mode';
  const [mode, setModeState] = useState(() => {
    try {
      return window.localStorage.getItem(MODE_STORAGE_KEY) === 'auto' ? 'auto' : 'normal';
    } catch {
      return 'normal';
    }
  });
  const setMode = (next) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* the mode still applies this visit */
    }
  };

  /**
   * The two gates, read from the settings registry so the threshold a promotion had to clear is a
   * number the owner can change — and one this panel can PRINT, because a gate whose value is not
   * shown cannot be checked.
   *
   * ⚠️ A failed read falls back to the DECLARED defaults and says so (`settingsSource`). Silently
   * substituting 10 / 30 would make an unreadable registry look like a configured one.
   */
  const settingsQuery = useQuery({
    queryKey: ['settings-registry'],
    queryFn: () => apiGet('/api/system/settings/registry').catch(() => null),
    staleTime: 300_000,
    // Read whenever the mode panel could be shown; ctiveStep is declared later in this component, so\n    // this cannot reference it without a use-before-define.\n    enabled: true,
  });
  const autoAcceptGates = useMemo(() => {
    const rows = settingsQuery.data?.settings;
    const find = (k) => (Array.isArray(rows) ? rows.find((s) => s.key === k)?.value : undefined);
    const minImprove = Number(find('backtest.autoAcceptMinPnlImprovePct'));
    const minTrades = Number(find('backtest.autoAcceptMinTrades'));
    return {
      minImprovePct: Number.isFinite(minImprove) ? minImprove : 10,
      minTrades: Number.isFinite(minTrades) ? minTrades : 30,
      source: Number.isFinite(minImprove) && Number.isFinite(minTrades)
        ? 'settings'
        : settingsQuery.isError
          ? 'defaults (the settings registry could not be read)'
          : 'defaults (not yet read)',
    };
  }, [settingsQuery.data, settingsQuery.isError]);

  /**
   * ── WHAT WE COMPARE AGAINST (2026-10-30) ──────────────────────────────────────────────────────
   * Owner direction: *"style these boxes with a colour to indicate improvement or not: based on the
   * previous test if one was done for that strategy."*
   *
   * ⚠️ THE ACCEPTED BASELINE WINS WHEN THERE IS ONE. In Auto-Accept mode A becomes the accumulated best,
   * so "improvement" has to mean "against A" — comparing against the immediately previous run would
   * flip the border back to red on the run after a promotion, which is backwards. With no baseline,
   * the most recent earlier run of the same protocol is used, which is the literal reading of the ask.
   */
  const runsList = useMemo(() => {
    const raw = latestRunsQuery.data;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : (raw.runs ?? []);
  }, [latestRunsQuery.data]);

  const previousRunId = useMemo(() => {
    if (!runId) return null;
    const prior = runsList.filter((r) => r.id !== runId);
    return prior[0]?.id ?? null;
  }, [runsList, runId]);

  const isComparingToBaseline = Boolean(baselineRunId && baselineRunId !== runId);
  const comparisonRunId = isComparingToBaseline ? baselineRunId : previousRunId;

  const comparisonQuery = useQuery({
    queryKey: ['backtest-result', comparisonRunId],
    queryFn: () => apiGet(`/api/backtest/results/${comparisonRunId}`),
    enabled: Boolean(comparisonRunId && runId && comparisonRunId !== runId),
    refetchInterval: false,
    retry: false,
  });

  /**
   * The verdicts, or `null` when there is nothing to compare with.
   *
   * ⚠️ A DIFFERENT PROTOCOL IS NOT A COMPARISON — the same guard `RunDiffPanel` applies, for the same
   * reason: two protocols score different directives against different symbols, so one being "better"
   * than the other is not a statement about a change anyone made.
   */
  const comparison = useMemo(() => {
    const prev = comparisonQuery.data;
    if (!comparisonRunId || !prev || !stats) return null;
    const protoA = prev.protocolId;
    const protoB = result?.protocolId;
    if (protoA && protoB && protoA !== protoB) {
      return {
        verdicts: {},
        tradeVerdicts: {},
        reason: `the comparison run is a different protocol (${protoA} vs ${protoB}), so its numbers are not a change to this one`,
      };
    }
    /**
     * ⚠️ A DIFFERENT WINDOW IS NOT A CHANGE EITHER. Two runs on different windows are two unrelated
     * measurements printed next to each other — the rule this page already states in the window
     * popover, applied here to the borders. Measured while building this: the newest stored run
     * measured `dev-window-v1` while a quick verification run measured "last 300 bars", and without
     * this guard the quick run's boxes would have been painted green for scoring fewer bars.
     */
    const windowA = prev.measuredPeriod?.name ?? null;
    const windowB = result?.measuredPeriod?.name ?? null;
    if (windowA !== windowB) {
      return {
        verdicts: {},
        tradeVerdicts: {},
        reason: `the comparison run measured ${windowA ? `the period “${windowA}”` : 'a day-range window'} and this one measured ${windowB ? `“${windowB}”` : 'a day range'} — different windows are two measurements, not a change`,
      };
    }
    const barsA = prev.scoreSeries?.length ?? null;
    const barsB = result?.scoreSeries?.length ?? null;
    const label = `run ${String(comparisonRunId).slice(0, 8)}${isComparingToBaseline ? ' — the accepted A' : ' — the previous run'}`
      // The bar counts travel in the label because a window can keep its name while its data grows.
      + (barsA != null && barsB != null ? ` (${barsA.toLocaleString()} vs ${barsB.toLocaleString()} bars scored)` : '');
    return {
      verdicts: compareMetrics(RUN_METRICS, prev.stats, stats),
      tradeVerdicts: compareMetrics(TRADE_METRICS, prev.tradeTotals, result?.tradeTotals),
      label,
      prevPnl: prev.stats?.totalPnl ?? null,
      prevTrades: prev.tradeTotals?.count ?? null,
    };
  }, [comparisonRunId, comparisonQuery.data, stats, result, isComparingToBaseline]);

  /**
   * `true` only when there is a REAL comparison — both runs comparable and a label naming which one.
   * The memo below returns a `reason` object with no label for an incomparable pair, so testing the
   * object itself is not enough (measured 2026-10-30: "…better / worse than . The figure itself…").
   */
  const hasComparison = Boolean(comparison?.label);

  const comparisonReason = comparison?.reason
    ?? noComparisonReason({
      previousRunId: comparisonRunId,
      previousRunMissing: comparisonQuery.isError && comparisonQuery.error?.status === 404,
      incomparable: null,
    });

  // ── AUTO-ACCEPT (2026-10-30) ───────────────────────────────────────────────────────────────────
  /**
   * Promotes the run to A when it clears BOTH gates. Nothing here writes to the strategy.
   *
   * ⚠️ RUN ONCE PER RUN. The effect re-runs on every render that touches its dependencies, so without
   * a guard it would call `baseline.accept()` repeatedly — each call a settings write, and each write
   * a mutation. `autoHandled` keys on the run id, which is the thing being decided about.
   */
  const autoHandled = useRef(new Set());
  const [autoOutcome, setAutoOutcome] = useState(null);

  useEffect(() => {
    if (mode !== 'auto' || !stats || !runId) return;
    if (autoHandled.current.has(runId)) return;
    // The comparison payload is the thing being judged; without it there is nothing to decide yet.
    if (comparisonRunId && comparisonRunId !== runId && !comparison && !comparisonQuery.isError) return;

    const trades = result?.tradeTotals?.count ?? 0;
    const pnl = stats.totalPnl ?? null;
    const gateTrades = autoAcceptGates.minTrades;
    const gateImprove = autoAcceptGates.minImprovePct;

    const decide = (verdict, detail) => {
      autoHandled.current.add(runId);
      setAutoOutcome({ runId, verdict, detail });
    };

    // A first run has nothing to beat. It becomes A so the NEXT run has a reference — and says so,
    // because "auto-accepted" with no comparison would otherwise read as a measured improvement.
    if (!comparisonRunId) {
      if (trades < gateTrades) {
        decide('skipped', `no baseline to beat, and ${trades} trade(s) is under the ${gateTrades}-trade gate — left as B`);
        return;
      }
      acceptBaseline(runId);
      decide('accepted-first', `first run for this protocol — became A with no comparison (${trades} trades)`);
      return;
    }

    if (comparisonQuery.isError) {
      decide('skipped', `could not read the comparison run, so nothing was judged${comparisonQuery.error?.status === 404 ? ' — it was deleted' : ''}`);
      return;
    }
    if (comparison?.reason) {
      // ⚠️ SHORT HERE, LONG IN THE COMPARISON NOTE (2026-10-30). The reason is a full sentence and it
      // was being printed twice within 40 pixels — once as the comparison's caption and again inside
      // this decision. One fact, one home: the note about comparing carries why comparing is not
      // possible; this note records only that the decision therefore could not be made.
      decide('skipped', 'no comparable run to judge — the comparison note above says why');
      return;
    }

    if (trades < gateTrades) {
      decide('skipped', `${trades} closed trade(s) is under the ${gateTrades}-trade gate — a total on that sample is noise`);
      return;
    }
    if (pnl == null || comparison?.prevPnl == null) {
      decide('skipped', 'one of the two runs has no total P&L recorded, so the improvement cannot be measured');
      return;
    }

    const prev = Number(comparison.prevPnl);
    const next = Number(pnl);
    // ⚠️ RELATIVE, AND SIGN-AWARE. A baseline of −100 improving to −90 is a 10% improvement in
    // magnitude, not a loss of 10%. Dividing by a NEGATIVE baseline without taking its magnitude
    // inverts the verdict — the 22.9%-win-rate run would have been "accepted" for getting worse.
    let improvementPct;
    if (prev === 0) improvementPct = next > 0 ? Infinity : 0;
    else improvementPct = ((next - prev) / Math.abs(prev)) * 100;

    if (!(improvementPct >= gateImprove)) {
      decide('skipped', `P&L moved ${improvementPct >= 0 ? '+' : ''}${improvementPct.toFixed(1)}% against A — under the ${gateImprove}% improvement gate`);
      return;
    }

    acceptBaseline(runId);
    decide('accepted', `P&L improved ${improvementPct === Infinity ? 'from zero to positive' : `+${improvementPct.toFixed(1)}%`} against A over ${trades} trades — became the new A`);
    // `acceptBaseline` and `comparison` are stable enough for a once-per-run decision; the run id is
    // the guard that actually matters, and it is in `autoHandled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, stats, runId, comparisonRunId, comparison, comparisonQuery.isError, autoAcceptGates, result]);

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
  const windowReady = usePeriod ? Boolean(selectedPeriod) : bars >= MIN_RUN_BARS;
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
  /**
   * `stepValid` = the VALUES for this step are usable. It governs whether the next step may be
   * entered, because an invalid step would let the reader assemble a run the engine must refuse.
   *
   * ⚠️ DERIVED FROM `STEPS`, NOT LISTED (2026-10-30). It was a literal map of seven keys, so inserting
   * four steps meant four more keys and any omission silently made a step unenterable. Now every step
   * gets a verdict by rule:
   *   · step 1 is the subject, so it is valid exactly when a runnable subject is chosen;
   *   · the Result step is valid exactly when a result exists;
   *   · everything between needs a subject and a resolvable window. **Information sources, Outputs and
   *     the four settings audits need no decision at all** — they arrive with defensible defaults, so
   *     they are steps because their READING matters, not because they need an answer.
   */
  const stepValid = useMemo(() => {
    const out = {};
    for (const s of STEPS) {
      if (s.n === 1) out[s.n] = canRunBool;
      else if (s.n === STEP_RESULT) out[s.n] = hasResult;
      else out[s.n] = canRunBool && instrumentReady;
    }
    return out;
  }, [canRunBool, instrumentReady, hasResult]);

  const stepUnlocked = useMemo(() => {
    const out = {};
    for (const s of STEPS) {
      // ⚠️ The RESULT step is unlocked by the RESULT, not by the Run step being enterable — the Run
      // step is valid before anything has been run, which made "Result" read Ready with no result.
      out[s.n] = s.n === 1
        ? true
        : s.n === STEP_RESULT
          ? stepValid[STEP_RESULT]
          : stepValid[1] && stepValid[2];
    }
    return out;
  }, [stepValid]);

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

  // ⚠️ A TICK BELONGS TO THE SUBJECT THAT EARNED IT. Changing what is being measured invalidates
  // every configuration step below step 1, so the ticks clear with it — otherwise the rail reads
  // "✓ Instrument & window Done" beside "Finish step 2 first" for a protocol whose window does not
  // resolve. Measured 2026-10-26 by switching BTC → USDJPY Risk-Pair V1 on step 4: the ✓ survived a
  // subject that could not satisfy it.
  const subjectKey = subject === 'strategy'
    ? `strategy:${selectedBot?.id ?? ''}`
    : `protocol:${selectedProtocol?.id ?? ''}`;
  useEffect(() => {
    setReached(new Set());
    autoAdvanced.current.clear();
  }, [subjectKey]);

  // Lock reasons name the ACTUAL unmet condition. "Complete the previous step" would be true
  // and useless; "this protocol resolves no symbols" is the thing the reader has to fix.
  /**
   * Lock reasons name the ACTUAL unmet condition. "Complete the previous step" would be true and
   * useless; "this protocol resolves no symbols" is the thing the reader has to fix.
   *
   * ⚠️ ONE RULE FOR EVERY STEP AFTER THE SECOND (2026-10-30). It was a literal map keyed 2–7, so the
   * four new settings steps had no entry and a locked step rendered "Locked — undefined". Every step
   * from 3 onward is gated by the same condition, so the reason is computed rather than listed.
   */
  const lockReasonFor = (n) => {
    if (n === 2) {
      return subject === 'strategy' && blockedByActiveBot
        // ⚠️ NAMED SEPARATELY. `blockedByActiveBot` also makes `canRun` false, so this case fell into
        // "Pick a strategy in step 1" — a reason naming a condition the reader has already satisfied,
        // on a card that is visibly selected.
        ? `${selectedBot?.name ?? 'This strategy'} is ACTIVE — pause it before backtesting`
        : !canRun
          ? `Pick a ${subject === 'protocol' ? 'protocol' : 'strategy'} in step 1`
          : subject === 'protocol' && (selectedProtocol?.resolvedSymbols ?? []).length === 0
            ? 'This protocol resolves no symbols — wire a watchlist or a symbol assignment'
            : 'Complete step 1';
    }
    if (n === STEP_RESULT) return 'Available once a run has completed';
    return 'Finish step 2 first';
  };

  /**
   * ⚠️ THIS ARRAY IS THE LAST STEP NUMBER AND IT IS NOT DERIVED — it was `[6, 5, 4, 3, 2, 1]` after the
   * Outputs step was inserted, so `stepUnlocked[7]` was never consulted and the Result step could not
   * open however complete the run was. Measured 2026-10-30: a finished 1,027-trade run left the page on
   * the Run step with a full result payload already in hand and no error anywhere.
   *
   * Derived now, so a future step cannot be half-added again.
   */
  const maxUnlocked = [...STEPS].reverse().map((s) => s.n).find((n) => stepUnlocked[n]) ?? 1;
  // Clamping is what makes a step RE-LOCK when its inputs stop being valid — e.g. switching to a
  // protocol with no resolvable symbols while standing on step 5 must not leave step 5 on screen.
  const activeStep = Math.min(step, maxUnlocked);
  const activeMeta = STEPS.find((s) => s.n === activeStep) ?? STEPS[0];

  // ── THE SESSION'S CHANGES ────────────────────────────────────────────────────────────────────
  /**
   * Owner direction, 2026-10-30: *"explore a method of presenting the previous value before the most
   * recent change so the user can track the changes made during the backtesting session … we should
   * frame it as a session because users will probably test many times in a row"*, and for step 5:
   * *"remind us of our selections and maybe even list the changes made and show the two values, old
   * and new."*
   *
   * ⚠️ DERIVED BY DIFFING A SNAPSHOT, NOT BY WRAPPING THE SETTERS. A wrapped setter only records the
   * call sites somebody remembered to wrap, so the next control added records nothing — a gap that is
   * invisible by construction. One diff over this declared list cannot miss a change to a listed
   * field, and adding a row here is the only way to track a new one.
   *
   * ⚠️ A FIELD MUST BE IN USE TO BE TRACKED. `Fixed $` while the model is `% of Equity` is not a
   * change to what the run does; logging it would report movement in a value the engine ignores.
   * The same test applies to the ATR and Kelly fields.
   *
   * ⚠️ `null` MEANS "NOT YET KNOWN", AND IT IS NOT A CHANGE. The protocol and bot lists load
   * asynchronously, so on first paint the subject has no name. A row whose value is null is left out
   * of the baseline entirely, so the default subject arriving is not logged as something the reader
   * did — and when it later changes from a real name to another real name, that is.
   */
  const sessionTracked = [
    {
      label: 'Subject',
      step: 1,
      value: subject === 'protocol'
        ? (selectedProtocol?.name ?? null)
        : (selectedBot?.name ?? null),
    },
    {
      label: 'Direction',
      step: 1,
      value: directionFilter ? String(directionFilter).replace('_ONLY', ' only') : 'Any direction',
    },
    // ⚠️ DERIVED FOR BOTH SUBJECTS (measured 2026-10-30 on the protocols route). A strategy's timeframe
    // is the bot's own cadence, and a protocol's is chosen FOR the reader from
    // (recommendedTimeframe) — so on first load the form, not the reader, made this decision. Logging it
    // reported two changes nobody had made. A change the reader DOES make still logs; only the settle
    // window absorbs the form's own work.
    { label: 'Timeframe', step: 2, derived: true, value: marketTimeframe || null },
    {
      label: 'Window',
      step: 2,
      // The stored period is filtered to the timeframe, which is itself auto-chosen — so the default
      // period is the form's pick too. Same rule as the timeframe above.
      derived: true,
      value: usePeriod
        ? (selectedPeriod?.name ?? `period (none stored for ${marketTimeframe || '—'})`)
        : `last ${bars} bars`,
    },
    { label: 'News filter', step: 3, value: NEWS_MODE_LABELS[newsExclusion] ?? newsExclusion },
    { label: 'Sides', step: 3, value: DIRECTION_LABELS[directionMode] ?? directionMode },
    // The trade shape and the money only exist for a strategy. A protocol run simulates no fills,
    // so every row below would be a value nothing reads.
    ...(subject === 'strategy' ? [
      { label: 'Stop (SL)', step: 4, derived: true, value: `${Number(effectiveSlPct).toFixed(2)}%` },
      {
        label: 'Target (TP)',
        step: 4,
        derived: true,
        value: Number(overrides.tpPct) > 0
          ? `${Number(overrides.tpPct).toFixed(2)}%`
          : (Number(selectedBot?.tpPct) > 0 ? `${Number(selectedBot.tpPct).toFixed(2)}%` : null),
      },
      {
        label: 'Entry bar',
        step: 4,
        derived: true,
        value: overrides.minComposite.trim() !== ''
          ? `${overrides.minComposite}%`
          : (selectedBot?.minComposite != null ? `${selectedBot.minComposite}%` : null),
      },
      { label: 'Spread', step: 4, derived: true, value: `${(spread * 100).toFixed(3)}%` },
      { label: 'Slippage', step: 4, derived: true, value: `${(slippage * 100).toFixed(3)}%` },
      { label: 'Commission', step: 4, derived: true, value: `$${Number(commission).toFixed(2)}` },
      { label: 'Sizing model', step: 4, derived: true, value: SIZING_MODEL_LABELS[positionModel] ?? positionModel },
      ...(positionModel === 'fixedPercent' ? [
        { label: 'Account size', step: 4, derived: true, value: `$${accountSize.toLocaleString()}` },
        { label: 'Risk %', step: 4, derived: true, value: `${riskPct}%` },
      ] : []),
      ...(positionModel === 'fixedDollar' ? [
        { label: 'Fixed $', step: 4, derived: true, value: `$${fixedAmount}` },
      ] : []),
      ...(positionModel === 'kellyFull' || positionModel === 'kellyHalf' ? [
        { label: 'Kelly cap', step: 4, derived: true, value: `${kellyCapPct}%` },
      ] : []),
      ...(positionModel === 'atrEqualRisk' ? [
        { label: 'ATR multiplier', step: 4, derived: true, value: `${atrMultiplier}×` },
        { label: 'ATR period', step: 4, derived: true, value: String(atrPeriod) },
      ] : []),
    ] : []),
  ].filter((r) => r.value != null);

  /**
   * ⚠️ HOW MANY DEBOUNCE TICKS A SUBJECT SWITCH KEEPS ITS DERIVED VALUES QUIET.
   *
   * The bug: half the tracked rows are not values the reader types — they are values the FORM derives
   * from the chosen bot (stop, target, entry bar, spread, slippage, commission, sizing). Changing the
   * subject re-derives them, but in LATER renders than the subject itself, because the bot list is a
   * separate query and the cost class follows the symbol. So one subject switch was logged once, and
   * then — one or two ticks later — six derived values were logged as though the reader had edited
   * each one.
   *
   * Owner report, 2026-10-30: *"This table is suggesting everything changed … I certainly never
   * changed so many different values."*
   *
   * THE FIX: a derived row is never reported while the switch is SETTLING. Settling is counted in
   * ticks, not seconds — a wall-clock window is a guess about how long a query takes and would report
   * the same phantom rows on a slow machine.
   */
  const SUBJECT_SETTLE_TICKS = 6;
  const SESSION_LOG_LIMIT = 25;
  const [sessionLog, setSessionLog] = useState([]);
  const sessionBaseline = useRef(null);
  const sessionTimer = useRef(null);
  /**
   * Ticks since the form was last (re)established — a subject change, or the first load.
   *
   * ⚠️ IT STARTS AT 0, NOT AT `null` (measured 2026-10-30, immediately after this shipped). `null` meant
   * "settled", so a FRESH PAGE LOAD had no settle window at all: `spread`/`slippage` initialise to their
   * defaults, the detected asset class rewrites them a moment later, and the log reported three
   * "changes" before the reader had touched anything. **A first load is a settle** — the subject, the
   * bot list and the cost class all arrive asynchronously, in different ticks.
   */
  const settleTicks = useRef(0);
  const sessionSignature = sessionTracked.map((r) => `${r.label}=${r.value}`).join('|');

  useEffect(() => {
    // ⚠️ DEBOUNCED, because several of these are typed values. Entering `2.5` into a stop would
    // otherwise log three changes (`2`, `2.`, `2.5`) and the panel would read as a keystroke trace
    // rather than a record of decisions.
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      const before = sessionBaseline.current;
      const nowRows = new Map(sessionTracked.map((r) => [r.label, r.value]));

      if (before === null) {
        sessionBaseline.current = nowRows;
        return;
      }

      const subjectChanged = before.has('Subject')
        && nowRows.has('Subject')
        && before.get('Subject') !== nowRows.get('Subject');
      if (subjectChanged) settleTicks.current = 0;
      else settleTicks.current += 1;

      const settling = settleTicks.current <= SUBJECT_SETTLE_TICKS;

      const changed = [];
      for (const row of sessionTracked) {
        if (!before.has(row.label)) continue;              // appeared with the subject; not a decision
        if (before.get(row.label) === row.value) continue;
        // Fallout from a subject switch that has not settled yet — re-baseline, do not report.
        if (row.derived && settling) continue;
        changed.push({
          label: row.label,
          step: row.step,
          from: before.get(row.label),
          to: row.value,
          at: Date.now(),
        });
      }

      sessionBaseline.current = nowRows;

      // ⚠️ A SUBJECT SWITCH IS ONE CHANGE, NOT SEVEN. Its row is `derived: false`, so it survives the
      // settle filter while everything the form re-derived from it is absorbed.
      if (changed.length) setSessionLog((rows) => [...changed.reverse(), ...rows].slice(0, SESSION_LOG_LIMIT));
    }, 600);
    return () => clearTimeout(sessionTimer.current);
    // `sessionSignature` IS the dependency: it is the value of every tracked field serialised, so it
    // changes exactly when one of them does. Listing the 20 fields instead would re-run this effect
    // for unrelated renders and reset the debounce mid-type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionSignature]);

  /**
   * How many session changes touch each step, for the rail badge.
   *
   * ⚠️ THIS IS THE ANSWER TO "did I change something?" FROM ANYWHERE ON THE PAGE, and it is why the
   * previous value does NOT need to be printed under every field. The owner's complaint is density;
   * a per-field "← was 2.00%" adds a line of text to every control the reader touches, while a badge
   * on the rail adds at most a few characters and points at the one table that holds them all.
   */
  const sessionChangeCounts = useMemo(() => {
    const counts = {};
    for (const r of sessionLog) counts[r.step] = (counts[r.step] ?? 0) + 1;
    return counts;
  }, [sessionLog]);

  // ── AUTO-ADVANCE IS DELIBERATELY NARROW ──────────────────────────────────────────────────────
  // ONLY Run → Result advances by itself, because that transition is the direct outcome of the
  // reader pressing Run. The configuration steps become satisfied silently, so advancing them
  // automatically carried the reader from step 1 to step 4 without ever showing them the structure
  // — measured on first load 2026-10-26, where a default protocol, timeframe and frozen period
  // satisfied steps 1-2 before the data had even painted. They advance on **Continue**.
  // `autoAdvanced` is what stops a manual visit to a satisfied step bouncing forward again.
  useEffect(() => {
    if (activeStep !== STEP_RUN || !hasResult) return;
    if (autoAdvanced.current.has(STEP_RUN)) return;
    autoAdvanced.current.add(STEP_RUN);
    setReached((prev) => new Set(prev).add(STEP_RUN));
    setStep(STEP_RESULT);
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
          {subject === 'protocol' ? 'Backtesting Protocols' : 'Backtest Strategies'}
          <PageInfoPopover label="What the Backtest Lab does">
            <strong>One subject, one window, one stored run — so two runs can be compared.</strong>
            <br />
            Pick a <strong>protocol</strong> (scores only) or a <strong>strategy</strong> (scores plus
            execution), choose a window, and run. Every run is stored, and any two can be compared on
            the <strong>Completed Runs</strong> page in this area.
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
                      <span className="pb-step-label">
                        {subject === 'protocol'
                          ? (s.labelForProtocol ?? s.label)
                          : (s.labelForStrategy ?? s.label)}
                      </span>
                      <span className="pb-step-state">
                        {state === 'locked'
                          ? `Locked — ${lockReasonFor(s.n)}`
                          : done
                            ? 'Done'
                            : activeStep === s.n
                              ? 'In progress'
                              : 'Ready'}
                        {/* A change marker, not a second state: the step can be Ready AND changed.
                            Rendered after the state so the reading order stays "what is this step
                            doing", then "you altered it this session". */}
                        {sessionChangeCounts[s.n] > 0 && (
                          <span className="pb-step-changed">
                            {' '}· {sessionChangeCounts[s.n]} change{sessionChangeCounts[s.n] === 1 ? '' : 's'}
                          </span>
                        )}
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
            <h2 id="pb-step-heading">
              {subject === 'protocol'
                ? (activeMeta.labelForProtocol ?? activeMeta.label)
                : (activeMeta.labelForStrategy ?? activeMeta.label)}
            </h2>
            {/* ⚠️ THE "STEP 6 OF 6" COUNTER IS GONE (owner direction, 2026-10-30: *"Remove these step
                labels they're just extra we don't need cluttering the screen"*). The rail beside this
                panel already shows every step, its number and its state — the counter restated one row
                of it. The captured-period detail MOVED HERE as the header's ℹ, which is the space the
                counter was using. */}
            {result?.measuredPeriod && (
              <PageInfoPopover label="Captured period">
                <strong>{result.measuredPeriod.name}</strong>
                {result.measuredPeriod.note ? <> — {result.measuredPeriod.note}</> : null}
                <br />
                {result.measuredPeriod.from} → {result.measuredPeriod.to}
                {result.measuredPeriod.bars != null
                  ? ` · ${result.measuredPeriod.bars.toLocaleString()} bars imported`
                  : ' · bar count not recorded'}
                <br />
                <br />
                A captured period is a <strong>named, frozen window</strong>, versioned rather than
                edited so that work done today is measured on the same bars as work done last week.
                Moving it silently invalidates every earlier comparison.
                {result.measuredPeriod.bars == null && (
                  <>
                    <br />
                    <br />
                    ⚠️ <strong>The bar count was not recorded</strong> on this run. That is missing
                    data, not a window of zero bars — re-run it to capture the count.
                  </>
                )}
              </PageInfoPopover>
            )}
          </header>

          {activeStep === 1 && (
            <>
        <div className="pb-run-head">
          

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

          {/* ⚠️ THE "40 of 40 strategies" COUNT WAS REMOVED (owner direction, 2026-10-30). The carousel's
              own header already prints "n / total", so this repeated the same fact in a second place —
              and the number is not a result, it is a length. Kept out of the DOM entirely rather than
              hidden, because a `sr-only` copy would re-add the duplication for screen readers. */}

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
          <InfoNote tone="warning" label="This strategy is active" role="status">
            <strong>⏸ {selectedBot.name}</strong> — pause it to make this comparison reproducible. An
            active bot keeps changing state underneath the run. Pausing stops new entries; it does{' '}
            <em>not</em> close a position that is already open.
            <div className="bt-note-actions">
              <button
                type="button"
                className="ff-btn pb-clear"
                disabled={pauseMutation.isPending}
                onClick={() => pauseMutation.mutate(selectedBot.id)}
              >
                {pauseMutation.isPending ? 'Pausing…' : 'Pause this strategy'}
              </button>
            </div>
          </InfoNote>
        )}

        {/* A protocol is not itself active, so a protocol run is never blocked. But a change to the
            thing a live bot trades contaminates the comparison just the same — say so. */}
        {activeBotsOnProtocol.length > 0 && (
          <InfoNote
            tone="warning"
            label={`${activeBotsOnProtocol.length} active bot${activeBotsOnProtocol.length === 1 ? '' : 's'} trade this protocol`}
            role="status"
          >
            The run is allowed — a protocol backtest places no order — but while those bots trade, the
            protocol&rsquo;s inputs keep moving.{' '}
            {activeBotsOnProtocol.map((b) => b.name).join(', ')}.
          </InfoNote>
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
                {/* ⚠️ THIS LOOKED LIKE A BROKEN MENU (owner report, 2026-10-30: *"This seems fixed to
                    5m … is that because nothing else is ready? It needs to be clear."*). It is not a
                    menu at all — it is `trading_strategy.timeframe`, the cadence the bot itself
                    trades, and a run on any other cadence would measure bars the bot never sees. The
                    BAR COUNT is stated too, because that is the other half of the question: the
                    cadence is fixed AND the period holds enough (or does not). */}
                <span className="pb-field-note">
                  Not a menu — this is the strategy&rsquo;s own cadence ({selectedBot?.timeframe || 'none'}),
                  read from the bot. A run on any other timeframe would score bars the bot never
                  trades, so it is changed on the strategy, not here.
                  {(() => {
                    const cov = timeframeCoverage?.[marketTimeframe];
                    if (!cov) return '';
                    return cov.usable
                      ? ` This period holds ${cov.bars.toLocaleString()} of them (minimum ${MIN_RUN_BARS}).`
                      : ` ⚠ This period holds only ${cov.bars.toLocaleString()} of them, under the ${MIN_RUN_BARS}-bar minimum — the run will refuse until more data is imported.`;
                  })()}
                </span>
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
                  aria-describedby="bt-timeframe-note"
                >
                  {TIMEFRAMES.map((tf) => {
                    const cov = timeframeCoverage?.[tf];
                    // ⚠️ UNKNOWN IS NOT UNUSABLE. While the coverage query is in flight, or if it
                    // failed, every option stays enabled and says so — disabling on `undefined`
                    // would turn "I could not check" into "there is no data", which are different
                    // answers and only one of them is true.
                    const unknown = !cov;
                    const disabled = !unknown && !cov.usable;
                    return (
                      <option key={tf} value={tf} disabled={disabled}>
                        {tf}
                        {cov ? ` · ${cov.bars.toLocaleString()} bars` : ''}
                        {/* ⚠️ "NOT ENOUGH" WAS AMBIGUOUS (owner direction, 2026-10-30: *"This seems
                            fixed to 5m … is that because nothing else is ready? It needs to be clear."*)
                            The reason is a BAR COUNT against a stated minimum, so the option says
                            exactly that instead of a judgement the reader has to guess at. */}
                        {disabled ? ` · under the ${MIN_RUN_BARS}-bar minimum` : ''}
                      </option>
                    );
                  })}
                </select>
                <span className="pb-field-note" id="bt-timeframe-note">
                  {coverageQuery.isError || (coverageQuery.data === null && !coverageQuery.isLoading)
                    ? `⚠ Could not read bar coverage for ${marketSymbol || 'this market'} — every timeframe is offered unchecked.`
                    : !timeframeCoverage
                      ? `Checking which timeframes hold ${MIN_RUN_BARS}+ bars for ${marketSymbol || 'this market'}…`
                      : (() => {
                        const usable = TIMEFRAMES.filter((t) => timeframeCoverage[t]?.usable);
                        const blocked = TIMEFRAMES.filter((t) => timeframeCoverage[t] && !timeframeCoverage[t].usable);
                        const scope = usePeriod && selectedPeriod
                          ? 'in this period'
                          : 'in the stored history';
                        // ⚠️ LEAD WITH THE ANSWER, NOT WITH A COUNT (owner direction, 2026-10-30).
                        // "1 of 5 timeframes hold 60+ bars" makes the reader work out WHY the control
                        // looks locked; when only one qualifies, the note says so and names what the
                        // others hold. Measured 2026-10-29: for `dev-window-v1` VIX 5m only the 5m
                        // series clears the minimum, so the select genuinely cannot move.
                        if (usable.length === 0) {
                          return `No timeframe holds ${MIN_RUN_BARS}+ bars ${scope} — import data on Backtest Data first.`;
                        }
                        if (usable.length === 1) {
                          const only = usable[0];
                          const why = blocked
                            .map((t) => `${t} holds ${timeframeCoverage[t].bars.toLocaleString()}`)
                            .join(', ');
                          return `Locked to ${only} — it is the only timeframe with ${MIN_RUN_BARS}+ bars ${scope} for ${marketSymbol}`
                            + (why ? ` (${why}).` : '.')
                            + ' This is a DATA limit, not a setting: the other series do not extend far enough to measure.';
                        }
                        return `${usable.length} of ${TIMEFRAMES.length} timeframes hold ${MIN_RUN_BARS}+ bars ${scope} for ${marketSymbol}. ${usePeriod ? 'Counts are measured inside this period, not the whole history.' : 'Counts are the whole stored history.'}`;
                      })()}
                </span>
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
                min={MIN_RUN_BARS}
                step={50}
                value={bars}
                onChange={(e) => setBars(Math.max(MIN_RUN_BARS, Number(e.target.value) || MIN_RUN_BARS))}
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
            {/*
              ── WHICH SIDES THIS RUN MAY OPEN (#1155, 2026-10-31) ─────────────────────────────────
              Owner direction: *"I read that it's easier to profit on VIX by shorting it but we can only
              tell that when we can test the same period both SHORT and LONG."*

              It sits in "Information sources" alongside the news filter because that is the step that
              decides WHAT POPULATION gets measured — and direction decides whether a signal becomes a
              position at all. ⚠️ 'Long only' is first and is the default: every run stored so far was
              long-only by construction, so a reader opening this page must not see a control implying
              the population changed when it did not.
            */}
            <div className="ff-field">
              <label className="ff-label" htmlFor="bt-direction">Sides this run may open</label>
              <select
                id="bt-direction"
                className="ff-select"
                value={directionMode}
                onChange={(e) => setDirectionMode(e.target.value)}
              >
                <option value="long">↗ Long only — every run before 2026-10-31 did this</option>
                <option value="short">↘ Short only — the mirror on the same bars</option>
                <option value="both">↕ Both — take every signal either way</option>
              </select>
              <span className="pb-field-note">
                A SIGNAL decides the side: BUY / STRONG_BUY opens a long, SELL / STRONG_SELL opens a
                short, with the stop above and the target below. Choose <em>Short only</em> to run the
                same window as a mirror of the long run and compare the two — that is the only way to
                answer "is this protocol better in the other direction?".
              </span>
            </div>

            <div className="ff-field pb-info-window">
              <label className="ff-label" htmlFor="bt-news">News days in the window</label>
              <select
                id="bt-news"
                className="ff-select"
                value={newsExclusion}
                onChange={(e) => setNewsExclusion(e.target.value)}
              >
                {/* ⚠️ THE DEFAULT IS FIRST, and it is the default on purpose (owner direction,
                    2026-10-26). Ordering it second — where it sat while `none` was the default —
                    makes the selected value look like a correction rather than the normal case. */}
                <option value="exclude">🚫 Skip news-day bars (protocol purity) — default</option>
                <option value="none">📰 Include every bar (realistic)</option>
                <option value="only">📡 News-day bars only (sensitivity)</option>
              </select>
              <span className="pb-field-note">
                A FILTER ON BARS, not a news score: bars dated on a news release are skipped or kept.
                Skipping is the default because it measures the protocol rather than the release —
                a run that includes them answers a different question.
                {/* ⚠️ `reduce` WAS REMOVED HERE (2026-10-26). `backtest.service.ts` implements
                    `exclude` and `only` and nothing else — `reduce` was accepted by the type, sent
                    by the form and acted on by no code, so it read as a fourth behaviour that did
                    not exist. Re-adding it requires the engine to weight news days, not filter them. */}
                {' '}“Reduce weight” is deliberately absent — the engine has no weighting step, so it
                would have been a control that changed nothing.
              </span>

              {/* ── WHAT NEWS ACTUALLY APPLIES (2026-10-30) ─────────────────────────────────────
                  The answer, before the run: how many records exist for THIS symbol inside THIS
                  window, and therefore whether the choice above does anything at all. */}
              <div className="pb-news-preview">
                {newsPreviewQuery.isLoading && (
                  <p className="pb-field-note">Checking what news records exist for {marketSymbol}…</p>
                )}
                {newsPreviewQuery.isError && (
                  <p className="pb-field-note">
                    ⚠ Could not read news coverage ({newsPreviewQuery.error?.status ?? 'no status'}) — that is
                    <strong> unknown</strong>, not zero. The run will still apply whichever mode is selected.
                  </p>
                )}
                {newsPreview?.available === false && (
                  <p className="pb-field-note">⚠ {newsPreview.reason}</p>
                )}
                {newsPreview?.available && (
                  <>
                    <p className="pb-field-note">
                      <strong>{newsPreview.articles}</strong> news record(s) on{' '}
                      <strong>{newsPreview.distinctDates}</strong> date(s){' '}
                      {newsPreview.windowBasis === 'selected-window'
                        ? 'inside the selected window'
                        : 'across the WHOLE stored history — this run\u2019s window is a bar count, so the true count is at most this'}
                      {newsPreview.articles > 0 && newsPreview.sampleDates?.length > 0 && (
                        <> — {newsPreview.sampleDates.slice(0, 5).join(', ')}{newsPreview.distinctDates > 5 ? '…' : ''}</>
                      )}
                      {Object.keys(newsPreview.byImpact ?? {}).length > 0 && (
                        <> · impact: {Object.entries(newsPreview.byImpact).map(([k, v]) => `${k} ${v}`).join(', ')}</>
                      )}
                      .
                    </p>
                    {newsIsInert && (
                      <p className="pb-field-note pb-news-inert">
                        🛑 <strong>This choice has no effect on this run.</strong> No news records exist for{' '}
                        {marketSymbol} in this window, so &ldquo;skip news-day bars&rdquo; and &ldquo;include
                        every bar&rdquo; measure exactly the same bars. The run is valid — it simply is not
                        news-filtered, and nothing will say so afterwards unless this line does.
                      </p>
                    )}
                    {newsPreview.excludesAnything && newsExclusion !== 'none' && (
                      <p className="pb-field-note">
                        Those {newsPreview.distinctDates} date(s) will be dropped from the run.
                      </p>
                    )}
                  </>
                )}
              </div>
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

        {/* ── STEP 5 — OUTPUTS (owner direction, 2026-10-30: *"maybe add a new step for the user to
            select what outputs they want"*) ────────────────────────────────────────────────────
            ⚠️ THIS STEP NEVER BLOCKS A RUN. It arrives with a defensible default set, so it is valid
            as soon as it is reachable — it exists because the choice is worth making deliberately, not
            because a run needs an answer. That is what keeps it from becoming friction in a session of
            twenty runs. */}
        {activeStep === STEP_OUTPUTS && (
          <div className="pb-fields">
            <p className="pb-field-note">
              What the Result step should show. Nothing here changes what the engine measures — it
              changes what you are handed afterwards, and it is remembered for this subject.
            </p>

            <ul className="bt-output-list">
              {OUTPUT_OPTIONS
                .filter((o) => (subject === 'protocol' ? o.protocols : o.strategies))
                .map((o) => (
                  <li key={o.id} className="bt-output-row">
                    <label className="bt-output-toggle">
                      <input
                        type="checkbox"
                        checked={outputs[o.id] !== false}
                        onChange={(e) => setOutput(o.id, e.target.checked)}
                      />
                      <span className="bt-output-label">{o.label}</span>
                    </label>
                    <span className="bt-output-hint">{o.hint}</span>
                  </li>
                ))}
            </ul>

            {/* A panel that does not exist yet is declared, not silently absent — the owner asked for
                this one twice, and an option that vanishes reads as an option that was refused. */}
            <InfoNote tone="info" label="A price chart of this run is not available yet">
              What is planned is one chart of the <em>run’s own</em> bars, coloured by the algorithm’s
              verdict, with support and resistance drawn as zones from the level directives. The chart
              that used to sit here was a general chart with its own symbol menu — it opened on
              whatever symbol was picked last, drew no scoring overlay, and so was never a picture of
              the run.
              <br />
              <br />
              Blocked by <strong>#1150</strong>: only 1 of 6 level directives returns its levels as
              data; the rest write them into a sentence, which cannot be drawn.
            </InfoNote>
          </div>
        )}

        {/* ── STEP 6 — the run ─────────────────────────────────────────────────────────────── */}
        {activeStep === STEP_RUN && (
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

            {/* ── WHAT CHANGED IN THIS VISIT ─────────────────────────────────────────────────────
                Owner direction, 2026-10-30. It sits BELOW the strip on purpose: the strip is what the
                run will use, this is the history of how it got there. Two tables, two questions —
                folding them into one would make "SL 2.00%" appear twice with no way to tell which one
                the engine reads. */}
            {sessionLog.length > 0 && (
              <div className="pb-session-log">
                <div className="pb-session-log-head">
                  <h3>Changes this session</h3>
                  <button
                    type="button"
                    className="ff-btn ff-btn-secondary pb-session-clear"
                    onClick={() => setSessionLog([])}
                  >
                    Clear
                  </button>
                </div>
                <table className="pb-session-table">
                  <thead>
                    <tr>
                      <th scope="col">Change</th>
                      <th scope="col">Was</th>
                      <th scope="col">Now</th>
                      <th scope="col">At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionLog.map((r) => (
                      <tr key={`${r.label}-${r.at}`}>
                        <th scope="row">{r.label}</th>
                        <td className="pb-was">{r.from}</td>
                        <td className="pb-now">{r.to}</td>
                        <td className="pb-at">{new Date(r.at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pb-field-note">
                  Newest first, this visit only. The strip above is what the run will <em>use</em>; this
                  is how it got there. A subject switch re-derives the timeframe, window, stop, target,
                  costs and sizing from the chosen subject, so it is recorded as{' '}
                  <strong>one</strong> change rather than a list — those values are the form&rsquo;s
                  work, not yours. Nothing here is sent to the engine: it is a record, not a setting.
                </p>
              </div>
            )}

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

            {/* ── MODES (owner direction, 2026-10-30) ─────────────────────────────────────────────
                *"Create modes. The first Modes will be Normal and Auto-Accept."* Placed here, on the
                Run step, because it decides what happens AFTER the run this button starts — and
                because the gates it will apply have to be readable before it applies them, not
                explained afterwards. */}
            <fieldset className="bt-modes">
              <legend>Mode</legend>
              <div className="bt-mode-options">
                <label className={`bt-mode${mode === 'normal' ? ' bt-mode--on' : ''}`}>
                  <input
                    type="radio"
                    name="bt-mode"
                    value="normal"
                    checked={mode === 'normal'}
                    onChange={() => setMode('normal')}
                  />
                  <span className="bt-mode-name">Normal</span>
                  <span className="bt-mode-hint">
                    A run is stored and shown. Nothing is promoted — you accept a baseline yourself.
                  </span>
                </label>
                <label className={`bt-mode${mode === 'auto' ? ' bt-mode--on' : ''}`}>
                  <input
                    type="radio"
                    name="bt-mode"
                    value="auto"
                    checked={mode === 'auto'}
                    onChange={() => setMode('auto')}
                  />
                  <span className="bt-mode-name">Auto-Accept</span>
                  <span className="bt-mode-hint">
                    A run that beats A by the gates below becomes the new <strong>A</strong> with no
                    click. A run that fails a gate is left as B and says which gate refused it.
                  </span>
                </label>
              </div>
              {mode === 'auto' && (
                /* ⚠️ A CONTAINER, NOT A TRAILING PARAGRAPH (owner direction, 2026-10-30: *"Put this
                   text … into a container to frame it better"*). It is the same `InfoNote` the result
                   page uses, so the sentence that states a policy and the sentence that reports its
                   outcome are the same shape — and the gates, which are the whole substance of the
                   mode, are no longer loose text under the radios. */
                <InfoNote
                  tone="info"
                  label="Gates in force"
                  meta={`source: ${autoAcceptGates.source}`}
                >
                  <strong>+{autoAcceptGates.minImprovePct}%</strong> total P&amp;L against A and at least{' '}
                  <strong>{autoAcceptGates.minTrades}</strong> closed trades.
                  <br />
                  🛑 <strong>This never changes the strategy’s own settings.</strong> It moves the
                  reference A points at, and nothing else — the bot keeps trading exactly what it
                  trades now. Writing a tested configuration into the live strategy is a separate,
                  explicit action and is not built.
                </InfoNote>
              )}
            </fieldset>

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

      {/* ── STEP 4 — Costs & sizing for strategies; SCORES ONLY for protocols ── */}
      {activeStep === 4 && scoresOnly && (<>
        <InfoNote tone="info" label="A protocol produces scores — nothing to set here">
          A protocol answers <em>“does an opportunity exist?”</em> — it is a reading of the bars, not an
          order. It has no position size, no stop, no spread and no account, so asking for them would be
          asking you to price a trade nobody places.
          <br />
          <br />
          This run therefore records <strong>scores, signals and forward returns</strong> and simulates{' '}
          <strong>no fills</strong>. Switch the subject to <strong>Complete Strategies</strong> (step 1)
          to measure a bot, where costs, sizing and trade size all belong to that bot.
          <br />
          <br />
          ⚠️ Runs stored before 2026-10-26 <em>did</em> simulate trades from a protocol, using whatever
          the form held at the time. Those runs have a trade count where a new one has 0 — the
          comparison panel reports that rather than averaging the two.
        </InfoNote>

          {/* ⚠️ STEP 4 IS THE DIRECTIVE LIST (owner direction, 2026-10-27): *"a list of directives in
              the protocol and the settings for those directives offered in fields for editing …
              stored as a custom per-protocol value, not a global."*
              `DirectiveSettingsPanel` writes the store the SCORER reads (`protocol:<slug>` settings
              family, via `PATCH :slug/directive-config`), not `protocol_directive_entry.maxScore`,
              which no scoring path reads. */}
          <h3 className="pb-info-head">
            Directives in {selectedProtocol?.name ?? 'this protocol'}
            {selectedProtocol?.directiveCount != null && <span className="dp-count"> · {selectedProtocol.directiveCount} directives</span>}
          </h3>
          <Suspense fallback={<p className="pb-none">Loading the directive settings…</p>}>
            <DirectiveSettingsPanel protocolSlug={protocolId} />
          </Suspense>
        </>
      )}

      {activeStep === 4 && !scoresOnly && (
      /* ⚠️ NO ACCORDION (owner direction, 2026-10-30: *"There is no need for this accordion to hold the
         content"*). The disclosure existed when this block sat under the whole page's other controls and
         needed a lid on it; it is now the entire content of its own step, so a toggle that collapses the
         only thing on screen buys nothing and costs a click. `showExecution` is gone with it. */
      <div className="bt-execution-panel">
            {/* What the class was detected FROM, and what that costs before the protocol does anything. */}
            <div className="bt-class-strip">
              <div className="bt-class-detect">
                <span className="bt-class-symbol">{marketSymbol || 'no symbol yet'}</span>
                <span className="bt-class-arrow" aria-hidden="true">→</span>
                {symbolClass === null ? (
                  <span className="bt-class-pending">detecting class…</span>
                ) : (
                  <>
                    <span className="bt-class-type">
                      {symbolClass.type}
                      {symbolClass.source === 'assumed' && (
                        <em title="Not found in /api/symbols, so this is getAssetType()’s fallback — its ‘stock’ answer means ‘not recognised’, not ‘verified equity’.">
                          {' '}· assumed
                        </em>
                      )}
                    </span>
                    <span className="bt-class-arrow" aria-hidden="true">→</span>
                    <span className="bt-class-profile">{costProfile.label} costs</span>
                  </>
                )}
                {costsEdited && <span className="bt-class-edited">edited</span>}
              </div>
              <button
                type="button"
                className="bt-class-reset"
                onClick={applyClassCosts}
                disabled={!symbolClass || (!costsEdited && slippage === costProfile.slippage
                  && spread === costProfile.spread && commission === costProfile.commission)}
              >
                Use {costProfile.label} defaults
              </button>
              {/* The class note is a claim about which numbers this run uses. When the broker's own
                  measured spread takes over, the note is describing a value nothing will read — so it is
                  labelled rather than left to sit beside a break-even it no longer explains. */}
              <p className="bt-class-gloss">
                {costSource === 'broker' ? 'Class default (not used — broker quote wins): ' : ''}
                {costProfile.note}
              </p>
              <p className={`bt-class-breakeven ${breakEvenPct > 0.5 ? 'is-high' : ''}`}>
                Break-even move <strong>{breakEvenPct.toFixed(2)}%</strong> of price — the trade must
                travel that far before it is flat ({(effectiveSpread * 100).toFixed(3)}% {costSource === 'broker' ? 'broker ' : ''}spread + {slippage * 100}% slippage
                each way).
              </p>
              {/*
                ⚠️ THE PERCENT ALONE MISLEADS (#1148). Measured 2026-10-29: VIX quotes a 0.17-point
                spread on an 18-point index — 0.93% — while US500 quotes 0.40 points on 7,722 — 0.005%.
                Reading only the percentage, an operator (and an agent) concluded "VIX is expensive and
                the broker is bad", when it is 17 ticks of an ordinary index CFD and the percentage is
                large only because the price is small. Show the broker's own numbers, in ticks, and the
                one ratio that actually decides whether a target is viable.
              */}
              {brokerSpread?.source === 'broker' && (
                <p className="bt-class-gloss">
                  <strong>Broker quote:</strong> {brokerSpread.spreadAbs?.toFixed(brokerSpread.tickSize && brokerSpread.tickSize < 0.01 ? 3 : 2)}{' '}
                  points{brokerSpread.ticks != null ? ` (${brokerSpread.ticks} ticks)` : ''} ={' '}
                  {brokerSpread.spreadPct?.toFixed(3)}% of price
                  {brokerSpread.eatsShareOfOnePctMove != null && (
                    <> — that eats <strong>{(brokerSpread.eatsShareOfOnePctMove * 100).toFixed(0)}%</strong> of a 1% move</>
                  )}
                  {`. Measured ${brokerSpread.quotedAt ? new Date(brokerSpread.quotedAt).toLocaleString() : ''}.`}
                  {(brokerSpread.eatsShareOfOnePctMove ?? 0) > 0.4 && (
                    <> ⚠️ At this price a 1% target is mostly cost — the bracket needs to be several times wider to be viable.</>
                  )}
                </p>
              )}
              {brokerSpread && brokerSpread.source === null && (
                <p className="bt-class-gloss">
                  No broker quote yet for {marketSymbol || 'this symbol'} — this run uses the class default.
                  Capture it with <code>POST /api/broker-symbols/spread-sync</code>.
                </p>
              )}
            </div>

            <div className="bt-execution-grid">
              {/* ⚠️ THE BOT'S OWN SETTINGS, INHERITED UNLESS EDITED (owner direction, 2026-10-26:
                  *"it should come from the strategies parts of data"*). Empty = use the bot's value,
                  which the engine applies server-side; typing a number is the CHANGE this run tests.
                  Before this, these three lived only in the Settings inventory tab, so the place a
                  change is made and the place it is described were different panels. */}
              {subject === 'strategy' && selectedBot && (
                <>
                  <label title="The bot's own entry bar — signals below this % never become a trade">
                    Entry bar % <span className="bt-inherit">bot: {selectedBot.minComposite ?? 0}%</span>
                    <input
                      type="number" step="1" min="0" max="100"
                      value={overrides.minComposite}
                      placeholder={String(selectedBot.minComposite ?? 0)}
                      onChange={(e) => setOverride('minComposite', e.target.value)}
                    />
                    <span className="bt-field-gloss">Blank = the bot&rsquo;s own bar. Above it, a higher bar takes fewer, stronger trades.</span>
                  </label>
                  <label title="The bot's stop distance as % of price">
                    Stop % <span className="bt-inherit">bot: {selectedBot.slPct ?? '—'}</span>
                    <input
                      type="number" step="0.1" min="0"
                      value={overrides.slPct}
                      placeholder={String(selectedBot.slPct ?? '')}
                      onChange={(e) => setOverride('slPct', e.target.value)}
                    />
                    <span className="bt-field-gloss">Blank = the bot&rsquo;s own stop. This also sets the position size (% of Equity sizing).</span>
                  </label>
                  <label title="The bot's target distance as % of price">
                    Target % <span className="bt-inherit">bot: {selectedBot.tpPct ?? '—'}</span>
                    <input
                      type="number" step="0.1" min="0"
                      value={overrides.tpPct}
                      placeholder={String(selectedBot.tpPct ?? '')}
                      onChange={(e) => setOverride('tpPct', e.target.value)}
                    />
                    <span className="bt-field-gloss">Blank = the bot&rsquo;s own target. Target ÷ stop is the payoff the result reports.</span>
                  </label>
                </>
              )}
              <label title="Slippage as decimal (0.01 = 1%)">
                Slippage
                <input type="number" step="0.0001" min="0" value={slippage} onChange={e => {
                  setSlippage(parseFloat(e.target.value) || 0); setCostsEdited(true); }} />
                <span className="bt-field-gloss">Paid on entry and again on exit. 0.01 = 1% of price each way.</span>
              </label>
              <label title="Spread as decimal (0.01 = 1%)">
                Spread
                <input type="number" step="0.0001" min="0" value={spread} onChange={e => {
                  setSpread(parseFloat(e.target.value) || 0); setCostsEdited(true); }} />
                <span className="bt-field-gloss">Split half on entry and half on exit — the full spread once per round trip.</span>
              </label>
              <label title="Per-share/contract commission ($)">
                Commission $
                <input type="number" step="0.01" min="0" value={commission} onChange={e => {
                  setCommission(parseFloat(e.target.value) || 0); setCostsEdited(true); }} />
                <span className="bt-field-gloss">Charged once per trade, multiplied by the units traded.</span>
              </label>
              <label title="Position sizing model">
                Sizing Model
                <select value={positionModel} onChange={e => { setPositionModel(e.target.value); }}>
                  <option value="fixedPercent">% of Equity</option>
                  <option value="fixedDollar">Fixed $</option>
                  <option value="atrEqualRisk">ATR Equal Risk</option>
                  <option value="kellyFull">Kelly (full)</option>
                  <option value="kellyHalf">Kelly (half)</option>
                </select>
                <span className="bt-field-gloss">
                  Turns the simulated balance into a <strong>unit count</strong>. It changes money P&amp;L
                  and money drawdown — never the win rate or the per-trade %.
                </span>
              </label>
              {positionModel === 'fixedDollar' && (
                <label title="Fixed currency amount committed per trade">
                  Fixed $
                  <input type="number" step="50" min="1" value={fixedAmount} onChange={e => {
                    setFixedAmount(parseFloat(e.target.value) || 100); }} />
                  <span className="bt-field-gloss">Same cash amount on every trade, whatever the price.</span>
                </label>
              )}
              {(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Maximum % of account allowed per trade. Kelly can be aggressive — cap it.">
                  Kelly Cap %
                  <input type="number" step="5" min="5" max="50" value={kellyCapPct} onChange={e => {
                    setKellyCapPct(parseFloat(e.target.value) || 25); }} />
                  <span className="bt-field-gloss">A ceiling on Kelly, because half-Kelly on a lucky streak still overbets.</span>
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="Stop distance = ATR × multiplier. Higher = wider stop, smaller position.">
                  ATR Multiplier
                  <input type="number" step="0.5" min="0.5" max="5" value={atrMultiplier} onChange={e => {
                    setAtrMultiplier(parseFloat(e.target.value) || 1.5); }} />
                  <span className="bt-field-gloss">Stop distance = ATR × this. Wider stop, smaller position.</span>
                </label>
              )}
              {positionModel === 'atrEqualRisk' && (
                <label title="ATR lookback period. 14 = standard, 10 = more responsive, 20 = smoother.">
                  ATR Period
                  <input type="number" step="1" min="5" max="50" value={atrPeriod} onChange={e => {
                    setAtrPeriod(parseInt(e.target.value, 10) || 14); }} />
                  <span className="bt-field-gloss">Bars in the ATR average. 14 is the standard.</span>
                </label>
              )}
              {!(positionModel === 'kellyFull' || positionModel === 'kellyHalf') && (
                <label title="Risk per trade as % of account">
                  Risk %
                  <input type="number" step="0.5" min="0.5" max="20" value={riskPct} onChange={e => {
                    setRiskPct(parseFloat(e.target.value) || 2); }} />
                  <span className="bt-field-gloss">
                    Used by % of Equity and ATR sizing. A Complete Strategy&apos;s real size is the
                    <strong> bot&apos;s</strong> setting — this form&apos;s value is what gets simulated,
                    and the two are only recorded, not reconciled.
                  </span>
                  {committedMultiple != null && (
                    <span className={`bt-field-warn ${committedMultiple > 3 ? 'is-high' : ''}`}>
                      {riskPct}% risk ÷ {effectiveSlPct}% stop ⇒ ≈{committedMultiple.toFixed(1)}× the
                      account committed per trade. The stop decides the size, not the account.
                    </span>
                  )}
                </label>
              )}
              <label title="Starting account balance for position sizing">
                Account Size
                <input type="number" step="1000" min="1000" value={accountSize} onChange={e => {
                  setAccountSize(parseInt(e.target.value) || 10000); }} />
                <span className="bt-field-gloss">Simulated starting balance. Nothing here reads a real account.</span>
              </label>
            </div>

            {/* ⚠️ WHAT THE BOT ITSELF TRADES. The engine sizes in UNITS and the bot in LOTS (#843), so a
                Complete Strategy's money figures are a simulation of the same edges — not its P&L.
                Shown rather than asserted, because a reader who cannot see the bot's own size has no
                way to judge whether the two agree. The FORK (bot wins vs form wins) is an owner
                decision, recorded in .github/REVIEW-QUEUE.md. */}
            {subject === 'strategy' && selectedBot && selectedBot.baseSize != null && (
              <p className="bt-bot-size-note">
                This bot&apos;s own entry size is <strong>{selectedBot.baseSize}</strong> — lots on
                MT5, shares elsewhere. The form below models <strong>units</strong>, so treat the
                money figures as a simulation of the edges, not as the bot&apos;s actual P&amp;L.
              </p>
            )}

            {/* WHAT THIS RUN CHANGES. Shown BEFORE the run so the experiment is deliberate, and
                again after it (the engine echoes the same list as `drivenBy.overridden`). */}
            {botChanges.length > 0 ? (
              <div className="pb-changes" role="note">
                <strong>Changes being tested ({botChanges.length})</strong>
                <ul>
                  {botChanges.map((c) => (
                    <li key={c.label}>
                      <span>{c.label}</span>
                      <code>{String(c.from)}</code>
                      <span aria-hidden="true">→</span>
                      <code>{c.to}</code>
                    </li>
                  ))}
                </ul>
                <p className="pb-field-note">
                  Everything else is the bot&rsquo;s own value. This run is the <strong>B</strong> side;
                  a run with nothing changed is the <strong>A</strong> baseline.
                </p>
              </div>
            ) : (
              <p className="pb-field-note">
                <strong>No changes — this is the baseline.</strong> It measures the bot exactly as
                configured, which is what tab <em>Current performance (A)</em> reports from its real
                trades.
              </p>
            )}

            {/* ⚠️ THE SETTINGS INVENTORY NO LONGER RENDERS HERE (2026-10-30). Its four audit groups are
                four steps of their own — see `SETTINGS_STEPS`. What stayed is the one thing this step
                owns: the four overrides the form above edits, and the list of what they change. */}
          </div>
      )}

      {/* ── STEPS 5–8 — THE SETTINGS AUDITS (2026-10-30) ─────────────────────────────────────────
          One group of the inventory per step. Each renders the SAME component with a different
          `group`, so the table shape, the honoured/reported/ignored verdicts and their API-driven
          provenance cannot drift between them. */}
      {SETTINGS_STEPS.map((s) => activeStep === s.step && (
        <div key={s.group} className="pb-fields">
          <InfoNote tone="neutral" label="What this step is">
            {s.lede}
          </InfoNote>
          <Suspense fallback={<p className="pb-none">Loading the settings inventory…</p>}>
            <BacktestSettingsInventory
              subject={subject}
              /*
                ⚠️ ON THE STRATEGIES ROUTE THE PROTOCOL COMES FROM THE BOT (found 2026-10-30, as soon as
                this became its own step). `protocolId` is the page's PROTOCOL-page state and is empty
                here, so the "What the protocol sets" step rendered 0 rows and told the reader to select
                a protocol that was already selected. A bot names its protocol; that is the one this run
                scores with.
              */
              protocolId={protocolId || selectedBot?.protocolId || ''}
              botId={botId}
              group={s.group}
              showFilters
            />
          </Suspense>
        </div>
      ))}

      {/* ── a failed run is reported in the step that started it ── */}
      {activeStep === STEP_RUN && runMutation.isError && (
        runMutation.error?.timedOut ? (
          <InfoNote
            tone="warning"
            label={`The browser stopped waiting after ${runMutation.error.timeoutSeconds}s`}
            role="status"
          >
            A long window can still be running on the server after the page gives up, and when it
            finishes the run <strong>IS stored</strong>. Check <strong>Completed Runs</strong> in this
            area before running it again — a second attempt would duplicate a run that already
            succeeded. Narrow the window if this keeps happening.
          </InfoNote>
        ) : (
          <NoticeBlock notice={noticeFromError(runMutation.error)} compact />
        )
      )}


      {activeStep === STEP_RESULT && stats && (
        <>
      <div className="bt-results">
          {/*
            ⚠️ BORDER = COMPARISON, VALUE COLOUR = PROFIT/LOSS (owner direction, 2026-10-30: *"the box
            borders are coloured based on comparison but the text for loss or profit is standard red and
            green"*). The two encodings answer different questions and neither overrides the other.

            ⚠️ AN UNCOLOURED BOX IS A THIRD STATE, NOT A MISSING ONE. `verdictClass` returns '' for both
            "nothing moved" and "nothing to compare against", and `comparisonReason` below prints which
            of those it is — an unlabelled grid of plain boxes would read as "nothing changed" in both
            cases, which is the defect this page keeps paying for.
          */}
          <div className="bt-stats-grid">
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.totalSignals)}`} title={comparison?.label ? `vs ${comparison.label}` : undefined}><div className="bt-stat-value">{stats.totalSignals}</div><div>Entry Signals</div></div>
            {/* ⚠️ #980 — `stats.winRate` is a SIGNAL rate (profitable entry signals ÷ entry
                signals). Labelling it "Win Rate" invited reading it as a trade rate, and run
                `0ddddd` stored 100% here beside 0 winners of 3 trades. The two populations are
                now labelled as what they are. */}
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.winRate)}`}><div className="bt-stat-value">{(stats.winRate * 100).toFixed(0)}%</div><div>Entry Signals Profitable</div></div>
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.averageReturn10d)}`}><div className="bt-stat-value">{pctOrDash(stats.averageReturn10d)}</div><div>Avg Return (10d)</div></div>
            {/* ⚠️ RENAMED 2026-10-30 (#1149 follow-up). These two are the BEST and WORST ten-day
                FORWARD RETURN of the scored bars — a signal-quality pair. Calling the negative one
                "Max Drawdown (10d)" put a second, unrelated "Max Drawdown" on the same page as the
                equity curve's (which read 8,867.70% for run `7f00cfb8` while this tile said −2.87%,
                from the same column). "Drawdown" now means one thing on this page: the equity path. */}
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.maxReturn10d)}`}><div className="bt-stat-value">{pctOrDash(stats.maxReturn10d)}</div><div>Best Return (10d)</div></div>
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.maxDrawdown10d)}`}><div className="bt-stat-value">{pctOrDash(stats.maxDrawdown10d)}</div><div>Worst Return (10d)</div></div>
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.profitFactor)}`}><div className="bt-stat-value">{stats.profitFactor}</div><div>Profit Factor</div></div>
            <div className={`bt-stat ${verdictClass(comparison?.verdicts?.sharpeApproximation)}`}><div className="bt-stat-value">{stats.sharpeApproximation}</div><div>Sharpe (approx)</div></div>
            {/* Bracket trade stats — STRATEGIES ONLY (owner direction, 2026-10-27: *"step … includes
                financial and trade related stats that need to be removed as they should only be shown
                on the Backtest Strategies view"*). A protocol run is `scoresOnly`, so every one of
                these cells would read 0 / $0.00 and invite the reader to treat "no trades" as a
                result. On the Strategies page they are the whole point. */}
            {subject === 'strategy' && stats.totalTrades != null && (
              <>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.totalTrades)}`}><div className="bt-stat-value">{stats.totalTrades}</div><div>Bracket Trades</div></div>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.tradeWinRate)}`}><div className="bt-stat-value">{(stats.tradeWinRate * 100).toFixed(0)}%</div><div>Trade Win Rate</div></div>
                {/*
                  ── THE TWO NUMBERS THAT ANSWER "WHY DOES THIS LOSE?" (2026-10-31) ────────────────
                  Measured across the stored runs, the achieved win rate alone cannot tell a reader
                  whether a configuration is near a fix or structurally impossible:
                    `1bbf1860` stop 2.49 / target 1.49 at 1.01% cost → needs 88.0%, won 42.3%
                    `568c5552` stop 2.47 / target 3.50 at 0.97% cost → needs 57.7%, won 22.9%
                  A 42% win rate looks "poor but closeable" on its own; beside an 88% requirement it
                  is a bracket that cannot pay for itself at any realistic win rate. So the required
                  rate and the GAP to it are tiles, and the gap is what a reader acts on.
                  ⚠️ `breakEvenUnavailable` is rendered, never swallowed: a null requirement is a
                  refusal ("this target does not even cover the cost"), not a zero.
                */}
                {stats.breakEvenWinRatePct != null && (
                  <div className={`bt-stat ${verdictClass(comparison?.verdicts?.breakEvenWinRatePct)}`} title={`This run's median bracket: stop ${stats.bracketStopPct}%, target ${stats.bracketTargetPct}%, round-trip cost ${stats.roundTripCostPct}%. Needs ${stats.breakEvenWinRatePct}% of trades to win to break even.`}>
                    <div className="bt-stat-value">{stats.breakEvenWinRatePct}%</div>
                    <div>Win Rate Needed</div>
                    <div className="bt-stat-sub">{stats.bracketStopPct}% stop · {stats.bracketTargetPct}% target · {stats.roundTripCostPct}% cost</div>
                  </div>
                )}
                {stats.breakEvenGapPp != null && (
                  <div className={`bt-stat ${stats.clearsBreakEven ? 'is-better' : 'is-worse'}`} title="Achieved trade win rate minus the rate this bracket needs, in percentage points. Negative means the configuration loses by arithmetic, before any judgement about the entries.">
                    <div className="bt-stat-value">{stats.breakEvenGapPp > 0 ? '+' : '−'}{Math.abs(stats.breakEvenGapPp)}pp</div>
                    <div>Gap to Break-even</div>
                    <div className="bt-stat-sub">{stats.clearsBreakEven ? 'clears it' : 'short of it'}</div>
                  </div>
                )}
                {stats.breakEvenWinRatePct == null && stats.breakEvenUnavailable && (
                  <div className="bt-stat is-worse" title="No break-even win rate can be computed from this run's own bracket and costs.">
                    <div className="bt-stat-value">—</div>
                    <div>Win Rate Needed</div>
                    <div className="bt-stat-sub">
                      {stats.breakEvenUnavailable === 'target-below-cost'
                        ? 'target does not cover the cost'
                        : 'no stop/target recorded'}
                    </div>
                  </div>
                )}
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.avgTradePnl)}`}><div className="bt-stat-value">{pctOrDash(stats.avgTradePnl)}</div><div>Avg Trade PnL</div></div>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.totalPnl)}`}><div className="bt-stat-value">{moneyOrDash(stats.totalPnl)}</div><div>Total PnL</div></div>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.grossPnl)}`}><div className="bt-stat-value">{moneyOrDash(stats.grossPnl)}</div><div>Gross PnL</div></div>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.totalCommission)}`}><div className="bt-stat-value">{moneyOrDash(stats.totalCommission)}</div><div>Total Commission</div></div>
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.avgPositionSize)}`}><div className="bt-stat-value">{stats.avgPositionSize != null ? Math.round(stats.avgPositionSize) : '—'}</div><div>Avg Pos Size</div></div>
                {/* ⚠️ THE WORST SINGLE TRADE, in currency (#1149 follow-up, 2026-10-30). This cell
                    used to read `run.maxDrawdown` — the same column as "Max Drawdown (10d)" — so run
                    `7f00cfb8` showed −2.87 in both, while its actual worst trade lost **$296.19**.
                    One column serving two labels, and only one of the two was true. */}
                <div className={`bt-stat ${verdictClass(comparison?.verdicts?.maxTradeDrawdown)}`}><div className="bt-stat-value">{moneyOrDash(stats.maxTradeDrawdown)}</div><div>Worst Trade</div></div>
              </>
            )}
          </div>

          {/*
            ── EVERY SENTENCE ON THIS PAGE, IN ONE STRUCTURE (2026-10-30) ────────────────────────
            ⚠️ Owner report: *"We've got too much mixed styling when displaying sentences … This is a
            perfect example of agentic AI working on a UI without any reference to an established theme
            like we are trying to do in the appearance area."*

            Measured before this change: five shapes for five sentences — a bare `<p>` legend, an
            `app-notice--warning`, a `.bt-period` paragraph, an unstyled `<ul>` of caveats and a
            `.bt-execution-info` line (plus a sixth, `.bt-news-info`). Each was locally reasonable; the
            SET was incoherent, which is what a missing pattern looks like from outside. They are now
            all `<InfoNote>`, so the anatomy — uppercase role label, one body, one optional caption — is
            identical and the tone lives on the border and the label only.

            ⚠️ ORDER IS DELIBERATE: what was measured, then what is being compared, then what the
            system decided, then the configuration used, then what the result cannot claim. Facts,
            then decisions, then limits. Read top-down it answers "what am I looking at?" before
            "should I trust it?".
          */}
          <InfoNote
            tone="neutral"
            label="Window measured"
            meta={[
              result?.measuredPeriod?.bars != null ? `${result.measuredPeriod.bars.toLocaleString()} bars imported` : 'bar count not recorded',
              result?.scoreSeries?.length ? `${result.scoreSeries.length.toLocaleString()} scored` : null,
            ].filter(Boolean).join(' · ')}
          >
            {result?.measuredPeriod
              ? <><strong>{result.measuredPeriod.name}</strong> · {result.measuredPeriod.from} → {result.measuredPeriod.to}</>
              : <>Day range · {result?.period ?? 'not stated by the engine'}</>}
          </InfoNote>

          <InfoNote
            tone="neutral"
            label="Comparison"
            meta={hasComparison ? undefined : comparisonReason}
          >
            {/*
              ⚠️ KEYED ON `label`, NOT ON `comparison` (measured 2026-10-30). The memo returns a
              `reason` object with NO label when the two runs are not comparable — so `comparison` is
              truthy and `comparison.label` is undefined, and the sentence rendered as "…better / worse
              than . The figure itself…". A comparison that cannot be made must take the
              cannot-be-made branch.
            */}
            {hasComparison
              ? <>Tile border{' '}
                <span className="info-note-key is-better">better</span>{' '}
                <span className="info-note-key is-worse">worse</span> than {comparison.label}. The
                figure itself keeps its profit-and-loss colour.</>
              : <>These tiles are not compared with anything, so no border is coloured and nothing
                here has been shown to be an improvement.</>}
          </InfoNote>

          {/* ⚠️ A PROMOTION NOBODY ANNOUNCED IS INDISTINGUISHABLE FROM A RUN THAT WAS NEVER
              PROMOTED. Every outcome is printed with the number that decided it, so a reader can
              disagree with the decision rather than having to trust it. */}
          {autoOutcome?.runId === runId && (
            <InfoNote
              tone={autoOutcome.verdict === 'accepted' || autoOutcome.verdict === 'accepted-first' ? 'success' : 'warning'}
              label={autoOutcome.verdict === 'accepted' || autoOutcome.verdict === 'accepted-first' ? 'Auto-Accept · promoted' : 'Auto-Accept · not promoted'}
              role="status"
            >
              {autoOutcome.verdict === 'accepted'
                ? <>This run is the new <strong>A</strong> — {autoOutcome.detail}.</>
                : autoOutcome.verdict === 'accepted-first'
                  ? <>This run became <strong>A</strong> because there was nothing to beat — {autoOutcome.detail}.</>
                  : <>Left as <strong>B</strong>: {capFirst(autoOutcome.detail)}.</>}
            </InfoNote>
          )}

          {/* Costs & sizing actually applied to this run — STRATEGIES ONLY. A `scoresOnly` run sends
              `slPct: 0 / tpPct: 0`, so no fill is simulated and a break-even line describes a trade
              that never happened. Shown on the Strategies view, where costs are real. */}
          {subject === 'strategy' && executionUsed && (
            <InfoNote
              tone="neutral"
              label="Costs applied"
              meta={`${executionUsed.positionModel === 'fixedPercent'
                ? `${executionUsed.riskPct}% risk on $${executionUsed.accountSize.toLocaleString()}`
                : executionUsed.positionModel === 'fixedDollar'
                  ? `$${executionUsed.fixedAmount} fixed per trade`
                  : executionUsed.positionModel?.startsWith('kelly')
                    ? `Kelly (${executionUsed.positionModel === 'kellyHalf' ? 'half' : 'full'}) · f=${(executionUsed.kellyFraction * 100).toFixed(1)}% · cap ${executionUsed.kellyCapPct}%`
                    : executionUsed.positionModel}`}
            >
              Break-even <strong>{((executionUsed.spread + executionUsed.slippage * 2) * 100).toFixed(2)}%</strong>
              {' '}· slippage {(executionUsed.slippage * 100).toFixed(2)}% each way · spread{' '}
              {(executionUsed.spread * 100).toFixed(2)}% · commission ${executionUsed.commission.toFixed(2)}/unit
              {executionUsed.positionModel?.startsWith('kelly') && executionUsed.kellyFraction * 100 > 25 && (
                <span className="is-worse"> · ⚠ Kelly is aggressive here</span>
              )}
            </InfoNote>
          )}

          {/* A filter that was on has to say so, because a run without news days and a run on a quiet
              week look identical afterwards. */}
          {result?.newsExclusion && result.newsExclusion !== 'none' && (
            <InfoNote tone="neutral" label="News filter applied">
              <strong>{result.newsExclusion === 'only' ? 'news-day bars only' : 'news-day bars skipped'}</strong>
              {result.newsDatesCount != null && <> · {result.newsDatesCount} news date(s) matched</>}
            </InfoNote>
          )}

          {/* ⚠️ WHAT THIS RUN CANNOT CLAIM — last, and toned, because it is the one statement a reader
              must not skim past. A bot-driven run carries the #843 sizing-divergence warning here. */}
          {result?.caveats?.length > 0 && (
            <InfoNote tone="warning" label="What this cannot claim">
              <ul>
                {result.caveats.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </InfoNote>
          )}

          {/* Equity curve + drawdown
              ⚠️ NEEDS ≥2 POINTS. A protocol run now places NO trades (scores only), so `/equity`
              returns exactly one point at zero — and the chart's breakeven line was built from
              `[first, last]`, i.e. `[t, t]`, which lightweight-charts rejects by assertion and the
              whole view died with "Something went wrong rendering this view" (2026-10-27). A flat
              line through one point is not a curve, so it is not drawn. */}
          {outputs.equity !== false && equityData && !equityData.error && equityData.equity?.length > 1 && (
            <div className="bt-chart-section">
              <h3>Equity Curve &amp; Drawdown</h3>
              <Suspense fallback={<p className="pb-none">Loading the equity curve…</p>}>
                <EquityCurveChart equityData={equityData} symbol={result?.symbol ?? marketSymbol} height={300} />
              </Suspense>
            </div>
          )}
          {outputs.equity !== false && equityData && !equityData.error && equityData.equity?.length === 1 && (
            <p className="pb-field-note">
              <strong>No equity curve.</strong> This run recorded no trades, so there is no curve to
              draw — a protocol produces <em>scores</em>, and score-only runs place nothing. Switch to{' '}
              <em>Backtest Strategies</em> to measure execution.
            </p>
          )}

          {/*
            ⚠️ THE PRICE CHART AND THE TRADES TABLE USED TO RENDER HERE ON BOTH VIEWS, and both were
            removed from the Protocols view on 2026-10-27 at the owner's direction.

            ⚠️ THE PRICE CHART IS NOW GONE FROM BOTH VIEWS (owner direction, 2026-10-30: *"Remove this
            chart as it is useless right now"*). It was never the run's chart — `BacktestChartPane`
            carries its own symbol menu, so it opened on whatever symbol was last picked rather than on
            the run under test, and it drew no scoring overlay. The chart that belongs here is the one
            the owner has asked for repeatedly: the run's own bars, coloured by the algorithm's verdict,
            with support/resistance levels drawn from the directives. That needs level directives to
            RETURN geometry, which 5 of 6 currently discard into `reason` prose (#1150). Until then a
            chart would be a picture of something else, so there is no chart.
          */}

          {/* Chart visualization — REMOVED 2026-10-30. See the note above: it is a general chart with
              its own symbol menu, so it was never a picture of the run. The Outputs step lists the
              honest replacement and says what it is waiting on. */}

          {/* ── WHAT IT TRADED ────────────────────────────────────────────────────────────────────
              ⚠️ THIS REPLACED AN ENTRY-SIGNAL TABLE THAT COULD NEVER RENDER (#1134). A stored run
              persists its TRADES, not its per-signal rows — `formatRunResult()` returns
              `entrySignals: []` — so a table keyed on those rows was structurally dead, while 1,285
              stored trades went unshown. The `caveats` block above states the gap; this shows the
              population that actually exists.

              ⚠️ THE MARKUP IS NOW THE SHARED `<TradeTable>` (owner direction, 2026-10-29: the same
              question — *"more trade based, show us profit loss"* — was being answered by TWO
              hand-written tables in different columns, one here and one in the A/B panels. This page
              keeps only the heading and the count; the columns, the sort, the P&L colour and the
              all-trades summary live in `components/backtest/TradeTable.jsx`, so the Run step and the
              A/B panels cannot drift apart. `limit={25}` here because this is a post-run glance;
              the A/B panels show 100. */}
          {subject === 'strategy' && outputs.trades !== false && result?.trades?.length > 0 && (
            <div className="bt-chart-section">
              <h3>Trades <span className="bt-measured-bars">· {Math.min(25, result.trades.length)} of {result.trades.length.toLocaleString()} shown, newest first</span></h3>
              <TradeTable
                trades={result.trades}
                totals={result.tradeTotals}
                timeframe={result.timeframe}
                limit={25}
                compare={comparison ? { verdicts: comparison.tradeVerdicts, label: comparison.label } : null}
              />
            </div>
          )}

          {/* ── STOP SCREEN (2026-10-29) ─────────────────────────────────────────────────────────
              *"if 70% of positions that dropped into the red by X amount then triggered the SL, that
              would tell us that we're losing money because the SL is too distant."* The panel is a
              first-order screen over the excursions this run recorded; it is not a re-simulation and
              says so in place. Kept OFF the Protocols view: a scores-only run records no trades, so
              every row would be a zero. */}
          {subject === 'strategy' && outputs.stopScreen !== false && result?.trades?.length > 0 && result?.id && (
            <div className="bt-chart-section">
              <h3>Stop screen <span className="bt-measured-bars">· how tight could the stop be?</span></h3>
              <Suspense fallback={<p className="pb-none">Screening candidate stops…</p>}>
                <StopSweepPanel runId={result.id} />
              </Suspense>
            </div>
          )}

          {/* ── SCORE SERIES (2026-10-30) ────────────────────────────────────────────────────────
              ⚠️ THIS IS THE PROTOCOL VIEW'S WHOLE RESULT. A protocol places no trades, so before this
              its Result step showed seven statistic tiles and nothing else — the per-bar reading, which
              is the entire output of a protocol, was only reachable by accepting a baseline and opening
              the A/B panel. Rendered for BOTH subjects when asked for: on a strategy it is the reading
              behind the trades, which is how a reader tells an entry problem from an exit problem. */}
          {outputs.scores !== false && Array.isArray(result?.scoreSeries) && result.scoreSeries.length > 0 && (
            <div className="bt-chart-section">
              <h3>
                Score series
                <span className="bt-measured-bars">
                  {' '}· {result.scoreSeries.length.toLocaleString()} bar(s) scored · the reading, not the trades
                </span>
              </h3>
              <Suspense fallback={<p className="pb-none">Loading the score series…</p>}>
                <ScoreSeriesTable scoreSeries={result.scoreSeries} />
              </Suspense>
            </div>
          )}

          {/* ── REPLAY (2026-10-30) ──────────────────────────────────────────────────────────────
              ⚠️ MOVED OFF THE PAGE CHROME AND BEHIND THE OUTPUTS CHOICE. It used to render on EVERY
              step, below the panel, for any strategy route with a run id — so it appeared while the
              reader was still choosing a window, and it fetched its own payload whether or not anyone
              watched it. Owner direction: *"Make this output an option."* */}
          {subject === 'strategy' && outputs.replay === true && result?.id && (
            <div className="bt-chart-section">
              <h3>Replay <span className="bt-measured-bars">· the run’s bars played forward with its trades marked</span></h3>
              <ReplayPlayer runId={result.id} />
            </div>
          )}

      </div>
        </>
      )}
        {/* ── Continue ────────────────────────────────────────────────────────────────────────────
            Steps 1-3 have no action of their own — they are configuration, so "done" quietly happens
            and the reader is left with nothing to press. This is that button. It is NOT shown on
            step 5, where the Run button IS the action, or on step 6, which is terminal. */}
        {activeStep < STEP_RUN && stepValid[activeStep] && stepUnlocked[activeStep + 1] && (
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
          you run — numbering that would put it in a position that is wrong for every step. It stays
          outside the steps, always available.

          ⚠️ "COMPLETED RUNS" IS NO LONGER ONE OF THEM (owner direction, 2026-10-31: *"move that to a
          new page for the area"*). Stored-run review left for `/lab/backtest-runs`; this page keeps
          only the panels that describe THIS run and the A/B pair.

          ⚠️ WHY TABS AND NOT THREE STACKED PANELS (owner report, 2026-10-22: *"the new page is
          actually a mess"*). This page had grown to NINE vertically stacked blocks. Everything was
          present and nothing was findable. One panel at a time is what makes each findable.

          ⚠️ THE CAPTURED-WINDOWS PANEL IS NOT HERE AT ALL (2026-10-22). It moved to
          `/lab/backtest-data`, the inventory of DATA: a captured period is a named, noted, imported
          window of bars, and storage management beside a measurement form is the wrong control on
          the wrong page. This page only CONSUMES periods — the step-2 Window control lists them. */}
      <nav className="bt-ref-tabs" aria-label="Reference panels">
        {[
          { id: 'current', label: 'Run A · accepted baseline', hint: 'The run you accepted as the reference. B is measured against it.' },
          { id: 'latest', label: 'Run B · latest', hint: 'The most recent stored run, in the same shape as A. Accept it to promote it to A.' },
          // `runs` was here — moved to /lab/backtest-runs (2026-10-31). Stored-run review is its own
          // job, not a fifth tab on a measurement form.
          { id: 'scores', label: 'A vs B differences', hint: 'What changed between the accepted baseline and the latest run — summarised, not every row.' },
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

      {/*
        ── THE PAIR, ON ONE ROW (owner report, 2026-10-30) ──────────────────────────────────────────
        *"We have some doubling of information: 'Run A · accepted baseline' and 'A · Accepted baseline —
        2fd56ab8 accepted' and in between … 'Comparing A against the latest run (7f00cfb8)' … which
        doesn't tell a human much. I think a more interesting design can exist on one row and include
        [accepted] [2fd56ab8] and [the select]."*

        So: ONE row — which run is A, which run is B, and the control that changes B. What it replaced:

          · a `<label>` sentence "Comparing A against …" AND a `p.bt-panel-note` repeating it — the
            same words twice, once as a label and once as a caption;
          · a select whose own option text ran to "the latest run (7f00cfb8) — 7f00cfb8 · VIX 5m ·
            2026-09-09 → 2026-10-20", i.e. the id twice plus material the facts table already lists.

        ⚠️ THE IDS, NOT THE WORDS. "Accepted baseline" and "Latest run" are on the tabs and are what the
        role letter already means; what a reader actually needs to fix a pair is the two ids side by side
        and one control. The "pin it" explanation moved into the select's own `title`/`aria-label`,
        because it explains the CONTROL rather than the data.
      */}
      {(() => {
        const runs = latestRunsQuery.data?.runs ?? latestRunsQuery.data ?? [];
        if (!runs.length) return null;
        return (
          <div className="bt-pair-bar">
            <div className="bt-pair-side">
              <span className="bt-pair-role">A</span>
              {baselineRunId
                ? <code className="bt-pair-id">{String(baselineRunId).slice(0, 8)}</code>
                : <span className="bt-pair-empty">none accepted</span>}
              {baselineRunId && <span className="dp-badge dp-badge--override">accepted</span>}
            </div>

            <span className="bt-pair-arrow" aria-hidden="true">→</span>

            <div className="bt-pair-side">
              <span className="bt-pair-role">B</span>
              <select
                className="ff-select bt-pair-select"
                value={pickedBId ?? ''}
                aria-label="Which stored run is B in this comparison"
                title="Leave on Latest to follow the newest run, or pin one run to compare against a pair that does not move under you."
                onChange={(e) => setPickedBId(e.target.value || null)}
              >
                <option value="">Latest · {String(latestRunId ?? '').slice(0, 8)}</option>
                {runs.slice(0, 20).map((r) => (
                  /* ⚠️ ID + WINDOW ONLY. The symbol and timeframe are in both runs' facts tables, and
                     repeating them in every option is what made this control twice as wide as it needed
                     to be. */
                  <option key={r.id} value={r.id}>
                    {r.id.slice(0, 8)} · {r.period}
                  </option>
                ))}
              </select>
              {pickedBId && (
                <button
                  type="button"
                  className="bt-pair-unpin"
                  onClick={() => setPickedBId(null)}
                  title="Go back to following the latest run"
                >
                  unpin
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {refTab === 'current' && (
        <Suspense fallback={<p className="pb-none">Loading the accepted baseline…</p>}>
          <RunPanel
            role="A"
            runId={baselineRunId}
            accepted
            onClear={baselineRunId ? clearBaseline : null}
            liveReference={liveReference}
            showTrades={subject === 'strategy'}
            emptyHint={
              baseline.source === 'loading'
                ? 'Checking the stored baseline…'
                : baseline.source === 'unreadable'
                  ? '⚠️ The accepted baseline could not be READ, so this is unknown rather than empty. Retry, or accept a run from Backtesting results (B) to replace it.'
                  : baseline.source === 'invalid'
                    ? '⚠️ The stored baseline row could not be parsed. Accept a run from Backtesting results (B) to replace it.'
                    : subject === 'strategy'
                      ? 'No baseline accepted yet. Open Backtesting results (B) and accept a run — it becomes A, and every later run is measured against it.'
                      : 'No baseline accepted yet. Run a backtest, then accept it from Backtesting results (B) — it becomes A.'
            }
          />
        </Suspense>
      )}

      {refTab === 'latest' && (
        <Suspense fallback={<p className="pb-none">Loading the most recent run…</p>}>
          <RunPanel
            role="B"
            runId={bRunId}
            onAccept={bRunId ? () => acceptBaseline(bRunId) : null}
            showTrades={subject === 'strategy'}
            emptyHint="No backtest has been stored yet, so there is nothing in B to compare against A."
          />
        </Suspense>
      )}

      {/*
        ⚠️ THE `runs` TAB WAS MOVED OFF THIS PAGE (owner direction, 2026-10-31) to `/lab/backtest-runs`.

        Owner, 2026-10-31: *"I'm realising this one page is very complex especially with the [Completed
        runs] added so move that to a new page for the area."* The panel itself is unchanged and
        `BacktestRunsPanel` is imported there rather than copied, so the #1132 guard that refuses to
        name a winner across two windows, the baseline pinning, and the delete guard all kept one
        implementation. What moved is only WHERE it is mounted.

        The tab list below no longer offers `runs`, and `refTab` can no longer hold that value, so the
        branch that rendered it is deleted rather than left unreachable.
      */}

      {refTab === 'scores' && (
        /* ⚠️ THIS TAB USED TO BE "Score detail" (#1143 follow-up, 2026-10-27): *"Score detail doesn't
           seem to display much but it should probably make differences between the A and B clear so
           that the user doesn't need to examine every row of data."*
           It is now the SUMMARY of A → B: how many bars moved, in which direction, and the ten
           biggest movers — with the unmatched-bar counts stated, because comparing the overlap as if
           it were the whole window is how a window mismatch becomes a false "no change". */
        <Suspense fallback={<p className="pb-none">Comparing the two runs…</p>}>
          <RunDiffPanel aId={baselineRunId} bId={bRunId} showTrades={subject === 'strategy'} />
        </Suspense>
      )}



      {/* #819 — the replay of THIS run. STRATEGIES ONLY (owner direction, 2026-10-27: *"We can remove
          this panel for Backtesting Protocols … but we will be improving it on Backtest Strategies so
          that it shows where trades are executed and exited."*). A scores-only run has no trades to
          replay, so on the Protocols view this panel could only ever say so — and it is a different
          renderer (hand-drawn SVG, see `backtest/replay/`), so its improvements are tracked there. */}
      {null /* Replay moved into the Result step and behind the Outputs choice — see the Outputs step. */}
    </div>
  );
}



