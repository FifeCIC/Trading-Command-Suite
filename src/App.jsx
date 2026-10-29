import { useEffect, useState, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analytics, trackAppView } from './analytics';
import Breadcrumbs from './components/Breadcrumbs';
import DevOverlay from './components/DevOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import MarketTape from './components/MarketTape';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';

import { apiGet } from './core/api/client';
import useTradeAttention from './core/use-trade-attention';
import { withDevTag } from './dev-runtime/tags';
import { getPerformanceSnapshot, startPerformanceMonitoring } from './performance/monitor';
import HomeDashboard from './pages/HomeDashboard';
import PluginTabSkeletonPage from './pages/PluginTabSkeletonPage';
// Direct-route pages live behind ONE import surface so the free build can swap them out
// (src/editions/direct-pages.free.jsx — FREE-EDITION-PLAN.md §3/§4). A `null` export means the
// page is premium: the route below is skipped and the page code is absent from the bundle.
import {
  PlatformComparisonsPage,
  DataManagementPage,
  TopMoversPage,
  SystemHealthPage,
} from './core/direct-pages.jsx';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import ScreenOptions from './components/ScreenOptions';
import PageInfoPopover from './components/PageInfoPopover';
import { VIEW_EXPLANATIONS } from './core/view-explanations';
import { TopRowSlotProvider, TopRowSlotHost } from './core/top-row-slot';

import { useNetworkStatus } from './utils/networkStatus';
import { useUiStore } from './stores/useUiStore';
import { useThemeRuntime } from './theme/useThemeRuntime';
// ⚠️ `ai-original.css` WAS imported here and is DELETED (2026-10-12, owner request). It was not a
// theme: it restyled the topbar's padding and stickiness, card padding and radius, table cell
// padding and button min-heights — ~80 STRUCTURAL properties, where `slate.css` declares none and
// `scifi.css` only a decorative dot. A theme may change colour; it may not change structure, and the
// owner measured the difference between packs and asked for it removed. The base `index.css` already
// owns all of it: `.topbar` (L979), `.topbar-area-nav button` (L1062) with the wrap guard at L2505,
// `box-sizing` (L424), and `min-height: 44px` in 11+ places. Deleting this import restores the app's
// own structure under every pack. `slate.css` is the only colour-only pack imported.
import './theme/packs/scifi.css';
import './theme/packs/slate.css';
import { featureFlags } from './utils/featureFlags';
import { NAV_TREE, getNavStructure } from './core/nav-tree';
import { PLUGIN_TAB_SKELETONS } from './pages/plugin-tab-skeletons';
import { VIEW_COMPONENTS } from './core/view-routes.jsx';
// Edition (free spinoff): compile-time flag + nav filtering + view-meta key lookup — the free
// build must never OFFER or RENDER a premium view (FREE-EDITION-PLAN.md §3). In the full build
// everything here is an identity/compile-time constant.
import { filterHiddenViews } from './core/hidden-views.js';
import { useHiddenViews } from './core/hooks/useHiddenViews.js';
// EditionNotice removed 2026-10-28 with the free edition (FREE-EDITION-PLAN.md is superseded).

/**
 * `FULL_EDITION_ONLY` — vestigial, kept only so the call site at the bottom reads unchanged.
 *
 * ⚠️ THERE IS ONE EDITION NOW. The free edition was removed 2026-10-28 (SETTLED-DECISIONS row 96),
 * so this is always `true` and the block it guards always renders. Simplify it when that block is
 * next touched.
 *
 * ⚠️ THE REASONING THAT WAS HERE IS WORTH KEEPING IF A PER-BUILD SPLIT EVER RETURNS. This flag used
 * to be `import.meta.env.VITE_EDITION !== 'free'`, and the reason it was a BUILD-TIME define rather
 * than a runtime helper is that only the define removes the literal from the shipped JavaScript: a
 * runtime "may this be offered?" check leaves the route path readable in the bundle. Measured
 * 2026-09-25, 20 route paths were reaching a free artefact before that was fixed.
 */
// There is ONE edition now — the free edition was removed 2026-10-28. Kept as a named constant
// so the call site at the bottom reads unchanged; simplify it whenever that block is next touched.
const FULL_EDITION_ONLY = true;

