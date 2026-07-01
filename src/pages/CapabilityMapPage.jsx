import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import { PAGE_DATA_STATUS } from '../core/page-data-status';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './capability-map.css';

// ── Build unified capability rows ──

function buildCapabilityRows(directives, providers) {
  const rows = [];

  // ── Pages (from nav tree + page data status) ──
  Object.entries(NAV_TREE).forEach(([areaKey, area]) => {
    area.views.forEach((view) => {
      const meta = PAGE_DATA_STATUS[view.id];
      rows.push({
        category: 'Page',
        area: area.label,
        name: view.label,
        type: 'UI',
        status: 'ALPHA',
        notes: meta?.source || meta?.note || '',
      });
    });
  });

  // ── Directives (from API or fallback) ──
  if (directives && Array.isArray(directives)) {
    directives.forEach((d) => {
      rows.push({
        category: 'Directive',
        area: d.category || 'Uncategorized',
        name: d.name,
        type: 'Backend',
        status: 'ALPHA',
        notes: d.description?.substring(0, 80) || '',
      });
    });
  }

  // ── Providers ──
  (providers || []).forEach((p) => {
    const name = p.displayName || p.name || p.provider || 'Unknown';
    rows.push({
      category: 'Provider',
      area: 'Data',
      name,
      type: 'Integration',
      status: 'ALPHA',
      notes: `Quotes: ${p.quotes !== false ? '✓' : '✗'} · Candles: ${p.candles !== false ? '✓' : '✗'} · News: ${p.news ? '✓' : '✗'} · Fund: ${p.fundamentals ? '✓' : '✗'} · Portfolio: ${p.portfolio ? '✓' : '✗'}`,
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
    { name: 'Directives (~94)', count: 6 },
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
    { name: 'Automation', count: 9 },
    { name: 'System', count: 4 },
    { name: 'Watchlists', count: 4 },
    { name: 'Processes', count: 3 },
    { name: 'Speed Trading', count: 3 },
    { name: 'Snapshots', count: 2 },
    { name: 'Backtest Data', count: 1 },
  ].forEach((mod) => {
    rows.push({
      category: 'API Module',
      area: 'Backend',
      name: mod.name,
      type: 'Backend',
      status: 'ALPHA',
      notes: `${mod.count} endpoints`,
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
    'Ticker Bar (Background Events)',
    'Network Status Bar',
    'PWA Install Prompt',
    'Analytics / Performance Monitoring',
    'Container Queries',
    'Popover API',
    'Scroll-Driven Animations',
    'Glass Panels',
  ].forEach((name) => {
    rows.push({
      category: 'Frontend Feature',
      area: 'UI',
      name,
      type: 'Frontend',
      status: 'ALPHA',
      notes: '',
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
    rows.push({
      category: 'Platform Support',
      area: 'Infrastructure',
      name,
      type: 'Platform',
      status: 'ALPHA',
      notes: '',
    });
  });

  // ── Backend Tech ──
  [
    'SEES Scoring Engine',
    'Scoring Scheduler',
    'Score History Service',
    'Predictive Scoring (ML Horizon)',
    'Outcome Tracker (Q304)',
    'Multi-Timeframe Scorer',
    'Speed Scan Service',
    'Strategy Competition Service',
    'Gated Scoring Pipeline',
    'Directive Registry (87 directives)',
    'Protocol System',
    'Portfolio Service (T212)',
    'Trading212 Import Service',
    'Correlation Service',
    'Risk Service (Drawdown Alerts)',
    'Trading Scheduler (Daily Cron)',
    'Backtest Service',
    'Alert Service',
    'Notification Service (Email/Win/Telegram/Discord)',
    'API Activity Middleware',
    'Process Manager',
  ].forEach((name) => {
    rows.push({
      category: 'Backend Tech',
      area: 'Backend',
      name,
      type: 'Backend',
      status: 'ALPHA',
      notes: '',
    });
  });

  return rows;
}

// ── Status Badge ──
function StatusBadge({ status }) {
  const color = '#8b5cf6';
  const bg = 'rgba(139,92,246,0.12)';
  return <span className="cm-badge" style={{ color, background: bg }}>{status}</span>;
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

  const directives = directivesQuery.data;
  const provData = providerHealthQuery.data;
  const providers = Array.isArray(provData?.providers) ? provData.providers : Array.isArray(provData) ? provData : [];

  const allRows = useMemo(
    () => buildCapabilityRows(directives, providers),
    [directives, providers]
  );

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

  if (allRows.length === 0) return <div className="cm-page"><LoadingSkeleton variant="table" rows={20} cols={5} /></div>;

  return (
    <div className="cm-page">
      <motion.header className="cm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🗺️ Capability Map</h1>
        <p className="cm-subtitle">
          Unified inventory of all capabilities across the Trading Command Suite — pages, directives, providers, APIs, backend services, and frontend features. All statuses are <strong>ALPHA</strong> until strengthened and promoted to BETA.
        </p>
      </motion.header>

      {/* ── Summary ── */}
      <div className="cm-summary">
        <div className="cm-summary-item"><span className="cm-summary-value">{allRows.length}</span><span className="cm-summary-label">total capabilities</span></div>
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
                <td style={{ fontSize: 11, color: 'var(--ink-soft)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cm-footer">
        {filtered.length} of {allRows.length} capabilities shown · All statuses ALPHA — to be promoted to BETA after strengthening
      </div>
    </div>
  );
}
