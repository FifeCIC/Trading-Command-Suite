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
import { useQuery } from '@tanstack/react-query';
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
    fnDesc: 'Computes final composite: (technical×0.40 + sentiment×0.35) × riskMultiplier, clamped 0–100. Assigns signal: ≥80 STRONG, ≥40 BUY, ≥20 HOLD, <20 → direction-dependent. Stores snapshot in score_snapshot for rarity percentile computation.',
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
];

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

  // Non-gated protocol list (has createdAt for user-vs-built-in heuristic)
  const protoAllQuery = useQuery({
    queryKey: ['mse-protocols-all'],
    queryFn: () => apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const allProtocolsData = protoAllQuery.data?.protocols ?? [];

  // Scoring auto-triggers when a Trading Strategy is selected (provides symbol + protocol)
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
  const selectedProtocol = protocols.find(p => p.id === activeProtocolId);

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
                        {liveValues[stage.id].map((check, ci) => (
                          <div key={ci} className={`mse-check-item ${check.pass === true ? 'mse-check-pass' : check.pass === false ? 'mse-check-fail' : 'mse-check-pending'}`}>
                            <span className="mse-check-icon">{check.pass === true ? '✓' : check.pass === false ? '✗' : '○'}</span>
                            <span className="mse-check-label">{check.label}</span>
                            <span className="mse-check-detail">{check.detail}</span>
                            {check.link && (
                              <a href={check.link} className="mse-check-link" title={check.linkLabel || 'Open'}>Go →</a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className={`mse-live-val ${confirmed ? '' : 'mse-live-dim'}`}>{liveValues[stage.id] || '—'}</span>
                    )}
                    <InfoPopover id={`pop-${stage.id}`} title={`${stage.title}`}>
                      <div className="mse-popover-grid">
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
                      <summary className="mse-detail-summary">Show all {scored.meta?.directiveCount || 0} directive results</summary>
                      <div className="mse-directive-list">
                        {Object.entries(scored.breakouts).map(([groupId, directives]) =>
                          directives.map(d => {
                            const rd = readinessMap[d.directiveId] || 'alpha';
                            const rs = READINESS_STYLES[rd] || READINESS_STYLES.alpha;
                            return (
                            <div key={d.directiveId} className={`mse-dir-row mse-dir-${d.signalClass}`} title={d.reason}>
                              <a
                                href={`/scoring/directive-detail?id=${d.directiveId}`}
                                className="mse-dir-name"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                              >{d.name}</a>
                              <span className="mse-dir-score">{d.score}/{d.maxScore}</span>
                              <span className="mse-dir-pct">{d.normalizedScore}%</span>
                              <span className="mse-dir-group-tag">{groupId}</span>
                              <span
                                style={{
                                  color: rs.color, background: rs.bg,
                                  border: `1px solid ${rs.color}40`,
                                  padding: '1px 5px', borderRadius: '3px',
                                  fontSize: '0.62rem', fontWeight: 700,
                                  flexShrink: 0,
                                }}
                                title={rs.title}
                              >{rs.label}</span>
                            </div>
                            );
                          })
                        )}
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
                <span className="mse-signal-composite">{scored.composite}/100</span>
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