// Edition-filtered once at module scope: the free build hides premium views from the sidebar.
// (Full build = identity; see src/core/edition-nav.js.)
// ⚠️ Renamed `..._BY_EDITION` 2026-10-02: AppShell now shadows these with the SAME names after also
// applying the owner's "hide now" verdicts, so every existing consumer inside AppShell picks up both
// filters without touching a call site.
const NAV_STRUCTURE_BY_EDITION = getNavStructure();
// The TOP navigation bar enumerates NAV_TREE directly, so it needs the same filter — measured
// live 2026-09-23: without this, the free build still offered Protocols/Scoring/Signals/Planner/
// Development in the top bar while the sidebar was correctly filtered.
const EDITION_NAV_TREE_BY_EDITION = NAV_TREE;

/**
 * Views the SHELL renders inline, with access to App's own state.
 *
 * ⚠️ Why this list has to exist. These views have no entry in `VIEW_COMPONENTS` — they need parent
 * state, so they cannot be a standalone component — and they have no nav entry either. The redirect
 * guard that salvages an unresolvable route therefore classified them as MISSING and bounced the user
 * to the area's first page, which silently made them unreachable.
 *
 * Measured 2026-09-17: `/settings/support` redirected to `/settings/trading-settings` instead of
 * rendering the support panel.
 *
 * Adding a name here is the correct way to say "the shell handles this one". Adding it to
 * `VIEW_COMPONENTS` is not an option for these.
 */
const INLINE_VIEWS = ['demos', 'use-cases', 'analytics', 'about'];

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

