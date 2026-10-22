/**
 * META.Stack Explorer — Vertical Pipeline Trace
 * ==============================================
 * Deep technical walkthrough of the full scoring pipeline (14+ stages),
 * from market data ingestion through directive scoring, risk gating,
 * and final trading signal generation.
 *
 * Role in the META.Stack design cycle (see issue #501):
 *   Tier 1 of 3 — the primary development/debugging tool. Validates that
 *   the system works as intended before building richer displays.
 *   Display (Tier 2) and Triple-Screen (Tier 3) depend on Explorer
 *   verifying pipeline correctness first.
 *
 * Each stage:
 *   - Scroll-reveal card (IntersectionObserver)
 *   - Starts faded → user confirms each step as verified
 *   - Shows function name + explanation + live value
 *   - Popover for deeper technical detail (DB tables, columns, values)
 *   - Nested sub-stages for complex sections (directives, risk gate)
 *
 * Route: /status/meta-stack-explorer
 * Data:  POST /api/scoring/gated/batch (live)
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import FadeCardGroup from '../components/FadeCardGroup';
import './meta-stack-explorer.css';
import PageInfoPopover from '../components/PageInfoPopover';

/* ── Scroll-reveal card (IntersectionObserver pattern from ThemeLabScroll) ── */
function RevealCard({ children, className = '', style = {} }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.unobserve(el); } },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`mse-reveal ${className}`}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
      }}
    >
      {children}
    </div>
  );
}

/* ── Confirmation toggle badge ── */
function ConfirmBadge({ confirmed, onToggle, label }) {
  return (
    <button
      type="button"
      className={`mse-confirm-badge ${confirmed ? 'mse-confirmed' : ''}`}
      onClick={onToggle}
      title={confirmed ? `"${label}" verified — click to unmark` : `Click to confirm "${label}" is working`}
    >
      {confirmed ? '✓ Confirmed' : '○ Unverified'}
    </button>
  );
}

/* ── Info popover (native Popover API pattern from ThemeLabPopover) ── */
function InfoPopover({ id, title, children }) {
  return (
    <div id={id} popover="auto" className="mse-popover">
      <h4 className="mse-popover-title">{title}</h4>
      <div className="mse-popover-body">{children}</div>
    </div>
  );
}

/* ── Pipeline stage definitions ────────────────────────── */
// Labels that assert a trade direction. Two non-directional states are NOT a disagreement — HOLD is
// "measured, no edge", NO_DATA/NO_READING is "nothing measured" — so comparing them by string equality
// would raise a false amber on every unread tick.
const DIRECTIONAL_LABELS = new Set(['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL']);

const PIPELINE = [
  // ── Prerequisites (Stage 0) ──
  {
    // linkTo `/watchlists/add-symbol` REMOVED 2026-10-01: that page was deleted (owner, Page
    // Walkthrough). The replacement is still open — #742 relocates symbol entry into Research and
    // #743 adds an "Import new symbol" action when a search finds no match.
    id: 'prereq-symbols', title: 'Symbol Registration',
    fn: 'SymbolsController.create() / POST /api/symbols',
    fnDesc: 'Symbols must be registered in the database before they can be scored. Built-in symbols (EURUSD, GBPUSD, etc.) come pre-registered as part of the default installation; any other symbol is registered through this endpoint.',
    dbTable: 'symbol',
    dbColumns: 'id (UUID), ticker, name, exchange, type, active',
  },
  {
    id: 'prereq-watchlist', title: 'Watchlist Setup', linkTo: '/watchlists/user-watchlists', linkLabel: 'Watchlists',
    fn: 'Watchlists — built-in defaults available, user should create their own',
    fnDesc: 'A watchlist groups symbols for batch scoring. Built-in watchlists (forex-majors, primary) are provided. User-created watchlists ensure only intended symbols are scored. A protocol must be paired with a watchlist.',
    dbTable: 'watchlist',
    dbColumns: 'id, label, symbols (JSON array of tickers)',
  },
  {
    id: 'prereq-protocol', title: 'Protocol Pairing', linkTo: '/scoring/configure-directives', linkLabel: 'Protocol Editor',
    fn: 'Protocol ←→ Watchlist pairing (Protocol Editor or built-in)',
    fnDesc: 'Many protocols are provided as part of installation (47 built-in). Each must be paired with a watchlist. This pairing is what the automation loop uses to know which symbols to score with which protocol.',
    dbTable: 'scoring_strategy (protocol assignment)',
    dbColumns: 'protocolId, watchlistName, watchlistId',
  },
  {
    id: 'prereq-automation', title: 'Automation Loop', linkTo: '/settings/automation', linkLabel: 'Automation settings',
    fn: 'AutomationLoopService.tick() — 6-step cycle',
    fnDesc: 'The automation loop is a scheduler that ticks every 2 minutes. Each tick: (1) checks timeline events → global risk multiplier, (2) fetches broker portfolios, (3) discovers active trading strategies, (4) reorders by priority queue, (5) runs SEES scoring for strategy symbols, (6) evaluates each strategy for trading decisions. Also records decision trails and saves score snapshots.',
    dbTable: 'automation_state (runtime)',
    dbColumns: 'loopEnabled, tickCount, tickIntervalMs, brokerStates, activeTimelineEvents, globalRiskMultiplier',
  },
  // ── SEES Pipeline (the scoring engine itself — stages 5–11) ──
  { isMarker: true, type: 'sees-start', label: 'SEES Pipeline' },
  {
    id: 'market-data', title: 'Market Data Ingestion', linkTo: '/watchlists/active-symbols', linkLabel: 'Active Symbols',
    fn: 'MarketDataService.getBars()',
    fnDesc: 'Fetches daily OHLCV bars from the MT5 bridge for the requested symbol. Bars are ordered oldest → newest per directive contract.',
    dbTable: 'market_bar',
    dbColumns: 'symbolId, timestamp, open, high, low, close, volume, timeframe',
  },
  {
    id: 'protocol', title: 'Protocol Resolution', linkTo: '/scoring/protocols', linkLabel: 'Protocols',
    fn: 'ProtocolDbService.findBySlug()',
    fnDesc: 'Looks up the protocol configuration from the database. Returns directive groups, direction mode (LONG_ONLY/SHORT_ONLY/BOTH), and weight strategy.',
    dbTable: 'scoring_strategy',
    dbColumns: 'id, name, slug, config (JSON: groups[], directionMode, weightStrategy)',
  },
  {
    id: 'conditions', title: 'Condition Detection',
    fn: 'ConditionDetectorService.detect()',
    fnDesc: 'Analyzes the market environment: session (Asian/London/NY), volatility regime, gap presence, multi-timeframe alignment. Produces a ConditionVector used to gate and weight directives.',
    dbTable: 'N/A (pure computation)',
    dbColumns: 'session, volatility, gapPercent, mtfAlignment',
  },
  {
    id: 'directives', title: 'Directive Execution', linkTo: '/scoring/directives-registry', linkLabel: 'Directives',
    fn: 'DirectivesService.runAll()',
    fnDesc: 'Runs every active directive in the protocol against the symbol. Each directive has independent logic — some need 36+ bars, some check session windows, some query external data. Muted/gated directives return score=0. Time-gated and suitability-gated checks run BEFORE calculation.',
    dbTable: 'directive (registry), score_snapshot (output)',
    dbColumns: 'directive: id, name, maxScore, directionBias, activeWindow | snapshot: composite, signal, snappedAt',
    isComplex: true,
    subs: [
      { id: 'technical', label: 'Technical Analysis', desc: 'Price action, momentum, patterns, volume — weighted at 0.40 in group-weighted mode', color: '#3b82f6' },
      { id: 'sentiment', label: 'Sentiment & Fundamentals', desc: 'Analyst consensus, news, earnings, social — weighted at 0.35. Data-gated: mock-neutral when no API keys connected.', color: '#8b5cf6' },
      { id: 'risk', label: 'Risk & Structural', desc: 'Correlation, dilution, concentration, volatility, liquidity — acts as a multiplier on the composite in group-weighted mode', color: '#ef4444' },
    ],
  },
  {
    id: 'groups', title: 'Group Score Aggregation',
    fn: 'ProtocolGatingService.scoreWithGating() — group phase',
    fnDesc: 'Groups directive results by category (Technical/Sentiment/Risk). Computes each group\'s percentage: sum(rawScores) ÷ sum(maxScores) × 100. Directives with higher maxScore naturally contribute more weight.',
    dbTable: 'score_snapshot',
    dbColumns: 'protocolId, symbol, composite, signal, snappedAt',
  },
  {
    id: 'risk-gate', title: 'Risk Gating',
    fn: 'RiskGatingEngine.apply()',
    fnDesc: 'Applies tiered risk rules to the base score. Hard gates (severity ≥ 0.8) can veto a trade entirely — score → 0. Soft modifiers scale proportionally by severity × weight. Regime overrides change directional bias without affecting magnitude. Cumulative multiplier is floored at 0.5.',
    dbTable: 'N/A (pure computation)',
    dbColumns: 'tier: hard_gate | soft_modifier | regime_override, severity (0-1), multiplier, reason',
    isComplex: true,
    subs: [
      { id: 'budget-gate', label: 'Budget Gate', desc: 'Hard-gate: blocks trades when daily loss limit exceeded. Soft: scales by daily utilization %.', color: '#ef4444' },
      { id: 'dxy-regime', label: 'DXY Regime', desc: 'Regime override: USD strength/weakness changes directional bias. Uses EURUSD as DXY proxy.', color: '#8b5cf6' },
      { id: 'liquidity-check', label: 'Liquidity Check', desc: 'Hard-gate at severity >0.9: blocks when spread too wide for execution. Soft: scales by liquidity score.', color: '#f59e0b' },
      { id: 'rollover-risk', label: 'Rollover Risk', desc: 'Soft modifier: near contract rollover penalizes entries due to expected spread widening.', color: '#f59e0b' },
    ],
  },
  {
    id: 'composite', title: 'Composite Score & Signal', linkTo: '/scoring/live-ordering-stack', linkLabel: 'Scoring Ladder',
    fn: 'ProtocolGatingService.scoreWithGating() — composite phase',
    // #1090 (2026-10-10): this line said "(technical×0.40 + sentiment×0.35) × riskMultiplier,
    // clamped 0–100" — BOTH halves were wrong (measured XAUUSD composite = 106, no clamp).
    // The composite is an additive raw sum; classification is percentage-based against the
    // protocol's own capacity (signalPct = signalRaw ÷ directional capacity).
    // Live number-by-number breakdown: ScoringMechanicsPanel (/trading/trading-bots).
    fnDesc: 'Computes the composite as an additive sum of directive raw scores — no 0–100 clamp. Signal classification is percentage-based against the protocol\'s own capacity: signalPct = signalRaw ÷ directional capacity (≥13% STRONG, ≥6% BUY, <6% HOLD). Stores snapshot in score_snapshot for rarity percentile computation.',
    dbTable: 'score_snapshot (output)',
    dbColumns: 'protocolId, symbol, composite, signal, rarityPercentile, snappedAt',
  },
  { isMarker: true, type: 'sees-end', label: 'SEES End' },
  // ── Post-scoring: Strategy layers ──
  {
    id: 'scoring-strategy', title: 'Trading Strategy Rules', linkTo: '/trading/bot-create', linkLabel: 'Create Strategy',
    fn: 'AutomationLoopService.evaluateStrategy() → gate checks',
    fnDesc: 'Active trading strategies carry rules beyond the raw protocol score: trade threshold comparison (composite must exceed minComposite), budget gate (daily loss limits), and mode-based filtering (manual/semi-auto/auto). A strategy can permit or block a trade independently of the signal. (The scoring_strategy layer was retired from the trading loop 2026-08-27 — its config now lives on the trading strategy.)',
    dbTable: 'trading_strategy, automation_rule',
    dbColumns: 'minComposite, mode (manual|semi-auto|auto), baseSize, slPct, tpPct, maxPyramidTiers',
    isComplex: true,
    subs: [
      // ⚠️ The bar is NOT restated here (#839). This read "(default 65)" — a pre-rescale number
      // that the 2026-09-15 rescale invalidated; the real default is BOT_BAR_DEFAULT (10). A literal
      // in prose cannot be updated by the compiler, so it drifted silently and the build guard does
      // not see it: that guard matches code defaults (property init, ??, ||), not sentences.
      // Point at the live source instead of copying it — Settings → Trade Thresholds reads
      // GET /api/scoring/gated/thresholds, which is the single source of truth for these numbers.
      { id: 'trade-threshold', label: 'Trade Threshold', desc: 'Composite must be ≥ minComposite (the bot bar) for the strategy to permit a trade. Current bars are shown in Settings → Trade Thresholds.', color: '#3b82f6' },
      { id: 'budget-gate-strat', label: 'Budget Gate (Strategy)', desc: 'Daily loss limit check — if cumulative P&L exceeds budget, strategy blocks all new trades.', color: '#ef4444' },
      { id: 'mode-gate', label: 'Mode Gate', desc: 'manual = user must approve, semi-auto = auto-score + manual execute, auto = full automation', color: '#f59e0b' },
      { id: 'directive-gates', label: 'Directive Group Gates', desc: 'Certain grouped directives act as strict gates — all must agree on direction for trade permission.', color: '#8b5cf6' },
    ],
  },
  {
    id: 'trading-strategy', title: 'Trading Strategy Evaluation', linkTo: '/trading/trading-bots', linkLabel: 'Trading Bots',
    fn: 'TradingStrategyService.evaluate() → portfolio-aware decision',
    fnDesc: 'Trading strategies add the portfolio context: Are existing positions profitable? Is the symbol already held? Would this exceed max positions? Does the strategy allow averaging down? Some strategies require existing positions to be in profit before opening new ones. Cooldown periods prevent overtrading.',
    dbTable: 'trading_strategy, decision_log',
    dbColumns: 'minComposite, maxPositions, cooldownMinutes, baseSize, slPct, tpPct, mode (manual|semi-auto|auto)',
    isComplex: true,
    subs: [
      { id: 'portfolio-state', label: 'Portfolio State Check', desc: 'Are current positions in profit? Total P&L, exposure %, per-symbol position count.', color: '#06b6d4' },
      { id: 'max-positions', label: 'Max Positions Gate', desc: 'Strategy may limit total open positions (e.g. max 5). If at limit, new trades blocked.', color: '#f59e0b' },
      { id: 'cooldown', label: 'Cooldown Period', desc: 'After a trade, the strategy enforces a cooldown (e.g. 5 min) before the same symbol can trade again.', color: '#8b5cf6' },
      { id: 'averaging', label: 'Averaging Policy', desc: 'Some strategies allow averaging (adding to losing positions), others forbid it — only add to winners.', color: '#ef4444' },
    ],
  },
  {
    id: 'outcome', title: 'Trade Execution & Outcome', linkTo: '/trading/positions-monitor', linkLabel: 'Positions Monitor',
    fn: 'Mt5Adapter.placeOrder() → TradeRecorderService → Trade Journal',
    fnDesc: 'If all gates pass, the trade is sent to the broker via MT5 bridge. The outcome is recorded: did the order fill? What was the entry price? Over time, outcomes are compared against signals to measure prediction accuracy. Manual trades not executed through the app won\'t have this data — but testing uses the app for full traceability.',
    dbTable: 'trade (execution), decision_log (permission), trade_journal (outcome)',
    dbColumns: 'trade: symbol, type, volume, entryPrice, exitPrice, pnl | decision_log: strategyId, symbol, decision, composite, reason',
  },

  // ── Bot-layer steps added 2026-10-08 (owner: "review this page for potential new steps that isn't
  //    integrated. Especially around bots."). Findings tracked in #1094. The page previously went
  //    straight from evaluation to execution; everything the bot layer does around those two — queue,
  //    permission, guards, exits, attribution — was invisible on the one page meant to show the path.
  {
    id: 'subscription-gate', title: 'Subscription Gate', linkTo: '/trading/trading-bots', linkLabel: 'Trading Bots',
    fn: 'SignalQueueService.syncQueues() — routing reads strategy_protocol',
    fnDesc: 'A bot is routed to a protocol through a SUBSCRIPTION row (strategy_protocol), not through trading_strategy.protocolId. ⚠️ A bot with no subscription row SILENTLY NEVER TRADES: it appears active in the UI, produces no queue entries, and reports no error. This is the single most common reason a correctly-configured bot does nothing, and it sits between "evaluation" and "execution" where nothing else explains the silence.',
    dbTable: 'strategy_protocol (the routing authority), trading_strategy',
    dbColumns: 'strategyId, protocolId, role (long|short)',
  },
  {
    id: 'signal-queue', title: 'Signal Queue', linkTo: '/automation/execution-queue', linkLabel: 'Execution Queue',
    fn: 'SignalQueueService.syncQueues() → strategy_signal_queue',
    fnDesc: 'The step BETWEEN evaluation and execution: a permitted signal is written to a queue row, which carries its own status, and is consumed on a later tick. Rows expire (they do not live forever) and are subject to a freshness bound, so a signal that ages out is dropped rather than executed late. A blocked queue row records WHY it was blocked, which is the only place that reason is preserved.',
    dbTable: 'strategy_signal_queue',
    dbColumns: 'strategyId, symbol, protocolId, direction, signal, combinedStrength, status, blockCause, createdAt, updatedAt',
  },
  {
    id: 'execution-guards', title: 'Execution Guards', linkTo: '/trading/positions-monitor', linkLabel: 'Positions Monitor',
    fn: 'preTradeReady / executionBlockers → DuplicateGuardService → position cap',
    fnDesc: 'Between "the bot wants to trade" and "an order is sent" sit guards that can refuse it: execution feasibility (volume floor, whether this broker can trade this instrument at all, venue mismatch), the duplicate guard (an open position on the same symbol/provider, or a trade inside a cooldown window), and the position cap. ⚠️ The duplicate guard is direction-UNAWARE: a live LONG on an instrument blocks a SHORT on the same instrument. These refuse a trade the score permitted, so a "no trade" here is a decision, not a failure.',
    dbTable: 'trade (open positions), position, symbol_route (venue)',
    dbColumns: 'duplicate guard: symbol + provider + cooldownMinutes | cap: maxPositions',
    isComplex: true,
    subs: [
      { id: 'feasibility', label: 'Execution Feasibility', desc: 'Can this broker trade this instrument at this size? Volume floor and venue capability. Assessed at generation AND re-checked at execution.', color: '#06b6d4' },
      { id: 'duplicate', label: 'Duplicate Guard', desc: 'Blocks a second position on the same symbol/provider, and re-entry inside a cooldown. ⚠️ Symbol+provider only — not direction-aware.', color: '#ef4444' },
      { id: 'position-cap', label: 'Position Cap', desc: 'A hard ceiling on open positions. Can refuse a trade the score allowed.', color: '#f59e0b' },
    ],
  },
  {
    id: 'exit-authority', title: 'Post-Entry Exit Authority', linkTo: '/lab/position-lifecycle', linkLabel: 'Position Lifecycle',
    fn: 'StopGuardianService → PositionTimeStopService → ExhaustionObserver',
    fnDesc: 'Once a position is open, THREE authorities can close it, and none of them is the signal that opened it: stop management (directive-based trailing stops — the ONE canonical implementation), the time stop (positions are not held indefinitely), and exhaustion observation. A position closing is therefore not evidence that the original signal was wrong.',
    dbTable: 'position, trade, stop_adjustment (via StopGuardianService)',
    dbColumns: 'sl, tp, trailing state, openedAt (time stop basis)',
    isComplex: true,
    subs: [
      { id: 'stop-guardian', label: 'Stop Guardian', desc: 'Directive-based trailing stop management. The single canonical implementation for post-entry stops.', color: '#8b5cf6' },
      { id: 'time-stop', label: 'Time Stop', desc: 'Closes a position that has been held too long, independent of price.', color: '#f59e0b' },
      { id: 'exhaustion', label: 'Exhaustion Observer', desc: 'Watches for a move losing energy and feeds the exit decision.', color: '#06b6d4' },
    ],
  },
  {
    id: 'attribution', title: 'Close Reason & Attribution', linkTo: '/trading/trade-journal', linkLabel: 'Trade Journal',
    fn: 'common/trading/close-reason.ts → ExitDataRecovery → trade.abTestSide',
    fnDesc: 'WHY a trade closed is derived, not assumed, and it is the input to every later "did the strategy work?" question. ⚠️ An unclassified close reads as broker:unknown — absence of evidence, not a named reason — so a repair path may overwrite it, while a NAMED reason is evidence and stays. Attribution to an A/B arm comes from the recorded side, never from an editable broker comment.',
    dbTable: 'trade (closeReason, pnl, abTestSide), trade_journal',
    dbColumns: 'closeReason, closedAt, pnl, abTestId, abTestSide',
  },
];

