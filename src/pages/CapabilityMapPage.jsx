import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import { PAGE_DATA_STATUS } from '../core/page-data-status';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './capability-map.css';

import { KNOWN_FEATURES } from '../data/known-features';

// ── Status semantics (#755, 2026-09-10) ──
//
// WHAT WAS WRONG: every row was emitted with `status: 'ALPHA'` as a hardcoded literal, so the
// column did not describe the capability — it described the fact that a row existed. "Predictive
// Scoring (ML Horizon)" displayed identically to the SEES Scoring Engine, long after its service
// had become a stub. A column that can only ever say one thing cannot drift, because it is not
// tracking anything.
//
// NOW: `status` is resolved per row from the capability record (`features.js` → the DB capability
// table). A genuinely unassessed feature falls back to `LEGACY_STATUS` — deliberately the
// least-flattering of the old literals, so "nobody has classified this" is visible rather than
// being disguised as a positive status. Removing the literals means the remaining ones are real
// signals: they mark rows still awaiting assessment, and that list should shrink to zero.
const LEGACY_STATUS = 'UNASSESSED';
const DEFAULT_CAPABILITY = {
  dataPersistence: 'ephemeral',
  uiSurfaces: 0,
  pipelineIntegration: 'none',
  devCompletion: 'partial',
  status: LEGACY_STATUS,
};

// ── Build unified capability rows ──

