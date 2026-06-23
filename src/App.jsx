import { useEffect, useState, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analytics, trackAppView, trackSupportClick } from './analytics';
import Breadcrumbs from './components/Breadcrumbs';
import DevOverlay from './components/DevOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import HealthStatusBar from './components/HealthStatusBar';
import { apiGet } from './core/api/client';
import { FEATURE_FLAGS } from './core/features/flags';
import { withDevTag } from './dev-runtime/tags';
import { getPerformanceSnapshot, startPerformanceMonitoring } from './performance/monitor';
import ArchitectureFrameworkPage from './pages/ArchitectureFrameworkPage';
import HomeDashboard from './pages/HomeDashboard';
import BacktestPage from './pages/BacktestPage';
import MultiStrategyComparisonPage from './pages/MultiStrategyComparisonPage';
import ScenarioAnalysisPage from './pages/ScenarioAnalysisPage';
import FaqPage from './pages/FaqPage';
import PortfolioPage from './pages/PortfolioPage';
import Mt5TradingPage from './pages/Mt5TradingPage';
import TradeHistoryPage from './pages/TradeHistoryPage';
import TradeJournalPage from './pages/TradeJournalPage';
import TradingPlansPage from './pages/TradingPlansPage';
import ProtocolsPage from './pages/ProtocolsPage';
import ReportsPage from './pages/ReportsPage';
import ActiveSymbolsPage from './pages/ActiveSymbolsPage';
import AddSymbolPage from './pages/AddSymbolPage';
import ApiActivityPage from './pages/ApiActivityPage';
import ApiEndpointsPage from './pages/ApiEndpointsPage';
import DatabaseTablesPage from './pages/DatabaseTablesPage';
import DataAreaLandingPage from './pages/DataAreaLandingPage';
import DiagramsPage from './pages/DiagramsPage';
import DataStatusPage from './pages/DataStatusPage';
import DataElementsPage from './pages/DataElementsPage';
import DirectivesManagerPage from './pages/DirectivesManagerPage';
import DirectivesStatusPage from './pages/DirectivesStatusPage';
import DirectivesConfigPage from './pages/DirectivesConfigPage';
import ScoringOverviewPage from './pages/ScoringOverviewPage';
import ScoringRunsPage from './pages/ScoringRunsPage';
import ScoringActivityLogsPage from './pages/ScoringActivityLogsPage';
import EventsCalendarPage from './pages/EventsCalendarPage';
import ExecutionQueuePage from './pages/ExecutionQueuePage';
import ImportJobsPage from './pages/ImportJobsPage';
import Mt5StatusPage from './pages/Mt5StatusPage';
import NewsIntelPage from './pages/NewsIntelPage';
import PlatformComparisonsPage from './pages/PlatformComparisonsPage';
import PluginTabSkeletonPage from './pages/PluginTabSkeletonPage';
import TradingStrategiesPage from './pages/TradingStrategiesPage';
import RiskControlsPage from './pages/RiskControlsPage';
import HomeDashboardPage from './pages/HomeDashboardPage';
import CacheMonitorPage from './pages/CacheMonitorPage';
import SeesLiveStackMockPage from './pages/SeesLiveStackMockPage';
import SeesAdvancedPage from './pages/SeesAdvancedPage';
import SeesArenaPage from './pages/SeesArenaPage';
import AlgorithmLabPage from './pages/AlgorithmLabPage';
import PerformanceLabPage from './pages/PerformanceLabPage';
import AlertCenterPage from './pages/AlertCenterPage';
import AutomationDashboardPage from './pages/AutomationDashboardPage';
import AutomationRulesPage from './pages/AutomationRulesPage';
import SetupWizardPage from './pages/SetupWizardPage';
import ServerControlsPage from './pages/ServerControlsPage';
import ChartComparisonPage from './pages/ChartComparisonPage';
import AnalyseSymbolPage from './pages/AnalyseSymbolPage';
import Mt5ConnectionManagerPage from './pages/Mt5ConnectionManagerPage';
import AccountsDashboardPage from './pages/AccountsDashboardPage';
import OrderTestingPage from './pages/OrderTestingPage';
import PredictiveSeesPage from './pages/PredictiveSeesPage';
import FluffDetectorPage from './pages/FluffDetectorPage';
import TradingTimelinePage from './pages/TradingTimelinePage';
import SignalsWorkbenchPage from './pages/SignalsWorkbenchPage';
import SettingsPage from './pages/SettingsPage';
import StrategiesPage from './pages/StrategiesPage';
import ProtocolsOverviewPage from './pages/ProtocolsOverviewPage';
import StrategyBuilderPage from './pages/StrategyBuilderPage';
import StrategyWizardPage from './pages/StrategyWizardPage';
import SymbolsBrowserPage from './pages/SymbolsBrowserPage';
import SymbolDetailPage from './pages/SymbolDetailPage';
import SpeedTradingPage from './pages/SpeedTradingPage';
import SnapshotLibraryPage from './pages/SnapshotLibraryPage';
import CalculatorsPage from './pages/CalculatorsPage';
import SystemStatusPage from './pages/SystemStatusPage';
import SystemLogPage from './pages/SystemLogPage';
import TrainingCandlePatternsPage from './pages/TrainingCandlePatternsPage';
import CandlePatternsGuidePage from './pages/CandlePatternsGuidePage';
import ThemePage from './pages/ThemePage';
import ThemeLabPage from './pages/ThemeLabPage';
import ThemeLabMotion from './pages/ThemeLabMotion';
import ThemeLabTransitions from './pages/ThemeLabTransitions';
import ThemeLabContainer from './pages/ThemeLabContainer';
import ThemeLabScroll from './pages/ThemeLabScroll';
import ThemeLabPopover from './pages/ThemeLabPopover';
import ComponentLabPage from './pages/ComponentLabPage';
import FeatureLabPage from './pages/FeatureLabPage';
import LabLandingPage from './pages/LabLandingPage';
import LabPage from './pages/LabPage';
import SnapshotReplayPage from './pages/SnapshotReplayPage';
import SocialNetworksPage from './pages/SocialNetworksPage';
import SupportResistancePage from './pages/SupportResistancePage';
import VolatilityAnalysisPage from './pages/VolatilityAnalysisPage';
import TechnicalIndicatorsPage from './pages/TechnicalIndicatorsPage';
import PatternScannerPage from './pages/PatternScannerPage';
import MacroMonitorPage from './pages/MacroMonitorPage';
import EarningsCalendarPage from './pages/EarningsCalendarPage';
import PriceForecastPage from './pages/PriceForecastPage';
import SectorRotationPage from './pages/SectorRotationPage';
import MarketCorrelationsPage from './pages/MarketCorrelationsPage';
import CapabilityMapPage from './pages/CapabilityMapPage';
import SourcesPage from './pages/SourcesPage';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import ApiOfflineBanner from './components/ApiOfflineBanner';
import { useNetworkStatus } from './utils/networkStatus';
import { useUiStore } from './stores/useUiStore';
import { useThemeRuntime } from './theme/useThemeRuntime';
import './theme/packs/ai-original.css';
import './theme/packs/scifi.css';
import { featureFlags } from './utils/featureFlags';
import { NAV_TREE, PRIMARY_PAGES, QUICK_MENU, getNavStructure } from './core/nav-tree';
import { PLUGIN_TAB_SKELETONS } from './pages/plugin-tab-skeletons';

