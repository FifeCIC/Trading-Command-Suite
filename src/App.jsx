import { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analytics, trackAppView, trackSupportClick } from './analytics';
import Breadcrumbs from './components/Breadcrumbs';
import DevOverlay from './components/DevOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import MarketTape from './components/MarketTape';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';

import { apiGet } from './core/api/client';
import { withDevTag } from './dev-runtime/tags';
import { getPerformanceSnapshot, startPerformanceMonitoring } from './performance/monitor';
import HomeDashboard from './pages/HomeDashboard';
import PlatformComparisonsPage from './pages/PlatformComparisonsPage';
import PluginTabSkeletonPage from './pages/PluginTabSkeletonPage';
import DataManagementPage from './pages/DataManagementPage';
import TopMoversPage from './pages/TopMoversPage';
import SystemHealthPage from './pages/SystemHealthPage';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import ScreenOptions from './components/ScreenOptions';
import PageInfoPopover from './components/PageInfoPopover';
import { VIEW_EXPLANATIONS } from './core/view-explanations';
import { TopRowSlotProvider, TopRowSlotHost } from './core/top-row-slot';

import { useNetworkStatus } from './utils/networkStatus';
import { useUiStore } from './stores/useUiStore';
import { useThemeRuntime } from './theme/useThemeRuntime';
import './theme/packs/ai-original.css';
import './theme/packs/scifi.css';
import './theme/packs/slate.css';
import { featureFlags } from './utils/featureFlags';
import { NAV_TREE, getNavStructure } from './core/nav-tree';
import { PLUGIN_TAB_SKELETONS } from './pages/plugin-tab-skeletons';
import { VIEW_COMPONENTS } from './core/view-routes.jsx';

const NAV_STRUCTURE = getNavStructure();

// Redirect the legacy /scoringStrategies/ area (renamed to /scoring/ 2026-08-19).
function ScoringStrategiesRedirect() {
  const { view } = useParams();
  return <Navigate to={`/scoring/${view || ''}`} replace />;
}

// Collapse the legacy /symbol/:ticker alias onto the canonical /research/symbol/:ticker.
function SymbolRedirect() {
  const { ticker } = useParams();
  return <Navigate to={`/research/symbol/${encodeURIComponent(ticker || '')}`} replace />;
}

const THEME_CARDS = [
  { id: 'ai-original', name: 'AI Original', description: 'Dark navy, blue accent — doomchart inspired.', colors: ['#0a0e17', '#5b8def', '#e6ecf7'] },
  { id: 'core', name: 'Core', description: 'Clean, neutral palette.', colors: ['#f4f7fb', '#0ea5a6', '#0f172a'] },
  { id: 'oceanic', name: 'Oceanic', description: 'Deep blue with teal.', colors: ['#0f1b2e', '#00d9ff', '#d6e8ff'] },
  { id: 'scifi', name: 'Sci-Fi', description: 'Dark navy, cyan neon.', colors: ['#0a1428', '#00d9ff', '#c1d0e0'] },
  { id: 'slate', name: 'Slate', description: 'Blue-gray with indigo accent — matches the dashboard.', colors: ['#0f172a', '#3b82f6', '#e2e8f0'] },
  { id: 'terminal', name: 'Terminal', description: 'Black, neon green.', colors: ['#0a0a0a', '#00ff41', '#e0e0e0'] },
  { id: 'void', name: 'Void', description: 'Black, neon purple.', colors: ['#08080d', '#8a50ff', '#d4d0e8'] },
];



function AccordionBlock({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`acc-block ${open ? 'acc-open' : ''}`}>
      <button type="button" className="acc-toggle" onClick={() => setOpen(!open)}>
        <span className="acc-arrow">{open ? '▾' : '▸'}</span>
        <span className="muted">{title}</span>
      </button>
      {open && <div className="acc-content">{children}</div>}
    </div>
  );
}

function ContentCard({ title, children }) {
  return (
    <article className="content-card">
      <h3>{title}</h3>
      <div>{children}</div>
    </article>
  );
}

/**
 * AppShell — Layout wrapper with sidebar, header breadcrumbs, footer, and ScreenOptions.
 *
 * Route param mapping:
 *   /:area/:view          → {area, view}          → primaryArea=area, secondaryView=view
 *   /research/symbol/:ticker → standalone (SymbolFocusPage, no AppShell)
 *   /symbol/:ticker          → standalone (SymbolFocusPage, no AppShell)
 *
 * Content rendering (renderMainContent, line ~484):
 *   Looks up VIEW_COMPONENTS[secondaryView] from core/view-routes.jsx (line ~148).
 *   Falls back to plugin skeletons, then inline views (demos, analytics).
 *   Does NOT use React Router <Outlet> — content is rendered inline.
 *
 * Sidebar (line ~896): Navigation rail with primaryArea-based view list.
 * ScreenOptions (line ~1030): Floating disc group with per-view settings.
 * Bookmark state: Derived from primaryArea/secondaryView pair.
 *
 * SEE ALSO: Route table at line ~1050, renderMainContent at line ~484,
 *           VIEW_COMPONENTS at core/view-routes.jsx.
 */
