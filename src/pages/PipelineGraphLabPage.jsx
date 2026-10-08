import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './pipeline-graph-lab.css';
import PIPELINE_POSITIONS from '../data/pipeline-graph-positions.json';
// ⚠️ The META.Stack lane board was a PAGE and is now a SECTION of this one (owner direction,
// 2026-10-08). The file still carries its original name; it is no longer a route. Its own CSS is
// imported by that module, so nothing needs importing here.
import MetaStackPipelineBoard from './MetaStackPipelinePage.jsx';
import PageInfoPopover from '../components/PageInfoPopover';
// ⚠️ THE INPUTS/OUTPUTS ON THIS PAGE ARE DERIVED, NOT WRITTEN. See `src/core/pipeline-map.js`.
// The node list below is hand-curated and will drift; the IO block must not join it.
import { loadPipelineMap, ioForFiles, unreferencedIn, divergentMathsIn } from '../core/pipeline-map';

// ── Background icon SVG components (one per node type) ───
function BgIconData() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><rect x="20" y="20" width="60" height="12" rx="3" opacity="0.5"/><rect x="20" y="38" width="45" height="12" rx="3" opacity="0.35"/><rect x="20" y="56" width="52" height="12" rx="3" opacity="0.25"/><rect x="20" y="74" width="38" height="10" rx="3" opacity="0.15"/></svg>; }
function BgIconScoring() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><polygon points="50,15 62,45 95,48 70,70 77,98 50,82 23,98 30,70 5,48 38,45" strokeWidth="1.5" fill="none" opacity="0.45"/><circle cx="50" cy="52" r="18" strokeWidth="1.2" fill="none" opacity="0.3"/></svg>; }
function BgIconSignals() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><line x1="15" y1="85" x2="40" y2="45" strokeWidth="2.5" opacity="0.5"/><line x1="35" y1="85" x2="55" y2="30" strokeWidth="2.5" opacity="0.4"/><line x1="55" y1="85" x2="70" y2="40" strokeWidth="2.5" opacity="0.35"/><line x1="75" y1="85" x2="85" y2="50" strokeWidth="2.5" opacity="0.25"/><circle cx="40" cy="45" r="4" opacity="0.5"/><circle cx="55" cy="30" r="4" opacity="0.45"/><circle cx="70" cy="40" r="4" opacity="0.4"/></svg>; }
function BgIconAutomation() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><circle cx="50" cy="50" r="38" strokeWidth="1.8" fill="none" opacity="0.4"/><path d="M50,20 A30,30 0 0,1 50,80" strokeWidth="2" fill="none" opacity="0.3"/><path d="M50,80 A30,30 0 0,1 50,20" strokeWidth="2" fill="none" opacity="0.15" strokeDasharray="4 4"/><circle cx="50" cy="50" r="6" opacity="0.5"/></svg>; }
function BgIconExecution() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><polyline points="25,75 45,40 65,55 85,20" strokeWidth="2.5" fill="none" opacity="0.45"/><circle cx="25" cy="75" r="4" opacity="0.5"/><circle cx="45" cy="40" r="4" opacity="0.4"/><circle cx="65" cy="55" r="4" opacity="0.35"/><circle cx="85" cy="20" r="5" opacity="0.5"/></svg>; }
function BgIconDatabase() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><ellipse cx="50" cy="22" rx="35" ry="10" strokeWidth="1.8" fill="none" opacity="0.5"/><rect x="15" y="22" width="70" height="56" rx="0" strokeWidth="1.8" fill="none" opacity="0.4"/><ellipse cx="50" cy="78" rx="35" ry="10" strokeWidth="1.8" fill="none" opacity="0.35"/><line x1="15" y1="50" x2="85" y2="50" strokeWidth="1" opacity="0.2"/></svg>; }
function BgIconPortfolio() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><rect x="15" y="25" width="70" height="55" rx="8" strokeWidth="1.8" fill="none" opacity="0.45"/><line x1="35" y1="15" x2="35" y2="85" strokeWidth="1.2" opacity="0.25"/><line x1="65" y1="15" x2="65" y2="85" strokeWidth="1.2" opacity="0.25"/><rect x="20" y="32" width="20" height="15" rx="2" opacity="0.3"/><rect x="44" y="32" width="20" height="15" rx="2" opacity="0.25"/><rect x="20" y="52" width="20" height="15" rx="2" opacity="0.2"/><rect x="44" y="52" width="20" height="15" rx="2" opacity="0.15"/></svg>; }
function BgIconRisk() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><polygon points="50,10 90,85 10,85" strokeWidth="1.8" fill="none" opacity="0.4"/><line x1="50" y1="40" x2="50" y2="70" strokeWidth="2.5" opacity="0.35"/><circle cx="50" cy="75" r="3" opacity="0.4"/><rect x="10" y="85" width="80" height="5" rx="2" opacity="0.2"/></svg>; }
function BgIconAlerts() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><path d="M30,75 L45,35 L60,60 L75,20" strokeWidth="2" fill="none" opacity="0.45"/><circle cx="30" cy="75" r="4" opacity="0.5"/><circle cx="45" cy="35" r="4" opacity="0.4"/><circle cx="60" cy="60" r="4" opacity="0.35"/><circle cx="75" cy="20" r="4" opacity="0.3"/></svg>; }
function BgIconProviders() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><circle cx="25" cy="30" r="15" strokeWidth="1.5" fill="none" opacity="0.4"/><circle cx="75" cy="30" r="15" strokeWidth="1.5" fill="none" opacity="0.35"/><circle cx="50" cy="70" r="15" strokeWidth="1.5" fill="none" opacity="0.3"/><line x1="38" y1="38" x2="52" y2="58" strokeWidth="1" opacity="0.25"/><line x1="62" y1="38" x2="52" y2="58" strokeWidth="1" opacity="0.22"/></svg>; }
// Used by the two per-bridge nodes. The bridges themselves are PYTHON (`scripts/mt5-bridge/`) and sit
// outside the TypeScript map, so those nodes show LIVE health instead of a derived input/output block.
function BgIconBridge() { return <svg viewBox="0 0 100 100" className="pg-bg-svg"><path d="M20,50 L45,50" strokeWidth="2.5" opacity="0.45"/><path d="M55,50 L80,50" strokeWidth="2.5" opacity="0.45"/><rect x="42" y="40" width="16" height="20" rx="3" strokeWidth="1.8" fill="none" opacity="0.5"/><circle cx="20" cy="50" r="5" strokeWidth="1.6" fill="none" opacity="0.4"/><circle cx="80" cy="50" r="5" strokeWidth="1.6" fill="none" opacity="0.4"/><path d="M30,28 L44,28" strokeWidth="1.2" opacity="0.25"/><path d="M56,72 L70,72" strokeWidth="1.2" opacity="0.25"/></svg>; }

// ── Node position loading — JSON file is canonical, inline x/y are dev defaults ──
function applyPositions(nodes) {
  const posMap = {};
  try {
    for (const p of PIPELINE_POSITIONS) posMap[p.id] = { x: p.x, y: p.y };
  } catch (err) {
    // ⚠️ WAS AN EMPTY `catch {}` UNTIL 2026-10-06. An empty catch is the exact defect this repo
    // keeps re-finding: the nodes still render at their inline x/y, so a failure to read saved
    // positions is indistinguishable from having none — plausible output, no error. It cannot
    // throw in practice (PIPELINE_POSITIONS is a JSON module import, validated at build), which is
    // why nobody noticed. Say so rather than assume.
    console.warn('[pipeline-graph] saved positions could not be applied; using inline defaults', err);
  }
  return nodes.map((n) => ({ ...n, x: posMap[n.id]?.x ?? n.x, y: posMap[n.id]?.y ?? n.y }));
}

