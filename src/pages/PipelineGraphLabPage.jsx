import { useState, useRef, useCallback } from 'react';
import './pipeline-graph-lab.css';

// ── Sample nodes — docs + health + live stats ────────────
const SAMPLE_NODES = [
  {
    id: 'data',
    label: 'Data Pipeline',
    subtype: 'Market Data + Earnings + News',
    icon: '🗄️', bgIcon: '◈',
    color: '#22c55e', health: 'healthy',
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
    icon: '⚡', bgIcon: '◆',
    color: '#22c55e', health: 'healthy',
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
    icon: '📶', bgIcon: '⇡',
    color: '#f59e0b', health: 'degraded',
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
    subtype: 'Broker-Agnostic · 3 Strategies',
    icon: '🔄', bgIcon: '⟳',
    color: '#22c55e', health: 'healthy',
    x: 680, y: 60,
    stats: { ticks: '2,341', trades: '12', lastTick: '5s ago' },
    docs: {
      description: 'Broker-agnostic tick loop: check Timeline → fetch portfolios → score positions → evaluate strategies → dispatch trades. Safety limits: max 1 trade/tick, min 60s cooldown, emergency stop.',
      endpoints: ['GET /api/automation/status', 'POST /api/automation/run-now', 'GET /api/automation/timeline'],
      tables: ['LoopTick', 'TradingStrategy', 'StrategyEvaluation', 'AutomationConfig'],
      files: ['nest/src/modules/automation/automation-loop.service.ts', 'nest/src/modules/automation/timeline.service.ts', 'nest/src/modules/trading/trading-strategy.service.ts'],
      strategies: '3 active strategies — gold-hedge-v1 (XAUUSD), tech-titans-v1 (NVDA), oil-trader-v1 (USOIL)',
    },
  },
  {
    id: 'execution',
    label: 'Trade Execution',
    subtype: 'MT5 Bridge · T212 API',
    icon: '💹', bgIcon: '▤',
    color: '#ef4444', health: 'down',
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
    icon: '🛢️', bgIcon: '⊞',
    color: '#22c55e', health: 'healthy',
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
];

// ── Connections ──────────────────────────────────────────
const CONNECTIONS = [
  { from: 'data', to: 'scoring', label: 'Market Bars + Earnings' },
  { from: 'data', to: 'signals', label: 'News + Sentiment' },
  { from: 'scoring', to: 'signals', label: 'Composite Scores' },
  { from: 'signals', to: 'automation', label: 'Ranked Signals' },
  { from: 'automation', to: 'execution', label: 'Trade Orders' },
  { from: 'execution', to: 'db', label: 'Trade Records' },
  { from: 'scoring', to: 'db', label: 'Score Snapshots' },
  { from: 'automation', to: 'db', label: 'Loop Ticks' },
];

const HEALTH_COLORS = {
  healthy: { glow: '#22c55e', pulse: 'pulse-green', label: 'Healthy' },
  degraded: { glow: '#f59e0b', pulse: 'pulse-amber', label: 'Degraded' },
  down: { glow: '#ef4444', pulse: 'pulse-red', label: 'Down' },
};

// ── Node ─────────────────────────────────────────────────
function GraphNode({ node, isHovered, onHover, onLeave, onClick }) {
  const h = HEALTH_COLORS[node.health] || HEALTH_COLORS.healthy;
  return (
    <div
      className={`pg-node pg-node--${node.health} ${isHovered ? 'pg-node--hover' : ''}`}
      style={{
        left: node.x, top: node.y,
        borderColor: h.glow,
        boxShadow: `0 0 20px ${h.glow}22, 0 0 60px ${h.glow}08, inset 0 0 20px ${h.glow}05`,
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={() => onClick(node)}
    >
      <span className="pg-node-bgicon">{node.bgIcon}</span>
      <span className="pg-node-badge" style={{ background: `${h.glow}18`, color: h.glow }}>{node.icon}</span>
      <div className="pg-node-body">
        <span className="pg-node-label">{node.label}</span>
        <span className="pg-node-subtype">{node.subtype}</span>
      </div>
      <div className={`pg-node-stats ${isHovered ? 'pg-node-stats--visible' : ''}`}>
        {Object.entries(node.stats).map(([key, val]) => (
          <div key={key} className="pg-stat-row">
            <span className="pg-stat-key">{key}</span>
            <span className="pg-stat-val">{val}</span>
          </div>
        ))}
      </div>
      <span className={`pg-node-pulse ${h.pulse}`} style={{ borderColor: h.glow }} />
    </div>
  );
}

// ── Connections (SVG) ────────────────────────────────────
function ConnectionLines({ nodes, connections }) {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const cx = 110, cy = 80;
  return (
    <svg className="pg-connections">
      {connections.map((c, i) => {
        const from = nodeMap[c.from], to = nodeMap[c.to];
        if (!from || !to) return null;
        const x1 = from.x + cx, y1 = from.y + cy, x2 = to.x + cx, y2 = to.y + cy;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="pg-edge" />
            <text x={(x1+x2)/2} y={(y1+y2)/2 - 6} className="pg-edge-label">{c.label}</text>
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
        {d.strategies && (
          <section className="pg-overlay-section">
            <h4>Active Strategies</h4>
            <p>{d.strategies}</p>
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
            {Object.entries(node.stats).map(([key, val]) => (
              <div key={key} className="pg-overlay-stat">
                <span className="pg-overlay-stat-val">{val}</span>
                <span className="pg-overlay-stat-key">{key}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────
export default function PipelineGraphLabPage() {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

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

  return (
    <div className="pg-page">
      <header className="pg-header">
        <div>
          <h1>Pipeline Graph <span className="pg-badge-prototype">PROTOTYPE</span></h1>
          <p className="pg-subtitle">Click a node for documentation · Drag to pan · Hover for stats · Health = border glow</p>
        </div>
        <div className="pg-legend">
          <span><span className="pg-dot" style={{ background: '#22c55e' }}/> Healthy</span>
          <span><span className="pg-dot" style={{ background: '#f59e0b' }}/> Degraded</span>
          <span><span className="pg-dot" style={{ background: '#ef4444' }}/> Down</span>
        </div>
      </header>

      <div className={`pg-canvas ${dragging ? 'pg-canvas--dragging' : ''}`} ref={canvasRef}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div className="pg-canvas-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <ConnectionLines nodes={SAMPLE_NODES} connections={CONNECTIONS} />
          {SAMPLE_NODES.map((n) => (
            <GraphNode key={n.id} node={n} isHovered={hovered === n.id}
              onHover={setHovered} onLeave={() => setHovered(null)} onClick={setSelected} />
          ))}
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