function buildCapabilityRows(directives, providers, dbMap) {
  const rows = [];

  // DB (capability table) first, static seed literal as fallback.
  const lookupKnown = (...names) => {
    for (const n of names) {
      const db = dbMap?.get(n);
      if (db) return db;
      const k = KNOWN_FEATURES[n];
      if (k) return k;
    }
    return {};
  };

  const def = { ...DEFAULT_CAPABILITY };

  // ── Pages (from nav tree + page data status) ──
  Object.entries(NAV_TREE).forEach(([areaKey, area]) => {
    area.views.forEach((view) => {
      const meta = PAGE_DATA_STATUS[view.id];
      rows.push({
        ...def,
        category: 'Page',
        area: area.label,
        name: view.label,
        type: 'UI',
        status: LEGACY_STATUS,
        notes: meta?.source || meta?.note || '',
        uiSurfaces: 1,
      });
    });
  });

  // ── Directives (from API or fallback) ──
  if (directives && Array.isArray(directives)) {
    directives.forEach((d) => {
      const known = lookupKnown(d.id, d.name);
      rows.push({
        ...def,
        category: 'Directive',
        area: d.category || 'Uncategorized',
        name: d.name,
        type: 'Backend',
        status: LEGACY_STATUS,
        notes: d.description?.substring(0, 80) || '',
        ...known,
      });
    });
  }

  // ── Providers ──
  (providers || []).forEach((p) => {
    const name = p.displayName || p.name || p.provider || 'Unknown';
    const known = lookupKnown(name, p.provider);
    rows.push({
      ...def,
      category: 'Provider',
      area: 'Data',
      name,
      type: 'Integration',
      status: LEGACY_STATUS,
      notes: `Quotes: ${p.quotes !== false ? '✓' : '✗'} · Candles: ${p.candles !== false ? '✓' : '✗'} · News: ${p.news ? '✓' : '✗'} · Fund: ${p.fundamentals ? '✓' : '✗'} · Portfolio: ${p.portfolio ? '✓' : '✗'}`,
      ...known,
    });
  });

  // ── API Modules ──
  [
    { name: 'Symbols', count: 5 },
    { name: 'Market Data', count: 3 },
    { name: 'Providers', count: 4 },
    { name: 'Import Jobs', count: 3 },
    { name: 'Scoring', count: 7 },
    { name: 'News', count: 4 },
    { name: 'Directives (~99)', count: 7 },
    { name: 'Strategies', count: 5 },
    { name: 'Earnings', count: 4 },
    { name: 'Portfolio', count: 4 },
    { name: 'Calibration', count: 3 },
    { name: 'Indicators', count: 6 },
    { name: 'Macro', count: 2 },
    { name: 'Alerts', count: 6 },
    { name: 'Training', count: 3 },
    { name: 'Backtest', count: 1 },
    { name: 'Architecture', count: 1 },
    { name: 'Paper Trading', count: 10 },
    { name: 'Automation', count: 9 },
    { name: 'System', count: 4 },
    { name: 'Watchlists', count: 4 },
    { name: 'Processes', count: 3 },
    { name: 'Speed Trading', count: 3 },
    { name: 'Signals (Envelope + Ladder)', count: 3 },
    { name: 'Risk (Overview + Gates)', count: 4 },
    { name: 'Research Overview', count: 1 },
    { name: 'Snapshots', count: 2 },
    { name: 'Backtest Data', count: 1 },
    { name: 'Performance (summary + equity)', count: 3 },
    { name: 'Market Context (7-Day)', count: 1 },
    { name: 'Data Import (orchestrator)', count: 4 },
    { name: 'Crypto Providers (Binance)', count: 2 },
    { name: 'Scoring Logs (unified)', count: 2 },
    { name: 'Alerts (triggers + service)', count: 4 },
    { name: 'Trading (strategies + duplicate)', count: 3 },
    { name: 'META.Stack (ratings + signature)', count: 3 },
    { name: 'Diversification (global)', count: 4 },
    { name: 'Symbol Focus (single ticker)', count: 1 },
    { name: 'Bridge Events (MT5)', count: 1 },
    { name: 'Daily Briefing (morning/evening)', count: 1 },
  ].forEach((mod) => {
    const known = lookupKnown(mod.name);
    rows.push({
      ...def,
      category: 'API Module',
      area: 'Backend',
      name: mod.name,
      type: 'Backend',
      status: LEGACY_STATUS,
      notes: `${mod.count} endpoints`,
      ...known,
    });
  });

  // ── Frontend Tools / Features ──
  [
    'Theme System (10+ packs)',
    'Motion / Animation Library',
    'Canvas 2D Chart Engine',
    'Lightweight Charts Engine',
    'PWA / Offline Support',
    'Bookmark System',
    'QA Check Tracking',
    'Dev Overlay + Activity Log',
    'Runtime Diagnostics Report',
    'Feature Flag System',
    'Error Boundaries',
    'Breadcrumbs',
    'Collapsible Sidebar',
    'Global Search',
    'Market Status Ticker (Bloomberg-style Scrolling Tape)',
    'Ticker Bar (Background Events)',
    'Network Status Bar',
    'PWA Install Prompt',
    'Analytics / Performance Monitoring',
    'Strategy Performance Dashboard (Equity Curve + Monthly Breakdown)',
    'Container Queries',
    'Popover API',
    'Scroll-Driven Animations',
    'Glass Panels',
    'Signal Ladder + Directive Drilldown',
    'Conflict Resolver (Bull/Bear Detection)',
    'Risk Gauges + Circuit Breaker UI',
    'Research Dashboard (8-Panel Aggregate)',
    'Protocol Selector (Scoring)',
    'Execution Queue (Timeline + Retry)',
    'Market Context Page (Session-aware)',
    'Provider Health Dashboard',
    'MTF Confluence (Conservative + Weighted)',
    'Divergence Suite (RSI + MACD + OBV)',
    'VWAP Confluence (Simple + Bands)',
    'Seasonality Heatmap (Monthly Win Rates)',
    'Recently Analysed Symbols (History + Quick Score)',
    'Create Strategy (Trading + Protocol Link)',
    'Paper Trading Dashboard',
    'Gap Scanner (Directive)',
    'User Preferences System (12 Settings)',
    'Strategy Showdown + Live Positions',
    'QA Testing Page + Checklist',
    'Preference Lab + User Settings',
    'Symbol Detail Page (Research Quick-View)',
    'Feature Lab (TP/Session/Trailing Stop Demos)',
    'Detachable Widget System',
    'Sticky Header + Notice Components',
    'Status Badge Component',
    'Multi-Screen Cockpit (Phase 1)',
    'Health Dashboard (6 diagnostic panels)',
    'Commands Reference (27 CLI)',
    'Health Settings (10 check toggles)',
  ].forEach((name) => {
    const known = lookupKnown(name);
    rows.push({
      ...def,
      category: 'Frontend Feature',
      area: 'UI',
      name,
      type: 'Frontend',
      status: LEGACY_STATUS,
      notes: '',
      uiSurfaces: 1,
      ...known,
    });
  });

  // ── Platform Support ──
  [
    'Trading212 API',
    'MT5 Bridge',
    'Alpaca Markets',
    'Finnhub',
    'Yahoo Finance',
    'Polygon.io',
    'Twelve Data',
    'FMP',
    'FRED (Economic Data)',
    'ECB (European Central Bank)',
    'MySQL / Prisma ORM',
    'NestJS Backend',
    'React 18 + Vite',
    'Windows Desktop',
    'Web (Cross-browser)',
    'PWA (Mobile)',
  ].forEach((name) => {
    const known = lookupKnown(name);
    rows.push({
      ...def,
      category: 'Platform Support',
      area: 'Infrastructure',
      name,
      type: 'Platform',
      status: LEGACY_STATUS,
      notes: '',
      ...known,
    });
  });

  // ── Backend Tech ──
  //
  // ⚠️ Every name here is registered as a live capability. Removed 2026-09-10 (#755) because
  // they no longer exist and were being presented as real:
  //   - 'Predictive Scoring (ML Horizon)' — deleted. getCurrentScore() returned a hard-coded 0
  //     and its SEED_CALENDAR events were all in the past, so every prediction was delta=0
  //     with no catalysts. Nothing consumed it.
  //   - 'Multi-Timeframe Scorer' — deleted. Zero references (no provider, no import, no route),
  //     and its output was a [-1,+1] fold rather than the platform's [0, maxScore] unit.
  // Do not re-add a name here for code that does not exist — see the status fix below.
  [
    'SEES Scoring Engine',
    'Scoring Scheduler',
    'Score History Service',
    'Outcome Tracker (Q304)',
    'Speed Scan Service',
    'Strategy Competition Service',
    'Strategy Comparison (Showdown)',
    'Gated Scoring Pipeline',
    'Directive Registry (99 directives)',
    'Protocol System',
    'Portfolio Service (T212)',
    'Trading212 Import Service',
    'Correlation Service',
    'Risk Service (Drawdown Alerts)',
    'TradingGatesService (3-Gate Pipeline)',
    'SignalEnvelopeService (Scoring Bridge)',
    'RiskOverviewService (Circuit Breaker)',
    'ResearchImportService (5 import pipelines)',
    'On-Demand Symbol Import (Self-Healing Directives)',
    'Trading Scheduler (Live Scoring — wired)',
    'PaperTradingService (Virtual Ledger)',
    'MonteCarloService (Risk-of-Ruin Sim)',
    'ScoringStrategy Persistence (DB)',
    'Backtest Service',
    'Alert Service',
    'Notification Service (Email/Win/Telegram/Discord)',
    'API Activity Middleware',
    'Process Manager',
    'System Health Diagnostics',
    'TradeRecorderService (full MT5 capture)',
  ].forEach((name) => {
    const known = lookupKnown(name);
    rows.push({
      ...def,
      category: 'Backend Tech',
      area: 'Backend',
      name,
      type: 'Backend',
      status: LEGACY_STATUS,
      notes: '',
      ...known,
    });
  });

  return rows;
}

