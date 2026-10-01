import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './pipeline-graph-lab.css';
import PIPELINE_POSITIONS from '../data/pipeline-graph-positions.json';
import PageInfoPopover from '../components/PageInfoPopover';

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

const BG_ICON_COMPONENTS = {
  data: BgIconData,
  scoring: BgIconScoring,
  signals: BgIconSignals,
  automation: BgIconAutomation,
  execution: BgIconExecution,
  db: BgIconDatabase,
};

// ── Node position loading — JSON file is canonical, inline x/y are dev defaults ──
function applyPositions(nodes) {
  const posMap = {};
  try { for (const p of PIPELINE_POSITIONS) posMap[p.id] = { x: p.x, y: p.y }; } catch {}
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

// ── Detail Overlay ───────────────────────────────────────
function DetailOverlay({ node, onClose }) {
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

  // Resize canvas to fit new nodes
  const canvasW = 1300, canvasH = 680;

  return (
    <div className="pg-page">
      <header className="pg-header">
        <div>
          <h1>Pipeline Graph <span className="pg-badge-live">LIVE DATA</span>
          <PageInfoPopover>
            Click a node for documentation · Drag to pan · Hover for stats · Real-time health from APIs
          </PageInfoPopover>
          <span style={{ marginLeft: 12, fontSize: '0.72rem' }}>
            <a href="/status/meta-stack-pipeline" style={{ color: 'var(--accent)', textDecoration: 'none' }}>→ META.Stack Pipeline</a>
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

      <footer className="pg-footer">
        <span>Prototype — Pipeline Graph Lab</span>
        <span>Click node → documentation · Drag to pan</span>
      </footer>

      <DetailOverlay node={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