const SAMPLE_NODES = [
  {
    id: 'data',
    label: 'Data Pipeline',
    subtype: 'Market Data + Earnings + News',
    icon: '🗄️', bgIcon: BgIconData,
    color: '#22c55e', health: 'healthy',
    variant: 'titlebar',
    x: 80, y: 200,
    stats: { imported: '1.2M bars', freshness: '3s ago', provider: 'Finnhub + MT5' },
    docs: {
      description: 'Orchestrates all external data ingestion — market bars, earnings calendars, news sentiment, analyst targets. The single entry point for every byte of data that flows through the system.',
      endpoints: ['POST /api/import-jobs/orchestrate', 'GET /api/import-jobs/status', 'GET /api/market-data/freshness/:symbol'],
      tables: ['MarketBar', 'ImportRun', 'EarningsEvent', 'NewsArticle', 'DataImportLog', 'AnalystTarget', 'FxRate'],
      files: ['nest/src/modules/import-jobs/data-import-orchestrator.service.ts', 'nest/src/modules/market-data/freshness.service.ts', 'nest/src/modules/research/research-import.service.ts'],
      providers: ['Finnhub', 'Alpha Vantage', 'Polygon.io', 'MT5 Bridge'],
    },
  },
  {
    id: 'scoring',
    label: 'Scoring Engine',
    subtype: '99 Directives · 32 Protocols',
    icon: '⚡', bgIcon: BgIconScoring,
    color: '#22c55e', health: 'healthy',
    variant: 'titlebar',
    x: 380, y: 60,
    stats: { runs: '14,247', lastRun: '12s ago', coverage: '78%' },
    docs: {
      description: 'Runs every directive against every symbol. Multi-protocol scoring with gated pipeline (risk → technical → sentiment), calibration overrides, and seasonality adjustments. The heart of SEES.',
      endpoints: ['GET /api/scoring/ranked', 'POST /api/scoring/gated/score', 'GET /api/scoring/runs', 'GET /api/speed/scan'],
      tables: ['Score', 'ScoreSnapshot', 'DirectiveOutcome', 'SymbolCalibration', 'ProtocolRun', 'SymbolProtocolAffinity'],
      files: ['nest/src/modules/scoring/scoring.service.ts', 'nest/src/modules/scoring/risk-gating-engine.service.ts', 'nest/src/modules/scoring/seasonality.service.ts', 'nest/src/modules/directives/directives.service.ts'],
      directives: ['99 directives registered — 50+ Technical, 12 Market Context, 10 Sentiment, 7 Risk, 4 Exit'],
    },
  },
  {
    id: 'signals',
    label: 'Signal Ladder',
    subtype: 'Envelope + Conflict Detection',
    icon: '📶', bgIcon: BgIconSignals,
    color: '#f59e0b', health: 'degraded',
    variant: 'titlebar',
    x: 380, y: 340,
    stats: { signals: '847', conflicts: '3', lastSignal: '8s ago' },
    docs: {
      description: 'Converts raw scores into ranked trading signals. Envelope layer applies confidence rails, conflict detection spots bull/bear divergence, and pre-trade readiness gates filter weak signals.',
      endpoints: ['GET /api/signals/ladder', 'GET /api/signals/envelope/:symbol'],
      tables: ['Signal', 'Score'],
      files: ['nest/src/modules/signals/signal-envelope.service.ts', 'nest/src/modules/scoring/protocol-consensus.service.ts'],
      conflicts: '3 active conflicts detected (bull/bear divergence on XAUUSD, NVDA, BTCUSD)',
    },
  },
  {
    id: 'automation',
    label: 'Automation Loop',
    subtype: 'Broker-Agnostic · 3 Bots',
    icon: '🔄', bgIcon: BgIconAutomation,
    color: '#22c55e', health: 'healthy',
    variant: 'titlebar',
    x: 680, y: 60,
    stats: { ticks: '2,341', trades: '12', lastTick: '5s ago' },
    docs: {
      description: 'Broker-agnostic tick loop: check Timeline → fetch portfolios → score positions → evaluate strategies → dispatch trades. Safety limits: max 1 trade/tick, min 60s cooldown, emergency stop.',
      endpoints: ['GET /api/automation/status', 'POST /api/automation/run-now', 'GET /api/automation/risk-events'],
      tables: ['LoopTick', 'TradingStrategy', 'StrategyEvaluation', 'AutomationConfig'],
      files: ['nest/src/modules/automation/automation-loop.service.ts', 'nest/src/modules/automation/timeline.service.ts', 'nest/src/modules/trading/trading-strategy.service.ts'],
      bots: '3 active bots — gold-hedge-v1 (XAUUSD), tech-titans-v1 (NVDA), oil-trader-v1 (USOIL)',
    },
  },
  {
    id: 'execution',
    label: 'Trade Execution',
    subtype: 'MT5 Bridge · T212 API',
    icon: '💹', bgIcon: BgIconExecution,
    color: '#ef4444', health: 'down',
    variant: 'titlebar',
    x: 680, y: 340,
    stats: { orders: '89', lastOrder: '2m ago', bridge: 'disconnected' },
    docs: {
      description: 'Places and manages trades across MT5 and Trading212. TradeRecorderService logs every order with origin attribution. Supports manual, agent, and strategy-originated trades.',
      endpoints: ['POST /api/trading/mt5/order', 'POST /api/trading/mt5/close', 'GET /api/trading/mt5/positions', 'GET /api/portfolio/trading212/positions'],
      tables: ['Trade', 'Order', 'OrderExecution', 'Position'],
      files: ['nest/src/modules/trading/mt5-trading.service.ts', 'nest/src/modules/trading/trade-history.controller.ts', 'nest/src/modules/portfolio/portfolio.service.ts', 'nest/src/modules/trading/duplicate-guard.service.ts'],
      bridgeStatus: '⚠️ MT5 Bridge disconnected — port 5000/5001 mismatch. EURUSD proxy active for DXY.',
    },
  },
  {
    id: 'db',
    label: 'Database',
    subtype: 'MySQL · Prisma · 43 Tables',
    icon: '🛢️', bgIcon: BgIconDatabase,
    color: '#22c55e', health: 'healthy',
    variant: 'titlebar',
    x: 980, y: 200,
    stats: { tables: '43', rows: '2.4M', latency: '2ms' },
    docs: {
      description: 'MySQL 8.0 via Prisma ORM. Stores everything: market data, scores, signals, trades, portfolio snapshots, automation ticks. Single source of truth for all persisted data.',
      endpoints: ['Prisma client (internal only)', 'GET /api/database/table-stats'],
      tables: ['43 tables — Symbol, Strategy, MarketBar, Score, Signal, Trade, Position, EarningsEvent, NewsArticle + 35 more'],
      files: ['nest/prisma/schema.prisma', 'nest/src/database/prisma.service.ts'],
      connection: 'mysql://tradingcs@localhost:3306/tradingcs — 2ms latency, 0 connection errors',
    },
  },
  {
    id: 'portfolio',
    label: 'Portfolio Tracker',
    subtype: 'MT5 + Trading212 Positions',
    icon: '📊', bgIcon: BgIconPortfolio,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 960, y: 420,
    stats: { positions: '—', pnl: '—', providers: 'MT5 + T212' },
    docs: {
      description: 'Unified view of all positions across MT5 and Trading212. Live pricing, P&L calculation, allocation percentages, and session-over-session snapshots.',
      endpoints: ['GET /api/portfolio/trading212/positions', 'GET /api/trading/mt5/positions', 'GET /api/portfolio/snapshots'],
      tables: ['Position', 'PortfolioSnapshot', 'PortfolioSnapshotPosition', 'FundAllocation'],
      files: ['nest/src/modules/portfolio/portfolio.service.ts', 'nest/src/modules/portfolio/portfolio-price.service.ts', 'nest/src/modules/portfolio/trading212-import.service.ts'],
    },
  },
  {
    id: 'risk',
    label: 'Risk Controls',
    subtype: 'Circuit Breaker · Drawdown · Exposure',
    icon: '🛡️', bgIcon: BgIconRisk,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 80, y: 460,
    stats: { drawdown: '—', exposure: '—', breaker: 'READY' },
    docs: {
      description: 'Monitors portfolio risk in real time. Circuit breaker trips on drawdown or exposure thresholds. Risk-gated scoring integrates with the pipeline via RiskGatingEngine.',
      endpoints: ['GET /api/risk/overview', 'POST /api/risk/monte-carlo', 'GET /api/risk/limits'],
      tables: ['Position', 'Trade', 'AutomationConfig'],
      files: ['nest/src/modules/risk/risk.controller.ts', 'nest/src/modules/risk/monte-carlo.service.ts', 'nest/src/modules/scoring/risk-gating-engine.service.ts'],
    },
  },
  {
    id: 'alerts',
    label: 'Alert Center',
    subtype: '9 Trigger Types · Real-time',
    icon: '🔔', bgIcon: BgIconAlerts,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 480, y: 500,
    stats: { active: '—', triggered: '—', lastCheck: '—' },
    docs: {
      description: 'Monitors 9 trigger types every 60s: MT5 health, provider degradation, data staleness, position P&L, swap accrual, margin utilization, market close proximity, weekend gap, earnings proximity.',
      endpoints: ['GET /api/alerts', 'GET /api/alerts/triggers', 'POST /api/alerts/dismiss'],
      tables: ['Alert', 'AlertConfig', 'CronMeta'],
      files: ['nest/src/modules/alerts/alert-trigger.service.ts', 'nest/src/modules/alerts/alert.service.ts'],
    },
  },
  {
    id: 'providers',
    label: 'Provider Network',
    subtype: 'Finnhub · MT5 · Binance · FMP · 5 more',
    icon: '🌐', bgIcon: BgIconProviders,
    color: '#f59e0b', health: 'unknown',
    variant: 'titlebar',
    x: 680, y: 500,
    stats: { total: '—', healthy: '—', degraded: '—' },
    docs: {
      description: '9 data providers with health monitoring, rate-limit governance, and automatic failover. ProviderDegradationService detects outages and adjusts scoring confidence.',
      endpoints: ['GET /api/providers/health', 'GET /api/providers/status', 'POST /api/providers/rate-limits'],
      tables: ['ProviderHealth', 'ApiActivityLog', 'ApiCalls', 'RateLimitGovernor'],
      files: ['nest/src/modules/providers/providers.service.ts', 'nest/src/modules/providers/provider-degradation.service.ts', 'nest/src/modules/providers/rate-limit-governor.service.ts'],
    },
  },

  // ── ADDED 2026-10-06 at the owner's request ───────────────────────────────────────────────
  // They asked to "break down the engineering and allow clicking on other features" — Directives,
  // the protocol system, Bots at the trading end, and one node per bridge.
  //
  // ⚠️ THE IO ON EVERY ONE OF THESE IS DERIVED, not written here: it comes from this node's
  // `docs.files` via `src/core/pipeline-map.js`, which reads the generated map. Adding a node costs
  // one declared file list and nothing else — that is what keeps a growing node list from becoming
  // a fifth hand-maintained surface.
  {
    id: 'directives',
    label: 'Directive Library',
    subtype: 'condition-detector · one input per idea',
    icon: '📐', bgIcon: BgIconData,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 1340, y: 60,
    stats: { shape: 'pure scoring input', outcome: 'recorded per run' },
    docs: {
      description: 'Every input to a score is a directive — a small function that reads bars, and returns a magnitude with a DIRECTION. A directive never knows what it is voting on, and never sees the portfolio. The composite is the sum of their magnitudes, weighted by maxScore.',
      endpoints: ['GET /api/directives', 'GET /api/directives/impact', 'GET /api/directives/outcomes'],
      tables: ['DirectiveOutcome', 'SymbolProtocolAffinity', 'DirectiveConfig'],
      files: [
        'nest/src/modules/directives/directives.service.ts',
        'nest/src/modules/directives/condition-detector.service.ts',
        'nest/src/modules/scoring/directive-config.service.ts',
        'nest/src/modules/scoring/directive-impact.service.ts',
      ],
    },
  },
  {
    id: 'protocols',
    label: 'Protocol System',
    subtype: 'gating · health · consensus',
    icon: '🧩', bgIcon: BgIconScoring,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 1340, y: 260,
    stats: { shape: 'a declared set of directives', unit: 'percent of CONFIGURED capacity' },
    docs: {
      description: 'A protocol is the declared set of directives a symbol is scored against, plus its gate. The percentage is earned ÷ CONFIGURED capacity — never an observed sum, which shrinks when a directive goes quiet and makes the same conditions score differently each tick.',
      endpoints: ['GET /api/scoring/protocols', 'GET /api/scoring/gated/protocols', 'GET /api/scoring/gated/thresholds'],
      tables: ['Protocol', 'ScoreSnapshot', 'StrategyProtocol', 'ProtocolRun'],
      files: [
        'nest/src/modules/scoring/protocol-gating.service.ts',
        'nest/src/modules/scoring/protocol-health.service.ts',
        'nest/src/modules/scoring/protocol-db.service.ts',
        'nest/src/modules/scoring/protocol-consensus.service.ts',
      ],
    },
  },
  {
    id: 'bots',
    label: 'Bots & Strategies',
    subtype: 'trading_strategy — the dispatch authority',
    icon: '🤖', bgIcon: BgIconAutomation,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 1340, y: 460,
    stats: { bots: '—', mode: 'auto | semi-auto | manual' },
    docs: {
      description: 'A bot IS its whole configuration — protocol, role, market, broker and execution policy. Any difference makes a different bot; two byte-identical bots are a duplicate, not a merge. ⚠️ `trading_strategy.mode` is the ONLY dispatch authority — no other mode field decides whether an order is placed.',
      endpoints: ['GET /api/trading/strategies', 'POST /api/trading/strategies/seed?dryRun=true'],
      tables: ['TradingStrategy', 'StrategyProtocol', 'StrategyEvaluation', 'SignalQueue'],
      files: [
        'nest/src/modules/trading/trading-strategy.service.ts',
        'nest/src/modules/trading/signal-queue.service.ts',
        'nest/src/modules/trading/bot-performance.service.ts',
        'nest/src/modules/trading/pyramid-policy.service.ts',
      ],
    },
  },
  {
    id: 'bridge-mt5',
    label: 'Bridge · MetaQuotes',
    subtype: 'broker 2 · Python bridge',
    icon: '🔌', bgIcon: BgIconBridge,
    color: '#22c55e', health: 'unknown',
    variant: 'titlebar',
    x: 940, y: 700,
    bridge: { brokerId: 2 },
    stats: { account: '—', tradeAllowed: '—' },
    docs: {
      description: 'The Python bridge (scripts/mt5-bridge/) holding one MetaTrader terminal. It is single-threaded BY DESIGN, so a blocking mt5.initialize() holds the interpreter and a watchdog thread never runs — which is why recovery is bounded at the call, not supervised. ⚠️ It sits OUTSIDE the TypeScript map, so no input/output can be derived for it; this node shows LIVE health instead.',
      endpoints: ['GET /api/providers/mt5/brokers', 'GET /api/providers/mt5/diagnostics', 'POST /api/providers/mt5/reconnect'],
      tables: ['BridgeEvent'],
      files: [],
    },
  },
  {
    id: 'bridge-pepperstone',
    label: 'Bridge · Pepperstone',
    subtype: 'broker 3 · Python bridge',
    icon: '🔌', bgIcon: BgIconBridge,
    color: '#f59e0b', health: 'unknown',
    variant: 'titlebar',
    x: 1200, y: 700,
    bridge: { brokerId: 3 },
    stats: { account: '—', tradeAllowed: '—' },
    docs: {
      description: 'The PepperstoneUK-Demo bridge, same Python process shape as broker 2. ⚠️ `tradeAllowed: false` here means the app CANNOT place orders on this account even though it is connected and pricing — that is the terminal\'s AutoTrading switch, not an app setting. Connected and tradeable are different facts and this node reports both.',
      endpoints: ['GET /api/providers/mt5/brokers', 'GET /api/providers/mt5/diagnostics', 'POST /api/providers/mt5/reconnect'],
      tables: ['BridgeEvent'],
      files: [],
    },
  },
];