const NAV_STRUCTURE = getNavStructure();

const THEME_CARDS = [
  { id: 'ai-original', name: 'AI Original', description: 'Dark navy, blue accent — doomchart inspired.', colors: ['#0a0e17', '#5b8def', '#e6ecf7'] },
  { id: 'core', name: 'Core', description: 'Clean, neutral palette.', colors: ['#f4f7fb', '#0ea5a6', '#0f172a'] },
  { id: 'oceanic', name: 'Oceanic', description: 'Deep blue with teal.', colors: ['#0f1b2e', '#00d9ff', '#d6e8ff'] },
  { id: 'scifi', name: 'Sci-Fi', description: 'Dark navy, cyan neon.', colors: ['#0a1428', '#00d9ff', '#c1d0e0'] },
  { id: 'terminal', name: 'Terminal', description: 'Black, neon green.', colors: ['#0a0a0a', '#00ff41', '#e0e0e0'] },
  { id: 'void', name: 'Void', description: 'Black, neon purple.', colors: ['#08080d', '#8a50ff', '#d4d0e8'] },
];



function BadgePill({ label, status = 'neutral' }) {
  return <span className={`badge-pill badge-${status}`}>{label}</span>;
}

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

function AppShell() {
  const { area, view, symbolId } = useParams();
  const navigate = useNavigate();
  
  const primaryArea = symbolId ? 'research' : (area || 'trading');
  const secondaryView = symbolId ? 'symbol-detail' : (view || 'sees-live-stack');
  const [demoPrompt, setDemoPrompt] = useState('Generate a responsive planning concept for eco garden week.');
  const [demoOutput, setDemoOutput] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [ffState, setFfState] = useState(() => featureFlags.getFlags());


  const toggleDevOverlay = useUiStore((state) => state.toggleDevOverlay);
  const devOverlayOpen = useUiStore((state) => state.devOverlayOpen);
  const themeMode = useUiStore((state) => state.themeMode);
  const themePack = useUiStore((state) => state.themePack);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const setThemePack = useUiStore((state) => state.setThemePack);
  const backgroundTone = useUiStore((state) => state.backgroundTone);
  const setBackgroundTone = useUiStore((state) => state.setBackgroundTone);
  const showNavIcons = useUiStore((state) => state.showNavIcons);
  const bookmarks = useUiStore((state) => state.bookmarks || []);
  const toggleBookmark = useUiStore((state) => state.toggleBookmark);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { adapters, meta } = useThemeRuntime({ mode: themeMode, packId: themePack });
  const availablePacks = Array.isArray(meta?.availablePacks) ? meta.availablePacks : [];
  const availableAdapters = Array.isArray(meta?.availableAdapters) ? meta.availableAdapters : [];
  const diagnostics = Array.isArray(meta?.diagnostics) ? meta.diagnostics : [];
  const policyMeta = meta?.policy || {};
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState(() => analytics.getSnapshot());
  const [performanceSnapshot, setPerformanceSnapshot] = useState(() => getPerformanceSnapshot());

  const { isOnline, wasOffline, lastOnlineAt } = useNetworkStatus();

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version')
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
    if (!hasCurrentView) {
      const firstView = views[0]?.id;
      if (firstView) {
        navigate(`/${primaryArea}/${firstView}`, { replace: true });
      }
    }
    pushActivity('NAV', `Primary changed to ${primaryArea}`);
  }, [primaryArea, secondaryView, navigate]);

  useEffect(() => {
    document.documentElement.setAttribute('data-bg-tone', backgroundTone);
  }, [backgroundTone]);

  useEffect(() => {
    return featureFlags.subscribe(setFfState);
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
    if (secondaryView === 'overview') {
      return <HomeDashboardPage />;
    }

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

    if (secondaryView === 'component-lab') {
      return <ComponentLabPage />;
    }

    if (secondaryView === 'theme-lab') {
      return <ThemeLabPage />;
    }

    if (secondaryView === 'theme-lab-motion') {
      return <ThemeLabMotion />;
    }

    if (secondaryView === 'theme-lab-transitions') {
      return <ThemeLabTransitions />;
    }

    if (secondaryView === 'theme-lab-container') {
      return <ThemeLabContainer />;
    }

    if (secondaryView === 'theme-lab-scroll') {
      return <ThemeLabScroll />;
    }

    if (secondaryView === 'theme-lab-popover') {
      return <ThemeLabPopover />;
    }

    if (secondaryView === 'server-controls') {
      return <ServerControlsPage />;
    }

    if (secondaryView === 'sees-live-stack') {
      return <SeesLiveStackMockPage />;
    }

    if (secondaryView === 'sees-arena') {
      return <SeesArenaPage />;
    }

    if (secondaryView === 'sees-advanced') {
      return <SeesAdvancedPage />;
    }

    if (secondaryView === 'backtest') {
      return <BacktestPage />;
    }

    if (secondaryView === 'strategies-compare') {
      return <MultiStrategyComparisonPage />;
    }

    if (secondaryView === 'scenario-analysis') {
      return <ScenarioAnalysisPage />;
    }

    if (secondaryView === 'portfolio-overview') {
      return <PortfolioPage />;
    }

    if (secondaryView === 'trade-history') {
      return <TradeHistoryPage />;
    }

    if (secondaryView === 'trade-journal') {
      return <TradeJournalPage />;
    }

    if (secondaryView === 'speed-trading') {
      return <SpeedTradingPage />;
    }

    if (secondaryView === 'trading-plans') {
      return <TradingPlansPage />;
    }

    if (secondaryView === 'protocols') {
      return <ProtocolsPage />;
    }

    if (secondaryView === 'reports') {
      return <ReportsPage />;
    }

    if (secondaryView === 'diagrams') {
      return <DiagramsPage />;
    }

    if (secondaryView === 'architecture-framework') {
      return <ArchitectureFrameworkPage />;
    }

    if (secondaryView === 'status') {
      return <SystemStatusPage />;
    }

    if (secondaryView === 'system-log') {
      return <SystemLogPage />;
    }

    if (secondaryView === 'setup') {
      return <SetupWizardPage />;
    }

    if (secondaryView === 'capability-map') {
      return <CapabilityMapPage />;
    }

    if (secondaryView === 'faq') {
      return <FaqPage />;
    }

    if (secondaryView === 'settings') {
      return <SettingsPage />;
    }

    if (secondaryView === 'calculators') {
      return <CalculatorsPage />;
    }
    if (secondaryView === 'snapshots') {
      return <SnapshotLibraryPage />;
    }
    if (secondaryView === 'snapshot-replay') {
      return <SnapshotReplayPage />;
    }
    if (secondaryView === 'symbols-browser') {
      return <SymbolsBrowserPage />;
    }

    if (secondaryView === 'symbol-detail') {
      return <SymbolDetailPage />;
    }

    if (secondaryView === 'active-symbols') {
      return <ActiveSymbolsPage />;
    }

    if (secondaryView === 'add-symbol') {
      return <AddSymbolPage />;
    }

    if (secondaryView === 'directives-manager') {
      return <DirectivesManagerPage />;
    }

    if (secondaryView === 'directives-status') {
      return <DirectivesStatusPage />;
    }

    if (secondaryView === 'configure-directives') {
      return <DirectivesConfigPage />;
    }

    if (secondaryView === 'algorithm-lab') {
      return <AlgorithmLabPage />;
    }

    if (secondaryView === 'scoring-overview') {
      return <ScoringOverviewPage />;
    }

    if (secondaryView === 'data-landing') {
      return <DataAreaLandingPage />;
    }

    if (secondaryView === 'database-tables') {
      return <DatabaseTablesPage />;
    }

    if (secondaryView === 'data-status') {
      return <DataStatusPage />;
    }

    if (secondaryView === 'data-elements') {
      return <DataElementsPage />;
    }

    if (secondaryView === 'transient-caches') {
      return <CacheMonitorPage />;
    }

    if (secondaryView === 'theme-packs') {
      return <ThemePage />;
    }

    if (secondaryView === 'import-jobs') {
      return <ImportJobsPage />;
    }

    if (secondaryView === 'mt5-trading') {
      return <Mt5TradingPage />;
    }

    if (secondaryView === 'mt5-status') {
      return <Mt5StatusPage />;
    }

    if (secondaryView === 'sources') {
      return <SourcesPage />;
    }

    if (secondaryView === 'api-activity') {
      return <ApiActivityPage />;
    }

    if (secondaryView === 'api-endpoints') {
      return <ApiEndpointsPage />;
    }

    if (secondaryView === 'provider-health') {
      return <SourcesPage />;
    }

    if (secondaryView === 'platform-comparisons') {
      return <PlatformComparisonsPage />;
    }

    if (secondaryView === 'news-intel') {
      return <NewsIntelPage />;
    }

    if (secondaryView === 'events-calendar') {
      return <EventsCalendarPage />;
    }

    if (secondaryView === 'social-networks') {
      return <SocialNetworksPage />;
    }

    if (secondaryView === 'scoring-runs') {
      return <ScoringRunsPage />;
    }

    if (secondaryView === 'scoring-activity-logs') {
      return <ScoringActivityLogsPage />;
    }

    if (secondaryView === 'protocol-overview') {
      return <ProtocolsOverviewPage />;
    }

    if (secondaryView === 'signals-workbench') {
      return <SignalsWorkbenchPage />;
    }

    if (secondaryView === 'create-protocols') {
      return <StrategyBuilderPage />;
    }

    if (secondaryView === 'strategy-wizard') {
      return <StrategyWizardPage />;
    }

    if (secondaryView === 'risk-controls') {
      return <RiskControlsPage />;
    }

    if (secondaryView === 'automation-dashboard') {
      return <AutomationDashboardPage />;
    }

    if (secondaryView === 'automation-rules') {
      return <AutomationRulesPage />;
    }

    if (secondaryView === 'execution-queue') {
      return <ExecutionQueuePage />;
    }

    if (secondaryView === 'alert-center') {
      return <AlertCenterPage />;
    }

    if (secondaryView === 'candle-patterns') {
      return <TrainingCandlePatternsPage />;
    }

    if (secondaryView === 'candle-patterns-guide') {
      return <CandlePatternsGuidePage />;
    }

    if (secondaryView === 'mt5-demo-trading') {
      return <Mt5TradingPage />;
    }

    if (secondaryView === 'lab-landing') {
      return <LabLandingPage />;
    }

    if (secondaryView === 'lab') {
      return <LabPage />;
    }

    if (secondaryView === 'feature-lab') {
      return <FeatureLabPage />;
    }

    if (secondaryView === 'performance-lab') {
      return <PerformanceLabPage />;
    }

    if (secondaryView === 'support-resistance') {
      return <SupportResistancePage />;
    }

    if (secondaryView === 'volatility-analysis') {
      return <VolatilityAnalysisPage />;
    }

    if (secondaryView === 'technical-indicators') {
      return <TechnicalIndicatorsPage />;
    }

    if (secondaryView === 'pattern-scanner') {
      return <PatternScannerPage />;
    }

    if (secondaryView === 'macro-monitor') {
      return <MacroMonitorPage />;
    }

    if (secondaryView === 'earnings-calendar') {
      return <EarningsCalendarPage />;
    }

    if (secondaryView === 'price-forecast') {
      return <PriceForecastPage />;
    }

    if (secondaryView === 'sector-rotation') {
      return <SectorRotationPage />;
    }

    if (secondaryView === 'market-correlations') {
      return <MarketCorrelationsPage />;
    }

    if (secondaryView === 'chart-comparison') {
      return <ChartComparisonPage />;
    }

    if (secondaryView === 'analyse-symbol') {
      return <AnalyseSymbolPage />;
    }

    if (secondaryView === 'mt5-connection-manager') {
      return <Mt5ConnectionManagerPage />;
    }

    if (secondaryView === 'accounts-dashboard') {
      return <AccountsDashboardPage />;
    }

    if (secondaryView === 'order-testing') {
      return <OrderTestingPage />;
    }

    if (secondaryView === 'timeline') {
      return <TradingTimelinePage />;
    }

    if (secondaryView === 'trading-strategies') {
      return <TradingStrategiesPage />;
    }
    if (PLUGIN_TAB_SKELETONS[secondaryView]) {
      return <PluginTabSkeletonPage tabId={secondaryView} />;
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

    if (secondaryView === 'security') {
      return (
        <div className="content-grid">
          <ContentCard title="Security Controls">
            <ul>
              <li>Theme allowlist policy and fail-closed enforcement.</li>
              <li>Analytics endpoint restrictions (https or localhost only).</li>
              <li>Sanitized event payloads and bounded local queue.</li>
            </ul>
          </ContentCard>
          <ContentCard title="Governance Intent">
            <p>
              Production builds should enforce approved module sets and reject unknown extensions by default.
            </p>
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

    if (secondaryView === 'roadmap') {
      return (
        <div className="content-grid">
          <ContentCard title="Near-Term">
            <ul>
              <li>Plugin registry tooling and module validation pipeline.</li>
              <li>Central analytics collector integration.</li>
              <li>Expanded sci-fi component kit and templates.</li>
            </ul>
          </ContentCard>
          <ContentCard title="Long-Term">
            <ul>
              <li>Cross-app federation for intranet-wide observability.</li>
              <li>Adaptive runtime profiles by deployment type.</li>
              <li>Premium tooling services and implementation support.</li>
            </ul>
          </ContentCard>
        </div>
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
  return (
    <div className={`site-shell layout-omni background-${backgroundTone}${devOverlayOpen ? '' : ' right-rail-hidden'}`} {...withDevTag('app.shell', { product: 'tradingcs' })}>
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
          <div className="topbar-logo-block">
            <button type="button" className="topbar-logo-btn" onClick={() => navigate('/')} title="Home">
              <img src="/tcs-logo.png" alt="Trading Command Suite" className="topbar-logo" />
            </button>
          </div>

          <div className="topbar-title-block">
            <p className="eyebrow">Trading Command Suite</p>
            <h1>{(NAV_STRUCTURE[primaryArea] || []).find((v) => v.id === secondaryView)?.label || secondaryView}</h1>
            <nav className="quick-menu-row" aria-label="Quick navigation">
              {QUICK_MENU.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={primaryArea === item.id ? 'nav-active' : ''}
                  onClick={() => onPrimarySelect(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

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
            {isApiOnline ? (
              <BadgePill label="API Online" status="ok" />
            ) : (
              <ApiOfflineBanner compact />
            )}
            <BadgePill label={isDbOnline ? 'DB Ready' : 'DB Offline'} status={isDbOnline ? 'ok' : 'warn'} />
            <BadgePill label="Omni Layout" status="neutral" />
            <HealthStatusBar />
          </div>
        </div>

      </header>

      {/* ── Bookmark Bar ── */}
      {bookmarks.length > 0 && (
        <nav className="bookmark-bar" aria-label="Bookmarked pages">
          {bookmarks.slice(0, 12).map((bm) => {
            const areaLabel = NAV_TREE[bm.area]?.label || bm.area;
            const viewLabel = NAV_STRUCTURE[bm.area]?.find((v) => v.id === bm.view)?.label || bm.view;
            return (
              <button
                key={bm.id}
                type="button"
                className={`bookmark-btn${primaryArea === bm.area && secondaryView === bm.view ? ' bookmark-active' : ''}`}
                onClick={() => navigate(`/${bm.area}/${bm.view}`)}
                title={`${areaLabel} › ${viewLabel}`}
              >
                ⭐ {viewLabel}
              </button>
            );
          })}
        </nav>
      )}

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
          ))}
        </div>

        <div className="rail-block">
          <button
            type="button"
            className={devOverlayOpen ? 'cta' : ''}
            onClick={() => {
              toggleDevOverlay();
              pushActivity('RUNTIME', 'Toggled dev overlay');
            }}
            style={{ padding: '0.4rem 0.7rem', fontSize: '0.82rem', width: '100%' }}
          >
            {devOverlayOpen ? 'Hide' : 'Show'} Dev Overlay
          </button>
          <DevOverlay
            healthQuery={healthQuery}
            availableAdapters={availableAdapters}
            analyticsSnapshot={analyticsSnapshot}
            performanceSnapshot={performanceSnapshot}
            onDownloadRuntimeReport={onDownloadRuntimeReport}
          />
        </div>

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
      </aside>

      <main className="main-stage" {...withDevTag('main.stage', { area: secondaryView })}>
        <div className="main-top-row">
          <Breadcrumbs />
          <button
            type="button"
            className={`star-toggle${bookmarks.some((b) => b.id === `${primaryArea}/${secondaryView}`) ? ' starred' : ''}`}
            onClick={() => toggleBookmark(primaryArea, secondaryView)}
            title={bookmarks.some((b) => b.id === `${primaryArea}/${secondaryView}`) ? 'Remove bookmark' : 'Bookmark this page'}
          >
            {bookmarks.some((b) => b.id === `${primaryArea}/${secondaryView}`) ? '⭐' : '☆'}
          </button>
        </div>
        <ErrorBoundary message="Something went wrong rendering this view.">
          {renderMainContent()}
        </ErrorBoundary>
      </main>

      {devOverlayOpen && (
        <aside className="right-rail" aria-label="Admin and status">
          <h2>Admin + Status</h2>
          <AccordionBlock title="Server" defaultOpen={true}>
            {healthQuery.isLoading && <p>Checking...</p>}
            {healthQuery.error && <p className="error">Offline</p>}
            {healthQuery.data && <p className="ok">Online: {healthQuery.data.version || 'unknown'}</p>}
            <p className="muted">Adapters: {availableAdapters.length}</p>
            <p className="muted">Analytics queue: {analyticsSnapshot.queueLength}</p>
            <p className="muted">Perf samples: {performanceSnapshot.samples}</p>
          </AccordionBlock>

          <div className="rail-block">
            <p className="muted">Actions</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <button type="button" onClick={onDownloadRuntimeReport} style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}>Export Report</button>
            </div>
          </div>
        </aside>
      )}

      <footer className="app-footer">
        <div className="footer-grid">
          <div className="footer-col">
            <h4>Trading Command Suite</h4>
            <p className="footer-tagline">Algorithmic analysis & portfolio management platform.</p>
            <p className="footer-credit">Created by <strong>Ryan Bayne</strong></p>
            <p className="footer-version">v{healthQuery.data?.version || 'nest-0.1.0'}</p>
          </div>
          <div className="footer-col">
            <h4>Quick Links</h4>
            <button type="button" onClick={() => navigate('/scoring/sees-live-stack')}>SEES Live Stack</button>
            <button type="button" onClick={() => navigate('/scoring/create-protocols')}>Strategy Builder</button>
            <button type="button" onClick={() => navigate('/research/news-intel')}>News Intel</button>
            <button type="button" onClick={() => navigate('/trading/portfolio-overview')}>Portfolio</button>
          </div>
          <div className="footer-col">
            <h4>Resources</h4>
            <button type="button" onClick={() => navigate('/builder/architecture-framework')}>Architecture</button>
            <button type="button" onClick={() => navigate('/status/capability-map')}>Capability Map</button>
            <button type="button" onClick={() => navigate('/lab/theme-lab')}>Theme Lab</button>
            <button type="button" onClick={() => navigate('/settings')}>Settings</button>
          </div>
          <div className="footer-col">
            <h4>Status</h4>
            <div className="footer-status-row">
              <span className={`footer-dot ${isApiOnline ? 'on' : 'off'}`} />
              <span>API: {isApiOnline ? 'Online' : 'Offline'}</span>
            </div>
            <div className="footer-status-row">
              <span className={`footer-dot ${isDbOnline ? 'on' : 'off'}`} />
              <span>DB: {isDbOnline ? 'Connected' : 'Offline'}</span>
            </div>
            <div className="footer-status-row">
              <span className="footer-dot on" />
              <span>Providers: {availableAdapters.length} active</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Ryan Bayne. All rights reserved.</span>
          <span className="footer-bottom-links">
            <button type="button" onClick={onDownloadRuntimeReport}>Export Report</button>
            {devOverlayOpen ? (
              <button type="button" onClick={toggleDevOverlay}>Hide Dev Overlay</button>
            ) : (
              <button type="button" onClick={toggleDevOverlay}>Dev Overlay</button>
            )}
          </span>
        </div>
        {devOverlayOpen && (
          <div className="dev-footer">
            <section className="footer-panel footer-insights" {...withDevTag('floating.insights', { kind: 'hidden-info' })}>
              <div className="floating-title"><span>Hidden Info</span><BadgePill label={themePack} status="ok" /></div>
              <p>Policy: {policyMeta.policyEnforced ? 'enforced' : 'not enforced'}</p>
              <p>Fail-closed: {policyMeta.failClosed ? 'on' : 'off'}</p>
              <p>Vitals tracked: {Object.keys(performanceSnapshot.metrics).length}</p>
            </section>
            <section className="footer-panel footer-log" {...withDevTag('floating.log', { kind: 'activity-log' })}>
              <div className="floating-title"><span>Live Activity Log</span><BadgePill label={`${activityLog.length}`} status="neutral" /></div>
              <div className="log-scroll">
                {activityLog.length === 0 && <p className="muted">Interact with the shell to populate log events.</p>}
                {activityLog.map((item) => (<p key={item.id} className="log-line">{item.timestamp} [{item.type}] {item.details}</p>))}
              </div>
            </section>
            <section className="footer-panel app-footer-ff">
              <div className="floating-title"><span>Feature Flags</span></div>
              {Object.entries(ffState).map(([name, enabled]) => (
                <label key={name} className="ff-row"><input type="checkbox" checked={enabled} onChange={() => enabled ? featureFlags.disable(name) : featureFlags.enable(name)} /><span>{name}</span></label>
              ))}
              <button type="button" className="ff-reset" onClick={() => featureFlags.reset()}>Reset defaults</button>
            </section>
          </div>
        )}
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary message="The application encountered a critical error.">
        <Routes>
          <Route path="/research/symbol/:symbolId" element={<AppShell />} />
          <Route path="/:area/:view" element={<AppShell />} />
          <Route path="/:area" element={<AppShell />} />
          <Route path="/" element={<HomeDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