// ⚠️ `slate` is FIRST — it is the default pack, and the list order is what the picker presents as the
// default. `ai-original` was removed 2026-10-12 (owner request) because it carried ~80 structural
// overrides, so the app's geometry silently depended on which pack was active.
// ⚠️ THEME_CARDS MOVED to src/core/theme-cards.js (2026-10-13). The Appearance area's chooser needs
// the same list, and importing it from here would have been a CYCLE — App.jsx imports the chooser.
// Nothing in App.jsx uses it now that the shell rail's pack and preview controls were removed.
// ⚠️ `themePack` / `setThemePack` DO stay: they feed `useThemeRuntime` above.



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
 *
 * ⚠️ `directContent` / `directArea` / `directView` (#1047) — the four LITERAL-route pages
 * (`src/core/direct-pages.jsx`) used to be mounted as BARE ELEMENTS outside this component, so they
 * got no sidebar, no breadcrumb and — because `useThemeRuntime()` runs in here — no theme pack.
 * They now render as the shell's content with the area/view stated, so the chrome and the theme
 * apply. The BUNDLE reason they were split out is untouched: the component is still referenced only
 * when the edition module exports it, so the free build still ships no premium page code.
 */
function AppShell({ directContent = null, directArea = null, directView = null }) {
  // ⚠️ MEMOISED, and it must stay that way. These shadow the module-scope edition-filtered
  // constants, so without a stable reference the NAV_STRUCTURE effect below (the one that
  // redirects an area with no first view) would re-run on every render once it is listed as a
  // dependency — which it now must be, because the value is no longer module-constant.
  const hiddenViews = useHiddenViews();
  const NAV_STRUCTURE = useMemo(
    () => filterHiddenViews(NAV_STRUCTURE_BY_EDITION, hiddenViews),
    [hiddenViews],
  );
  const EDITION_NAV_TREE = useMemo(
    () => filterHiddenViews(EDITION_NAV_TREE_BY_EDITION, hiddenViews),
    [hiddenViews],
  );
  const { area, view, symbolId, ticker, strategyId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const isHomePage = location.pathname === '/';
  // `/trading/symbol/:ticker` renders the symbol page INSIDE the shell chrome.
  const isSymbolRoute = Boolean(ticker);
  // `/trading/strategy/:strategyId` — the per-bot TRUTH VIEW (#864). In the shell chrome like the
  // symbol routes, but pinned to the trading area rather than derived, because the path already
  // says which area it belongs to.
  const isStrategyRoute = Boolean(strategyId);
  // Symbol routes use literal prefixes (research/symbol, trading/symbol) so the
  // `area` param is undefined — derive the sidebar area from the pathname.
  const symbolArea = location.pathname.startsWith('/research/symbol/') ? 'research'
    : location.pathname.startsWith('/trading/symbol/') ? 'trading'
    : 'trading';
  const primaryArea = directArea ?? (isStrategyRoute ? 'trading' : (isSymbolRoute ? symbolArea : (symbolId ? 'research' : (isHomePage ? null : (area || 'trading')))));
  // defaultView: the first REAL view for the current area.
  //
  // ⚠️ NOT `areaViews[0]`. A `kind: 'section-header'` entry is a LABEL with an `id` (used as a
  // React key) but NO PAGE, so taking index 0 produced `/settings/settings-layers` — a header id —
  // which resolved to no component and rendered the shell's fallback. Settings is the first area to
  // OPEN with a header (#617), which is what exposed this; every other area happened to start with a
  // real page.
  const areaViews = NAV_STRUCTURE[primaryArea];
  const defaultView = areaViews?.find((item) => item.kind !== 'section-header' && item.id)?.id
    || 'directives-registry';
  const secondaryView = isStrategyRoute ? 'strategy-detail' : (isSymbolRoute ? 'symbol' : (symbolId ? 'symbol-detail' : (view || defaultView)));
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
      'mt5-trading': 'mt5-trading',
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

  // ── Browser notification when algo trading is not active (owner request, 2026-09-27) ──
  //
  // ⚠️ THE BACKSTOP, NOT THE PRIMARY CHANNEL: this only fires while a tab is open, which is
  // exactly the situation `trade-disabled` usually is NOT in. The Windows toast raised from the
  // BACKEND — through `NotificationService` → `WindowsChannel` — is the one that reaches an absent
  // owner. Mounted at the shell so it watches globally rather than only on a page that happens to
  // show the MT5 state.
  //
  // Reads `GET /api`, which already carries `anyTradeAllowed` (#972/#1010) — it computes nothing
  // new and is not a second poller of the trading path.
  useTradeAttention();

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
    // ⚠️ A section header SATISFIES `item.id === secondaryView`, so testing `id` alone treats a
    // header route as a real view and the redirect below NEVER fires — which is how
    // `/settings/settings-layers` stayed broken while this guard looked correct. Headers must not
    // count as "the current view exists".
    const hasCurrentView = views.some((item) => item.id === secondaryView && item.kind !== 'section-header')
      || INLINE_VIEWS.includes(secondaryView);
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
  }, [primaryArea, secondaryView, navigate, NAV_STRUCTURE]);

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
    // ⚠️ `views[0]?.id` is WRONG when an area opens with a section header. A header is a label with
    // an id but no page, so clicking "Settings" navigated to `/settings/settings-layers` and the user
    // landed on the shell's fallback instead of a settings page. Land on the first REAL view.
    const firstView = views.find((item) => item.kind !== 'section-header' && item.id)?.id || 'overview';
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
    // ── Edition guard — the decision now lives in the LAST RESORT branch at the bottom ──
    // ⚠️ The free build deliberately carries NO list of premium routes (2026-09-23). The first
    // version of this guard asked `getViewMetaKey()` whether the path was a known premium view —
    // which meant the free bundle had to ship every premium path to answer the question. Measured:
    // all 95 premium paths appeared as string literals in dist-free/assets/index-*.js. The map is
    // the thing the free edition must not contain, so the guard moved to where "no page" is
    // decided. Deliberate consequence: in the free build a typo'd URL and a premium URL read the
    // same, because telling them apart is exactly what the removed list was for.

    // ── DIRECT-ROUTE PAGES (#1047) — render inside the chrome, not beside it ──
    // The element is passed in from the route so the edition swap keeps working: in the free build
    // `direct-pages.free.jsx` exports `null`, the route is not declared at all, and this branch is
    // never reached. Nothing premium is referenced from here.
    if (directContent) return directContent;

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

    // ⚠️ LAST RESORT — an honest dead end, NOT a sponsorship panel.
    //
    // This `return` used to BE the support panel, so it fired for EVERY unresolved view. A route that
    // exists in the nav but has no page — such as `/settings/settings-layers`, which is a
    // section-header id — therefore rendered "Support Trading Command Suite" with a donation button.
    // That failure mode is bad three times over: the user is told the app is broken AND asked for
    // money, the real cause stays invisible, and a missing page looks exactly like a deliberate one.
    //
    // The support panel was DELETED 2026-09-17 (owner decision). It had no route of its own and was
    // reachable only as this fallback, so it was never a page — it was a disguised error state.
    //
    // Reaching here means `VIEW_COMPONENTS[secondaryView]`, `PLUGIN_TAB_SKELETONS[secondaryView]` and
    // every inline branch above all missed.
    //
    // FREE BUILD: that is the edition guard. Nothing in this bundle knows which routes are premium
    // (see the note at the top of renderMainContent), so "no page here" IS the not-in-this-edition
    // answer — say so plainly rather than naming a nav entry, which would be false for a URL the
    // free edition never had.
    // The premium-view notice is gone with the free edition (2026-10-28): every route is allowed.

    // Say that, and NAME the view so it is reportable.
    return (
      <section className="intro-panel">
        <h2>This view has no page</h2>
        <p>
          <code>{secondaryView}</code> is registered in the navigation but has no view component, so
          there is nothing to render here.
        </p>
        <p>
          If you arrived from the sidebar, the nav entry is at fault: it is either a section heading
          (a label with an id but no page) or a view that was never built.
        </p>
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
            {Object.entries(EDITION_NAV_TREE)
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
            {Object.entries(EDITION_NAV_TREE)
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
            {Object.entries(EDITION_NAV_TREE)
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
            {/* ⚠️ THEME MODE / THEME PACK / PREVIEW REMOVED HERE (2026-10-13, owner request).
                ⚠️ These were SHELL CHROME — they rendered whenever Screen Options was open, which is
                why they appeared to live on /settings/trading-settings when they were not part of
                that page at all. Theme pack selection moves to the new Appearance area.
                ⚠️ "Background" is deliberately KEPT: the owner listed Theme Mode, Theme Pack and
                Preview, and not this. Do not "finish the job" by removing it. */}
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

            {/* ⚠️ The Preview cards rail-block was removed here too (2026-10-13) — it was the third of
                the three the owner listed. Its pack chooser now lives in the Appearance area, so
                keeping it would have left two controls for one setting. */}
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
          {/* #864 — the per-bot truth view. Declared with the OTHER literal-prefix routes rather
              than left to `/:area/:view`, which matches two segments and would not reach it. */}
          <Route path="/trading/strategy/:strategyId" element={<AppShell />} />
          <Route path="/symbol/:ticker" element={<SymbolRedirect />} />
          {/* Direct-route pages — guarded by `null` in the free build (src/core/direct-pages.jsx).
              ⚠️ #1047 — rendered AS THE SHELL'S CONTENT, not as bare elements: mounted outside
              `AppShell` they had no menu, no sidebar and no theme pack, because `useThemeRuntime()`
              runs inside the shell. `directArea`/`directView` give the sidebar and breadcrumb the
              right context; the `&&` guards are what keep the free bundle free of premium code. */}
          {DataManagementPage && <Route path="/settings/data-management" element={<AppShell directArea="settings" directView="data-management" directContent={<DataManagementPage />} />} />}
          {TopMoversPage && <Route path="/lab/top-movers" element={<AppShell directArea="lab" directView="top-movers" directContent={<TopMoversPage />} />} />}
          {SystemHealthPage && <Route path="/settings/health-check" element={<AppShell directArea="settings" directView="health-check" directContent={<SystemHealthPage />} />} />}
          {PlatformComparisonsPage && <Route path="/lab/platform-comparisons" element={<AppShell directArea="lab" directView="platform-comparisons" directContent={<PlatformComparisonsPage />} />} />}
          {/* ⚠️ §9.14 — every redirect in this block lands on a PREMIUM view, so the free build
              omits the route entirely. Two things are avoided by omitting rather than retargeting:
              the premium path would otherwise ship as a string literal in the free bundle, and a
              free user following an old bookmark would be sent to a page that is not there. The
              free build falls through to the edition guard instead, which is the designed reply.
              The flag folds at build time — see FULL_EDITION_ONLY at the top of this file. */}
          {FULL_EDITION_ONLY && (
            <>
              <Route path="/protocols/symbols-ladder" element={<Navigate to="/scoring/symbols-ladder" replace />} />
              {/* ⚠️ APPEARANCE AREA MOVES (2026-10-13, owner request). The three views below moved
                  into the new Appearance area, and the Theme Packs page was retired into its chooser.
                  These redirects exist so a link, a bookmark or a handoff written BEFORE the move
                  still lands somewhere correct — removing a route without one produces a blank view
                  that reads as a broken build rather than as a move. */}
              <Route path="/settings/appearance" element={<Navigate to="/appearance/appearance" replace />} />
              <Route path="/settings/screen-assignment" element={<Navigate to="/appearance/screen-assignment" replace />} />
              <Route path="/development/responsive-layout-lab" element={<Navigate to="/appearance/responsive-layout-lab" replace />} />
              <Route path="/settings/theme-packs" element={<Navigate to="/appearance/layout-guide" replace />} />
              {/* Theme Lab retired 2026-10-13 (owner request). Its sections became the Appearance
                  element groups; this redirect keeps `/development/theme-lab` resolving rather than
                  showing a blank view to anyone following an older link or handoff. */}
              <Route path="/development/theme-lab" element={<Navigate to="/appearance/layout-guide" replace />} />
              <Route path="/protocols/singles-monitor" element={<Navigate to="/scoring/singles-monitor" replace />} />
              {/* ⚠️ PHANTOM VIEW-META ENTRIES REMOVED 2026-10-15 — these five paths had a view-meta entry
                  but no route, because routes are generated from the NAV TREE and the nav moved these
                  views to /protocols ("Fully migrated from legacy /scoring/ area", nav-tree.js). The
                  entries were a phantom: no route, but a row in the Page Walkthrough — which is how the
                  owner came to score five non-existent pages 1/10.
                  ⚠️ DIRECTION IS PER VIEW, and these five went protocols-ward while symbols-ladder and
                  singles-monitor (above) went scoring-ward. The nav tree decides, not a neighbouring
                  redirect — reading one case backwards is how an agent would re-open this. */}
              <Route path="/scoring/directives-registry" element={<Navigate to="/protocols/directives-registry" replace />} />
              <Route path="/scoring/protocols-ladder" element={<Navigate to="/protocols/protocols-ladder" replace />} />
              <Route path="/scoring/protocol-builder" element={<Navigate to="/protocols/protocol-builder" replace />} />
              <Route path="/scoring/sees-arena" element={<Navigate to="/protocols/sees-arena" replace />} />
              <Route path="/lab/dual-protocol-inspector" element={<Navigate to="/protocols/dual-protocol-inspector" replace />} />
              <Route path="/scoring/exit-signals" element={<Navigate to="/trading/exit-signals" replace />} />
              {/* ⚠️ TARGET CORRECTED 2026-10-15. This pointed at `/lab/dual-protocol-inspector`, which is
                  not a route — the nav routes that view at `/protocols/dual-protocol-inspector`. A
                  redirect to a dead path is worse than no redirect: it looks handled while landing the
                  user on the catch-all. */}
              <Route path="/lab/scoring-debug-lab" element={<Navigate to="/protocols/dual-protocol-inspector" replace />} />
              <Route path="/lab/meta-stack-explorer" element={<Navigate to="/status/meta-stack-explorer" replace />} />
              {/* ⚠️ This redirected to /status/meta-stack-pipeline, which was MERGED into this lab
                  (2026-10-08). The old URL now lands on the graph itself rather than 404ing — a
                  bookmark or a link in an older issue keeps working. */}
              <Route path="/lab/meta-stack-pipeline" element={<Navigate to="/development/pipeline-graph-lab" replace />} />
              {/* `/planner/allocator` → `/lab/allocator` REMOVED 2026-10-01. The allocator view was
                  deleted at the owner's direction in the Page Walkthrough ("delete unless you think
                  there is value" — read: it survives as the Portfolio Assistant). A redirect to a
                  route that no longer exists is a 404 with extra steps. */}
              <Route path="/qa/:view" element={<Navigate to="/development/qa-testing" replace />} />
              <Route path="/qa" element={<Navigate to="/development/qa-testing" replace />} />
              {/* `/trading/trading-strategies` RETIRED 2026-09-23 (owner, option A): its table +
                  sticky sidebar layout moved to /trading/trading-bots, so this is a REDIRECT rather
                  than a deletion. A retired route with no redirect is a 404 for every bookmark,
                  every doc link and every QA procedure that names it - and paths are cheap, dead
                  links are not. Premium-only, because its destination is premium. */}
              <Route path="/trading/trading-strategies" element={<Navigate to="/trading/trading-bots" replace />} />
              {/* These two redirect only to FREE destinations, so the reason to gate them is not the
                  destination — it is the SOURCE path: `/lab/metastack-*` names the system, and per
                  §14.2.1 the NAME is part of the asset. An old bookmark falls through to the
                  edition guard instead, which is the designed reply. */}
              <Route path="/lab/metastack-display" element={<Navigate to="/lab/triple-screen" replace />} />
              <Route path="/lab/metastack-performance" element={<Navigate to="/lab" replace />} />
            </>
          )}
          <Route path="/status/platform-api-management" element={<Navigate to="/status" replace />} />
          <Route path="/status/audit-log" element={<Navigate to="/status" replace />} />
          <Route path="/status/ai-logs" element={<Navigate to="/status" replace />} />
          <Route path="/lab/directive-audit" element={<Navigate to="/lab" replace />} />
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