// ── Connections ──────────────────────────────────────────
const CONNECTIONS = [
  { from: 'data', to: 'scoring', label: 'Market Bars + Earnings', flow: 'Market bars, earnings events, news → scoring pipeline' },
  { from: 'data', to: 'signals', label: 'News + Sentiment', flow: 'News articles, sentiment scores → signal context' },
  { from: 'scoring', to: 'signals', label: 'Composite Scores', flow: 'Protocol-scored composites → ranked signal ladder' },
  { from: 'signals', to: 'automation', label: 'Ranked Signals', flow: 'Top-ranked signals → automation decision engine' },
  { from: 'automation', to: 'execution', label: 'Trade Orders', flow: 'Buy/sell decisions → MT5/T212 execution' },
  { from: 'execution', to: 'db', label: 'Trade Records', flow: 'Filled orders → Trade table with origin attribution' },
  { from: 'scoring', to: 'db', label: 'Score Snapshots', flow: 'Composite scores → ScoreSnapshot table (every 5s)' },
  { from: 'automation', to: 'db', label: 'Loop Ticks', flow: 'Tick audit trail → LoopTick table' },
  { from: 'providers', to: 'data', label: 'API Data', flow: '9 providers feed the data pipeline' },
  { from: 'providers', to: 'alerts', label: 'Health Status', flow: 'Provider health feeds alert triggers' },
  { from: 'execution', to: 'portfolio', label: 'Positions', flow: 'Filled orders create MT5/T212 positions' },
  { from: 'portfolio', to: 'risk', label: 'Exposure', flow: 'Position values → risk calculations' },
  { from: 'risk', to: 'alerts', label: 'Breaches', flow: 'Drawdown/exposure breaches → alert triggers' },
  { from: 'risk', to: 'automation', label: 'Circuit State', flow: 'Breaker status (READY/TRIPPED) → automation gate' },
  // ── Connections for the nodes added 2026-10-06 ──
  { from: 'directives', to: 'scoring', label: 'Directive Votes', flow: 'Every directive is an input to the composite — a magnitude and a direction, never a percentage' },
  { from: 'protocols', to: 'scoring', label: 'Declared Sets', flow: 'The protocol declares WHICH directives run; the denominator is the CONFIGURED capacity, not an observed sum' },
  { from: 'signals', to: 'bots', label: 'Queue', flow: 'Ranked signals enter strategy_signal_queue, routed BY SUBSCRIPTION — a bot with no strategy_protocol row never trades' },
  { from: 'bots', to: 'automation', label: 'Dispatch Authority', flow: 'trading_strategy.mode decides dispatch; no other mode field is read' },
  { from: 'bridge-mt5', to: 'execution', label: 'broker 2', flow: 'Orders, positions and candles for every symbol routed to broker 2' },
  { from: 'bridge-pepperstone', to: 'execution', label: 'broker 3', flow: 'Orders, positions and candles for every symbol routed to broker 3' },
  { from: 'providers', to: 'bridge-mt5', label: 'MetaQuotes', flow: 'The provider network talks to each bridge over HTTP' },
  { from: 'providers', to: 'bridge-pepperstone', label: 'Pepperstone', flow: 'The provider network talks to each bridge over HTTP' },
];

