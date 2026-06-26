import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import { PAGE_DATA_STATUS, getPageDataSummary } from '../core/page-data-status';
import { useUiStore } from '../stores/useUiStore';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './capability-map.css';

// ── Directive categories (from directive-groups.ts) ──
const DIRECTIVE_CATEGORIES = [
  {
    id: 'technical',
    name: 'Technical Analysis',
    directives: [
      { id: 'rsi-oversold', name: 'RSI Oversold', status: 'implemented' },
      { id: 'rsi-overbought', name: 'RSI Overbought', status: 'implemented' },
      { id: 'macd-crossover', name: 'MACD Crossover', status: 'implemented' },
      { id: 'ema-structure', name: 'EMA Structure', status: 'implemented' },
      { id: 'volume-confirmation', name: 'Volume Confirmation', status: 'implemented' },
      { id: 'momentum-roc', name: 'Momentum ROC', status: 'implemented' },
      { id: 'bollinger-squeeze', name: 'Bollinger Squeeze', status: 'implemented' },
      { id: 'support-resistance', name: 'Support/Resistance', status: 'implemented' },
      { id: 'atr-expansion', name: 'ATR Expansion', status: 'implemented' },
      { id: 'session-timing-filter', name: 'Session Timing Filter', status: 'implemented' },
      { id: 'session-open-effect', name: 'Session Open Effect', status: 'planned' },
    ],
  },
  {
    id: 'sentiment',
    name: 'Sentiment & Fundamentals',
    directives: [
      { id: 'analyst-adjustments', name: 'Analyst Adjustments', status: 'implemented' },
      { id: 'analyst-consensus', name: 'Analyst Consensus', status: 'implemented' },
      { id: 'news-sentiment', name: 'News Sentiment', status: 'implemented' },
      { id: 'earnings-proximity', name: 'Earnings Proximity', status: 'implemented' },
      { id: 'earnings-momentum', name: 'Earnings Momentum', status: 'planned' },
      { id: 'social-buzz', name: 'Social Buzz', status: 'planned' },
      { id: 'insider-activity', name: 'Insider Activity', status: 'planned' },
    ],
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    directives: [
      { id: 'position-concentration', name: 'Position Concentration', status: 'implemented' },
      { id: 'correlation-drag', name: 'Correlation Drag', status: 'implemented' },
      { id: 'dilution-impact', name: 'Dilution Impact', status: 'planned' },
      { id: 'volatility-regime', name: 'Volatility Regime', status: 'implemented' },
      { id: 'liquidity-check', name: 'Liquidity Check', status: 'planned' },
      { id: 'budget-gate', name: 'Budget Gate', status: 'planned' },
    ],
  },
];

// ── Provider status ──
const PROVIDERS = [
  { name: 'Alpaca', quotes: true, candles: true, news: false, fundamentals: false, portfolio: false, orders: false, health: 'live' },
  { name: 'Finnhub', quotes: true, candles: true, news: true, fundamentals: true, portfolio: false, orders: false, health: 'live' },
  { name: 'Yahoo Finance', quotes: true, candles: true, news: false, fundamentals: false, portfolio: false, orders: false, health: 'live' },
  { name: 'Polygon', quotes: true, candles: true, news: false, fundamentals: false, portfolio: false, orders: false, health: 'live' },
  { name: 'Twelve Data', quotes: true, candles: true, news: false, fundamentals: false, portfolio: false, orders: false, health: 'live' },
  { name: 'FMP', quotes: true, candles: true, news: false, fundamentals: false, portfolio: false, orders: false, health: 'live' },
  { name: 'Trading212', quotes: true, candles: true, news: false, fundamentals: false, portfolio: true, orders: true, health: 'live' },
  { name: 'FRED', quotes: false, candles: false, news: false, fundamentals: true, portfolio: false, orders: false, health: 'live' },
  { name: 'ECB', quotes: false, candles: false, news: false, fundamentals: true, portfolio: false, orders: false, health: 'live' },
  { name: 'MT5 Bridge', quotes: true, candles: true, news: false, fundamentals: false, portfolio: true, orders: true, health: 'degraded' },
];