/* ── PLANNED IN #1129 ──
 * MISSING:  a readability pass. Every stage now renders its measured values and reasons at ALL
 *           times (owner decision 2026-10-20 — the three-level switch was replaced by a single
 *           Pause/Play control). The page is therefore dense by design, and nothing has been done
 *           to make that density scannable.
 * TODAY:    each stage is a flat list of rows; label, value and reason compete for the eye, and a
 *           stage with 11 directives produces a long table with no summary line.
 * WHEN BUILT: order rows by result (fail → warn → na → pass) so the thing needing attention is
 *           first, and let a stage collapse to its worst row when the page is not being read.
 */

/* ── Main component ────────────────────────────────────── */
export default function MetaStackExplorerPage() {
  const [confirmedStages, setConfirmedStages] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mse-confirmed-stages') || '{}'); }
    catch { return {}; }
  });
  const [selectedStrategyId, setSelectedStrategyId] = useState(() => {
    try { return localStorage.getItem('mse-selected-strategy') || null; }
    catch { return null; }
  });
  const [scrollPct, setScrollPct] = useState(0);

  // ── PAUSE / PLAY — the one control on this page ─────────────────────────────────────────────
  //
  // Owner direction, 2026-10-20: *"rather than three levels I just want a toggle to Pause or Play.
  // Pause will allow me to view every step on the latest score. Play will automatically refresh the
  // page … instead of two levels of information on the UI I want it all displayed at all times."*
  //
  // So there is no level switch any more: every check, every measured value and every engine
  // reason is rendered at all times. The ONLY thing this control changes is whether the page
  // re-reads — nothing about what is shown.
  //
  // ⚠️ PAUSED IS THE DEFAULT, and that is deliberate: a diagnostic page that moves under the
  // reader is how a number gets read from one tick and compared against another. Paused is the
  // same behaviour the page had before this control existed (fetch on mount, then hold), so
  // defaulting to it cannot surprise anyone. Play is opt-in and obvious.
  const [playing, setPlaying] = useState(() => {
    try { return localStorage.getItem('mse-live') === 'on'; } catch { return false; }
  });
  const choosePlaying = (next) => {
    setPlaying(next);
    try { localStorage.setItem('mse-live', next ? 'on' : 'off'); } catch {}
  };

  // PLAY = re-read on an interval. PAUSE = the interval does not exist, so nothing can move.
  //
  // Every `mse-*` query on the page is invalidated together: a refresh that updated some panels
  // and not others would let two stages describe different ticks while looking like one record.
  const PLAY_INTERVAL_MS = 15_000;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      queryClient.invalidateQueries({
        predicate: (q) => String(q?.queryKey?.[0] ?? '').startsWith('mse-'),
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, queryClient]);

  // ── Prerequisite data queries ──
  const symbolsQuery = useQuery({
    queryKey: ['mse-symbols-count'],
    queryFn: () => apiGet('/api/symbols').catch(() => ({ symbols: [] })),
    staleTime: 60_000,
  });
  const watchlistsQuery = useQuery({
    queryKey: ['mse-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => []),
    staleTime: 60_000,
  });
  const autoQuery = useQuery({
    queryKey: ['mse-automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => ({})),
    refetchInterval: 30_000,
  });
  const providerHealthQuery = useQuery({
    queryKey: ['mse-provider-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => ({})),
    staleTime: 30_000,
  });
  const scoringStratsQuery = useQuery({
    queryKey: ['mse-scoring-strats'],
    queryFn: () => apiGet('/api/automation/scoring-strategies').catch(() => []),
    staleTime: 60_000,
  });
  const tradingStratsQuery = useQuery({
    queryKey: ['mse-trading-strats'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => []),
    staleTime: 60_000,
  });
  const positionsQuery = useQuery({
    queryKey: ['mse-positions'],
    queryFn: () => apiGet('/api/trading/mt5/positions').catch(() => []),
    refetchInterval: 30_000,
  });
  // Directive registry — used for readiness badges on directive results
  const directivesQuery = useQuery({
    queryKey: ['mse-directives'],
    queryFn: () => apiGet('/api/directives').catch(() => []),
    staleTime: 120_000,
  });

  // ── Derived from selected Trading Strategy (cascades through all stages) ──
  const tradingStrats = Array.isArray(tradingStratsQuery.data) ? tradingStratsQuery.data : [];
  const selectedStrategy = tradingStrats.find(s => s.id === selectedStrategyId) || null;
  const activeSymbol = selectedStrategy?.symbol || null;
  const activeProtocolId = selectedStrategy?.protocolId || null;

  // ── Scroll progress bar (ThemeLabScroll pattern) ──
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      setScrollPct(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) * 100);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleConfirm = (stageId) => setConfirmedStages(prev => {
    const next = { ...prev, [stageId]: !prev[stageId] };
    try { localStorage.setItem('mse-confirmed-stages', JSON.stringify(next)); } catch {}
    return next;
  });
  const confirmAll = () => { const a = {}; PIPELINE.forEach(s => { if (!s.isMarker) a[s.id] = true; }); setConfirmedStages(a); try { localStorage.setItem('mse-confirmed-stages', JSON.stringify(a)); } catch {} };
  const resetAll = () => { setConfirmedStages({}); try { localStorage.removeItem('mse-confirmed-stages'); } catch {} };

  const protoQuery = useQuery({
    queryKey: ['mse-protocols-v2'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const protocols = protoQuery.data?.protocols ?? [];

  // ⚠️ DECLARED HERE, ABOVE EVERY CONSUMER — caught by a real browser, not by the linter.
  //
  // `technicalValues` (below) reads `selectedProtocol?.tradingStyle` for the pre-trade gate. This
  // const used to sit ~300 lines BELOW it, which is a temporal-dead-zone crash at render:
  //   ReferenceError: Cannot access 'selectedProtocol' before initialization
  //
  // ⚠️ `no-use-before-define` did NOT catch this one. The rule reports a reference to a later
  // `const` only within the SAME scope; this reference is inside a nested memo callback, so ESLint
  // stays silent while the page still blanks. The only check that found it was driving the real
  // browser (logs/canary-mse-render.cjs). Do not treat the linter as coverage for this class.
  const selectedProtocol = protocols.find(p => p.id === activeProtocolId);

  // ⚠️ DECLARATION ORDER IS LOAD-BEARING — this block MOVED here on 2026-10-20.
  //
  // It used to sit ~350 lines below, next to the Score Momentum query. The Technical-level memos
  // below read `scored` (in their bodies AND in their dependency arrays, which are evaluated
  // immediately), so every one of them hit the temporal dead zone:
  //
  //     ReferenceError: Cannot access 'scored' before initialization
  //
  // …and the whole page rendered blank. A build cannot catch this — it is a runtime ordering
  // fault that `tsc` and Vite both accept. `scoreQuery` depends only on `activeSymbol` and
  // `activeProtocolId`, so it belongs with the other fetches, above anything that reads it.
  const scoreQuery = useQuery({
    queryKey: ['mse-score-v2', activeSymbol, activeProtocolId],
    queryFn: async () => {
      if (!activeSymbol || !activeProtocolId) return null;
      const r = await apiPost('/api/scoring/gated/batch', { tickers: [activeSymbol], protocolId: activeProtocolId });
      return Array.isArray(r) ? r[0] : null;
    },
    enabled: !!activeSymbol && !!activeProtocolId,
    staleTime: 10_000,
  });

  const scored = scoreQuery.data;

  // ⚠️ MOVED HERE with `scoreQuery` (2026-10-20). `allProtocolsData` is read by the Technical-level
  // memos below, and it used to be declared ~350 lines later — `ReferenceError: Cannot access
  // 'allProtocolsData' before initialization`. Same fault as `scored`; same fix: a fetch belongs
  // above everything that reads it.
  const protoAllQuery = useQuery({
    queryKey: ['mse-protocols-all'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const allProtocolsData = protoAllQuery.data?.protocols ?? [];

  // ⚠️ MEASURED CEILING — the number that explains every "0-33" composite, and it was already
  // being computed and served by `/api/scoring/gated/thresholds` with nothing displaying it.
  //
  // `protocolCeilings[slug].ceilingPct` is the HIGHEST percentage that protocol reached in
  // `ceilingWindowDays` (90). Measured 2026-10-20: one-directive probes reach 60-100%, three
  // directives reach 42%, and the 7-13 directive protocols reach 17-29%. A tick cannot exceed the
  // ceiling, so the practical scoring range is 0 -> ceiling, while `entry` (6%) and `strong` (13%)
  // are fixed percentages of CONFIGURED capacity. On `xau-speed-m15` (ceiling 24.2%) "strong" is
  // 54% of everything the protocol can ever achieve. See #1131.
  //
  // Declared HERE, above `technicalValues`, for the reason recorded at `scoreQuery`: a top-level
  // const read by a later hook is a temporal-dead-zone crash, not a type error.
  const thresholdsQuery = useQuery({
    queryKey: ['mse-thresholds'],
    queryFn: () => apiGet('/api/scoring/gated/thresholds').catch(() => null),
    staleTime: 120_000,
  });

  // ── MEASURED VALUES — stage 1 (Symbol Registration) ─────────────────────────────────────────
  //
  // ⚠️ WHY THIS EXISTS. The pipeline row "Non-default symbol added" reports a FAIL on a healthy
  // FX-only install: it is a tutorial prompt wearing a pass/fail badge. Worse, the question that
  // actually matters had NO surface anywhere in the app — *"which registered symbols does no active
  // protocol ever resolve?"* A symbol in that state is never scored, never queued and never traded,
  // and nothing reports it. That is the defect class this block is for.
  //
  // Everything below is computed from payloads this page ALREADY fetches (`/api/symbols` and
  // `/api/scoring/gated/protocols`), so it describes the SAME snapshot as the rows above it. No new
  // request, and with Pause on, nothing can move under the reader.
  const symbolTech = useMemo(() => {
    const raw = symbolsQuery.data;
    const rows = Array.isArray(raw?.symbols) ? raw.symbols : Array.isArray(raw) ? raw : [];
    const byType = rows.reduce((acc, r) => {
      const key = r.type || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const registered = new Set(rows.map((r) => String(r.ticker || '').toUpperCase()).filter(Boolean));
    const resolved = new Set();
    for (const p of protocols) {
      for (const s of (p.resolvedSymbols || [])) resolved.add(String(s).toUpperCase());
    }
    const covered = [...resolved].filter((t) => registered.has(t));
    const orphans = [...registered].filter((t) => !resolved.has(t));
    return {
      total: rows.length,
      activeCount: rows.filter((r) => r.active !== false).length,
      byType,
      covered,
      orphans,
      selectedResolved: activeSymbol ? resolved.has(String(activeSymbol).toUpperCase()) : null,
    };
  }, [symbolsQuery.data, protocols, activeSymbol]);

  // ── MEASURED VALUES — bar freshness ─────────────────────────────────────────────────────────
  //
  // ⚠️ This is the stage that answers "is it the data?" — the question that took four hours by
  // hand on 2026-10-19. It reads ONE endpoint (`/api/market-data/freshness`) and reports what it
  // says rather than re-deriving it: ⚠️ the endpoint currently reports the `1h` cadence only, so
  // every other cadence is `na` here rather than silently presented as covered.
  const freshnessQuery = useQuery({
    queryKey: ['mse-freshness'],
    queryFn: () => apiGet('/api/market-data/freshness').catch(() => ({ results: [] })),
    staleTime: 60_000,
  });

  const marketTech = useMemo(() => {
    const results = Array.isArray(freshnessQuery.data?.results) ? freshnessQuery.data.results : [];
    const ages = results.map((r) => r.ageMinutes).filter((a) => Number.isFinite(a)).sort((a, b) => a - b);
    const selected = activeSymbol
      ? results.find((r) => String(r.ticker).toUpperCase() === String(activeSymbol).toUpperCase())
      : null;
    return {
      count: results.length,
      fresh: results.filter((r) => r.status === 'fresh').length,
      stale: results.filter((r) => r.status === 'stale').length,
      missing: results.filter((r) => r.status === 'missing').length,
      medianAge: ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null,
      oldestAge: ages.length ? Math.round(ages[ages.length - 1]) : null,
      selected,
    };
  }, [freshnessQuery.data, activeSymbol]);

  // ── MEASURED VALUES — directive rows (the walk-through surface) ─────────────────────────────
  //
  // ⚠️ Every field below is produced by the engine and was ALREADY in the payload; the page showed
  // only name + score + class. The two that explain a wrong-looking number are `reason` (the
  // engine's own sentence) and `inSignal` (whether that reading counted). Measured 2026-10-19:
  // `xau-speed-m15` returned `0 / 910` while eleven directives measured, two of them `bearish`,
  // and nothing on this page could show that.
  const directiveRows = useMemo(() => {
    const breakouts = scored?.breakouts || {};
    const rows = [];
    for (const [groupId, list] of Object.entries(breakouts)) {
      for (const d of (list || [])) {
        rows.push({
          groupId,
          directiveId: d.directiveId,
          name: d.name,
          score: d.score,
          maxScore: d.maxScore,
          normalizedScore: d.normalizedScore,
          signalClass: d.signalClass || 'neutral',
          counted: d.inSignal === true,
          unmeasured: d.unmeasured === true,
          reason: d.reason || null,
        });
      }
    }
    // Counted first, then the biggest raw readings — the rows a reader needs are at the top.
    return rows.sort((a, b) => (Number(b.counted) - Number(a.counted)) || ((b.score || 0) - (a.score || 0)));
  }, [scored]);

  // ⚠️ THE SHARE COLUMN'S DENOMINATOR IS *NOT* THE TICK'S DIVISOR, and conflating them would
  // produce a confidently wrong percentage for every gate directive.
  //
  // `configuredSignalMax` (910 on `xau-speed-m15`) EXCLUDES gate directives — `liquidity-check`
  // declares 100 but is not in the signal divisor. So dividing each directive's maxScore by 910
  // would overstate gate directives and the shares would not sum to 100%.
  //
  // Summing every declared maxScore gives a denominator that is internally consistent: the shares
  // sum to 100%, and the gap between this total and `configuredSignalMax` IS the gate capacity.
  const declaredCapacity = directiveRows.reduce((sum, d) => sum + (d.maxScore || 0), 0);

  const technicalValues = useMemo(() => ({
    'prereq-symbols': [
      { label: 'Registered', value: String(symbolTech.total), status: symbolTech.total > 0 ? 'pass' : 'fail', reason: 'rows in the Symbol table' },
      { label: 'Active', value: String(symbolTech.activeCount), status: symbolTech.activeCount > 0 ? 'pass' : 'warn', reason: 'an inactive symbol is never scored' },
      {
        label: 'By type',
        value: Object.entries(symbolTech.byType).map(([k, v]) => `${k} ${v}`).join(' · ') || '—',
        // Ticked when the value is PRESENT — the owner asked for that explicitly (2026-10-20):
        // a row that reports real data confirms the mechanism works and should not read as a gap.
        status: symbolTech.total > 0 ? 'pass' : 'na',
        reason: 'symbol types present — the type decides the market calendar and the venue gate',
      },
      {
        label: 'Resolved by an active protocol',
        value: String(symbolTech.covered.length),
        status: symbolTech.covered.length > 0 ? 'pass' : 'fail',
        reason: 'symbols at least one active protocol resolves to',
      },
      {
        label: 'Registered but resolved by none',
        value: String(symbolTech.orphans.length),
        status: symbolTech.orphans.length > 0 ? 'warn' : 'pass',
        reason: 'never scored, never queued, never traded — and no other surface in the app reports it',
      },
      ...(activeSymbol ? [{
        label: `Selected symbol (${activeSymbol})`,
        value: symbolTech.selectedResolved ? 'resolved' : 'not resolved',
        status: symbolTech.selectedResolved ? 'pass' : 'fail',
        reason: symbolTech.selectedResolved
          ? 'an active protocol resolves this symbol'
          : 'no active protocol resolves it, so nothing downstream can score it',
      }] : [{ label: 'Selected symbol', value: '—', status: 'na', reason: 'no strategy selected above' }]),
      {
        label: 'symbol_route coverage',
        value: 'unknown',
        status: 'na',
        reason: 'no endpoint exposes per-symbol routes. symbol_route has ONE writer (Mt5Controller) and no seeder, so "routed or not" cannot be read from here',
      },
    ],

    // ── Stage 2: Watchlists ──────────────────────────────────────────────────────────────────
    'prereq-watchlist': (() => {
      const raw = watchlistsQuery.data;
      const lists = Array.isArray(raw?.watchlists) ? raw.watchlists : Array.isArray(raw) ? raw : [];
      const builtIn = lists.filter((w) => w.kind === 'built-in').length;
      const user = lists.length - builtIn;
      const empty = lists.filter((w) => !(w.symbolCount > 0)).length;
      const linkedToProtocol = lists.filter((w) => !!w.protocolId);
      return [
        { label: 'Watchlists', value: String(lists.length), status: lists.length > 0 ? 'pass' : 'fail', reason: `${builtIn} built-in · ${user} user-created` },
        {
          label: 'Empty watchlists',
          value: String(empty),
          status: empty > 0 ? 'warn' : 'pass',
          reason: 'a watchlist with 0 symbols resolves no protocol symbols — it looks configured and does nothing',
        },
        {
          label: 'Linked to a protocol',
          value: `${linkedToProtocol.length}`,
          status: linkedToProtocol.length > 0 ? 'pass' : 'warn',
          reason: linkedToProtocol.length
            ? linkedToProtocol.map((w) => `${w.id}→${w.protocolId}`).join(', ')
            : 'no watchlist names a protocol — protocol symbols must then come from an explicit assignment or derive rule',
        },
      ];
    })(),

    // ── Stage 3: Protocol pairing ────────────────────────────────────────────────────────────
    'prereq-protocol': (() => {
      const gated = protocols;
      const activeProtoIds = new Set(gated.filter((p) => p.active !== false).map((p) => p.id));
      const linked = new Set(tradingStrats.map((s) => s.protocolId).filter(Boolean));
      const zeroSymbols = gated.filter((p) => p.active !== false && (p.resolvedSymbols || []).length === 0);
      const registered = new Set(
        (Array.isArray(symbolsQuery.data?.symbols) ? symbolsQuery.data.symbols : Array.isArray(symbolsQuery.data) ? symbolsQuery.data : [])
          .map((r) => String(r.ticker || '').toUpperCase()),
      );
      const unregistered = gated
        .filter((p) => p.active !== false)
        .flatMap((p) => (p.resolvedSymbols || []).filter((t) => !registered.has(String(t).toUpperCase())).map((t) => `${p.id}:${t}`));
      return [
        { label: 'Protocols', value: String(gated.length), status: gated.length > 0 ? 'pass' : 'fail', reason: `${activeProtoIds.size} active · ${allProtocolsData.length || '—'} in the registry` },
        { label: 'Linked to a trading strategy', value: String(linked.size), status: linked.size > 0 ? 'pass' : 'fail', reason: 'a protocol with no bot is scoreable but never tradeable' },
        {
          label: 'Active protocols resolving ZERO symbols',
          value: String(zeroSymbols.length),
          status: zeroSymbols.length > 0 ? 'warn' : 'pass',
          reason: zeroSymbols.length
            ? zeroSymbols.map((p) => `${p.id} (${p.name || '—'})`).join(', ')
            : 'every active protocol resolves at least one symbol',
        },
        {
          label: 'Resolved symbols not registered',
          value: String(unregistered.length),
          status: unregistered.length > 0 ? 'fail' : 'pass',
          reason: unregistered.length ? unregistered.slice(0, 12).join(', ') : 'every resolved ticker exists in the Symbol table',
        },
      ];
    })(),

    // ── Stage 4: Market data ─────────────────────────────────────────────────────────────────
    'market-data': [
      { label: 'Symbols with a freshness row', value: String(marketTech.count), status: marketTech.count > 0 ? 'pass' : 'warn', reason: 'the freshness sweep only covers active symbols' },
      {
        label: 'Fresh / stale / missing',
        value: `${marketTech.fresh} / ${marketTech.stale} / ${marketTech.missing}`,
        status: marketTech.stale + marketTech.missing > 0 ? 'warn' : 'pass',
        reason: 'stale = the feed is behind on an open market; missing = no bars at all',
      },
      {
        label: 'Bar age (median / oldest)',
        value: `${marketTech.medianAge ?? '—'} / ${marketTech.oldestAge ?? '—'} min`,
        status: marketTech.medianAge != null ? 'pass' : 'na',
        reason: 'measured against the newest stored bar per symbol — the value is the finding, not a verdict',
      },
      ...(marketTech.selected ? [{
        label: `Selected symbol (${activeSymbol})`,
        value: marketTech.selected.status,
        status: marketTech.selected.status === 'fresh' ? 'pass' : 'fail',
        reason: `newest ${marketTech.selected.timeframe} bar ${marketTech.selected.latestTimestamp || 'none'} · age ${Math.round(marketTech.selected.ageMinutes ?? 0)} min`,
      }] : [{ label: 'Selected symbol', value: '—', status: 'na', reason: 'no strategy selected above' }]),
      {
        label: 'Other cadences',
        value: 'unknown',
        status: 'na',
        reason: 'this endpoint reports the 1h cadence only — 5m/15m/1d freshness is not exposed here and must not be read as healthy',
      },
    ],

    // ── Stage 5: Conditions ──────────────────────────────────────────────────────────────────
    'conditions': (() => {
      if (!scored) return [{ label: 'Awaiting scoring', value: '—', status: 'na', reason: 'select a protocol above' }];
      const inactive = scored.inactiveGroupIds || [];
      return [
        {
          label: 'Gating active',
          value: scored.gatingActive === false ? 'inactive' : 'active',
          status: scored.gatingActive === false ? 'warn' : 'pass',
          reason: 'whether the gate framework was consulted this tick — NOT whether a rule changed the outcome',
        },
        {
          label: 'Directives producing direction',
          value: `${directiveRows.filter((d) => d.counted).length} of ${directiveRows.length}`,
          status: directiveRows.some((d) => d.counted) ? 'pass' : 'warn',
          reason: 'zero means the tick is a no-data verdict whatever the individual scores say',
        },
        {
          label: 'Inactive groups',
          value: inactive.length ? inactive.join(', ') : 'none',
          // An inactive group keeps its capacity in the denominator while contributing nothing to
          // the numerator, so its presence is worth seeing — `warn`, not a neutral informational.
          status: inactive.length ? 'warn' : 'pass',
          reason: 'a group with no reading this tick contributes nothing to the numerator but keeps its capacity in the denominator',
        },
      ];
    })(),

    // ── Stage 6: Group aggregation ───────────────────────────────────────────────────────────
    'groups': (() => {
      if (!scored) return [{ label: 'Awaiting scoring', value: '—', status: 'na', reason: 'select a protocol above' }];
      const raw = scored.subRawTotals || {};
      const max = scored.subMaxTotals || {};
      const rows = Object.keys({ ...raw, ...max }).map((g) => {
        const r = raw[g] || 0;
        const m = max[g] || 0;
        return {
          label: g,
          value: `${r}/${m}${m > 0 ? ` (${Math.round((r / m) * 100)}%)` : ''}`,
          status: m > 0 ? 'pass' : 'na',
          reason: m > 0 ? `group capacity ${m} counted in the signal denominator` : 'no capacity this tick — the group produced no eligible directive',
        };
      });
      return rows.length ? rows : [{ label: 'Groups', value: '—', status: 'na', reason: 'the payload carried no group totals' }];
    })(),

    // ── Stage 7: Risk gating ─────────────────────────────────────────────────────────────────
    'risk-gate': (() => {
      if (!scored) return [{ label: 'Awaiting scoring', value: '—', status: 'na', reason: 'select a protocol above' }];
      const gate = scored.riskGate || {};
      const chain = gate.multiplierChain || [];
      return [
        {
          label: 'Hard gate',
          value: gate.hardGateTriggered ? 'TRIGGERED' : 'none',
          status: gate.hardGateTriggered ? 'fail' : 'pass',
          reason: gate.hardGateReason || 'no rule vetoed the trade',
        },
        {
          label: 'Multiplier',
          value: scored.riskMultiplier != null ? `×${Number(scored.riskMultiplier).toFixed(3)}` : 'not evaluated',
          status: scored.riskMultiplier == null ? 'na' : scored.riskMultiplier < 1 ? 'warn' : 'pass',
          reason: scored.riskMultiplier == null
            ? 'risk gating was not evaluated on this path — absence, not a multiplier of 1'
            : scored.riskMultiplier < 1 ? 'reduced by at least one rule' : 'no rule reduced the composite',
        },
        {
          label: 'Rules applied',
          value: String(chain.length),
          status: chain.length ? 'pass' : 'na',
          reason: chain.length
            ? chain.map((r) => `${r.name}${r.multiplier != null ? ` ×${Number(r.multiplier).toFixed(3)}` : ''}`).join(' · ')
            : 'no risk rule produced a multiplier this tick — the chain being empty is not evidence the gate ran',
        },
      ];
    })(),

    // ── Stage 8: Composite — the denominator, which is where a zero comes from ───────────────
    'composite': (() => {
      // Ceiling rows are protocol-level and stand on their own — they render even when this tick
      // produced no score, because "can this protocol ever fire?" is a different question.
      const t = thresholdsQuery.data;
      const ceiling = t?.protocolCeilings?.[activeProtocolId] ?? null;
      const entry = t?.classification?.entry ?? null;
      const strong = t?.classification?.strong ?? null;
      const style = selectedProtocol?.tradingStyle;
      // ⚠️ THE LABEL IS NOT THE KEY. The registry carries `tradingStyle: "Day Trade"` while
      // `preTradeGate.byStyle` keys are kebab-case (`day-trade`). Looking up the label directly
      // returned `undefined` and fell through to the default — silently. It happens to give the
      // same number for Day Trade (both 10), but `scalp` is 12 and `swing` is 9, so a protocol
      // whose style resolved wrongly would be gated against a bar its style never asked for, with
      // no error anywhere. Normalise before lookup and name the resolved key in the reason.
      const styleKey = typeof style === 'string'
        ? style.trim().toLowerCase().replace(/\s+/g, '-')
        : null;
      const gate = t?.preTradeGate?.byStyle?.[styleKey] ?? t?.preTradeGate?.default ?? null;
      const gateSource = t?.preTradeGate?.byStyle?.[styleKey] != null
        ? `style "${styleKey}"`
        : styleKey ? `default (no entry for style "${styleKey}")` : 'default (no style resolved)';
      const pctOf = (bar) => (ceiling && ceiling.ceilingPct > 0 && bar != null
        ? Math.round((bar / ceiling.ceilingPct) * 100)
        : null);

      const ceilingRows = [
        {
          label: 'Measured ceiling (90 days)',
          value: ceiling
            ? `${ceiling.ceilingPct}% · ${ceiling.samples} sample${ceiling.samples === 1 ? '' : 's'}`
            : 'not measured',
          status: !ceiling ? 'na' : ceiling.samples < 30 ? 'na' : ceiling.ceilingPct > 0 ? 'pass' : 'fail',
          reason: !ceiling
            ? 'no measured ceiling for this protocol — the audit has not observed it score'
            : ceiling.samples < 30
              ? `only ${ceiling.samples} sample(s) — too few to treat as a ceiling, in either direction`
              : `the highest percentage this protocol reached in ${t?.ceilingWindowDays ?? 90} days. No tick can exceed it, so the practical range is 0–${ceiling.ceilingPct}%, not 0–100`,
        },
        {
          label: 'Entry / strong vs ceiling',
          value: entry == null || strong == null
            ? '—'
            : `${entry}% / ${strong}%${ceiling ? ` = ${pctOf(entry) ?? '?'}% / ${pctOf(strong) ?? '?'}% of ceiling` : ''}`,
          // Present data ticks; only a proportion above half the achievable range stands out.
          status: entry == null || strong == null
            ? 'na'
            : ceiling && pctOf(strong) != null && pctOf(strong) > 50 ? 'warn' : 'pass',
          reason: 'classification compares against CONFIGURED capacity, not against what this protocol can actually reach — a high share here means "strong" is barely attainable',
        },
        {
          label: 'Pre-trade gate',
          value: gate == null
            ? '—'
            : `${gate}%${ceiling ? ` = ${pctOf(gate) ?? '?'}% of ceiling` : ''}`,
          status: gate == null ? 'na' : ceiling && pctOf(gate) != null && pctOf(gate) > 50 ? 'warn' : 'pass',
          reason: `resolved from ${gateSource} — this gate blocks a signal before any bot sees it`,
        },
      ];

      if (!scored) return [...ceilingRows, { label: 'Awaiting scoring', value: '—', status: 'na', reason: 'select a protocol above' }];
      const de = scored.meta?.directionalEvidence;
      const observed = scored.meta?.observedSignalMax ?? scored.observedSignalMax;
      const configured = scored.meta?.configuredSignalMax ?? scored.configuredSignalMax;
      const earnable = scored.meta?.earnableSignalMax ?? scored.earnableSignalMax ?? null;
      const tb = scored.meta?.thresholdBasis ?? scored.thresholdBasis ?? null;
      const rows = [
        {
          label: 'Directional split',
          value: de ? `${de.bullishRaw}/${de.bullishMax} bull · ${de.bearishRaw}/${de.bearishMax} bear` : '—',
          status: de ? 'pass' : 'na',
          reason: de
            ? `selected: ${de.selected} — a reading on the non-permitted side is measured and then excluded from the numerator`
            : 'the payload carried no direction split for this tick',
        },
        {
          label: 'Denominator (observed vs configured)',
          value: `${observed ?? '—'} / ${configured ?? '—'}`,
          status: observed === 0 && configured > 0 ? 'warn' : 'pass',
          reason: observed === 0 && configured > 0
            ? 'observed capacity is ZERO while configured capacity is not — nothing directional counted this tick, so the numerator is 0 by construction, not by measurement'
            : 'observed capacity is the sum of maxScores for directives that produced directional evidence',
        },
        {
          // #1131 — the divisor includes capacity that NOTHING can earn, so the same 13% buys a
          // STRONG label at very different levels of real conviction between protocols. Measured
          // spread: 12% (`forex-session-v1`) to 58% (`vix-spike-v1`). Reporting only — the label is
          // still decided against `configured`, because excluding this capacity without moving the
          // thresholds pushed 24% of recorded ticks across one.
          label: 'Earnable capacity',
          value: earnable == null
            ? '—'
            : `${earnable} of ${configured ?? '—'}${configured > 0 ? ` · ${Math.round(((configured - earnable) / configured) * 100)}% unearnable` : ''}`,
          status: earnable == null ? 'na' : configured > 0 && (configured - earnable) / configured >= 0.25 ? 'warn' : 'pass',
          reason: earnable == null
            ? 'the payload carried no `earnableSignalMax` — an older build, or this path does not compute it'
            : 'maximum real score: directives that can never emit a direction are removed from the divisor. A high share means the entry/strong thresholds are easier to reach here than in a protocol whose capacity is all earnable (see #1131)',
        },
        {
          // #1131 — the same reading under both threshold bases. `signal` is still decided by the
          // incumbent 13% of CONFIGURED capacity; this asks what the bar would be at 20% of
          // EARN-ABLE capacity (calibrated to preserve today's label frequency). Both are persisted
          // per tick, so the comparison is on identical readings rather than two runs.
          label: 'Label under the calibrated basis',
          value: tb == null
            ? '—'
            : `${tb.signalAtEarnable} at ${tb.earnableStrong}% · today ${scored.signal ?? '—'} at ${tb.strong}%`,
          status: tb == null ? 'na' : (tb.signalAtEarnable === scored.signal
            || (!DIRECTIONAL_LABELS.has(tb.signalAtEarnable) && !DIRECTIONAL_LABELS.has(scored.signal)))
            ? 'pass' : 'warn',
          reason: tb == null
            ? 'the payload carried no `thresholdBasis` — an older build'
            : tb.signalAtEarnable === scored.signal
              ? `both bases agree on this reading (bars convert to ${tb.earnableEntry}/${tb.earnableStrong}% here)`
              : `the bases DISAGREE here: 13% of configured only equals 20% of earnable when ${Math.round((earnable / (configured || 1)) * 100)}% of this protocol's capacity is earnable. Nothing has changed — the classifier still uses the configured bar (see #1131)`,
        },
        {
          label: 'Counted / measured directives',
          value: `${directiveRows.filter((d) => d.counted).length} / ${directiveRows.length}`,
          status: directiveRows.some((d) => d.counted) ? 'pass' : 'warn',
          reason: 'how many of the directives that ran contributed to the score',
        },
        {
          label: 'Unmeasured directives',
          value: String(directiveRows.filter((d) => d.unmeasured).length),
          status: directiveRows.some((d) => d.unmeasured) ? 'warn' : 'pass',
          reason: 'reported insufficient bars or input — an unmeasured directive is treated as no penalty, so its silence is not neutral in effect',
        },
        {
          label: 'No-data verdict',
          value: scored.noData ? 'NO_DATA' : 'scored',
          status: scored.noData ? 'warn' : 'pass',
          reason: scored.noDataReason || 'a directional reading was produced',
        },
        {
          // ⚠️ A measured gap, stated as a gap. The directive guard finds 12 directives declaring
          // capacity they cannot reach and 2 that are constant in production (#1131), but it is a
          // CLI script with no endpoint, so this page CANNOT show it. Saying `na` with the command
          // is honest; inventing a summary here would be the exact defect this level exists for.
          label: 'Directive audit (guard MODE 7/9)',
          value: 'not exposed',
          status: 'na',
          reason: 'on-demand only: node nest/scripts/directive-guard.cjs --db (0 errors / 92 warnings on 2026-10-20, incl. 12 directives whose declared maxScore exceeds what they can return). No endpoint serves it — see epic #1129',
        },
      ];
      return rows;
    })(),
  }), [symbolTech, activeSymbol, marketTech, protocols, allProtocolsData, tradingStrats, symbolsQuery.data, watchlistsQuery.data, scored, directiveRows, thresholdsQuery.data, activeProtocolId, selectedProtocol]);

  // Score Momentum (#519)
  const velocityQuery = useQuery({
    queryKey: ['mse-velocity', activeSymbol],
    queryFn: () => apiGet(`/api/scoring/velocity/${activeSymbol}?window=5`).catch(() => null),
    enabled: !!activeSymbol,
    refetchInterval: 30_000,
  });
  const velocity = velocityQuery.data;
  const signalClass = scored
    ? (scored.signal === 'BUY' || scored.signal === 'STRONG_BUY') ? 'buy'
      : (scored.signal === 'SELL' || scored.signal === 'STRONG_SELL') ? 'sell' : 'hold'
    : '';
  const liveValues = useMemo(() => {
    const symCount = symbolsQuery.data?.symbols?.length || 0;
    const allSymbols = symbolsQuery.data?.symbols || [];
    const wlCount = Array.isArray(watchlistsQuery.data) ? watchlistsQuery.data.length : 0;
    const allWatchlists = Array.isArray(watchlistsQuery.data) ? watchlistsQuery.data : [];
    // Built-in watchlists have slug IDs; user-created have UUIDs (36 chars with dashes)
    const userWatchlists = allWatchlists.filter(w => (w.id || '').length >= 36);
    const hasUserWatchlist = userWatchlists.length > 0;
    const autoRunning = autoQuery.data?.loopEnabled || false;
    const loopStrategies = autoQuery.data?.activeStrategies || [];
    const activeStrats = loopStrategies.length || 0;
    // All active loop strategies wired (have protocolId + symbol)?
    const wiredStrats = loopStrategies.filter(s => s.protocolId && s.symbol);
    // Total trading strategies available (from trading strats query)
    const totalTradingStrats = Array.isArray(tradingStratsQuery.data) ? tradingStratsQuery.data.length : 0;
    // Broker states (MT5 connection health, etc.)
    const brokerStates = autoQuery.data?.brokerStates || {};
    const connectedBrokers = Object.entries(brokerStates).filter(([, s]) => s.connected);
    const enabledBrokers = Object.entries(brokerStates).filter(([, s]) => s.enabled);
    // Provider health from dedicated endpoint (persists across restarts, unlike brokerStates)
    const providerList = providerHealthQuery.data?.providers || [];
    const healthyProviders = providerList.filter(s => s?.status === 'healthy' || s?.status === 'connected');
    // Active timeline events (economic calendar, earnings)
    const timelineEvents = autoQuery.data?.activeTimelineEvents || [];
    const globalRiskMultiplier = autoQuery.data?.globalRiskMultiplier ?? 1;
    const scoringStrats = Array.isArray(scoringStratsQuery.data) ? scoringStratsQuery.data : [];
    const positions = Array.isArray(positionsQuery.data) ? positionsQuery.data : [];
    const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);

    // Protocol pairing checks
    const allProtocols = allProtocolsData || [];
    const protoCount = allProtocols.length;
    // Cross-reference: which protocols have scoring strategies linked?
    const protoIdsWithStrats = new Set(scoringStrats.map(s => s.protocolId).filter(Boolean));
    const protocolsWithStrats = allProtocols.filter(p => protoIdsWithStrats.has(p.id));
    // Cross-reference: do those strategies have valid watchlist links?
    // Strategies use either watchlistId (FK) or watchlistName (label) — check both
    const watchlistIds = new Set(allWatchlists.map(w => w.id));
    const watchlistLabels = new Set(allWatchlists.map(w => w.label?.toLowerCase?.() || w.name?.toLowerCase?.() || ''));
    const stratsWithValidWl = scoringStrats.filter(s =>
      (s.watchlistId && watchlistIds.has(s.watchlistId)) ||
      (s.watchlistName && watchlistLabels.has(s.watchlistName.toLowerCase()))
    );
    const stratsWithNameOnly = scoringStrats.filter(s =>
      !s.watchlistId && s.watchlistName && watchlistLabels.has(s.watchlistName.toLowerCase())
    );
    const stratsUnlinked = scoringStrats.filter(s =>
      !(s.watchlistId && watchlistIds.has(s.watchlistId)) &&
      !(s.watchlistName && watchlistLabels.has(s.watchlistName.toLowerCase()))
    );
    // Pick 3 random protocols with strategies linked
    const randomLinked = protocolsWithStrats.sort(() => Math.random() - 0.5).slice(0, 3);
    // Check if any non-default symbols exist (user-added, not just built-in forex/crypto/indices)
    const builtInTypes = ['forex', 'crypto', 'index', 'commodity'];
    const userSymbols = allSymbols.filter(s => !builtInTypes.includes(s.type));
    const hasUserSymbols = userSymbols.length > 0;

    const matchingScoringStrat = scoringStrats.find(s => s.protocolId === activeProtocolId);
    const matchingTradingStrats = tradingStrats.filter(s => s.protocolId === activeProtocolId && s.symbol === activeSymbol);

    const vals = {
      'prereq-symbols': [
        { label: 'Any symbols registered', pass: symCount > 0, detail: `${symCount} total` },
        { label: 'Non-default symbol added', pass: hasUserSymbols, detail: hasUserSymbols ? `${userSymbols.length} stock/ETF symbols` : 'only built-in forex/crypto — register one via POST /api/symbols' },
      ],
      'prereq-watchlist': [
        { label: 'Any watchlist exists', pass: wlCount > 0, detail: `${wlCount} total (${allWatchlists.length - userWatchlists.length} built-in)` },
        { label: 'User-created watchlist', pass: hasUserWatchlist, detail: hasUserWatchlist ? `${userWatchlists.length} custom watchlists` : 'only built-in — create your own', link: '/watchlists/user-watchlists', linkLabel: 'Watchlists' },
      ],
      'prereq-protocol': [
        { label: 'Any protocol registered', pass: protoCount > 0, detail: `${protoCount} total` },
        { label: 'Protocols linked to scoring strategies', pass: protocolsWithStrats.length > 0, detail: protocolsWithStrats.length > 0 ? `${protocolsWithStrats.length} of ${protoCount} linked` : 'no scoring strategies — create one', link: '/scoring/configure-directives', linkLabel: 'Protocol Editor' },
        { label: 'Linked watchlist exists', pass: stratsWithValidWl.length > 0, detail: stratsWithValidWl.length > 0 ? `${stratsWithValidWl.length} valid${stratsWithNameOnly.length > 0 ? ` (${stratsWithNameOnly.length} name-based)` : ''}${stratsUnlinked.length > 0 ? `, ${stratsUnlinked.length} unlinked` : ''}` : 'no strategies with valid watchlists — assign via Strategy Editor', link: '/trading/create-strategy', linkLabel: 'Create Strategy' },
        ...(!activeSymbol ? [{ label: 'Examples (linked protocols)', pass: randomLinked.length > 0, detail: randomLinked.length > 0 ? randomLinked.map(p => p.name || p.id).join(', ') : 'none linked' }] : []),
      ],
      'prereq-automation': [
        { label: 'Automation loop running', pass: autoRunning, detail: autoRunning ? `tick #${autoQuery.data?.tickCount || '?'}, every ${(autoQuery.data?.tickIntervalMs || 120000) / 1000}s` : 'paused — enable from Automation settings', link: '/settings/automation', linkLabel: 'Automation' },
        { label: 'Trading strategies in loop', pass: activeStrats > 0, detail: activeStrats > 0 ? `${activeStrats} active (of ${totalTradingStrats} total)` : 'none active — enable from Automation settings', link: '/settings/automation', linkLabel: 'Automation' },
        { label: 'Strategies wired to protocols', pass: wiredStrats.length === activeStrats && activeStrats > 0, detail: activeStrats > 0 ? `${wiredStrats.length}/${activeStrats} have protocol + symbol` : '—' },
        // ── Data readiness per strategy (from automation loop PENDING state) ──
        (() => {
          const loopStrats = autoQuery.data?.activeStrategies || [];
          const sel = loopStrats.find(s => s.id === selectedStrategy?.id);
          const ready = sel?.dataStatus === 'ready';
          const pending = sel?.dataStatus === 'pending_bars';
          const blocked = sel?.dataStatus === 'blocked';
          return {
            label: 'Data readiness',
            pass: ready,
            detail: sel
              ? `${sel.dataStatus === 'ready' ? '✓' : sel.dataStatus === 'pending_bars' ? '⏳' : '🚫'} ${sel.dataStatusReason || sel.dataStatus || 'unknown'}`
              : '— (select a strategy above)',
          };
        })(),
        { label: 'Broker connections', pass: connectedBrokers.length > 0 || healthyProviders.length > 0, detail: connectedBrokers.length > 0 ? `${connectedBrokers.length} in loop (${connectedBrokers.map(([k]) => k.toUpperCase()).join(', ')})` : healthyProviders.length > 0 ? `${healthyProviders.length} healthy (${healthyProviders.map(p => p.provider).join(', ')}) — loop has not registered yet` : `no brokers connected — check MT5 bridge` },
        { label: 'Active timeline events', pass: timelineEvents.length >= 0, detail: timelineEvents.length > 0 ? `${timelineEvents.length} events (risk ×${globalRiskMultiplier.toFixed(2)})` : 'none — risk multiplier ×1.0' },
      ],
      'trading-strategy': [
        { label: 'Trading strategy selected', pass: !!selectedStrategy, detail: selectedStrategy ? selectedStrategy.name : '⬇ Select below', link: '/trading/trading-bots', linkLabel: 'Bots' },
        { label: 'Strategy ID', pass: !!selectedStrategy?.id, detail: selectedStrategy?.id || '—' },
        { label: 'Strategy active', pass: selectedStrategy?.active === true, detail: selectedStrategy ? (selectedStrategy.active ? 'active' : 'inactive') : '—' },
        { label: 'Symbol assigned', pass: !!selectedStrategy?.symbol, detail: selectedStrategy?.symbol || 'no symbol' },
        { label: 'Protocol assigned', pass: !!selectedStrategy?.protocolId, detail: selectedStrategy?.protocolId || 'no protocol', link: '/scoring/protocols', linkLabel: 'Protocols' },
        { label: 'Mode configured', pass: !!selectedStrategy?.mode, detail: selectedStrategy?.mode || '—' },
        { label: 'Min composite', pass: (selectedStrategy?.minComposite || 0) >= 0, detail: selectedStrategy ? String(selectedStrategy.minComposite || 0) : '—' },
      ],
      'scoring-strategy': [
        { label: 'Scoring strategy found', pass: !!matchingScoringStrat, detail: matchingScoringStrat ? matchingScoringStrat.name : (activeProtocolId ? 'no match — create one for this protocol' : '— select a strategy first'), link: '/trading/create-strategy', linkLabel: 'Create' },
        { label: 'Strategies configured', pass: scoringStrats.length > 0, detail: scoringStrats.length > 0 ? `${scoringStrats.length} total` : 'none — create via Strategy Editor', link: '/trading/create-strategy', linkLabel: 'Create' },
        { label: 'Strategy enabled', pass: matchingScoringStrat?.enabled === true, detail: matchingScoringStrat ? (matchingScoringStrat.enabled ? 'enabled' : 'disabled') : '—' },
        { label: 'Trade threshold set', pass: (matchingScoringStrat?.tradeThreshold || 0) > 0, detail: matchingScoringStrat ? `${matchingScoringStrat.tradeThreshold}` : '—' },
        { label: 'Watchlist linked', pass: !!(matchingScoringStrat?.watchlistId || matchingScoringStrat?.watchlistName), detail: matchingScoringStrat ? (matchingScoringStrat.watchlistName || matchingScoringStrat.watchlistId || 'none') : '—' },
      ],
      'outcome': [
        { label: 'Open positions', pass: positions.length > 0, detail: positions.length > 0 ? `${positions.length} open` : 'none', link: '/trading/positions-monitor', linkLabel: 'Positions' },
        { label: 'Total P&L', pass: totalPnl !== 0, detail: `$${totalPnl.toFixed(2)}` },
        { label: 'Recent decisions', pass: (autoQuery.data?.recentDecisions?.length || 0) > 0, detail: `${autoQuery.data?.recentDecisions?.length || 0} logged` },
      ],
      // Scoring stages — show waiting state when no strategy selected
      'market-data': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'protocol': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'conditions': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'directives': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'groups': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'risk-gate': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
      'composite': [{ label: 'Awaiting strategy selection', pass: false, detail: 'select a Trading Strategy below' }],
    };
    if (!scored) return vals;
    const dCount = scored.meta?.directiveCount || 0;
    const gCount = scored.meta?.gatedCount || 0;
    const groupKeys = scored.breakouts ? Object.keys(scored.breakouts) : [];
    // Find top-scoring directive across all groups
    let topDir = null;
    if (scored.breakouts) {
      for (const group of Object.values(scored.breakouts)) {
        for (const d of group) {
          if (!topDir || d.score > topDir.score) topDir = d;
        }
      }
    }
    // Sum raw scores and max scores across all groups
    const totalRaw = scored.subRawTotals ? Object.values(scored.subRawTotals).reduce((a, b) => a + b, 0) : 0;
    const totalMax = scored.subMaxTotals ? Object.values(scored.subMaxTotals).reduce((a, b) => a + b, 0) : 0;
    const totalPct = totalMax > 0 ? Math.round(totalRaw / totalMax * 100) : 0;
    return {
      ...vals,
      'market-data': [
        { label: 'Bars fetched', pass: dCount > 0, detail: `${dCount} directives receiving bars` },
        { label: 'Symbol matched', pass: scored.symbol === activeSymbol, detail: scored.symbol || '—' },
        { label: 'Protocol routed', pass: !!activeProtocolId, detail: activeProtocolId || '—' },
      ],
      'protocol': [
        { label: 'Protocol resolved', pass: !!selectedProtocol, detail: selectedProtocol?.name || activeProtocolId || '—' },
        // ⚠️ This row used to read 'Weight strategy' with `pass: !!scored.meta?.weightStrategy` — a
        // check that passed merely because the FIELD EXISTS, while the field selects nothing (measured
        // 2026-09-24, #919). It reported a capability the engine does not have. Now it states the
        // denominator the engine actually used, which is the truth the payload carries.
        {
          label: 'Denominator',
          pass: scored.meta?.denominatorMode === 'configured-capacity',
          detail: `${scored.meta?.denominatorMode || '—'} · weightStrategy is inert (#919)`,
        },
        { label: 'Direction mode', pass: !!selectedProtocol?.directionMode, detail: selectedProtocol?.directionMode || 'LONG_ONLY' },
        { label: 'Trading style', pass: !!selectedProtocol?.tradingStyle, detail: selectedProtocol?.tradingStyle || '—' },
        { label: 'Win rate target', pass: !!selectedProtocol?.winRateTarget, detail: selectedProtocol?.winRateTarget || '—' },
        { label: 'Directive groups', pass: groupKeys.length > 0, detail: groupKeys.length > 0 ? `${groupKeys.length} groups (${groupKeys.join(', ')}) — ${selectedProtocol?.directiveCount || dCount} directives` : '—' },
      ],
      'conditions': [
        { label: 'Gating active', pass: scored.gatingActive !== false, detail: scored.gatingActive ? 'active' : 'inactive' },
        { label: 'Directives passed gates', pass: gCount > 0, detail: gCount > 0 ? `${gCount} of ${dCount} passed activation` : 'all gated out' },
        { label: 'Gating delta', pass: typeof scored.meta?.gatingDelta === 'number', detail: `weighted vs additive: ${scored.meta?.gatingDelta?.toFixed?.(1) || '—'} pts` },
      ],
      'directives': [
        { label: 'Total executed', pass: dCount > 0, detail: `${dCount} directives` },
        { label: 'Readiness', pass: (scored.meta?.readinessBreakdown?.ready || 0) > 0, detail: `🟢 ${scored.meta?.readinessBreakdown?.ready || 0} ready, 🟡 ${scored.meta?.readinessBreakdown?.beta || 0} beta, 🔴 ${scored.meta?.readinessBreakdown?.alphaExcluded || 0} excluded` },
        { label: 'Total raw score', pass: totalRaw > 0, detail: `${totalRaw} / ${totalMax} (${totalPct}%) — before group weighting & risk gating` },
        { label: 'Group coverage', pass: groupKeys.length > 0, detail: groupKeys.map(k => `${k}: ${scored.subRawTotals?.[k] || 0}/${scored.subMaxTotals?.[k] || 0}`).join(', ') || '—' },
        { label: 'Top directive', pass: !!topDir, detail: topDir ? `${topDir.name} (${topDir.score}/${topDir.maxScore} = ${topDir.normalizedScore}%)` : '—' },
      ],
      'groups': scored.subScores ? [
        { label: 'Technical group score', pass: (scored.subScores.technical || 0) > 0, detail: `${scored.subScores.technical || 0}%` },
        { label: 'Sentiment group score', pass: (scored.subScores.sentiment || 0) > 0, detail: `${scored.subScores.sentiment || 0}%` },
        { label: 'Risk group active', pass: (scored.subScores.risk || 0) > 0, detail: `${scored.subScores.risk || 0}%` },
      ] : [{ label: 'Awaiting scoring', pass: false, detail: 'select a Trading Strategy above' }],
      'risk-gate': [
        { label: 'Hard gate triggered', pass: !scored.riskGate?.hardGateTriggered, detail: scored.riskGate?.hardGateTriggered ? '🚫 BLOCKED — trade vetoed' : '✓ none triggered' },
        { label: 'Risk multiplier applied', pass: (scored.riskMultiplier || 1) < 1, detail: `×${scored.riskMultiplier?.toFixed?.(3) || '1.0'}${(scored.riskMultiplier || 1) < 1 ? ' (reduced)' : ' (no reduction)'}` },
        { label: 'Risk score', pass: typeof scored.riskGate?.riskScore === 'number', detail: `${scored.riskGate?.riskScore?.toFixed?.(1) || '—'} / 100` },
        { label: 'Multiplier chain', pass: (scored.riskGate?.multiplierChain?.length || 0) > 0, detail: `${scored.riskGate?.multiplierChain?.length || 0} rules applied` },
      ],
      'composite': [
        // ⚠️ `${scored.composite}/100` was wrong and is deliberately gone (#839).
        //
        // `composite` is a percentage of CONFIGURED capacity, and since the 2026-09-15 rescale it
        // measures 0-33 on every active protocol. Printing "/100" told the reader the scale went
        // to 100, so a healthy reading looked like a failed one. The denominator now comes from
        // the payload instead of being asserted.
        { label: 'Final composite', pass: (scored.composite || 0) > 0, detail: `${scored.composite}/${scored.rawMax ?? '—'} (${scored.signalPct ?? '—'}%)` },
        { label: 'Signal assigned', pass: !!scored.signal, detail: scored.signal || '—' },
        { label: 'Score Momentum', pass: velocity?.signal !== 'insufficient_data', detail: velocity && velocity.signal !== 'insufficient_data' ? `${velocity.velocityPtsPerHour > 0 ? '📈' : '📉'} ${velocity.velocityPtsPerHour} pts/hr · ${velocity.signalLabel}` : '— (need more ticks)' },
        { label: 'Rarity', pass: !!scored.rarity, detail: scored.rarity ? `${scored.rarity.band} (p${scored.rarity.percentile}, ${scored.rarity.sampleSize} samples)` : '—' },
        // ⚠️ `|| 60` was a pre-rescale fallback (#839) — it made an absent threshold silently read
        // as 60, and the comparison then reported a confident FAIL against a bar that does not
        // exist. An absent bar is NOT APPLICABLE; saying so is the only honest output.
        ...(() => {
          const bar = matchingScoringStrat?.tradeThreshold;
          if (bar == null) {
            return [{ label: 'Threshold check', pass: true, detail: 'no scoring strategy threshold set — not applicable (this is not a pass or a fail)' }];
          }
          const composite = scored.composite || 0;
          return [{ label: 'Threshold check', pass: composite >= bar, detail: `${composite} vs threshold ${bar} → ${composite >= bar ? 'PASS' : 'FAIL'}` }];
        })(),
      ],
    };
  }, [scored, selectedProtocol, activeProtocolId, activeSymbol, selectedStrategy, symbolsQuery.data, watchlistsQuery.data, allProtocolsData, autoQuery.data, providerHealthQuery.data, scoringStratsQuery.data, tradingStratsQuery.data, positionsQuery.data]);

  // ── Directive readiness lookup (for per-directive badges) ──
  const readinessMap = useMemo(() => {
    const map = {};
    if (Array.isArray(directivesQuery.data)) {
      for (const d of directivesQuery.data) {
        map[d.id] = d.readiness || 'alpha';
      }
    }
    return map;
  }, [directivesQuery.data]);

  const READINESS_STYLES = {
    ready:  { color: '#22c55e', bg: '#22c55e18', label: 'READY', title: 'Verified against live data' },
    beta:  { color: '#f59e0b', bg: '#f59e0b18', label: 'BETA', title: 'Real math, proxy/limited data' },
    alpha:  { color: '#ef4444', bg: '#ef444418', label: 'ALPHA', title: 'Mock, stub, or placeholder' },
  };

  const confirmedCount = Object.values(confirmedStages).filter(Boolean).length;
  const stageCount = PIPELINE.filter(s => !s.isMarker).length;
  const allConfirmed = confirmedCount === stageCount;

  return (
    <div className="mse-page">
      {/* ── Scroll progress bar ── */}
      <div style={{ position: 'fixed', top: 0, left: 0, height: 3, zIndex: 100, width: `${scrollPct}%`, background: 'var(--accent)', transition: 'width 0.1s linear' }} />

      <header className="mse-header">
        <div>
          <h1>META.Stack Explorer
          <PageInfoPopover>
            Modular Expert Trading Architecture — end-to-end pipeline trace
          </PageInfoPopover>
        </h1>
        </div>
        <div className="mse-header-actions">
          {/* One toggle, two states, and the label says what it is doing — not "on/off". */}
          <button
            type="button"
            className={`mse-live-toggle${playing ? ' is-playing' : ''}`}
            aria-pressed={playing}
            onClick={() => choosePlaying(!playing)}
            title={playing
              ? 'PLAY — the page re-reads the latest score on an interval. Click to pause and hold this record.'
              : 'PAUSE — this record is frozen. Every step of it is shown; nothing re-reads until you press play.'}
          >
            <span aria-hidden="true">{playing ? '▶' : '❚❚'}</span>
            {playing ? 'Playing' : 'Paused'}
          </button>
          <span className="mse-progress">{confirmedCount}/{stageCount} confirmed</span>
          <button className="mse-action-btn" onClick={confirmAll}>Confirm All</button>
          <button className="mse-action-btn mse-action-reset" onClick={resetAll}>Reset</button>
        </div>
      </header>

      {/* ── Selected Strategy Banner ── */}
      {selectedStrategy ? (
        <div className="mse-strategy-banner">
          <span className="mse-strategy-banner-icon">📌</span>
          <span className="mse-strategy-banner-name">{selectedStrategy.name}</span>
          <span className="mse-strategy-banner-meta">
            {selectedStrategy.symbol} · {selectedStrategy.timeframe || '1h'}
            {selectedStrategy.mode ? ` · ${selectedStrategy.mode}` : ''}
          </span>
          {selectedProtocol && (
            <span className="mse-strategy-banner-protocol" title={`Protocol: ${selectedProtocol.name}`}>
              ⚙ {selectedProtocol.name}
            </span>
          )}
          {selectedStrategy.minComposite > 0 && (
            <span className="mse-strategy-banner-threshold">
              Min composite: {selectedStrategy.minComposite}
            </span>
          )}
          {/* Protocol picker AT THE TOP. The page is driven by a trading strategy, and a strategy
              is the (protocol × symbol × mode) triple — so choosing a protocol here means choosing
              the strategy that owns it. Options therefore read `protocol · symbol — mode`, which is
              the pair the pipeline actually scores; a protocol with no strategy cannot be scored at
              all and is listed below with that reason rather than silently missing. */}
          <select
            className="mse-banner-select"
            aria-label="Protocol and symbol to inspect"
            value={selectedStrategyId || ''}
            onChange={(e) => {
              const v = e.target.value || null;
              setSelectedStrategyId(v);
              try {
                if (v) localStorage.setItem('mse-selected-strategy', v);
                else localStorage.removeItem('mse-selected-strategy');
              } catch {}
            }}
          >
            <option value="">— select a protocol —</option>
            {tradingStrats.map(s => (
              <option key={s.id} value={s.id}>
                {s.protocolId ? `${s.protocolId} · ${s.symbol}` : s.name} — {s.mode || 'auto'}
                {s.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          <button
            className="mse-strategy-banner-change"
            onClick={() => {
              const el = document.querySelector('.mse-strategy-picker');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            Change ↓
          </button>
        </div>
      ) : (
        <div className="mse-strategy-banner mse-strategy-banner--empty">
          <span className="mse-strategy-banner-icon">📌</span>
          <span className="mse-strategy-banner-name">No strategy selected</span>
          <span className="mse-strategy-banner-meta">
            {tradingStrats.length > 0
              ? `${tradingStrats.length} trading strateg${tradingStrats.length === 1 ? 'y' : 'ies'} available — pick one to populate the pipeline`
              : 'No trading strategies found — create one first'}
          </span>
          {/* ⚠️ THE PICKER MUST EXIST IN THE EMPTY STATE — that is the state a fresh load lands in.
              Found by the browser canary on 2026-10-20: `mse-banner-select option` count was **0**,
              because the select only rendered in the populated branch and the empty branch offered
              a scroll link to a picker further down the page. "Select the protocol at the top" is
              the control that matters most when nothing is selected. */}
          {tradingStrats.length > 0 && (
            <select
              className="mse-banner-select"
              aria-label="Protocol and symbol to inspect"
              value={selectedStrategyId || ''}
              onChange={(e) => {
                const v = e.target.value || null;
                setSelectedStrategyId(v);
                try {
                  if (v) localStorage.setItem('mse-selected-strategy', v);
                  else localStorage.removeItem('mse-selected-strategy');
                } catch {}
              }}
            >
              <option value="">— select a protocol —</option>
              {tradingStrats.map(s => (
                <option key={s.id} value={s.id}>
                  {s.protocolId ? `${s.protocolId} · ${s.symbol}` : s.name} — {s.mode || 'auto'}
                  {s.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          )}
          <button
            className="mse-strategy-banner-change"
            onClick={() => {
              const el = document.querySelector('.mse-strategy-picker');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            Pick ↓
          </button>
        </div>
      )}

      {/* ── Pipeline stages (vertical) — prerequisites always visible, core requires strategy selection ── */}
      <div className="mse-pipeline">
        {PIPELINE.map((stage, i) => {
          // ── Section marker banner ──
          if (stage.isMarker) {
            return (
              <div key={stage.type} className={`mse-section-marker ${stage.type}`}>
                <div className="mse-section-marker-line" />
                <span className="mse-section-marker-label">{stage.label}</span>
                <div className="mse-section-marker-line" />
              </div>
            );
          }

          // ── Regular stage card ──
          // Compute stage number by counting non-marker stages up to this index
          const num = PIPELINE.slice(0, i + 1).filter(s => !s.isMarker).length;
          const needsScoring = !stage.id.startsWith('prereq-') && !['scoring-strategy', 'trading-strategy', 'outcome'].includes(stage.id);
          const hasData = !needsScoring || scored;
          const confirmed = !!confirmedStages[stage.id];
            return (
              <div key={stage.id} className="mse-stage-wrapper">
                {i > 0 && !PIPELINE[i - 1].isMarker && (
                  <div className="mse-connector-vertical">
                    <div className="mse-connector-line" />
                    <span className="mse-connector-arrow">▼</span>
                  </div>
                )}
                <RevealCard
                  className={`mse-stage ${confirmed ? 'mse-stage-confirmed' : 'mse-stage-pending'} ${!hasData && needsScoring ? 'mse-stage-waiting' : ''}`}
                  style={{ transitionDelay: `${num * 0.06}s` }}
                  key={stage.id}
                >
                  <span className="mse-stage-num">{num}</span>
                  <div className="mse-stage-inner">
                  <div className="mse-stage-head">
                    <div className="mse-stage-title-group">
                      <h3 className="mse-stage-title">{stage.title}</h3>
                    </div>
                    <button className="mse-info-btn" popovertarget={`pop-${stage.id}`} aria-label={`Technical details for ${stage.title}`} title="Technical details">Info</button>
                    <ConfirmBadge confirmed={confirmed} onToggle={() => toggleConfirm(stage.id)} label={stage.title} />
                  </div>
                  <p className="mse-stage-desc">{stage.fnDesc}</p>
                  <div className="mse-stage-live">
                    <span className="mse-live-label">Status</span>
                    {Array.isArray(liveValues[stage.id]) ? (
                      <div className="mse-check-list">
                        {liveValues[stage.id].map((check, ci) => {
                          // ⚠️ `pass` has no third state, so "could not judge" had to be written as
                          // `pass: true` with the word "not applicable" in the text — which renders
                          // as a tick. `status` is the contract (pass | fail | warn | na); `pass` is
                          // still accepted so untouched stages keep working during the migration.
                          const st = check.status
                            ?? (check.pass === true ? 'pass' : check.pass === false ? 'fail' : 'warn');
                          return (
                            <div key={ci} className={`mse-check-item mse-check-${st}`}>
                              <span className="mse-check-icon">
                                {st === 'pass' ? '✓' : st === 'fail' ? '✗' : st === 'na' ? '?' : '⚠'}
                              </span>
                              <span className="mse-check-label">{check.label}</span>
                              <span className="mse-check-detail">
                                {check.value != null && <strong className="mse-check-value">{check.value}</strong>}
                                {check.reason ?? check.detail}
                              </span>
                              {check.link && (
                                <a href={check.link} className="mse-check-link" title={check.linkLabel || 'Open'}>Go →</a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className={`mse-live-val ${confirmed ? '' : 'mse-live-dim'}`}>{liveValues[stage.id] || '—'}</span>
                    )}
                    {/* ── MEASURED VALUES AND REASONS — always shown ─────────────────────────
                        No level gates this any more: the owner asked for everything visible at
                        all times, with Pause/Play as the only control. It reads the same fetched
                        snapshot as the rows above, so it can only ever describe the record that
                        is already on screen. */}
                    {Array.isArray(technicalValues[stage.id]) && (
                      <div className="mse-check-list mse-check-list--technical">
                        {technicalValues[stage.id].map((check, ti) => (
                          <div key={`t${ti}`} className={`mse-check-item mse-check-${check.status}`}>
                            <span className="mse-check-icon">
                              {check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : check.status === 'na' ? '?' : '⚠'}
                            </span>
                            <span className="mse-check-label">{check.label}</span>
                            <span className="mse-check-detail">
                              {check.value != null && <strong className="mse-check-value">{check.value}</strong>}
                              {check.reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* ⚠️ The directive ledger that used to render HERE has moved into the stage's
                        own "Show all N directive results" disclosure, so there is one list of the
                        evidence rather than two that can drift. Technical adds interpretation
                        elsewhere (denominator, direction split), never a second copy of the rows. */}
                    <InfoPopover id={`pop-${stage.id}`} title={`${stage.title}`}>                      <div className="mse-popover-grid">
                        <div className="mse-popover-item"><span className="mse-popover-label">Function</span><code>{stage.fn}</code></div>
                        {stage.fnDesc && <div className="mse-popover-item"><span className="mse-popover-label">Description</span><span className="mse-popover-desc">{stage.fnDesc}</span></div>}
                        <div className="mse-popover-item"><span className="mse-popover-label">DB Table</span><code>{stage.dbTable}</code></div>
                        <div className="mse-popover-item"><span className="mse-popover-label">Columns</span><code className="mse-popover-code-sm">{stage.dbColumns}</code></div>
                      </div>
                    </InfoPopover>
                  </div>

                  {/* Trading Strategy selector — drives the entire pipeline */}
                  {stage.id === 'trading-strategy' && (
                    <div className="mse-strategy-picker">
                      <span className="mse-live-label">Select a Trading Strategy:</span>
                      <select
                        className="mse-protocol-select mse-protocol-select-wide"
                        value={selectedStrategyId || ''}
                        onChange={e => { const v = e.target.value || null; setSelectedStrategyId(v); try { if (v) localStorage.setItem('mse-selected-strategy', v); else localStorage.removeItem('mse-selected-strategy'); } catch {} }}
                      >
                        <option value="">— Choose a strategy to populate the pipeline —</option>
                        {tradingStrats.filter(s => s.active).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.symbol} @ {s.timeframe})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {stage.isComplex && stage.subs && (
                    <FadeCardGroup
                      variant="hover scroll-each"
                      maxWidth="100%"
                      cards={stage.subs.map(sub => {
                        let subLive = '—';
                        if (stage.id === 'directives' && scored && scored.breakouts) {
                          const group = scored.breakouts[sub.id];
                          if (group) {
                            const names = group.slice(0, 3).map(d => d.name).join(', ');
                            subLive = `${group.length} directives: ${names}${group.length > 3 ? ` +${group.length - 3} more` : ''}`;
                          }
                        }
                        if (stage.id === 'risk-gate' && scored && scored.riskGate?.multiplierChain) {
                          const step = scored.riskGate.multiplierChain.find(s => s.directiveId === sub.id);
                          subLive = step ? `×${step.multiplier?.toFixed?.(3)} (${step.tier.replace('_', ' ')}, severity ${Math.round((step.severity || 0) * 100)}%)` : 'not triggered';
                        }
                        return { label: sub.label, desc: sub.desc, color: sub.color, extra: subLive };
                      })}
                    />
                  )}

                  {stage.id === 'directives' && scored && scored.breakouts && (
                    <details className="mse-detail-toggle">
                      <summary className="mse-detail-summary">
                        Show all {directiveRows.length} directive results — score · class · counted · reason
                      </summary>
                      {/* ⚠️ ONE surface, not two. This disclosure used to render its own list
                          (name/score/%) while a second list rendered beside it at the old Technical
                          level.
                          Two lists of the same rows is how they drift. The table is now the only
                          rendering, and it is the same at every level — what Technical adds
                          elsewhere is the *interpretation* (denominator, direction split), not a
                          second copy of the evidence.

                          The `Counted` column is the one that matters: `inSignal: false` on a
                          100-point reading means it was measured and refused, which is invisible
                          in a score of `0 / 910`. */}
                      <div className="mse-dir-table-wrap">
                        <table className="mse-dir-table">
                          <thead>
                            <tr>
                              <th scope="col">Directive</th>
                              <th scope="col">Group</th>
                              <th scope="col" className="mse-dir-num">Score</th>
                              <th scope="col" className="mse-dir-num" title="This directive's maxScore as a share of ALL declared directive capacity in the protocol. Its capacity occupies that share of the tick's divisor whether or not it fires. Gate directives are excluded from the signal divisor, so the shares here can exceed the signal denominator's own split.">share</th>
                              <th scope="col">Class</th>
                              <th scope="col">Readiness</th>
                              <th scope="col">Counted</th>
                              <th scope="col">Engine reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {directiveRows.map((d) => {
                              const rd = readinessMap[d.directiveId] || 'alpha';
                              const rs = READINESS_STYLES[rd] || READINESS_STYLES.alpha;
                              return (
                                <tr key={`${d.groupId}:${d.directiveId}`} className={`mse-dir-tr mse-dir-${d.signalClass}`}>
                                  <td className="mse-dir-name">
                                    <a
                                      href={`/scoring/directive-detail?id=${d.directiveId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mse-dir-link"
                                      title={d.directiveId}
                                    >
                                      {d.name || d.directiveId}
                                    </a>
                                  </td>
                                  <td className="mse-dir-group">{d.groupId}</td>
                                  <td className="mse-dir-num">
                                    {d.score}/{d.maxScore}
                                    {d.normalizedScore != null ? ` · ${d.normalizedScore}%` : ''}
                                  </td>
                                  {/* ⚠️ THE DILUTION, PER DIRECTIVE. `maxScore` is in the divisor on
                                      every tick; a directive that never fires still occupies its
                                      share. Measured 2026-10-20: `rsi-oversold` holds 140 of 910
                                      (15%) and only counts when a σ-bonus fires, and
                                      `position-size-kelly` declares 100 while being able to return
                                      at most 30 (directive-guard MODE 9, #1131). */}
                                  <td className="mse-dir-num mse-dir-share">
                                    {declaredCapacity > 0
                                      ? `${Math.round((d.maxScore / declaredCapacity) * 100)}%`
                                      : '—'}
                                  </td>
                                  <td>
                                    <span className={`mse-dir-class mse-dir-class--${d.signalClass}`}>{d.signalClass}</span>
                                    {d.unmeasured && (
                                      <span className="mse-dir-flag" title="Reported insufficient input — this is NOT a neutral reading">unmeasured</span>
                                    )}
                                  </td>
                                  <td>
                                    <span
                                      className="mse-dir-readiness"
                                      style={{ color: rs.color, background: rs.bg, border: `1px solid ${rs.color}40` }}
                                      title={rs.title}
                                    >
                                      {rs.label}
                                    </span>
                                  </td>
                                  <td className={d.counted ? 'mse-dir-counted' : 'mse-dir-refused'}>{d.counted ? 'yes' : 'no'}</td>
                                  <td className="mse-dir-reason">{d.reason || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {stage.id === 'risk-gate' && scored && scored.riskGate?.multiplierChain && (
                    <details className="mse-detail-toggle">
                      <summary className="mse-detail-summary">Show full risk multiplier chain ({scored.riskGate.multiplierChain.length} rules)</summary>
                      <div className="mse-risk-chain">
                        {scored.riskGate.multiplierChain.map((step, j) => (
                          <div key={j} className={`mse-risk-row mse-risk-${step.tier}`}>
                            <span className="mse-risk-name">{step.name}</span>
                            <span className="mse-risk-mult">×{step.multiplier?.toFixed?.(3)}</span>
                            <span className="mse-risk-cum">cum: {step.cumulativeMultiplier?.toFixed?.(3)}</span>
                            <span className="mse-risk-reason">{step.reason}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>{/* /mse-stage-inner */}
                </RevealCard>
              </div>
            );
          })}
          {/* ── Trailing connector ── */}
          <div className="mse-connector-vertical"><div className="mse-connector-line" /></div>

          {scored && (
          <RevealCard>
            <motion.div
              className={`mse-signal-banner mse-signal-${signalClass} ${allConfirmed ? 'mse-signal-verified' : ''}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <div className="mse-signal-main">
                <span className="mse-signal-symbol">{scored.symbol}</span>
                <span className={`mse-signal-badge mse-signal-badge-${signalClass}`}>{scored.signal}</span>
                {/* ⚠️ THE DENOMINATOR IS `signalMax`, NOT 100 (measured 2026-10-08). The payload
                    carries `composite` (8), `signalRaw` (8), **`signalMax` (910)** and `signalPct`
                    (0.879%) — 8/910 agrees with the percentage, so signalMax is the real maximum.
                    Printing "/100" rendered "8/100", i.e. a raw score against a denominator the
                    protocol does not have. Same defect as /status/meta-stack-status (#1090), except
                    there the maximum is absent from the payload and so cannot be shown at all. */}
                <span
                  className="mse-signal-composite"
                  title="Raw composite out of this protocol's signal maximum — not a score out of 100"
                >
                  {scored.composite}
                  {typeof scored.signalMax === 'number' ? `/${scored.signalMax}` : ''}
                  {typeof scored.signalPct === 'number' ? ` · ${Number(scored.signalPct).toFixed(2)}%` : ''}
                </span>
              </div>
              <div className="mse-signal-meta">
                <span>Risk: ×{scored.riskMultiplier?.toFixed?.(3) || '—'}</span>
                <span>Rarity: {scored.rarity?.label || '—'} ({scored.rarity?.percentile || '?'}p)</span>
                <span>Strategy: {scored.meta?.weightStrategy || '—'}</span>
                <a href={`/scoring/directive-impact-audit?symbol=${encodeURIComponent(activeSymbol)}`} className="mse-impact-link" title="See which directives drive this score">📊 Impact Audit →</a>
              </div>
            </motion.div>
          </RevealCard>
          )}
        </div>{/* /mse-pipeline */}

      {!selectedStrategy && (
        <div className="mse-empty">
          <div className="mse-empty-icon">📈</div>
          <h2>Select a Trading Strategy</h2>
          <p>Scroll down to the <strong>Trading Strategy Evaluation</strong> stage and pick a strategy from the dropdown. This will populate the entire pipeline with live data using the actual backend functions.</p>
        </div>
      )}
    </div>
  );
}