function AppShell() {
  const { area, view, symbolId, ticker } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const isHomePage = location.pathname === '/';
  // `/trading/symbol/:ticker` renders the symbol page INSIDE the shell chrome.
  const isSymbolRoute = Boolean(ticker);
  // Symbol routes use literal prefixes (research/symbol, trading/symbol) so the
  // `area` param is undefined — derive the sidebar area from the pathname.
  const symbolArea = location.pathname.startsWith('/research/symbol/') ? 'research'
    : location.pathname.startsWith('/trading/symbol/') ? 'trading'
    : 'trading';
  const primaryArea = isSymbolRoute ? symbolArea : (symbolId ? 'research' : (isHomePage ? null : (area || 'trading')));
  // defaultView: use the first registered view for the current area, falling back to directives-registry
  const areaViews = NAV_STRUCTURE[primaryArea];
  const defaultView = (areaViews && areaViews.length > 0) ? areaViews[0].id : 'directives-registry';
  const secondaryView = isSymbolRoute ? 'symbol' : (symbolId ? 'symbol-detail' : (view || defaultView));
  // Dashboard renders full-bleed — no breadcrumb, no left section nav — as a
  // step toward the future widget-based, multi-screen dashboard.
  const isDashboard = primaryArea === 'dashboard';
  const [demoPrompt, setDemoPrompt] = useState('Generate a responsive planning concept for eco garden week.');
  const [demoOutput, setDemoOutput] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [ffState, setFfState] = useState(() => featureFlags.getFlags());


  const devOverlayOpen = useUiStore((state) => state.devOverlayOpen);
  const closeDevOverlay = useUiStore((state) => state.closeDevOverlay);
  const themeMode = useUiStore((state) => state.themeMode);
  const themePack = useUiStore((state) => state.themePack);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const setThemePack = useUiStore((state) => state.setThemePack);
  const backgroundTone = useUiStore((state) => state.backgroundTone);
  const setBackgroundTone = useUiStore((state) => state.setBackgroundTone);
  const showNavIcons = useUiStore((state) => state.showNavIcons);
  const bookmarks = useUiStore((state) => state.bookmarks || []);
  const toggleBookmark = useUiStore((state) => state.toggleBookmark);

  // ── Sidebar collapse ──
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // ── Screen Options overlay ──
  const [screenOptionsOpen, setScreenOptionsOpen] = useState(false);
  const [screenOptionsView, setScreenOptionsView] = useState(null);
  // ── Status popout ──
  const [statusPopoutOpen, setStatusPopoutOpen] = useState(false);

  // Screen Options and Dev Tools share the right rail — keep them exclusive.
  useEffect(() => {
    if (devOverlayOpen) setScreenOptionsOpen(false);
  }, [devOverlayOpen]);

  // Update screen options view when user navigates
  useEffect(() => {
    const viewId = secondaryView;
    // Map known views to their registry keys
    const VIEW_TO_OPTIONS = {
      'speed-scanner': 'speed-scanner',
      'pipeline-graph-lab': 'pipeline-graph-lab',
      'active-symbols': 'active-symbols',
      'directives-registry': 'directives-registry',
      'symbols-ladder': 'symbols-ladder',
      'symbols-browser': 'symbols-browser',
      'screener': 'screener',
      'signals-overview': 'signals-overview',
      't212-portfolio': 't212-portfolio',
    };
    setScreenOptionsView(VIEW_TO_OPTIONS[viewId] || null);
  }, [primaryArea, secondaryView]);
  const { meta } = useThemeRuntime({ mode: themeMode, packId: themePack });
  const availablePacks = Array.isArray(meta?.availablePacks) ? meta.availablePacks : [];
  const availableAdapters = Array.isArray(meta?.availableAdapters) ? meta.availableAdapters : [];
  const diagnostics = Array.isArray(meta?.diagnostics) ? meta.diagnostics : [];
  const policyMeta = meta?.policy || {};
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState(() => analytics.getSnapshot());
  const [performanceSnapshot, setPerformanceSnapshot] = useState(() => getPerformanceSnapshot());

  const { isOnline, wasOffline, lastOnlineAt } = useNetworkStatus();

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version'),
    retry: false,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const apiActivitySummaryQuery = useQuery({
    queryKey: ['api-activity-summary-nav'],
    queryFn: () => apiGet('/api/api-activity/summary'),
    refetchInterval: 15_000,
    enabled: primaryArea === 'data',
  });

  const hasApiErrors = (apiActivitySummaryQuery.data?.errorCount ?? 0) > 0;

  const readiness = !healthQuery.data?.version
    ? { level: 'warn', summary: 'API?' }
    : policyMeta.failClosed && !policyMeta.policyEnforced
      ? { level: 'blocked', summary: 'Fail config' }
      : !performanceSnapshot.started
        ? { level: 'warn', summary: 'Vitals' }
        : { level: 'ok', summary: 'OK' };

  function pushActivity(type, details) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      details
    };
    setActivityLog((prev) => [item, ...prev].slice(0, 24));
  }

  // ── Track app view on mount ──
  const autoStartAttempted = useRef(false);

  useEffect(() => {
    trackAppView();
    startPerformanceMonitoring();
    pushActivity('BOOT', 'Shell initialized');

    const timer = window.setInterval(() => {
      setAnalyticsSnapshot(analytics.getSnapshot());
      setPerformanceSnapshot(getPerformanceSnapshot());
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Auto-start the NestJS API if it's not running on app launch
  useEffect(() => {
    if (autoStartAttempted.current) return;

    const attemptAutoStart = async () => {
      // Wait for initial health check to settle
      await new Promise((r) => setTimeout(r, 3000));

      if (autoStartAttempted.current) return;
      autoStartAttempted.current = true;

      // Check if API is already reachable
      try {
        const res = await fetch('http://localhost:3201/api/version', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          pushActivity('AUTOSTART', 'API already running');
          return;
        }
      } catch {
        // API not reachable — try to start it
      }

      pushActivity('AUTOSTART', 'Attempting to start API server...');
      try {
        await fetch('/api/processes/tradercore%3Aapi%3A3201/start', {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        });
        pushActivity('AUTOSTART', 'Start command sent');
      } catch {
        pushActivity('AUTOSTART', 'Could not reach task runner');
      }
    };

    attemptAutoStart();
  }, []);

  useEffect(() => {
    const views = NAV_STRUCTURE[primaryArea] || [];
    const hasCurrentView = views.some((item) => item.id === secondaryView);
    const hasComponent = !!VIEW_COMPONENTS[secondaryView];
    if (!hasCurrentView && !hasComponent) {
      // ⚠️ Skip section headers when choosing the fallback route. A header is a LABEL, not a
      // destination: it has an `id` (used as a React key) but no page, so navigating to it
      // renders nothing and the user sees an apparently broken area. This only worked before
      // because every header happened to sit below index 0 — the Settings area (2026-09-16,
      // #617) is the first to open with one.
      const firstView = views.find((item) => item.kind !== 'section-header' && item.id)?.id;
      if (firstView) {
        navigate(`/${primaryArea}/${firstView}`, { replace: true });
      }
    }
    pushActivity('NAV', `Primary changed to ${primaryArea}`);
  }, [primaryArea, secondaryView, navigate]);

  useEffect(() => {
    document.documentElement.setAttribute('data-bg-tone', backgroundTone);
  }, [backgroundTone]);

  // ── Apply user preferences to document root ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tcs:preferences');
      const prefs = raw ? JSON.parse(raw) : {};
      document.documentElement.setAttribute('data-page-transitions', prefs.pageTransitions !== false ? 'true' : 'false');
      document.documentElement.setAttribute('data-high-contrast', prefs.highContrastText === true ? 'true' : 'false');
      document.documentElement.setAttribute('data-colorblind', prefs.colorBlindMode === true ? 'true' : 'false');
      document.documentElement.setAttribute('data-font-scale', prefs.fontScale || 'normal');
      document.documentElement.setAttribute('data-focus-indicator-style', prefs.focusIndicatorStyle || 'strong');
      document.documentElement.setAttribute('data-layout-size', prefs.layoutSize || 'normal');
    } catch { /* preference not yet saved */ }
  }, []);

  // ── Listen for preference changes ──
  useEffect(() => {
    const onStorage = () => {
      try {
        const raw = localStorage.getItem('tcs:preferences');
        const prefs = raw ? JSON.parse(raw) : {};
        document.documentElement.setAttribute('data-high-contrast', prefs.highContrastText === true ? 'true' : 'false');
        document.documentElement.setAttribute('data-colorblind', prefs.colorBlindMode === true ? 'true' : 'false');
        document.documentElement.setAttribute('data-page-transitions', prefs.pageTransitions !== false ? 'true' : 'false');
        document.documentElement.setAttribute('data-font-scale', prefs.fontScale || 'normal');
        document.documentElement.setAttribute('data-focus-indicator-style', prefs.focusIndicatorStyle || 'strong');
        document.documentElement.setAttribute('data-layout-size', prefs.layoutSize || 'normal');
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    return featureFlags.subscribe(setFfState);
  }, []);

  // ── Background ticker feed — polls scoring activity & alerts ──
  useEffect(() => {
    let lastSeenScoreEvent = '';
    let lastSeenAlertId = '';

    const poll = async () => {
      try {
        // SEES scoring protocol activity
        const sp = await fetch('/api/scoring/protocols', { signal: AbortSignal.timeout(5000) });
        if (sp.ok) {
          const data = await sp.json();
          const acts = data?.recentActivity || [];
          if (acts.length > 0) {
            const latest = acts[0];
            const key = `${latest.timestamp}-${latest.event}-${latest.protocolId}`;
            if (key !== lastSeenScoreEvent) {
              lastSeenScoreEvent = key;
            }
          }
        }
      } catch { /* silent */ }

      try {
        // Alerts
        const ar = await fetch('/api/alerts/active', { signal: AbortSignal.timeout(5000) });
        if (ar.ok) {
          const alerts = await ar.json();
          const active = Array.isArray(alerts) ? alerts : (alerts?.alerts || []);
          if (active.length > 0) {
            const latest = active[0];
            if (latest.id !== lastSeenAlertId) {
              lastSeenAlertId = latest.id;
            }
          }
        }
      } catch { /* silent */ }
    };

    // Initial poll after a short delay (let health check settle)
    const initTimer = setTimeout(poll, 6000);
    const interval = setInterval(poll, 15_000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, []);

  function onSupportClick(surface) {
    trackSupportClick(surface);
    pushActivity('SUPPORT', `CTA clicked from ${surface}`);
  }

  async function onDownloadRuntimeReport() {
    const { buildRuntimeReport, exportRuntimeReport } = await import('./runtime/report');
    const runtimeReport = buildRuntimeReport({
      health: healthQuery.data || null,
      analyticsSnapshot,
      performanceSnapshot,
      themePack,
      themeMode,
      availablePacks,
      availableAdapters,
      diagnostics,
      policyMeta,
      activityLog,
      primaryArea,
      secondaryView
    });
    exportRuntimeReport(runtimeReport);
    pushActivity('REPORT', 'Report downloaded');
  }

  function onPrimarySelect(newArea) {
    const views = NAV_STRUCTURE[newArea] || [];
    const firstView = views[0]?.id || 'overview';
    navigate(`/${newArea}/${firstView}`);
  }

  function onSecondarySelect(viewId) {
    navigate(`/${primaryArea}/${viewId}`);
    pushActivity('VIEW', `Opened ${viewId}`);
  }



  function runDemo() {
    const output = `Demo response for "${demoPrompt}":\n- Theme: sci-fi curriculum board\n- Activity flow: intro > collaboration > reflection\n- Evidence capture: photo + annotation + outcome tag\n- Parent digest summary prepared`;
    setDemoOutput(output);
    analytics.track('demo.executed', {
      view: secondaryView,
      promptLength: demoPrompt.length
    });
    pushActivity('DEMO', 'Generated demo output');
  }

  function renderMainContent() {
    // ── Component map lookup (handles ~90 simple views) ──
    const Component = VIEW_COMPONENTS[secondaryView];
    if (Component) return <Component />;

    // ── Plugin tab skeletons ──
    if (PLUGIN_TAB_SKELETONS[secondaryView]) {
      return <PluginTabSkeletonPage tabId={secondaryView} />;
    }

    // ── Complex inline views (use parent state) ──

    if (secondaryView === 'demos') {
      return (
        <section className="demo-panel">
          <h2>Interactive Demo</h2>
          <p>Run a sample flow to preview how your future tools can present generated outcomes.</p>
          <textarea value={demoPrompt} onChange={(event) => setDemoPrompt(event.target.value)} rows={5} />
          <div className="inline-actions">
            <button type="button" className="cta" onClick={runDemo}>Run Demo</button>
            <button
              type="button"
              onClick={() => {
                setDemoPrompt('Create a team dashboard card layout with live safety indicators.');
                pushActivity('DEMO', 'Loaded alt prompt');
              }}
            >
              Load Alternate Prompt
            </button>
          </div>
          {demoOutput && <pre className="demo-output">{demoOutput}</pre>}
        </section>
      );
    }

    if (secondaryView === 'use-cases') {
      return (
        <div className="content-grid">
          <ContentCard title="Education Tools">
            <p>Observation capture, planning, and parent communication apps with reusable modules.</p>
          </ContentCard>
          <ContentCard title="Internal Dashboards">
            <p>Operational portals with policy-safe extensions and centralized analytics reporting.</p>
          </ContentCard>
          <ContentCard title="Client Prototypes">
            <p>Fast proof-of-concepts with a credible product shell for demos and screenshots.</p>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'analytics') {
      return (
        <div className="content-grid">
          <ContentCard title="Analytics Pipeline">
            <p>Mode: {analyticsSnapshot.enabled ? 'enabled' : 'disabled'}</p>
            <p>Forwarding: {analyticsSnapshot.endpointConfigured ? 'configured' : 'local queue only'}</p>
            <p>Queued events: {analyticsSnapshot.queueLength}</p>
            <p>Sent events: {analyticsSnapshot.sentCount}</p>
            <p>Readiness: {readiness.level}</p>
          </ContentCard>
          <ContentCard title="Performance Metrics">
            <p>Monitoring: {performanceSnapshot.enabled ? 'enabled' : 'disabled'}</p>
            <p>Samples captured: {performanceSnapshot.samples}</p>
            <p>Last update: {performanceSnapshot.lastUpdatedAt || 'pending'}</p>
          </ContentCard>
          <ContentCard title="Runtime Report">
            <p>Export current health, policy, analytics, and vitals as JSON.</p>
            <div className="inline-actions">
              <button type="button" onClick={onDownloadRuntimeReport}>Download Report</button>
            </div>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'about') {
      return (
        <section className="intro-panel">
          <h2>About Trading Command Suite</h2>
          <p>
            Built by Ryan Bayne and offered by FifeCIC.Scot, this platform helps teams move from prototype
            to secure live products without rebuilding foundation systems each time.
          </p>
        </section>
      );
    }

    return (
      <section className="demo-panel">
        <h2>Support Trading Command Suite</h2>
        <p>
          If this platform saves you development time, sponsorships help maintain rapid releases and open tooling.
        </p>
        <div className="inline-actions">
          <a
            className="support-link-button"
            href="https://www.buymeacoffee.com/ryanbayne"
            target="_blank"
            rel="noreferrer"
            onClick={() => onSupportClick('support.main')}
          >
            Buy Me a Coffee
          </a>
          <a className="support-link-button" href="mailto:tradingcs@fifecic.scot">
            Contact Ryan
          </a>
        </div>
      </section>
    );
  }

  const isApiOnline = Boolean(healthQuery.data?.version);
  const isDbOnline = healthQuery.data?.services?.databaseConnected === true;

  // ── Setup gate: redirect to setup wizard if infra not ready ──
  const setupCompleted = (() => { try { return localStorage.getItem('tcs-setup-completed') === 'true'; } catch { return false; } })();
  const healthFetched = healthQuery.isFetched;
  const needsSetup = healthFetched && !setupCompleted && (!isApiOnline || !isDbOnline);
  const onSetupPage = window.location.pathname === '/status/setup';
  useEffect(() => {
    if (needsSetup && !onSetupPage) { window.location.href = '/status/setup'; }
  }, [needsSetup, onSetupPage]);

  // ── MT5 bridge status (lightweight poll) ─────────────
  const mt5Query = useQuery({
    queryKey: ['mt5-diag-header'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const isMt5Online = mt5Query.data?.connected === true || mt5Query.data?.status === 'online';

  const statusLevel = isApiOnline
    ? (isDbOnline && isMt5Online ? 'online' : 'warn')
    : 'offline';
  const statusLabel = isApiOnline
    ? (isDbOnline && isMt5Online ? 'Online' : 'Degraded')
    : 'Offline';
  return (
    <div className={`site-shell layout-omni background-${backgroundTone}${(devOverlayOpen || screenOptionsOpen) ? '' : ' right-rail-hidden'}${leftCollapsed ? ' left-rail-collapsed' : ''}${isDashboard ? ' dashboard-shell' : ''}`} {...withDevTag('app.shell', { product: 'tradingcs' })}>
      {!isOnline && (
        <div className="network-status-bar offline">
          📡 Offline — showing cached data (last sync: {lastOnlineAt?.toLocaleTimeString() || 'never'})
        </div>
      )}
      {wasOffline && isOnline && (
        <div className="network-status-bar online">
          ✅ Back online — data is updating
        </div>
      )}

      <PwaInstallPrompt />

      <div className="sci-bg" aria-hidden="true">
        <div className="sci-stars" />
        <div className="sci-grid" />
        <div className="sci-glow" />
      </div>

      <header className="topbar topbar-omni">
        <div className="topbar-row topbar-row-main">
          <div className="topbar-brand" title="Trading Command Suite" aria-label="Trading Command Suite">
            <span className="topbar-brand-line"><span className="topbar-brand-accent">T</span>RADING</span>
            <span className="topbar-brand-line"><span className="topbar-brand-accent">C</span>OMMAND</span>
            <span className="topbar-brand-line"><span className="topbar-brand-accent">S</span>UITE</span>
          </div>
          <nav className="topbar-area-nav" aria-label="Main navigation">
            {/* Primary hubs — Dashboard + Accounts left of separator */}
            {Object.entries(NAV_TREE)
              .filter(([id]) => ['dashboard', 'trading212'].includes(id))
              .map(([id, area]) => (
                <button
                  key={id}
                  type="button"
                  className={primaryArea === id ? 'nav-active' : ''}
                  onClick={() => onPrimarySelect(id)}
                  title={area.label}
                >
                  {area.label}
                </button>
              ))}
            {/* Separator between primary hubs and area nav */}
            <span className="topbar-nav-sep" aria-hidden="true" />
            {/* Area navigation */}
            {Object.entries(NAV_TREE)
              .filter(([id]) => !['dashboard', 'trading212', 'development'].includes(id))
              .map(([id, area]) => (
                <button
                  key={id}
                  type="button"
                  className={primaryArea === id ? 'nav-active' : ''}
                  onClick={() => onPrimarySelect(id)}
                  title={area.label}
                >
                  {area.label}
                </button>
              ))}
            {/* Developer tooling — separated on the right */}
            <span className="topbar-nav-sep" aria-hidden="true" />
            {Object.entries(NAV_TREE)
              .filter(([id]) => id === 'development')
              .map(([id, area]) => (
                <button
                  key={id}
                  type="button"
                  className={primaryArea === id ? 'nav-active' : ''}
                  onClick={() => onPrimarySelect(id)}
                  title={area.label}
                >
                  {area.label}
                </button>
              ))}
          </nav>

          <div className="topbar-status-cluster">
            <button
              type="button"
              className="mobile-nav-toggle"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileNavOpen}
            >
              <span className="hamburger-line" />
              <span className="hamburger-line" />
              <span className="hamburger-line" />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button
                type="button"
                className="topbar-calc-btn"
                onClick={() => navigate('/trading/calculators')}
                title="Quick Calculators"
                aria-label="Open Calculators"
              >
                🧮
              </button>
              <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="topbar-status-summary"
                onClick={() => setStatusPopoutOpen(v => !v)}
                onBlur={() => setTimeout(() => setStatusPopoutOpen(false), 200)}
                title={`API: ${isApiOnline ? '✓' : '✗'} | DB: ${isDbOnline ? '✓' : '✗'} | MT5: ${isMt5Online ? '✓' : '✗'}`}
              >
                <span className={`topbar-status-dot ${statusLevel}`} />
                <span>{statusLabel}</span>
              </button>
              {statusPopoutOpen && (
                <div className="topbar-status-popout" style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6,
                  background: 'var(--panel)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0.75rem 1rem', zIndex: 100,
                  minWidth: 200, boxShadow: 'var(--shadow-card)',
                  fontFamily: 'var(--font-body)',
                }}>
                  <div className="dev-section-title" style={{ marginBottom: '0.5rem' }}>System Status</div>
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">API</span>
                    <span className={`dev-stat-value ${isApiOnline ? 'ok' : 'error'}`}>
                      {isApiOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">Database</span>
                    <span className={`dev-stat-value ${isDbOnline ? 'ok' : 'error'}`}>
                      {isDbOnline ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">MT5 Bridge</span>
                    <span className={`dev-stat-value ${isMt5Online ? 'ok' : 'error'}`}>
                      {isMt5Online ? 'Connected' : 'Offline'}
                    </span>
                  </div>
                  {isMt5Online && mt5Query.data && (
                    <>
                      <div className="dev-stat-row">
                        <span className="dev-stat-label">MT5 Account</span>
                        <span className="dev-stat-value muted">{mt5Query.data.account || '—'}</span>
                      </div>
                      <div className="dev-stat-row">
                        <span className="dev-stat-label">Balance</span>
                        <span className="dev-stat-value muted">
                          {mt5Query.data.balance != null ? `$${Number(mt5Query.data.balance).toLocaleString()}` : '—'}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">Mode</span>
                    <span className="dev-stat-value muted">{healthQuery.data?.mode || '—'}</span>
                  </div>
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">Providers</span>
                    <span className="dev-stat-value muted">{availableAdapters.length} registered</span>
                  </div>
                  <div className="dev-stat-row">
                    <span className="dev-stat-label">Version</span>
                    <span className="dev-stat-value muted">{healthQuery.data?.version || '—'}</span>
                  </div>
                  <a href="/status/setup" className="dev-action-btn" style={{ display: 'block', marginTop: '0.5rem', textAlign: 'center', textDecoration: 'none' }}>
                    Setup & Diagnostics →
                  </a>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
        <MarketTape />
      </header>

      {mobileNavOpen && (
        <div
          className="mobile-nav-overlay"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`left-rail${mobileNavOpen ? ' left-rail--open' : ''}`} aria-label="Section navigation">
        <div className="left-rail-header">
          <h2>{NAV_TREE[primaryArea]?.label || primaryArea}</h2>
          <button
            type="button"
            className="mobile-nav-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            ✕
          </button>
        </div>
        <div className="rail-links">
          {(NAV_STRUCTURE[primaryArea] || []).filter((item) => {
            if (item.id === 'import-jobs' && !ffState.importJobs) return false;
            return true;
          }).map((item) => (
            item.kind === 'section-header' ? (
              <div key={item.id} className="rail-section-header">
                <span className="rail-section-header-label">{item.icon} {item.label}</span>
              </div>
            ) : (
            <button
              key={item.id}
              type="button"
              className={secondaryView === item.id ? 'nav-active' : ''}
              onClick={() => {
                onSecondarySelect(item.id);
                setMobileNavOpen(false);
              }}
            >
              <span className="rail-link-label">{item.label}</span>
              {showNavIcons && item.icon && (
                <span className="rail-link-icon">{item.icon}</span>
              )}
              {item.id === 'api-activity' && hasApiErrors && (
                <span className="rail-status-dot rail-status-dot--error" aria-label="API errors present" />
              )}
            </button>
            )
          ))}
        </div>

        {/* ── Bookmarks Section ── */}
        {bookmarks.length > 0 && (
          <div className="rail-bookmarks">
            <div className="left-rail-header">
              <h2>Bookmarks ⭐</h2>
            </div>
            <div className="rail-links">
            {bookmarks.slice(0, 12).map((bm) => {
              const areaLabel = NAV_TREE[bm.area]?.label || bm.area;
              const viewLabel = NAV_STRUCTURE[bm.area]?.find((v) => v.id === bm.view)?.label || bm.view;
              return (
                <button
                  key={bm.id}
                  type="button"
                  className={primaryArea === bm.area && secondaryView === bm.view ? 'nav-active' : ''}
                  onClick={() => {
                    navigate(`/${bm.area}/${bm.view}`);
                    setMobileNavOpen(false);
                  }}
                  title={`${areaLabel} › ${viewLabel}`}
                >
                  <span className="rail-link-label">{viewLabel}</span>
                </button>
              );
            })}
            </div>
          </div>
        )}

        {primaryArea === 'settings' && (
          <>
            <AccordionBlock title="Theme Mode" defaultOpen={false}>
              <div className="inline-actions" style={{ padding: '0.5rem 0' }}>
                <button type="button" className={themeMode === 'light' ? 'cta' : ''} onClick={() => setThemeMode('light')}>
                  Light
                </button>
                <button type="button" className={themeMode === 'dark' ? 'cta' : ''} onClick={() => setThemeMode('dark')}>
                  Dark
                </button>
              </div>
            </AccordionBlock>

            <AccordionBlock title="Background" defaultOpen={false}>
              <div className="inline-actions" style={{ padding: '0.5rem 0' }}>
                <button
                  type="button"
                  className={backgroundTone === 'aura' ? 'cta' : ''}
                  onClick={() => {
                    setBackgroundTone('aura');
                    pushActivity('THEME', 'Background tone set to aura');
                  }}
                >
                  Aura
                </button>
                <button
                  type="button"
                  className={backgroundTone === 'slate' ? 'cta' : ''}
                  onClick={() => {
                    setBackgroundTone('slate');
                    pushActivity('THEME', 'Background tone set to slate');
                  }}
                >
                  Slate
                </button>
                <button
                  type="button"
                  className={backgroundTone === 'black' ? 'cta' : ''}
                  onClick={() => {
                    setBackgroundTone('black');
                    pushActivity('THEME', 'Background tone set to black');
                  }}
                >
                  Pure Black
                </button>
              </div>
            </AccordionBlock>

            <div className="rail-block">
              <p className="muted">Theme Pack</p>
              <div className="rail-links">
                {availablePacks.map((packId) => (
                  <button
                    key={packId}
                    type="button"
                    className={themePack === packId ? 'nav-active' : ''}
                    onClick={() => {
                      setThemePack(packId);
                      pushActivity('THEME', `Pack switched to ${packId}`);
                    }}
                  >
                    {packId}
                  </button>
                ))}
              </div>
            </div>

            <div className="rail-block preview-cards-rail">
              <p className="muted">Preview</p>
              <div className="preview-cards">
                {THEME_CARDS.filter((c) => availablePacks.includes(c.id)).map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`preview-card-rail ${themePack === card.id ? 'active' : ''}`}
                    onClick={() => { setThemePack(card.id); pushActivity('THEME', `Preview clicked ${card.id}`); }}
                  >
                    <div className="preview-card-swatch" style={{ background: card.colors[0] }}>
                      <span className="preview-card-accent" style={{ background: card.colors[1] }} />
                      <span className="preview-card-line" style={{ background: card.colors[2], opacity: 0.3 }} />
                      <span className="preview-card-line short" style={{ background: card.colors[2], opacity: 0.2 }} />
                    </div>
                    <span className="preview-card-name">{card.name}</span>
                    <span className="preview-card-desc">{card.description}</span>
                    <div className="preview-card-bars">
                      {card.colors.map((c) => (
                        <span key={c} className="preview-card-bar" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <button
          type="button"
          className="rail-collapse-toggle"
          onClick={() => setLeftCollapsed(v => !v)}
          title={leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {leftCollapsed ? '▸' : '◂'}
        </button>
      </aside>

      <main id="main-content" className="main-stage" {...withDevTag('main.stage', { area: secondaryView })}>
        <div aria-live="assertive" aria-atomic="true" className="sr-only-alert" role="alert"></div>
        <TopRowSlotProvider>
          <div className="main-top-row">
            {!isDashboard && <Breadcrumbs />}
            <div className="main-top-right">
              {(() => {
                const explanation = VIEW_EXPLANATIONS[secondaryView];
                if (!explanation) return null;
                return (
                  <div className="main-top-info">
                    <PageInfoPopover>{explanation}</PageInfoPopover>
                  </div>
                );
              })()}
              <TopRowSlotHost />
            </div>
          </div>
          <ErrorBoundary message="Something went wrong rendering this view.">
            {renderMainContent()}
          </ErrorBoundary>
        </TopRowSlotProvider>
      </main>

      {devOverlayOpen && (
        <aside className="right-rail" aria-label="Admin and status">
          <h2>Dev Tools</h2>
          <DevOverlay
            healthQuery={healthQuery}
            availableAdapters={availableAdapters}
            analyticsSnapshot={analyticsSnapshot}
            performanceSnapshot={performanceSnapshot}
            onDownloadRuntimeReport={onDownloadRuntimeReport}
          />
        </aside>
      )}

      <ScreenOptions
        activeView={screenOptionsView}
        area={primaryArea}
        isOpen={screenOptionsOpen}
        onToggle={() => {
          setScreenOptionsOpen((v) => {
            if (!v) closeDevOverlay();
            return !v;
          });
        }}
        isBookmarked={bookmarks.some((b) => b.id === `${primaryArea}/${secondaryView}`)}
        onToggleBookmark={() => toggleBookmark(primaryArea, secondaryView)}
        statusLevel={statusLevel}
        isMt5Online={isMt5Online}
        isApiOnline={isApiOnline}
        isDbOnline={isDbOnline}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <ErrorBoundary message="The application encountered a critical error.">
        <Routes>
          <Route path="/research/symbol/:ticker" element={<AppShell />} />
          <Route path="/trading/symbol/:ticker" element={<AppShell />} />
          <Route path="/symbol/:ticker" element={<SymbolRedirect />} />
          <Route path="/settings/data-management" element={<DataManagementPage />} />
          <Route path="/lab/top-movers" element={<TopMoversPage />} />
          <Route path="/settings/health-check" element={<SystemHealthPage />} />
          <Route path="/lab/platform-comparisons" element={<PlatformComparisonsPage />} />
          <Route path="/protocols/symbols-ladder" element={<Navigate to="/scoring/symbols-ladder" replace />} />
          <Route path="/protocols/singles-monitor" element={<Navigate to="/scoring/singles-monitor" replace />} />
          <Route path="/scoring/exit-signals" element={<Navigate to="/trading/exit-signals" replace />} />
          <Route path="/lab/scoring-debug-lab" element={<Navigate to="/lab/dual-protocol-inspector" replace />} />
          <Route path="/lab/meta-stack-explorer" element={<Navigate to="/status/meta-stack-explorer" replace />} />
          <Route path="/lab/meta-stack-pipeline" element={<Navigate to="/status/meta-stack-pipeline" replace />} />
          <Route path="/planner/allocator" element={<Navigate to="/lab/allocator" replace />} />
          <Route path="/status/platform-api-management" element={<Navigate to="/status" replace />} />
          <Route path="/status/audit-log" element={<Navigate to="/status" replace />} />
          <Route path="/status/ai-logs" element={<Navigate to="/status" replace />} />
          <Route path="/lab/metastack-display" element={<Navigate to="/lab/triple-screen" replace />} />
          <Route path="/lab/metastack-performance" element={<Navigate to="/lab" replace />} />
          <Route path="/lab/directive-audit" element={<Navigate to="/lab" replace />} />
          {/* QA area retired 2026-09-03 — QA Checklist moved to Development */}
          <Route path="/qa/:view" element={<Navigate to="/development/qa-testing" replace />} />
          <Route path="/qa" element={<Navigate to="/development/qa-testing" replace />} />
          <Route path="/scoringStrategies/:view" element={<ScoringStrategiesRedirect />} />
          <Route path="/scoringStrategies" element={<Navigate to="/scoring" replace />} />
          <Route path="/:area/:view" element={<AppShell />} />
          <Route path="/:area" element={<AppShell />} />
          <Route path="/" element={<HomeDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <KeyboardShortcutsHelp />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