// ── Discussion coverage ──
const DISCUSSIONS = [
  { name: 'News Dissipation Curves', status: 'implemented', note: 'Q287 built, Q287b pending migration' },
  { name: 'Predictive SEES', status: 'implemented' },
  { name: 'Exit Signals', status: 'in-progress', note: 'Q279 claimed' },
  { name: 'Speed/Day Trading', status: 'discussed', note: 'Q289–Q293 generated' },
  { name: 'Automation Loop & Timeline', status: 'designed', note: '5 prompts, 2026-06-26' },
  { name: 'Unified Broker Interface', status: 'designed', note: 'IBrokerPortfolio extension' },
  { name: 'HOTAS Trading Interface', status: 'deferred' },
  { name: 'Session Open Effect', status: 'not-started' },
  { name: 'Single Symbol View', status: 'not-started' },
  { name: 'Snapshot Replay', status: 'not-started' },
  { name: 'Trailing Stop Logic', status: 'implemented', note: 'Q290 demo built' },
  { name: 'Timezone Handling (IANA vs UTC)', status: 'implemented', note: 'Q291 + Q294 demo built' },
];

// ── API Endpoints (grouped by module) ──
const API_MODULES = [
  { name: 'Symbols', count: 5, endpoints: ['GET /symbols', 'GET /symbols/:id', 'GET /symbols/search', 'POST /symbols', 'PATCH /symbols/:id'] },
  { name: 'Market Data', count: 3, endpoints: ['GET /market-data/quotes', 'GET /market-data/candles', 'GET /market-data/snapshots'] },
  { name: 'Providers', count: 4, endpoints: ['GET /providers', 'GET /providers/health', 'GET /providers/:id', 'GET /providers/mt5/diagnostics'] },
  { name: 'Import Jobs', count: 3, endpoints: ['GET /import-jobs', 'POST /import-jobs', 'GET /import-jobs/:id'] },
  { name: 'Scoring', count: 7, endpoints: ['GET /scoring/runs', 'GET /scoring/live', 'POST /scoring/run', 'GET /scoring/arena', 'GET /scoring/diagnostics', 'GET /scoring/gated/:symbol', 'GET /scoring/gated/portfolio'] },
  { name: 'News', count: 4, endpoints: ['GET /news/feed', 'GET /news/articles', 'POST /news/import', 'GET /news/sentiment'] },
  { name: 'Directives', count: 5, endpoints: ['GET /directives', 'GET /directives/:id', 'PATCH /directives/:id', 'GET /directives/status', 'GET /directives/groups'] },
  { name: 'Strategies', count: 5, endpoints: ['GET /strategies', 'POST /strategies', 'GET /strategies/saved', 'GET /strategies/:id', 'POST /strategies/:id/duplicate'] },
  { name: 'Portfolio', count: 4, endpoints: ['GET /portfolio', 'GET /portfolio/positions', 'GET /portfolio/history', 'POST /portfolio/import'] },
  { name: 'Calibration', count: 3, endpoints: ['GET /calibrations', 'GET /calibrations/:symbol', 'POST /calibrations'] },
  { name: 'Indicators', count: 6, endpoints: ['GET /indicators/sr', 'GET /indicators/volatility', 'GET /indicators/rsi', 'GET /indicators/macd', 'GET /indicators/sma', 'GET /indicators/correlation'] },
  { name: 'Macro', count: 2, endpoints: ['GET /macro/indicators', 'GET /macro/fred'] },
  { name: 'Alerts', count: 6, endpoints: ['GET /alerts/active', 'GET /alerts/history', 'GET /alerts/count', 'POST /alerts/:id/acknowledge', 'POST /alerts/:id/dismiss', 'POST /alerts/:id/snooze'] },
  { name: 'Training', count: 3, endpoints: ['GET /training/candle-patterns', 'GET /training/candle-patterns/history', 'GET /training/pattern-accuracy/:id'] },
  { name: 'Backtest', count: 1, endpoints: ['GET /backtest/chart-data'] },
  { name: 'Architecture', count: 1, endpoints: ['GET /api/architecture/manifest'] },
  { name: 'Automation', count: 9, endpoints: ['GET /api/automation/status', 'POST /api/automation/toggle', 'POST /api/automation/run-now', 'POST /api/automation/emergency-stop', 'GET /api/automation/timeline', 'GET /api/automation/timeline/symbol/:symbol', 'GET /api/automation/portfolio-scores', 'POST /api/automation/confirm-action', 'POST /api/automation/reject-action'] },
  { name: 'System', count: 4, endpoints: ['GET /api/version', 'GET /api/health', 'GET /api/api-activity/summary', 'GET /api/system/logs'] },
];

