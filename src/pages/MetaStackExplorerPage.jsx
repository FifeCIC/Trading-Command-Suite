/**
 * META.Stack Explorer — Vertical pipeline trace
 * =============================================
 * A vertical, scroll-through breakdown of the full scoring pipeline
 * from market data ingestion to final trading signal.
 *
 * Each stage:
 *   - Scroll-reveal card (IntersectionObserver)
 *   - Starts faded → user confirms each step as verified
 *   - Shows function name + explanation + live value
 *   - Popover for deeper technical detail (DB tables, columns, values)
 *   - Nested sub-stages for complex sections (directives, risk gate)
 *
 * Route: /development/meta-stack-explorer
 * Data:  POST /api/scoring/gated/batch (live)
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import FadeCardGroup from '../components/FadeCardGroup';
import './meta-stack-explorer.css';

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
    <>
      <button className="mse-info-btn" popoverTarget={id} aria-label={`Technical details for ${title}`}>ⓘ</button>
      <div id={id} popover="auto" className="mse-popover">
        <h4 className="mse-popover-title">{title}</h4>
        <div className="mse-popover-body">{children}</div>
      </div>
    </>
  );
}

/* ── Pipeline stage definitions ────────────────────────── */
const PIPELINE = [
  // ── Prerequisites (Stage 0) ──
  {
    id: 'prereq-symbols', title: 'Symbol Registration', icon: '➕',
    fn: 'SymbolsController.create() / POST /api/symbols',
    fnDesc: 'Symbols must be registered in the database before they can be scored. Use the Add Symbol feature. Built-in symbols (EURUSD, GBPUSD, etc.) come pre-registered as part of the default installation.',
    dbTable: 'symbol',
    dbColumns: 'id (UUID), ticker, name, exchange, type, active',
  },
  {
    id: 'prereq-watchlist', title: 'Watchlist Setup', icon: '⊞',
    fn: 'Watchlists — built-in defaults available, user should create their own',
    fnDesc: 'A watchlist groups symbols for batch scoring. Built-in watchlists (forex-majors, primary) are provided. User-created watchlists ensure only intended symbols are scored. A protocol must be paired with a watchlist.',
    dbTable: 'watchlist',
    dbColumns: 'id, label, symbols (JSON array of tickers)',
  },
  {
    id: 'prereq-protocol', title: 'Protocol Pairing', icon: '◆',
    fn: 'Protocol ←→ Watchlist pairing (Protocol Editor or built-in)',
    fnDesc: 'Many protocols are provided as part of installation (47 built-in). Each must be paired with a watchlist. This pairing is what the automation loop uses to know which symbols to score with which protocol.',
    dbTable: 'scoring_strategy (protocol assignment)',
    dbColumns: 'protocolId, watchlistName, watchlistId',
  },
  {
    id: 'prereq-sees', title: 'SEES / Automation Active', icon: '⚡',
    fn: 'AutomationLoopService — 2-min tick OR manual POST /api/scoring/gated/batch',
    fnDesc: 'SEES (the scoring engine) can run manually for one-time scoring, or automatically every 2 minutes when automation is active. Active protocols paired with watchlists are scored on each tick. Manual runs use the gated/batch endpoint.',
    dbTable: 'automation_state (runtime), score_snapshot (output)',
    dbColumns: 'running (bool), tick (int), activeStrategies (int)',
  },
  // ── Core scoring pipeline ──
  {
    id: 'market-data', title: 'Market Data Ingestion', icon: '📡',
    fn: 'MarketDataService.getBars()',
    fnDesc: 'Fetches daily OHLCV bars from the MT5 bridge for the requested symbol. Bars are ordered oldest → newest per directive contract.',
    dbTable: 'market_bar',
    dbColumns: 'symbolId, timestamp, open, high, low, close, volume, timeframe',
  },
  {
    id: 'protocol', title: 'Protocol Resolution', icon: '◆',
    fn: 'ProtocolDbService.findBySlug()',
    fnDesc: 'Looks up the protocol configuration from the database. Returns directive groups, direction mode (LONG_ONLY/SHORT_ONLY/BOTH), and weight strategy.',
    dbTable: 'scoring_strategy',
    dbColumns: 'id, name, slug, config (JSON: groups[], directionMode, weightStrategy)',
  },
  {
    id: 'conditions', title: 'Condition Detection', icon: '🔍',
    fn: 'ConditionDetectorService.detect()',
    fnDesc: 'Analyzes the market environment: session (Asian/London/NY), volatility regime, gap presence, multi-timeframe alignment. Produces a ConditionVector used to gate and weight directives.',
    dbTable: 'N/A (pure computation)',
    dbColumns: 'session, volatility, gapPercent, mtfAlignment',
  },
  {
    id: 'directives', title: 'Directive Execution', icon: '⚡',
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
    id: 'groups', title: 'Group Score Aggregation', icon: '📊',
    fn: 'ProtocolGatingService.scoreWithGating() — group phase',
    fnDesc: 'Groups directive results by category (Technical/Sentiment/Risk). Computes each group\'s percentage: sum(rawScores) ÷ sum(maxScores) × 100. Directives with higher maxScore naturally contribute more weight.',
    dbTable: 'score_snapshot',
    dbColumns: 'protocolId, symbol, composite, signal, snappedAt',
  },
  {
    id: 'risk-gate', title: 'Risk Gating', icon: '🛡️',
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
    id: 'composite', title: 'Composite Score & Signal', icon: '🎯',
    fn: 'ProtocolGatingService.scoreWithGating() — composite phase',
    fnDesc: 'Computes final composite: (technical×0.40 + sentiment×0.35) × riskMultiplier, clamped 0–100. Assigns signal: ≥80 STRONG, ≥40 BUY, ≥20 HOLD, <20 → direction-dependent. Stores snapshot in score_snapshot for rarity percentile computation.',
    dbTable: 'score_snapshot (output)',
    dbColumns: 'protocolId, symbol, composite, signal, rarityPercentile, snappedAt',
  },
  // ── Post-scoring: Strategy layers ──
  {
    id: 'scoring-strategy', title: 'Scoring Strategy Rules', icon: '⚙',
    fn: 'AutomationLoopService.evaluateStrategy() → gate checks',
    fnDesc: 'Active scoring strategies have additional rules beyond the raw protocol score. Gates can involve: directive-based strict gates (grouped directives that must all agree), trade threshold comparison (composite must exceed tradeThreshold), budget gate (daily loss limits), and mode-based filtering (manual/semi-auto/auto). A strategy can permit or block a trade independently of the signal.',
    dbTable: 'scoring_strategy, automation_rule',
    dbColumns: 'tradeThreshold, mode (manual|semi-auto|auto), baseSize, slPct, tpPct, maxPyramidTiers',
    isComplex: true,
    subs: [
      { id: 'trade-threshold', label: 'Trade Threshold', desc: 'Composite must be ≥ tradeThreshold (default 60) for the strategy to permit a trade.', color: '#3b82f6' },
      { id: 'budget-gate-strat', label: 'Budget Gate (Strategy)', desc: 'Daily loss limit check — if cumulative P&L exceeds budget, strategy blocks all new trades.', color: '#ef4444' },
      { id: 'mode-gate', label: 'Mode Gate', desc: 'manual = user must approve, semi-auto = auto-score + manual execute, auto = full automation', color: '#f59e0b' },
      { id: 'directive-gates', label: 'Directive Group Gates', desc: 'Certain grouped directives act as strict gates — all must agree on direction for trade permission.', color: '#8b5cf6' },
    ],
  },
  {
    id: 'trading-strategy', title: 'Trading Strategy Evaluation', icon: '📈',
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
    id: 'outcome', title: 'Trade Execution & Outcome', icon: '🏁',
    fn: 'Mt5Adapter.placeOrder() → TradeRecorderService → Trade Journal',
    fnDesc: 'If all gates pass, the trade is sent to the broker via MT5 bridge. The outcome is recorded: did the order fill? What was the entry price? Over time, outcomes are compared against signals to measure prediction accuracy. Manual trades not executed through the app won\'t have this data — but testing uses the app for full traceability.',
    dbTable: 'trade (execution), decision_log (permission), trade_journal (outcome)',
    dbColumns: 'trade: symbol, type, volume, entryPrice, exitPrice, pnl | decision_log: strategyId, symbol, decision, composite, reason',
  },
];