// ── Badge Components ──
//
// StatusBadge colours by REAL status rather than one fixed violet. `UNASSESSED` is grey — it
// means "not yet classified", which is neither good nor bad and must not read as either.
function StatusBadge({ status }) {
  const map = {
    LIVE:        { color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    BETA:        { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    ALPHA:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    STUB:        { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    DEPRECATED:  { color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)' },
    UNASSESSED:  { color: '#71717a', bg: 'rgba(113,113,122,0.12)' },
  };
  const m = map[status] || map.UNASSESSED;
  const title = status === 'UNASSESSED'
    ? 'Not yet classified — set `status` for this capability in src/data/features.js'
    : status;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={title}>{status}</span>;
}

function DataBadge({ value }) {
  const map = {
    stored: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '💾' },
    config: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: '⚙' },
    cached: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🔄' },
    ephemeral: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '💨' },
  };
  const m = map[value] || map.ephemeral;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.icon} {value}</span>;
}

function PipelineBadge({ value }) {
  const map = {
    both: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'score + trade' },
    scoring: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'scoring' },
    trading: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'trading' },
    none: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)', label: 'none' },
    planned: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', label: 'planned' },
  };
  const m = map[value] || map.none;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.label}</span>;
}

function DoneBadge({ value }) {
  const map = {
    complete: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '✓' },
    partial: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '◐' },
    stub: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '✗' },
    planned: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: '→' },
  };
  const m = map[value] || map.partial;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.icon} {value}</span>;
}