const HEALTH_COLORS = {
  healthy: { glow: '#22c55e', pulse: 'pulse-green', label: 'Healthy' },
  degraded: { glow: '#f59e0b', pulse: 'pulse-amber', label: 'Degraded' },
  down: { glow: '#ef4444', pulse: 'pulse-red', label: 'Down' },
  unknown: { glow: '#64748b', pulse: '', label: 'Unknown' },
};

// ── Node ─────────────────────────────────────────────────
function GraphNode({ node, isHovered, onHover, onLeave, onClick }) {
  const h = HEALTH_COLORS[node.health] || HEALTH_COLORS.healthy;
  const variantClass = node.variant ? `pg-node--${node.variant}` : '';
  return (
    <div
      className={`pg-node pg-node--${node.health} ${variantClass} ${isHovered ? 'pg-node--hover' : ''}`}
      style={{
        left: node.x, top: node.y,
        borderColor: h.glow,
        boxShadow: `0 0 20px ${h.glow}22, 0 0 60px ${h.glow}08, inset 0 0 20px ${h.glow}05`,
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={() => onClick(node)}
    >
      <span className="pg-node-bgicon">{typeof node.bgIcon === 'function' ? <node.bgIcon /> : node.bgIcon}</span>
      <span className="pg-node-badge" style={{ background: `${h.glow}18`, color: h.glow }}>{node.icon}</span>
      {node.variant === 'titlebar' ? (
        <>
          <div className="pg-node-titlebar" style={{ background: `${h.glow}12`, borderBottom: `1px solid ${h.glow}22` }}>
            <span className="pg-node-label">{node.label}</span>
            <span className="pg-node-subtype">{node.subtype}</span>
          </div>
        </>
      ) : (
        <div className="pg-node-body">
          <span className="pg-node-label">{node.label}</span>
          <span className="pg-node-subtype">{node.subtype}</span>
        </div>
      )}
      <div className={`pg-node-stats ${isHovered ? 'pg-node-stats--visible' : ''}`}>
        {Object.entries(node.stats).map(([key, val]) => {
          const displayVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '—');
          return (
          <div key={key} className="pg-stat-row">
            <span className="pg-stat-key">{key}</span>
            <span className="pg-stat-val">{displayVal}</span>
          </div>
        );})}
      </div>
      <span className={`pg-node-pulse ${h.pulse}`} style={{ borderColor: h.glow }} />
    </div>
  );
}

// ── Connection routing engine ─────────────────────────────
const NODE_W = 220, NODE_H = 155;
const PORT_SPACING = 24; // doubled from 12 for clearer separation

// Direction: which side does the vector from cx,cy to tx,ty exit?
function exitSide(cx, cy, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

// Port position along a given side, distributed evenly
function portOnSide(cx, cy, side, index, total) {
  const offset = total > 1 ? (index - (total - 1) / 2) * PORT_SPACING : 0;
  switch (side) {
    case 'right':  return { x: cx + NODE_W / 2 + 1, y: cy + offset };
    case 'left':   return { x: cx - NODE_W / 2 - 1, y: cy + offset };
    case 'bottom': return { x: cx + offset, y: cy + NODE_H / 2 + 1 };
    case 'top':    return { x: cx + offset, y: cy - NODE_H / 2 - 1 };
    default:       return { x: cx, y: cy };
  }
}

function buildPath(sx, sy, tx, ty, mode) {
  if (mode === 'diagonal') return `M${sx},${sy} L${tx},${ty}`;
  const midX = (sx + tx) / 2;
  return `M${sx},${sy} L${midX},${sy} L${midX},${ty} L${tx},${ty}`;
}

function ConnectionLines({ connections, nodes, mode, hoveredNode, hoveredConn, onConnHover, onConnLeave, onConnClick }) {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, { ...n, cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2 }]));

  // First pass: count per-side usage per node
  const sideTotals = {}; // key: "nodeId:side" → number of connections
  for (const c of connections) {
    const from = nodeMap[c.from], to = nodeMap[c.to];
    if (!from || !to) continue;
    const sSide = exitSide(from.cx, from.cy, to.cx, to.cy);
    const eSide = exitSide(to.cx, to.cy, from.cx, from.cy);
    const sKey = `${c.from}:${sSide}`, eKey = `${c.to}:${eSide}`;
    sideTotals[sKey] = (sideTotals[sKey] || 0) + 1;
    sideTotals[eKey] = (sideTotals[eKey] || 0) + 1;
  }

  // Second pass: assign port positions
  const sideCounters = {};
  for (const c of connections) {
    const from = nodeMap[c.from], to = nodeMap[c.to];
    if (!from || !to) continue;
    const sSide = exitSide(from.cx, from.cy, to.cx, to.cy);
    const eSide = exitSide(to.cx, to.cy, from.cx, from.cy);
    const sKey = `${c.from}:${sSide}`, eKey = `${c.to}:${eSide}`;
    const sIdx = sideCounters[sKey] || 0;
    const eIdx = sideCounters[eKey] || 0;
    sideCounters[sKey] = sIdx + 1;
    sideCounters[eKey] = eIdx + 1;
    c._sp = portOnSide(from.cx, from.cy, sSide, sIdx, sideTotals[sKey]);
    c._ep = portOnSide(to.cx, to.cy, eSide, eIdx, sideTotals[eKey]);
  }

  return (
    <svg className="pg-connections">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {connections.map((c, i) => {
        if (!c._sp || !c._ep) return null;
        const pathD = buildPath(c._sp.x, c._sp.y, c._ep.x, c._ep.y, mode);
        const midX = (c._sp.x + c._ep.x) / 2, midY = (c._sp.y + c._ep.y) / 2;
        // Highlight if this connection's nodes are hovered
        const isNodeHovered = hoveredNode && (c.from === hoveredNode || c.to === hoveredNode);
        const isHovered = hoveredConn === i || isNodeHovered;
        return (
          <g key={i} className={`pg-conn-group ${isHovered ? 'pg-conn-group--hover' : ''}`}
            onMouseEnter={() => onConnHover(i)}
            onMouseLeave={onConnLeave}
            onClick={(e) => { e.stopPropagation(); onConnClick(c, e); }}>
            <path d={pathD} className="pg-edge-hit" fill="none" />
            <path d={pathD} className={`pg-edge ${isNodeHovered ? 'pg-edge--glow' : ''}`} fill="none" />
            <text x={midX} y={midY - 10} className={`pg-edge-label ${isHovered ? 'pg-edge-label--glow' : ''}`}>
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Inputs / Outputs — DERIVED FROM THE GENERATED MAP (#1071, Phase 3) ──────────────────────
//
// ⚠️ NOTHING IN THIS BLOCK IS TYPED BY HAND, and that is the point of the phase. The resources
// come from `docs/PIPELINE-MAP.json`, which is generated from source and `--check`ed in the
// backend prebuild — so if a service stops writing a table, this block changes on its own. The
// node list above it is hand-curated; an IO line written beside it would be a fifth architecture
// surface, and the repo already has four plus a gate checking that two of them agree.
//
// ⚠️ AND "CANNOT LOAD" IS RENDERED AS SUCH. An empty IO block on a failed fetch would read as
// "this subsystem touches nothing", which is a confident false statement rather than a gap.
function IOColumn({ title, arrow, rows, filesOf }) {
  return (
    <section>
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <ul><li className="pg-io-none">none from these files</li></ul>
      ) : (
        <ul>
          {rows.map((r) => {
            const names = r.files.map((f) => f.split('/').pop());
            return (
              <li key={r.resource}>
                <code>{r.resource}</code>
                <span className="pg-io-via" title={filesOf(r).join('\n')}> {arrow} {names.join(', ')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NodeIO({ node, pmap, pmapState }) {
  const files = node.docs?.files || [];
  const io = useMemo(
    () => (pmap ? ioForFiles(pmap, files) : { inputs: [], outputs: [], untracked: [], missing: [] }),
    [pmap, node.id], // eslint-disable-line react-hooks/exhaustive-deps -- `files` is a module constant on the node
  );
  const unref = useMemo(() => (pmap ? unreferencedIn(pmap, files) : []), [pmap, node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const diverge = useMemo(() => (pmap ? divergentMathsIn(pmap, files) : []), [pmap, node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⚠️ THE SCOPE IS PART OF THE HEADING, AND IT IS NOT DECORATION. This block is derived from the
  // node's DECLARED file list, and that list is hand-written. "Writes: none" is therefore a
  // statement about three named files, not about the subsystem — measured on the first run, the
  // Data Pipeline node declared three files and NONE of them writes a tracked resource, while the
  // data pipeline obviously writes `marketbar` (through `import-jobs.service.ts`, which the node
  // never listed). Without the scope this reads as a false claim about the subsystem; with it, it
  // reads as what it is — a true statement about an incomplete list, which is the drift the whole
  // phase exists to expose.
  const head = (
    <h4>
      Inputs / Outputs
      <span className="pg-io-src">
        from docs/PIPELINE-MAP.json · {files.length} declared file(s)
      </span>
    </h4>
  );

  if (pmapState === 'loading') {
    return <section className="pg-overlay-section">{head}<p>Reading the generated map…</p></section>;
  }
  if (pmapState === 'error') {
    return (
      <section className="pg-overlay-section">
        {head}
        <div className="pg-overlay-alert pg-overlay-alert--warn">
          The generated map could not be loaded. Nothing is claimed here rather than guessed — run
          <code> node scripts/generate-pipeline-map.cjs --write </code> if it is missing.
        </div>
      </section>
    );
  }

  return (
    <section className="pg-overlay-section">
      {head}
      <div className="pg-overlay-grid">
        <IOColumn title="Reads (in)" arrow="←" rows={io.inputs} filesOf={(r) => r.files} />
        <IOColumn title="Writes (out)" arrow="→" rows={io.outputs} filesOf={(r) => r.files} />
      </div>

      {/* ⚠️ TWO DIFFERENT FACTS, TWO DIFFERENT MESSAGES. "This path is stale" and "this file is
          real but touches nothing the dataset tracks" are not the same claim, and the first version
          of this block made the second wear the first's wording — it flagged
          `risk-gating-engine.service.ts` as a possible dead path, and the file exists. */}
      {io.missing.length > 0 && (
        <div className="pg-overlay-alert pg-overlay-alert--warn">
          {io.missing.length} file(s) in this node&apos;s list are <strong>not in the scanned source</strong> —
          a stale path, so nothing can be derived from them: {
            io.missing.map((f) => f.split('/').pop()).join(', ')
          }
        </div>
      )}
      {io.untracked.length > 0 && (
        <p className="pg-io-note">
          {io.untracked.length} file(s) here are real but touch none of the {pmap ? pmap.resources.size : 11}{' '}
          tracked pipeline resources, so the dataset has no row for them and no IO can be derived:{' '}
          {io.untracked.map((f) => f.split('/').pop()).join(', ')}.
        </p>
      )}

      {unref.length > 0 && (
        <p className="pg-io-note">
          <strong>{unref.length}</strong> function(s) in these files have no resolved consumer:{' '}
          {unref.slice(0, 4).map((u) => u.name).join(', ')}
          {unref.length > 4 ? ` and ${unref.length - 4} more` : ''}.
        </p>
      )}

      {diverge.length > 0 && (
        <p className="pg-io-note pg-io-note--warn">
          <strong>{diverge.length}</strong> maths group(s) in these files are written with{' '}
          <strong>different edges</strong> — same arithmetic, different conditions or guards. That is
          the #1069 shape, and it is the reason to look rather than the answer.
        </p>
      )}
    </section>
  );
}

/**
 * NodeBridge() — the per-bridge nodes' equivalent of NodeIO.
 *
 * WHY THIS EXISTS SEPARATELY: the MT5 bridges are PYTHON (`scripts/mt5-bridge/`), so they are not in
 * the TypeScript source the pipeline map scans. `ioForFiles()` would return empty for them, and an
 * empty IO block reads as "this node touches nothing" — a false claim. So these two nodes show LIVE
 * health instead, and SAY WHY they have no derived IO.
 *
 * ⚠️ TWO FACTS THAT ARE NOT THE SAME FACT, and the whole reason this block is worth having:
 * `connected` is whether the bridge is talking to the terminal; `tradeAllowed` is whether the
 * terminal will let it place an order. Measured 2026-10-06 — broker 3 was `connected: true,
 * balance: 1000, connectionState: 'ok'` with `tradeAllowed: false`. The app could take prices from
 * it and could not trade on it, and nothing on the screen said so.
 *
 * Data source: GET /api/providers/mt5/brokers (same-origin — the bridge itself listens on :5000/5001
 * and sends no CORS headers, so it must be read through the API, not fetched directly).
 */
function NodeBridge({ brokerId }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['pipeline-graph', 'brokers'],
    queryFn: () => apiGet('/api/providers/mt5/brokers').catch(() => null),
    refetchInterval: 15000,
  });

  const head = (
    <h4>
      Bridge Health
      <span className="pg-io-src">live · GET /api/providers/mt5/brokers</span>
    </h4>
  );

  if (isLoading) {
    return <section className="pg-overlay-section">{head}<p>Reading bridge health…</p></section>;
  }

  const list = Array.isArray(data?.brokers) ? data.brokers : [];
  const broker = list.find((b) => Number(b.brokerId) === Number(brokerId));

  // ⚠️ "Cannot judge" must never render as "fine" — and the two ways of failing to judge are
  // DIFFERENT FACTS: the API not answering says nothing at all, while an answer that omits this
  // broker is a configuration finding. Collapse them and the reader draws the wrong conclusion.
  if (!broker) {
    return (
      <section className="pg-overlay-section">
        {head}
        <div className="pg-overlay-alert pg-overlay-alert--warn">
          {isError || data == null ? (
            <>The API did not answer, so nothing was measured. This is <strong>not</strong> a
              statement that the bridge is down.</>
          ) : (
            <>The API answered and returned no broker <strong>{brokerId}</strong>. That is a
              <strong> configuration</strong> fact, not an outage — the account is not in
              <code> MT5_ACTIVE_BROKERS</code>.</>
          )}
        </div>
      </section>
    );
  }

  const h = broker.health || {};
  // ⚠️ `credentialMismatch` is THE field for "the terminal is logged in as somebody else", and until
  // this node it had NO UI anywhere — the bridge detected it, refused every mutating call (#1035),
  // and the API published it, so it was reachable and invisible at the same time. A wrong-account
  // binding that nothing displays is a money-path fact with no surface.
  // Three states, not two: null = matches, an object = mismatch, ABSENT = this bridge build does
  // not report it, which is "cannot judge" and must not read as "fine".
  const reportsMismatch = Object.prototype.hasOwnProperty.call(h, 'credentialMismatch');
  const mismatch = h.credentialMismatch;
  const rows = [
    ['connected', h.connected ? 'yes' : 'NO'],
    ['account', h.account || '—'],
    ['server', h.server || broker.server || '—'],
    ['balance / equity', `${h.balance ?? '—'} / ${h.equity ?? '—'}`],
    ['tradeAllowed', h.tradeAllowed ? 'true' : 'FALSE — will refuse orders'],
    ['orderReady', h.orderReady ? 'true' : 'false'],
    ['credential match', !reportsMismatch
      ? 'not reported by this bridge build'
      : (mismatch
        ? `MISMATCH — terminal is on ${mismatch.actualAccount} @ ${mismatch.actualServer}`
        : 'matches the configured account')],
    ['connection state', h.connectionState || '—'],
    ['circuit breaker', `${h.circuitBreaker?.state ?? '—'} · ${h.circuitBreaker?.failures ?? 0} failures`],
    ['bridge url', broker.url || '—'],
  ];

  return (
    <section className="pg-overlay-section">
      {head}
      <p className="pg-io-note">
        The bridge is Python and sits outside the scanned TypeScript source, so this node has
        <strong> no derived inputs or outputs</strong> — live health instead. <strong>Connected and
        tradeable are different facts</strong>, and a bridge can be one without the other.
      </p>
      {mismatch && (
        <div className="pg-overlay-alert pg-overlay-alert--warn">
          <strong>Wrong account bound.</strong> Configured for slot #{mismatch.activeSlot}
          {' '}({mismatch.requestedAccount ?? '—'} @ {mismatch.requestedServer ?? '—'}), but the
          terminal is logged in as <strong>{mismatch.actualAccount} @ {mismatch.actualServer}</strong>.
          Every mutating call is refused (#1035) — reads stay open, so this bridge still answers with
          prices.{' '}
          {Array.isArray(mismatch.reasons) && mismatch.reasons.length > 0 &&
            <>Reasons: {mismatch.reasons.join('; ')}.</>}
        </div>
      )}
      {h.tradeAllowed === false && (
        <div className="pg-overlay-alert pg-overlay-alert--warn">
          Connected, priced, and <strong>cannot place an order</strong>. Every order to this account
          will be refused. This is the MT5 terminal&apos;s AutoTrading switch — a click in
          MetaTrader, not an app setting.
        </div>
      )}
      <div className="pg-overlay-stat-grid">
        {rows.map(([key, val]) => (
          <div key={key} className="pg-overlay-stat">
            <span className="pg-overlay-stat-val">{String(val)}</span>
            <span className="pg-overlay-stat-key">{key}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Detail Overlay ───────────────────────────────────────
function DetailOverlay({ node, onClose, pmap, pmapState }) {
  if (!node) return null;
  const h = HEALTH_COLORS[node.health] || HEALTH_COLORS.healthy;
  const d = node.docs;
  return (
    <div className="pg-overlay-backdrop" onClick={onClose}>
      <div className="pg-overlay" onClick={(e) => e.stopPropagation()}>
        <button className="pg-overlay-close" onClick={onClose}>✕</button>

        <div className="pg-overlay-head">
          <span className="pg-overlay-icon" style={{ background: `${h.glow}18`, color: h.glow }}>{node.icon}</span>
          <div>
            <h2>{node.label}</h2>
            <span className="pg-overlay-health" style={{ color: h.glow }}>● {h.label}</span>
          </div>
        </div>

        <p className="pg-overlay-desc">{d.description}</p>

        {d.bridgeStatus && (
          <div className="pg-overlay-alert">{d.bridgeStatus}</div>
        )}
        {d.conflicts && (
          <div className="pg-overlay-alert pg-overlay-alert--warn">{d.conflicts}</div>
        )}

        {/* A bridge node has no derivable IO (Python, outside the scanned source) — it shows live
            health instead. See NodeBridge for why those are not the same block. */}
        {node.bridge
          ? <NodeBridge brokerId={node.bridge.brokerId} />
          : <NodeIO node={node} pmap={pmap} pmapState={pmapState} />}

        <div className="pg-overlay-grid">
          {d.endpoints && (
            <section>
              <h4>API Endpoints</h4>
              <ul>{d.endpoints.map((e, i) => <li key={i}><code>{e}</code></li>)}</ul>
            </section>
          )}
          {d.tables && (
            <section>
              <h4>Database Tables</h4>
              <ul>{d.tables.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </section>
          )}
          {d.files && (
            <section>
              <h4>Key Source Files</h4>
              <ul>{d.files.map((f, i) => <li key={i}><code>{f}</code></li>)}</ul>
            </section>
          )}
        </div>

        {d.providers && (
          <section className="pg-overlay-section">
            <h4>Data Providers</h4>
            <div className="pg-provider-chips">{d.providers.map((p, i) => <span key={i} className="pg-chip">{p}</span>)}</div>
          </section>
        )}
        {d.directives && (
          <section className="pg-overlay-section">
            <h4>Directives</h4>
            <p>{d.directives}</p>
          </section>
        )}
        {d.bots && (
          <section className="pg-overlay-section">
            <h4>Active Bots</h4>
            <p>{d.bots}</p>
          </section>
        )}
        {d.connection && (
          <section className="pg-overlay-section">
            <h4>Connection</h4>
            <p><code>{d.connection}</code></p>
          </section>
        )}

        <div className="pg-overlay-stats">
          <h4>Live Stats</h4>
          <div className="pg-overlay-stat-grid">
            {Object.entries(node.stats).map(([key, val]) => {
              const displayVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '—');
              return (
              <div key={key} className="pg-overlay-stat">
                <span className="pg-overlay-stat-val">{displayVal}</span>
                <span className="pg-overlay-stat-key">{key}</span>
              </div>
            );})}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Connection Info Popover ──────────────────────────────
function ConnectionPopover({ conn, position, onClose }) {
  if (!conn) return null;
  return (
    <div className="pg-conn-popover" style={{ left: position.x, top: position.y }} onClick={onClose}>
      <div className="pg-conn-popover-head">
        <span className="pg-conn-arrow">{conn.from}</span>
        <span className="pg-conn-label-text">{conn.label}</span>
        <span className="pg-conn-arrow">{conn.to}</span>
      </div>
      {conn.flow && <p className="pg-conn-flow">{conn.flow}</p>}
      <span className="pg-conn-hint">Click to dismiss</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────
export default function PipelineGraphLabPage() {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [hoveredConn, setHoveredConn] = useState(null);
  const [connPopover, setConnPopover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // ── Connector mode — reads from Screen Options localStorage ──
  const getConnMode = () => {
    try { return localStorage.getItem('pg-connector-mode') || 'diagonal'; }
    catch { return 'diagonal'; }
  };
  const [connMode, setConnMode] = useState(getConnMode);

  // Poll localStorage for Screen Options changes (same-tab doesn't fire 'storage' event)
  useEffect(() => {
    const interval = setInterval(() => {
      const current = getConnMode();
      setConnMode((prev) => prev !== current ? current : prev);
    }, 250);
    return () => clearInterval(interval);
  }, []);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  // ── Real API data ──────────────────────────────────────
  const { data: autoStatus } = useQuery({
    queryKey: ['pipeline-graph', 'automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 10000,
  });
  const { data: providerHealth } = useQuery({
    queryKey: ['pipeline-graph', 'providers'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 30000,
  });
  const { data: riskOverview } = useQuery({
    queryKey: ['pipeline-graph', 'risk'],
    queryFn: () => apiGet('/api/risk/overview').catch(() => null),
    refetchInterval: 30000,
  });
  // Per-bridge health for the two bridge nodes. Same key as NodeBridge uses, so this is ONE fetch
  // shared between the canvas (node ring colour + hover stats) and the overlay (full health).
  const { data: brokersHealth } = useQuery({
    queryKey: ['pipeline-graph', 'brokers'],
    queryFn: () => apiGet('/api/providers/mt5/brokers').catch(() => null),
    refetchInterval: 15000,
  });

  // ── The generated map (#1071 Phase 3) ─────────────────────────────────────────────
  // Loaded on mount, lazily: the artefact is ~700 KB and this is the only page that reads it.
  // ⚠️ 'error' is a separate state from 'ready with empty results' — the IO block renders them
  // differently, because "could not load" and "touches nothing" are different facts.
  const [pmap, setPmap] = useState(null);
  const [pmapState, setPmapState] = useState('loading');
  useEffect(() => {
    let alive = true;
    loadPipelineMap()
      .then((m) => { if (alive) { setPmap(m); setPmapState('ready'); } })
      .catch(() => { if (alive) setPmapState('error'); });
    return () => { alive = false; };
  }, []);

  // Apply saved positions, then merge live API data
  const positionedNodes = useMemo(() => applyPositions(SAMPLE_NODES), []);
  const liveNodes = positionedNodes.map((n) => {
    const updated = { ...n, stats: { ...n.stats } };
    if (n.id === 'automation' && autoStatus) {
      // ⚠️ BOTS, not strategies (#878). `autoStatus.activeStrategies` is `trading_strategy` rows
      // with `active = true` (see automation.controller.ts). The stat KEY is rendered as the LABEL
      // by the Object.entries loop on the node, so "strategies" printed a bot count under the wrong
      // word — "strategy" already means a derived strategy or a protocol subscription elsewhere.
      const bots = Array.isArray(autoStatus.activeStrategies) ? autoStatus.activeStrategies.length : (autoStatus.activeStrategies ?? 0);
      updated.stats = {
        ticks: String(autoStatus.tickCount ?? '—'),
        trades: String(autoStatus.tradeCount ?? '—'),
        bots: String(bots),
        status: autoStatus.loopEnabled ? 'RUNNING' : 'PAUSED',
      };
      updated.health = autoStatus.loopEnabled ? 'healthy' : 'degraded';
    }
    if (n.id === 'providers' && providerHealth) {
      const list = Array.isArray(providerHealth) ? providerHealth : (providerHealth?.providers || []);
      const healthy = list.filter((p) => p.status === 'healthy').length;
      const degraded = list.filter((p) => p.status === 'degraded').length;
      const down = list.filter((p) => p.status === 'down' || p.status === 'failed').length;
      updated.stats = { total: String(list.length), healthy: String(healthy), degraded: String(degraded), down: String(down) };
      updated.health = down > 0 ? 'degraded' : healthy > 0 ? 'healthy' : 'unknown';
    }
    if (n.id === 'risk' && riskOverview) {
      const breaker = riskOverview.circuitBreaker;
      const breakerState = typeof breaker === 'string' ? breaker : (breaker?.state || 'READY');
      updated.stats = {
        drawdown: riskOverview.drawdownPct != null ? `${riskOverview.drawdownPct}%` : '—',
        exposure: riskOverview.exposurePct != null ? `${riskOverview.exposurePct}%` : '—',
        breaker: breakerState,
      };
      updated.health = breakerState === 'TRIPPED' ? 'down' : 'healthy';
    }
    if (n.id === 'execution' && autoStatus) {
      updated.health = autoStatus.brokerConnected ? 'healthy' : 'down';
    }
    // ── The nodes added 2026-10-06 ──
    if (n.id === 'bots' && autoStatus) {
      // ⚠️ `autoStatus.activeStrategies` is `trading_strategy` rows with `active = true` (#878), so
      // the count here is BOTS — the same number the automation node shows, under the node that owns
      // them. `trading_strategy.mode` is the dispatch authority this node is about.
      const bots = Array.isArray(autoStatus.activeStrategies)
        ? autoStatus.activeStrategies.length
        : (autoStatus.activeStrategies ?? '—');
      updated.stats = { bots: String(bots), loop: autoStatus.loopEnabled ? 'RUNNING' : 'PAUSED' };
      updated.health = 'healthy';
    }
    if (n.bridge && brokersHealth) {
      const list = Array.isArray(brokersHealth.brokers) ? brokersHealth.brokers : [];
      const b = list.find((x) => Number(x.brokerId) === Number(n.bridge.brokerId));
      if (b) {
        const h = b.health || {};
        updated.stats = {
          account: String(h.account ?? '—'),
          balance: String(h.balance ?? '—'),
          // ⚠️ Printed as a WORD, not a boolean: `tradeAllowed: false` is the single most
          // consequential field on this node and `false` beside `connected: true` is easy to skim
          // past. The node ring turns amber for it — connected-but-not-tradeable is not "healthy".
          trade: h.tradeAllowed ? 'allowed' : 'BLOCKED',
        };
        updated.health = !h.connected
          ? 'down'
          // A credential mismatch is worse than AutoTrading being off: the terminal is on an account
          // this bridge was never configured for, so the refusal is structural rather than a switch.
          // Both refuse orders; only one of them means "somebody is logged into the wrong account".
          : (h.credentialMismatch ? 'down' : (h.tradeAllowed ? 'healthy' : 'degraded'));
      } else {
        // The API answered without this broker — a configuration fact, not an outage.
        updated.health = 'unknown';
      }
    }
    return updated;
  });

  const onMouseDown = useCallback((e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('pg-canvas-inner')) {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { ...pan };
    }
  }, [pan]);

  const onMouseMove = useCallback((e) => {
    if (!dragging) return;
    setPan({ x: panStart.current.x + e.clientX - dragStart.current.x, y: panStart.current.y + e.clientY - dragStart.current.y });
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(false), []);

  // Resize canvas to fit new nodes — widened 2026-10-06 for the five nodes added at the owner's
  // request. Three continue the right-hand column; the two bridges sit under the provider network.
  const canvasW = 1620, canvasH = 900;

  return (
    <div className="pg-page">
      <header className="pg-header">
        <div>
          <h1>Pipeline Graph <span className="pg-badge-live">LIVE DATA</span>
          <PageInfoPopover>
            Click a node for documentation · Drag to pan · Hover for stats · Real-time health from APIs
          </PageInfoPopover>
          <span style={{ marginLeft: 12, fontSize: '0.72rem' }}>
            {/* Link to the META.Stack board REMOVED 2026-10-08 — the board is rendered further down
                this same page, so the link was a self-reference. */}
          </span>
        </h1>
        </div>
        <div className="pg-legend">
          <span><span className="pg-dot" style={{ background: '#22c55e' }}/> Healthy</span>
          <span><span className="pg-dot" style={{ background: '#f59e0b' }}/> Degraded</span>
          <span><span className="pg-dot" style={{ background: '#ef4444' }}/> Down</span>
          <span><span className="pg-dot" style={{ background: '#64748b' }}/> Unknown</span>
        </div>
      </header>

      <div className={`pg-canvas ${dragging ? 'pg-canvas--dragging' : ''}`} ref={canvasRef}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div className="pg-canvas-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width: `${canvasW}px`, height: `${canvasH}px` }}>
          <ConnectionLines nodes={liveNodes} connections={CONNECTIONS} mode={connMode}
            hoveredNode={hovered}
            hoveredConn={hoveredConn} onConnHover={setHoveredConn} onConnLeave={() => setHoveredConn(null)}
            onConnClick={(c, evt) => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect) {
                setConnPopover({ conn: c, x: evt.clientX - rect.left - 140, y: evt.clientY - rect.top - 60 });
              }
            }} />
          {liveNodes.map((n) => (
            <GraphNode key={n.id} node={n} isHovered={hovered === n.id}
              onHover={setHovered} onLeave={() => setHovered(null)} onClick={setSelected} />
          ))}
          {connPopover && <ConnectionPopover conn={connPopover.conn} position={{ x: connPopover.x, y: connPopover.y }} onClose={() => setConnPopover(null)} />}
        </div>
      </div>

      {/* ── META.Stack lane board — MERGED IN (owner direction, 2026-10-08) ──
          Owner: *"I want the nodes on this view factored into /development/pipeline-graph-lab and then
          this page deleted."* The board is the SAME component, rendered here rather than on its own
          route; that route, its nav entry and its view-meta row are removed, so the app has one
          pipeline surface instead of two that drift apart.

          ⚠️ THE GRAPH ABOVE STAYS THE PRIMARY VIEW and keeps its live data. The board below is the
          human-readable lane summary — it holds no live feed of its own, so it must not become the
          thing a reader lands on. */}
      <section className="pg-lane-board">
        <MetaStackPipelineBoard />
      </section>

      <footer className="pg-footer">
        <span>Prototype — Pipeline Graph Lab</span>
        <span>Click node → documentation · Drag to pan</span>
      </footer>

      <DetailOverlay node={selected} onClose={() => setSelected(null)} pmap={pmap} pmapState={pmapState} />
    </div>
  );
}