/* ── Main component ────────────────────────────────────── */
export default function MetaStackExplorerPage() {
  const [confirmedStages, setConfirmedStages] = useState({});
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
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

  const toggleConfirm = (stageId) => setConfirmedStages(prev => ({ ...prev, [stageId]: !prev[stageId] }));
  const confirmAll = () => { const a = {}; PIPELINE.forEach(s => { a[s.id] = true; }); setConfirmedStages(a); };
  const resetAll = () => setConfirmedStages({});

  const protoQuery = useQuery({
    queryKey: ['mse-protocols-v2'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 120_000,
  });
  const protocols = protoQuery.data?.protocols ?? [];

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
  const signalClass = scored
    ? (scored.signal === 'BUY' || scored.signal === 'STRONG_BUY') ? 'buy'
      : (scored.signal === 'SELL' || scored.signal === 'STRONG_SELL') ? 'sell' : 'hold'
    : '';
  const selectedProtocol = protocols.find(p => p.id === activeProtocolId);

  const liveValues = useMemo(() => {
    const symCount = symbolsQuery.data?.symbols?.length || 0;
    const wlCount = Array.isArray(watchlistsQuery.data) ? watchlistsQuery.data.length : 0;
    const autoRunning = autoQuery.data?.running || false;
    const activeStrats = autoQuery.data?.activeStrategies || 0;
    const scoringStrats = Array.isArray(scoringStratsQuery.data) ? scoringStratsQuery.data : [];
    const positions = Array.isArray(positionsQuery.data) ? positionsQuery.data : [];
    const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);

    const matchingScoringStrat = scoringStrats.find(s => s.protocolId === activeProtocolId);
    const matchingTradingStrats = tradingStrats.filter(s => s.protocolId === activeProtocolId && s.symbol === activeSymbol);

    const vals = {
      'prereq-symbols': `${symCount} symbols registered${symCount > 0 ? ' ✓' : ' — use Add Symbol'}`,
      'prereq-watchlist': `${wlCount} watchlists${wlCount > 0 ? ' ✓' : ' — create one first'}`,
      'prereq-protocol': activeProtocolId
        ? `${selectedProtocol?.name || activeProtocolId} (from selected strategy)`
        : '— select a Trading Strategy below to auto-resolve',
      'prereq-sees': autoRunning
        ? `Automation running (tick #${autoQuery.data?.tick || '?'}, ${activeStrats} strategies)`
        : 'Automation paused — strategies scored on-demand',
      'trading-strategy': selectedStrategy
        ? `${selectedStrategy.name} — ${selectedStrategy.symbol} @ ${selectedStrategy.timeframe}, mode: ${selectedStrategy.mode}`
        : '⬇ Select a Trading Strategy below to populate the full pipeline',
      'scoring-strategy': matchingScoringStrat
        ? `${matchingScoringStrat.name} — mode: ${matchingScoringStrat.mode}, threshold: ${matchingScoringStrat.tradeThreshold}`
        : activeProtocolId ? 'No matching scoring strategy for this protocol' : '— select a strategy first',
      'outcome': positions.length > 0
        ? `${positions.length} open positions, total P&L: $${totalPnl.toFixed(2)}`
        : 'No open positions',
    };
    if (!scored) return vals;
    return {
      ...vals,
      'market-data': `${scored.meta?.directiveCount || '?'} directives receiving bars for ${scored.symbol}`,
      'protocol': `${selectedProtocol?.name || activeProtocolId} — ${scored.meta?.weightStrategy || 'group-weighted'} mode`,
      'conditions': `${scored.meta?.gatedCount || 0}/${scored.meta?.directiveCount || 0} directives passed activation gates`,
      'directives': `${scored.meta?.directiveCount || 0} executed, ${scored.meta?.gatedCount || 0} active after gating`,
      'groups': scored.subScores ? Object.entries(scored.subScores).map(([k, v]) => `${k}: ${v}%`).join(' | ') : '—',
      'risk-gate': scored.riskGate?.hardGateTriggered ? '🚫 BLOCKED — trade vetoed' : `✓ PASS — multiplier ×${scored.riskMultiplier?.toFixed?.(3) || '1.0'}`,
      'composite': `${scored.composite}/100 → ${scored.signal}`,
    };
  }, [scored, selectedProtocol, activeProtocolId, activeSymbol, selectedStrategy, symbolsQuery.data, watchlistsQuery.data, autoQuery.data, scoringStratsQuery.data, tradingStratsQuery.data, positionsQuery.data]);

  const confirmedCount = Object.values(confirmedStages).filter(Boolean).length;
  const allConfirmed = confirmedCount === PIPELINE.length;

  return (
    <div className="mse-page">
      {/* ── Scroll progress bar ── */}
      <div style={{ position: 'fixed', top: 0, left: 0, height: 3, zIndex: 100, width: `${scrollPct}%`, background: 'var(--accent)', transition: 'width 0.1s linear' }} />

      <header className="mse-header">
        <div>
          <h1>META.Stack Explorer</h1>
          <p className="mse-subtitle">Modular Expert Trading Architecture — end-to-end pipeline trace</p>
        </div>
        <div className="mse-header-actions">
          <span className="mse-progress">{confirmedCount}/{PIPELINE.length} confirmed</span>
          <button className="mse-action-btn" onClick={confirmAll}>Confirm All</button>
          <button className="mse-action-btn mse-action-reset" onClick={resetAll}>Reset</button>
        </div>
      </header>

      {/* ── Pipeline stages (vertical) — prerequisites always visible, core requires strategy selection ── */}
      <div className="mse-pipeline">
        {PIPELINE.map((stage, i) => {
          // All stages visible; scoring stages show placeholder until strategy selected
          const needsScoring = !stage.id.startsWith('prereq-') && !['scoring-strategy', 'trading-strategy', 'outcome'].includes(stage.id);
          const hasData = !needsScoring || scored;

          const confirmed = !!confirmedStages[stage.id];
            return (
              <div key={stage.id} className="mse-stage-wrapper">
                {i > 0 && (
                  <div className="mse-connector-vertical">
                    <div className="mse-connector-line" />
                    <span className="mse-connector-arrow">▼</span>
                  </div>
                )}
                <RevealCard
                  className={`mse-stage ${confirmed ? 'mse-stage-confirmed' : 'mse-stage-pending'} ${!hasData && needsScoring ? 'mse-stage-waiting' : ''}`}
                  style={{ transitionDelay: `${i * 0.06}s` }}
                  key={stage.id}
                >
                  <span className="mse-stage-num">{i + 1}</span>
                  <div className="mse-stage-inner">
                  <div className="mse-stage-head">
                    <span className="mse-stage-icon">{stage.icon}</span>
                    <div className="mse-stage-title-group">
                      <h3 className="mse-stage-title">{stage.title}</h3>
                      <code className="mse-stage-fn">{stage.fn}</code>
                    </div>
                    <ConfirmBadge confirmed={confirmed} onToggle={() => toggleConfirm(stage.id)} label={stage.title} />
                  </div>
                  <p className="mse-stage-desc">{stage.fnDesc}</p>
                  <div className="mse-stage-live">
                    <span className="mse-live-label">Live value:</span>
                    <span className={`mse-live-val ${confirmed ? '' : 'mse-live-dim'}`}>{liveValues[stage.id] || '—'}</span>
                    <InfoPopover id={`pop-${stage.id}`} title={`${stage.title} — Technical Detail`}>
                      <div className="mse-popover-grid">
                        <div className="mse-popover-item"><span className="mse-popover-label">Function</span><code>{stage.fn}</code></div>
                        <div className="mse-popover-item"><span className="mse-popover-label">DB Table</span><code>{stage.dbTable}</code></div>
                        <div className="mse-popover-item"><span className="mse-popover-label">Columns</span><code className="mse-popover-code-sm">{stage.dbColumns}</code></div>
                        <div className="mse-popover-item"><span className="mse-popover-label">Example</span><span className="mse-popover-example">{liveValues[stage.id] || '—'}</span></div>
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
                        onChange={e => setSelectedStrategyId(e.target.value || null)}
                      >
                        <option value="">— Choose a strategy to populate the pipeline —</option>
                        {tradingStrats.filter(s => s.active).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.symbol} @ {s.timeframe})
                          </option>
                        ))}
                      </select>
                      {selectedStrategy && (
                        <div className="mse-strategy-detail">
                          Symbol: <strong>{selectedStrategy.symbol}</strong> | Protocol: <strong>{selectedStrategy.protocolId}</strong>
                          {selectedStrategy.shortProtocolId && <> | Short: <strong>{selectedStrategy.shortProtocolId}</strong></>}
                          {' '}| Mode: <strong>{selectedStrategy.mode}</strong> | Min composite: <strong>{selectedStrategy.minComposite}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {stage.isComplex && stage.subs && (
                    <FadeCardGroup
                      variant="hover scroll-each"
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
                          directives.map(d => (
                            <div key={d.directiveId} className={`mse-dir-row mse-dir-${d.signalClass}`} title={d.reason}>
                              <span className="mse-dir-name">{d.name}</span>
                              <span className="mse-dir-score">{d.score}/{d.maxScore}</span>
                              <span className="mse-dir-pct">{d.normalizedScore}%</span>
                              <span className="mse-dir-group-tag">{groupId}</span>
                            </div>
                          ))
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