// ── Main Page ──
export default function CapabilityMapPage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // ── Live queries ──
  const directivesQuery = useQuery({
    queryKey: ['capability-map', 'directives'],
    queryFn: () => apiGet('/api/directives'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const providerHealthQuery = useQuery({
    queryKey: ['capability-map', 'provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // ── DB-backed capabilities (primary source when available) ──
  const capabilitiesQuery = useQuery({
    queryKey: ['capability-map', 'db-capabilities'],
    queryFn: () => apiGet('/api/capabilities').catch(() => []),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const dbCapabilities = Array.isArray(capabilitiesQuery.data) ? capabilitiesQuery.data : [];

  const directives = directivesQuery.data;
  const provData = providerHealthQuery.data;
  const providers = Array.isArray(provData?.providers) ? provData.providers : Array.isArray(provData) ? provData : [];

  const allRows = useMemo(() => {
    const dbMap = dbCapabilities.length > 0 ? new Map(dbCapabilities.map(c => [c.name, c])) : null;
    const localRows = buildCapabilityRows(directives, providers, dbMap);
    
    // If DB capabilities are available, merge them with locally-built rows
    if (dbMap) {
      const localNames = new Set(localRows.map(r => r.name));
      
      // Convert DB capabilities to row format
      const dbRows = dbCapabilities.map(c => ({
        name: c.name,
        category: c.category,
        area: c.area,
        type: c.type,
        status: c.status,
        notes: c.notes || '',
        dataPersistence: c.dataPersistence || 'ephemeral',
        uiSurfaces: c.uiSurfaces || 0,
        pipelineIntegration: c.pipelineIntegration || 'none',
        devCompletion: c.devCompletion || 'partial',
      }));
      
      // Add locally-built rows that don't exist in DB
      for (const row of localRows) {
        if (!dbMap.has(row.name)) {
          dbRows.push(row);
        }
      }
      
      return dbRows;
    }
    
    return localRows;
  }, [directives, providers, dbCapabilities]);

  const categories = [...new Set(allRows.map((r) => r.category))].sort();

  const filtered = useMemo(() => {
    let rows = allRows;
    if (filter !== 'all') rows = rows.filter((r) => r.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.area.toLowerCase().includes(q));
    }
    return rows;
  }, [allRows, filter, search]);

  const totals = allRows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
  const completeLoop = allRows.filter((r) => r.dataPersistence === 'stored' && r.uiSurfaces > 0 && (r.pipelineIntegration === 'scoring' || r.pipelineIntegration === 'trading' || r.pipelineIntegration === 'both') && r.devCompletion === 'complete').length;
  const completeDev = allRows.filter((r) => r.devCompletion === 'complete').length;

  if (allRows.length === 0) return <div className="cm-page"><LoadingSkeleton variant="table" rows={20} cols={5} /></div>;

  return (
    <div className="cm-page">
      <motion.header className="cm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🗺️ Capability Map</h1>
        <p className="cm-subtitle">
          Unified inventory of {allRows.length} capabilities — {dbCapabilities.length > 0 ? `${dbCapabilities.length} from DB` : 'built from live system scan'}. New capabilities added via POST /api/capabilities.
        </p>
      </motion.header>

      {/* ── Summary ── */}
      <div className="cm-summary">
        <div className="cm-summary-item"><span className="cm-summary-value">{allRows.length}</span><span className="cm-summary-label">total capabilities</span></div>
        <div className="cm-summary-item" title="Features where data is stored (not ephemeral), has at least 1 UI surface, is integrated into scoring/trading, and is marked complete">
          <span className="cm-summary-value" style={{color: completeLoop > completeDev * 0.3 ? '#22c55e' : '#f59e0b'}}>{completeLoop}/{completeDev}</span>
          <span className="cm-summary-label">complete loops</span>
        </div>
        {categories.map((cat) => (
          <div key={cat} className="cm-summary-item">
            <span className="cm-summary-value">{totals[cat] || 0}</span>
            <span className="cm-summary-label">{cat}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="cm-controls">
        <input
          type="search"
          placeholder="Search capabilities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="cm-search"
        />
        <div className="cm-filter-chips">
          <button className={`cm-filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          {categories.map((cat) => (
            <button key={cat} className={`cm-filter-chip ${filter === cat ? 'active' : ''}`} onClick={() => setFilter(cat)}>{cat} ({totals[cat] || 0})</button>
          ))}
        </div>
      </div>

      {/* ── Unified Table ── */}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Area</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th title="Is data stored in the database (stored), held in memory (cached), or does it evaporate after use (ephemeral)? Configuration data stored as part of the codebase counts as 'config'.">💾 Data</th>
              <th title="How many UI components, pages, or panels display data from this capability? 0 = API-only, no visual surface.">🖥 UI</th>
              <th title="Is this capability integrated into the scoring pipeline, trading execution, both, or neither? 'planned' = design exists but not wired yet.">🔗 Pipeline</th>
              <th title="Is the implementation complete per developer intentions? 'stub' = placeholder, 'partial' = in progress, 'complete' = done, 'planned' = designed but not built.">✅ Done</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <motion.tr key={`${row.category}-${row.name}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.002 }}>
                <td><span className="cm-cat-chip">{row.category}</span></td>
                <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{row.area}</td>
                <td><strong>{row.name}</strong></td>
                <td style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{row.type}</td>
                <td><StatusBadge status={row.status} /></td>
                <td><DataBadge value={row.dataPersistence} /></td>
                <td style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: row.uiSurfaces > 0 ? '#22c55e' : 'var(--ink-soft)' }}>{row.uiSurfaces}</td>
                <td><PipelineBadge value={row.pipelineIntegration} /></td>
                <td><DoneBadge value={row.devCompletion} /></td>
                <td style={{ fontSize: 11, color: 'var(--ink-soft)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cm-footer">
        {filtered.length} of {allRows.length} capabilities shown · {completeLoop} have a complete data loop (stored + UI + pipeline + complete) · Click column headers for details
      </div>
    </div>
  );
}
