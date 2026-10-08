/**
 * META.Stack Pipeline Graph — Interactive architecture & roadmap.
 * ===============================================================
 * Visual representation of the canonical META.Stack pipeline with
 * implemented and planned nodes. Each module lane shows its nodes,
 * wired to actual files, endpoints, and database tables.
 *
 * Lane colors distinguish modules. Dashed borders = planned/roadmap.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import PageInfoPopover from '../components/PageInfoPopover';
import './meta-stack-pipeline.css';

// ── Module lane definitions ──
const LANES = [
  { id: 'watchlists', label: 'Watchlists', color: '#3b82f6', x: 20, w: 200 },
  { id: 'protocols', label: 'Protocols', color: '#22c55e', x: 240, w: 200 },
  { id: 'sees', label: 'SEES / Scoring', color: '#8b5cf6', x: 460, w: 200 },
  { id: 'scoring-strategies', label: 'Strategy Binding', color: '#f59e0b', x: 680, w: 220 },
  { id: 'trading-strategies', label: 'Trading Strategies', color: '#ef4444', x: 920, w: 220 },
  { id: 'execution', label: 'Trading Bot', color: '#06b6d4', x: 1160, w: 200 },
];

// ── Node definitions ──
const NODES = [
  // ── Watchlists ──
  {
    id: 'wl-define', lane: 'watchlists', y: 60, status: 'implemented', critical: 1,
    label: 'Define Watchlists', subtype: 'Symbol groups',
    page: '/watchlists/user-watchlists',
    files: ['src/pages/WatchlistsPage.jsx'],
    endpoints: ['GET /api/watchlists', 'POST /api/watchlists'],
    tables: ['Watchlist', 'watchlist_symbol'],
  },
  {
    id: 'wl-active', lane: 'watchlists', y: 160, status: 'implemented',
    label: 'Active Symbols', subtype: 'Filtered & ready',
    page: '/watchlists/active-symbols',
    files: ['src/pages/ActiveSymbolsPage.jsx'],
    endpoints: ['GET /api/symbols?active=true'],
  },

  // ── Protocols ──
  {
    id: 'proto-registry', lane: 'protocols', y: 40, status: 'implemented', critical: 2,
    label: 'Protocol Registry', subtype: '41 protocols',
    page: '/protocols/protocols-registry',
    files: ['src/pages/ProtocolsPageB.jsx', 'nest/src/modules/scoring/protocol-db.service.ts'],
    endpoints: ['GET /api/scoring/gated/protocols'],
    tables: ['protocol', 'protocol_directive_group', 'protocol_directive_entry'],
  },
  {
    id: 'proto-resolve', lane: 'protocols', y: 150, status: 'implemented',
    label: 'Symbol Resolution', subtype: 'Watchlist + single-symbol',
    files: ['nest/src/modules/scoring/protocol-db.service.ts (resolveSymbols)'],
    endpoints: ['GET /api/scoring/gated/protocols/:id/symbols'],
    tables: ['SymbolProtocolAssignment', 'Watchlist'],
  },
  {
    id: 'proto-directives', lane: 'protocols', y: 260, status: 'implemented',
    label: 'Directive Groups', subtype: 'Per protocol',
    files: ['nest/src/modules/directives/directive-groups.ts'],
    tables: ['protocol_directive_group'],
  },
  {
    id: 'proto-editor', lane: 'protocols', y: 360, status: 'planned',
    label: 'Protocol Builder', subtype: 'Visual editor',
    files: ['src/pages/ProtocolBuilderPage.jsx'],
    endpoints: ['POST /api/scoring/gated/protocols'],
  },

  // ── SEES / Scoring ──
  {
    id: 'sees-bars', lane: 'sees', y: 40, status: 'implemented', critical: 3,
    label: 'Load Market Bars', subtype: 'MT5 bridge + DB',
    files: ['nest/src/modules/market-data/market-data.service.ts'],
    endpoints: ['GET /api/market-data/latest/:symbol'],
    tables: ['MarketBar'],
  },
  {
    id: 'sees-score', lane: 'sees', y: 140, status: 'implemented', critical: 4,
    label: 'Compute Scores', subtype: 'All directives per symbol',
    files: ['nest/src/modules/scoring/scoring.service.ts'],
    endpoints: ['GET /api/scoring/ranked', 'POST /api/scoring/gated/batch'],
    tables: ['Score'],
  },
  {
    id: 'sees-protocol-score', lane: 'sees', y: 250, status: 'implemented', critical: 5,
    label: 'Protocol-Gated Score', subtype: 'Filtered directives',
    files: ['nest/src/modules/scoring/protocol-gating.service.ts'],
    endpoints: ['GET /api/scoring/gated/:symbol?protocol='],
    tables: ['Score'],
  },
  {
    id: 'sees-db', lane: 'sees', y: 370, status: 'implemented',
    label: '→ Score Table (DB)', subtype: 'Persist all scores',
    tables: ['Score (strategyId, symbolId, value, breakdown)'],
  },

  // ── Strategy Binding (scoring-strategy layer retired 2026-08-27) ──
  {
    id: 'ss-create', lane: 'scoring-strategies', y: 40, status: 'implemented', critical: 6,
    label: 'Bind Trading Strategy', subtype: 'Protocol × symbol × broker × threshold',
    action: '6 active FX session strategies today',
    files: ['src/pages/StrategyCreatePage.jsx', 'nest/src/modules/trading/trading-strategy.service.ts'],
    endpoints: ['POST /api/trading/strategies'],
    tables: ['trading_strategy'],
  },
  {
    id: 'ss-gate', lane: 'scoring-strategies', y: 160, status: 'implemented', critical: 7,
    label: 'Threshold + Direction', subtype: 'minComposite vs composite, LONG vs SHORT',
    desc: 'Automation loop applies trading-strategy minComposite and compares the LONG vs SHORT protocol composite to pick the side. Directive-level "gates" are research only (#657/#658) — hard YES/NO after scoring, never score maths.',
    files: ['nest/src/modules/automation/automation-loop.service.ts (compareProtocolPair)'],
    tables: ['trading_strategy (minComposite)'],
  },
  {
    id: 'ss-signal', lane: 'scoring-strategies', y: 280, status: 'implemented',
    label: 'Generate BUY / SELL / HOLD', subtype: 'Every tick',
    desc: 'The automation loop emits BUY / SELL / HOLD per scored symbol every tick and persists them to decision_log.',
    tables: ['decision_log'],
  },
  {
    id: 'ss-advanced', lane: 'scoring-strategies', y: 390, status: 'planned',
    label: 'Advanced SEES', subtype: 'Additional directive layers',
    desc: 'Trading strategies may include additional directive runs (news, sentiment, earnings) depending on sophistication.',
  },

  // ── Trading Strategies ──
  {
    id: 'ts-evaluate', lane: 'trading-strategies', y: 60, status: 'implemented', critical: 8,
    label: 'Evaluate Signal', subtype: 'Cooldown + duplicate + diversification',
    desc: 'Per-symbol cooldown, duplicate guard, diversification pre-check and weekend defense decide trade vs skip.',
    files: ['nest/src/modules/automation/automation-loop.service.ts (dispatchTrade)', 'nest/src/modules/trading/duplicate-guard.service.ts'],
  },
  {
    id: 'ts-schedule', lane: 'trading-strategies', y: 180, status: 'implemented',
    label: 'Mode Dispatch', subtype: 'Manual / semi-auto / auto',
    desc: 'Manual logs only. Semi-auto queues the order to pending_action for review. Auto executes immediately.',
    tables: ['pending_action'],
  },
  {
    id: 'ts-size', lane: 'trading-strategies', y: 290, status: 'implemented', critical: 9,
    label: 'Position Sizing', subtype: 'baseSize × rarity band',
    desc: 'baseSize multiplied by the rarity band size multiplier (useRaritySizing, default on).',
    files: ['nest/src/modules/trading/trading-strategy.service.ts (execute)'],
    tables: ['trading_strategy (baseSize, maxSize, useRaritySizing)'],
  },

  // ── Trading Bot (Execution) ──
  {
    id: 'exec-dispatch', lane: 'execution', y: 60, status: 'implemented', critical: 10,
    label: 'Dispatch Order', subtype: 'MT5 / T212',
    action: 'Opt in: POST /api/automation/config { tradingEnabled: true } — auto-trade is OFF by default',
    files: ['nest/src/modules/trading/mt5-trading.service.ts'],
    endpoints: ['POST /api/trading/mt5/order'],
  },
  {
    id: 'exec-record', lane: 'execution', y: 170, status: 'implemented', critical: 11,
    label: 'Record Trade', subtype: 'Trade + Position tables',
    files: ['nest/src/modules/trading/trade-recorder.service.ts'],
    tables: ['Trade', 'Position'],
  },
  {
    id: 'exec-monitor', lane: 'execution', y: 280, status: 'implemented',
    label: 'Position Monitor', subtype: 'Stop guardian',
    desc: 'StopGuardian tracks guarded positions and records every SL/TP adjustment.',
    files: ['nest/src/modules/automation/stop-guardian.service.ts', 'nest/src/modules/trading/stop-guardian.service.ts'],
  },
];

// ── Background SVG per lane ──
function laneBgIcon(laneId) {
  const icons = {
    watchlists: <svg viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="20" rx="4" opacity="0.3"/><rect x="15" y="42" width="70" height="20" rx="4" opacity="0.2"/><rect x="15" y="69" width="70" height="20" rx="4" opacity="0.15"/></svg>,
    protocols: <svg viewBox="0 0 100 100"><polygon points="50,15 65,45 50,80 35,45" strokeWidth="2" fill="none" opacity="0.3"/><circle cx="50" cy="45" r="12" fill="none" strokeWidth="1.5" opacity="0.2"/></svg>,
    sees: <svg viewBox="0 0 100 100"><polygon points="50,12 62,40 95,42 70,65 77,92 50,78 23,92 30,65 5,42 38,40" strokeWidth="1.2" fill="none" opacity="0.25"/><circle cx="50" cy="50" r="16" fill="none" strokeWidth="1" opacity="0.15"/></svg>,
    'scoring-strategies': <svg viewBox="0 0 100 100"><rect x="10" y="15" width="35" height="30" rx="4" opacity="0.25"/><rect x="55" y="15" width="35" height="30" rx="4" opacity="0.2"/><rect x="10" y="55" width="35" height="30" rx="4" opacity="0.15"/><rect x="55" y="55" width="35" height="30" rx="4" opacity="0.1"/></svg>,
    'trading-strategies': <svg viewBox="0 0 100 100"><line x1="15" y1="75" x2="40" y2="35" strokeWidth="2" opacity="0.3"/><line x1="35" y1="75" x2="55" y2="25" strokeWidth="2" opacity="0.25"/><line x1="55" y1="75" x2="70" y2="35" strokeWidth="2" opacity="0.2"/><line x1="75" y1="75" x2="85" y2="40" strokeWidth="2" opacity="0.15"/></svg>,
    execution: <svg viewBox="0 0 100 100"><polyline points="20,60 35,45 55,55 80,20" strokeWidth="2.5" fill="none" opacity="0.35"/><circle cx="20" cy="60" r="4" opacity="0.3"/><circle cx="35" cy="45" r="3" opacity="0.25"/><circle cx="55" cy="55" r="3" opacity="0.2"/><circle cx="80" cy="20" r="5" opacity="0.3"/></svg>,
  };
  return <div className="msp-lane-bg">{icons[laneId] || null}</div>;
}

export default function MetaStackPipelineBoard() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [showPlanned, setShowPlanned] = useState(true);

  // Live stats (optional — for implemented nodes)
  const { data: health } = useQuery({
    queryKey: ['msp-health'],
    queryFn: () => apiGet('/api/health').catch(() => null),
    staleTime: 30_000,
  });

  const visibleNodes = useMemo(() =>
    showPlanned ? NODES : NODES.filter(n => n.status === 'implemented'),
    [showPlanned]
  );

  const selected = NODES.find(n => n.id === selectedNode);

  return (
    <div className="msp-page">
      <header className="msp-header">
        <div>
          {/* ⚠️ `h2`, NOT `h1` (2026-10-08). This board is now EMBEDDED in Pipeline Graph Lab, which
              owns the page's single `h1` — two `h1`s on one page is a heading-structure defect, and
              the accessibility policy applies to `src/**`. The page's own route was removed, so this
              is never the top-level heading. */}
          <h2>META.Stack Pipeline
            <PageInfoPopover>
              Shortest path to a live trade. Numbered nodes = the critical path (all implemented). Amber nodes need one user action. Dashed = roadmap.
            </PageInfoPopover>
          </h2>
          <p className="msp-subtitle">
            Every numbered step exists in code today. The two amber steps are configuration, not code: bind a trading strategy, and opt in to trading. Directive-level gates are research (#657/#658).
            {/* The "→ Detailed Node View" link was REMOVED 2026-10-08: this board now lives INSIDE
                Pipeline Graph Lab, so the link pointed at the page that was rendering it. */}
            {' '}<a href="/development/diagrams" style={{ color: 'var(--ink-soft)', fontSize: '0.75rem', textDecoration: 'none' }}>→ Conceptual Diagrams</a>
          </p>
        </div>
        <label className="msp-toggle">
          <input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)} />
          Show planned
        </label>
      </header>

      <div className="msp-canvas">
        {/* Lane headers */}
        {LANES.map(lane => (
          <div
            key={lane.id}
            className="msp-lane"
            style={{
              left: lane.x,
              width: lane.w,
              borderColor: lane.color + '44',
              background: lane.color + '08',
            }}
          >
            <div className="msp-lane-header">
              <span className="msp-lane-title" style={{ color: lane.color }}>{lane.label}</span>
            </div>
            {laneBgIcon(lane.id)}

            {/* Nodes in this lane */}
            {visibleNodes
              .filter(n => n.lane === lane.id)
              .map(node => (
                <div
                  key={node.id}
                  className={`msp-node ${node.status === 'planned' ? 'msp-node-planned' : ''} ${node.critical ? 'msp-node-critical' : ''} ${node.action ? 'msp-node-action' : ''} ${selectedNode === node.id ? 'msp-node-selected' : ''}`}
                  style={{
                    top: node.y,
                    borderColor: node.status === 'planned' ? lane.color + '66' : node.action ? '#f59e0b' : lane.color,
                    borderStyle: node.status === 'planned' ? 'dashed' : 'solid',
                  }}
                  onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}
                >
                  {node.critical && <span className="msp-step">{node.critical}</span>}
                  <div className="msp-node-label">{node.label}</div>
                  <div className="msp-node-subtype">{node.subtype}</div>
                  {node.status === 'planned' && <span className="msp-node-badge">planned</span>}
                  {node.action && <span className="msp-action-badge">needs you</span>}
                </div>
              ))}
          </div>
        ))}

        {/* Arrows between nodes (simplified — lanes flow left→right) */}
        <svg className="msp-arrows" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {/* Watchlists → Protocols */}
          <line x1="220" y1="100" x2="240" y2="100" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="220" y1="200" x2="240" y2="200" stroke="var(--line)" strokeWidth="1" />
          {/* Protocols → SEES */}
          <line x1="440" y1="80" x2="460" y2="80" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="440" y1="190" x2="460" y2="190" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="440" y1="300" x2="460" y2="300" stroke="var(--line)" strokeWidth="1" />
          {/* SEES → Scoring Strategies */}
          <line x1="660" y1="80" x2="680" y2="80" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="660" y1="180" x2="680" y2="180" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="660" y1="290" x2="680" y2="290" stroke="var(--line)" strokeWidth="1" />
          <line x1="660" y1="410" x2="680" y2="410" stroke="var(--line)" strokeWidth="1" />
          {/* Scoring Strategies → Trading Strategies */}
          <line x1="900" y1="100" x2="920" y2="100" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="900" y1="200" x2="920" y2="200" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="900" y1="310" x2="920" y2="310" stroke="var(--line)" strokeWidth="1" />
          {/* Trading Strategies → Execution */}
          <line x1="1140" y1="100" x2="1160" y2="100" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="1140" y1="220" x2="1160" y2="220" stroke="var(--line)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="msp-detail">
          <h3>{selected.label} <span className={`msp-detail-badge ${selected.status}`}>{selected.status}</span></h3>
          {selected.desc && <p className="msp-detail-desc">{selected.desc}</p>}
          {selected.page && (
            <div className="msp-detail-section">
              <strong>Page</strong>
              <a href={`/#${selected.page}`} className="msp-detail-link">{selected.page}</a>
            </div>
          )}
          {selected.files?.length > 0 && (
            <div className="msp-detail-section">
              <strong>Files</strong>
              {selected.files.map((f, i) => <code key={i} className="msp-detail-code">{f}</code>)}
            </div>
          )}
          {selected.endpoints?.length > 0 && (
            <div className="msp-detail-section">
              <strong>Endpoints</strong>
              {selected.endpoints.map((e, i) => <code key={i} className="msp-detail-code">{e}</code>)}
            </div>
          )}
          {selected.tables?.length > 0 && (
            <div className="msp-detail-section">
              <strong>Tables</strong>
              {selected.tables.map((t, i) => <code key={i} className="msp-detail-code">{t}</code>)}
            </div>
          )}
          <button className="msp-detail-close" onClick={() => setSelectedNode(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