// ── Helpers ──
function StatusBadge({ status }) {
  const map = {
    live: { label: 'Live', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    partial: { label: 'Partial', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    mock: { label: 'Mock', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    implemented: { label: 'Done', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    planned: { label: 'Planned', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
    'in-progress': { label: 'Active', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    discussed: { label: 'Discussed', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    deferred: { label: 'Deferred', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
    designed: { label: 'Designed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    'not-started': { label: '—', color: '#64748b', bg: 'rgba(100,116,139,0.06)' },
    degraded: { label: 'Degraded', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  };
  const s = map[status] || { label: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' };
  return <span className="cm-badge" style={{ color: s.color, background: s.bg }}>{s.label}</span>;
}

function ProgressBar({ pct, color = 'var(--accent, #0ea5a6)' }) {
  return (
    <div className="cm-progress">
      <motion.div
        className="cm-progress-fill"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct)}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ background: color }}
      />
    </div>
  );
}

function CollapsibleSection({ id, title, summary, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="cm-section">
      <button type="button" className="cm-section-toggle" onClick={() => setOpen(!open)}>
        <span className="cm-section-chevron" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
        <h2 className="cm-section-title">{title}</h2>
        {summary && <span className="cm-section-summary">{summary}</span>}
      </button>
      {open && <div className="cm-section-body">{children}</div>}
    </section>
  );
}

// ── Main Page ──
export default function CapabilityMapPage() {
  // ── QA tracking ──
  const qaChecks = useUiStore((state) => state.qaChecks || {});
  const toggleQaCheck = useUiStore((state) => state.toggleQaCheck);
  const qaCount = Object.keys(qaChecks).length;

  // ── Live queries ──
  const providerHealthQuery = useQuery({
    queryKey: ['capability-map', 'provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const directivesQuery = useQuery({
    queryKey: ['capability-map', 'directives'],
    queryFn: () => apiGet('/api/directives'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const apiOnline = !providerHealthQuery.isError && !directivesQuery.isError;

  // ── Directive stats (live or fallback) ──
  const directiveStats = useMemo(() => {
    if (directivesQuery.data && Array.isArray(directivesQuery.data)) {
      const live = directivesQuery.data;
      const categories = new Map();
      live.forEach((d) => {
        const cat = d.category || 'Uncategorized';
        if (!categories.has(cat)) categories.set(cat, { name: cat, total: 0, implemented: 0, directives: [] });
        const c = categories.get(cat);
        c.total++;
        c.directives.push({ id: d.id, name: d.name, status: 'implemented' });
        c.implemented++;
      });
      const total = live.length;
      return { total, implemented: total, pct: 100, liveCategories: Array.from(categories.values()) };
    }
    // Fallback to hardcoded
    let total = 0, implemented = 0;
    DIRECTIVE_CATEGORIES.forEach((cat) => {
      cat.directives.forEach((d) => {
        total++;
        if (d.status === 'implemented') implemented++;
      });
    });
    return { total, implemented, pct: Math.round((implemented / total) * 100), liveCategories: null };
  }, [directivesQuery.data]);

  // ── Provider stats (live or fallback) ──
  const providerData = useMemo(() => {
    if (providerHealthQuery.data) {
      const data = providerHealthQuery.data;
      const providers = Array.isArray(data.providers) ? data.providers : Array.isArray(data) ? data : [];
      const live = providers.filter((p) => p.status === 'healthy' || p.status === 'ok').length;
      return { providers, live, total: providers.length, isLive: true };
    }
    const live = PROVIDERS.filter((p) => p.health === 'live').length;
    return { providers: PROVIDERS, live, total: PROVIDERS.length, isLive: false };
  }, [providerHealthQuery.data]);

  // Page data stats
  const pageStats = useMemo(() => getPageDataSummary(), []);

  // API total
  const apiTotal = API_MODULES.reduce((s, m) => s + m.count, 0);

  return (
    <div className="cm-page">
      <motion.header className="cm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🗺️ Capability Map</h1>
        <p className="cm-subtitle">
          Living inventory compiled from the directive registry, provider adapters, page metadata, and discussion documents.
        </p>
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <a href="/builder/architecture-framework" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>⬡ Architecture Framework</a>
          <a href="/builder/diagrams" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>▦ Diagrams</a>
        </div>
      </motion.header>

      {/* ── Summary Card ── */}
      <motion.div className="cm-summary" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="cm-summary-item">
          <span className="cm-summary-value">{directivesQuery.isLoading ? '…' : `${directiveStats.pct}%`}</span>
          <span className="cm-summary-label">directives implemented</span>
        </div>
        <div className="cm-summary-item">
          <span className="cm-summary-value">{providerHealthQuery.isLoading ? '…' : `${providerData.live}/${providerData.total}`}</span>
          <span className="cm-summary-label">providers {providerData.isLive ? 'healthy' : 'live'}</span>
        </div>
        <div className="cm-summary-item">
          <span className="cm-summary-value">{pageStats.live}/{pageStats.total}</span>
          <span className="cm-summary-label">pages have real data</span>
        </div>
        <div className="cm-summary-item">
          <span className="cm-summary-value">{apiTotal}</span>
          <span className="cm-summary-label">API endpoints</span>
          {apiOnline && <span className="cm-summary-source" style={{ fontSize: 9, color: '#22c55e', display: 'block', marginTop: 2 }}>● live data</span>}
        </div>
      </motion.div>

      {/* ── Directive Coverage ── */}
      <CollapsibleSection id="directives" title="Directive Coverage" summary={directivesQuery.isLoading ? 'Loading…' : `${directiveStats.implemented}/${directiveStats.total} implemented (${directiveStats.pct}%)`}>
        {directivesQuery.isLoading && <LoadingSkeleton variant="text" lines={6} />}
        {directivesQuery.isError && <ApiOfflineBanner compact />}
        {!directivesQuery.isLoading && (
        <div className="cm-categories">
          {(directiveStats.liveCategories || DIRECTIVE_CATEGORIES).map((cat) => {
            const directives = cat.directives || [];
            const impl = cat.implemented ?? directives.filter((d) => d.status === 'implemented').length;
            const total = cat.total ?? directives.length;
            const pct = Math.round((impl / total) * 100);
            const color = pct === 100 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
            return (
              <div key={cat.id || cat.name} className="cm-category">
                <div className="cm-category-header">
                  <strong>{cat.name}</strong>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)' }}>{impl}/{total}</span>
                </div>
                <ProgressBar pct={pct} color={color} />
                <div className="cm-directive-list">
                  {directives.map((d) => (
                    <span key={d.id} className={`cm-directive-chip ${d.status || 'implemented'}`}>{d.name}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </CollapsibleSection>

      {/* ── Provider Status ── */}
      <CollapsibleSection id="providers" title="Provider Status" summary={providerHealthQuery.isLoading ? 'Loading…' : `${providerData.live}/${providerData.total} ${providerData.isLive ? 'healthy' : 'live'}`}>
        {providerHealthQuery.isLoading && <LoadingSkeleton variant="table" rows={6} cols={8} />}
        {providerHealthQuery.isError && <ApiOfflineBanner compact />}
        {!providerHealthQuery.isLoading && (
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Quotes</th>
                <th>Candles</th>
                <th>News</th>
                <th>Fund.</th>
                <th>Portfolio</th>
                <th>Orders</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {providerData.providers.map((p) => {
                const status = providerData.isLive ? (p.status === 'healthy' || p.status === 'ok' ? 'live' : p.status === 'degraded' || p.status === 'missing-credentials' ? 'degraded' : 'failed') : p.health;
                const hasQuotes = providerData.isLive ? (p.quotes !== false) : p.quotes;
                const hasCandles = providerData.isLive ? (p.candles !== false) : p.candles;
                const hasNews = providerData.isLive ? (p.news === true) : p.news;
                const hasFundamentals = providerData.isLive ? (p.fundamentals === true) : p.fundamentals;
                const hasPortfolio = providerData.isLive ? (p.portfolio === true) : p.portfolio;
                const hasOrders = providerData.isLive ? (p.orders === true) : p.orders;
                return (
                <tr key={p.name || p.provider}>
                  <td><strong>{p.name || p.provider}</strong></td>
                  <td>{hasQuotes ? '✅' : '—'}</td>
                  <td>{hasCandles ? '✅' : '—'}</td>
                  <td>{hasNews ? '✅' : '—'}</td>
                  <td>{hasFundamentals ? '✅' : '—'}</td>
                  <td>{hasPortfolio ? '📊' : '—'}</td>
                  <td>{hasOrders ? '📤' : '—'}</td>
                  <td><StatusBadge status={status} /></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>)}
      </CollapsibleSection>

      {/* ── Page Data Status ── */}
      <CollapsibleSection id="pages" title="Page Data Status" summary={`${pageStats.live} live · ${pageStats.partial} partial · ${pageStats.mock} mock · ${qaCount} QA checked`}>
        <p className="cm-qa-note">✅ QA checkmarks are saved automatically. To reset all checkboxes, visit <a href="/settings/settings">Settings → General</a> and click <strong>Reset QA Checks</strong>.</p>
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Area</th>
                <th>Status</th>
                <th>Source</th>
                <th className="cm-qa-th">QA</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(NAV_TREE).flatMap(([areaKey, area]) =>
                area.views.map((view) => {
                  const meta = PAGE_DATA_STATUS[view.id];
                  const checked = !!qaChecks[view.id];
                  return (
                    <tr key={view.id} className={checked ? 'cm-qa-checked' : ''}>
                      <td>{view.label}</td>
                      <td style={{ color: 'var(--ink-soft, #94a3b8)', fontSize: 12 }}>{area.label}</td>
                      <td>{meta ? <StatusBadge status={meta.status} /> : <StatusBadge status="planned" />}</td>
                      <td style={{ fontSize: 11, color: 'var(--ink-soft, #94a3b8)' }}>{meta?.source || meta?.note || meta?.planned || '—'}</td>
                      <td className="cm-qa-td">
                        <button
                          type="button"
                          className={`cm-qa-checkbox${checked ? ' cm-qa-checked-box' : ''}`}
                          onClick={() => toggleQaCheck(view.id)}
                          title={checked ? `QA checked ${new Date(qaChecks[view.id]).toLocaleString()}` : 'Mark QA complete'}
                        >
                          {checked ? '✅' : '☐'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* ── Discussion Coverage ── */}
      <CollapsibleSection id="discussions" title="Discussion Coverage" summary={`${DISCUSSIONS.filter((d) => d.status === 'implemented').length} implemented`}>
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Discussion</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {DISCUSSIONS.map((d) => (
                <tr key={d.name}>
                  <td><strong>{d.name}</strong></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td style={{ fontSize: 11, color: 'var(--ink-soft, #94a3b8)' }}>{d.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* ── API Endpoints ── */}
      <CollapsibleSection id="api" title="API Endpoints" summary={`${apiTotal} endpoints across ${API_MODULES.length} modules`} defaultOpen={false}>
        <div className="cm-api-grid">
          {API_MODULES.map((mod) => (
            <div key={mod.name} className="cm-api-module">
              <div className="cm-api-module-header">
                <strong>{mod.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)' }}>{mod.count} endpoints</span>
              </div>
              <ul className="cm-api-list">
                {mod.endpoints.map((ep) => (
                  <li key={ep}>{ep}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}
