/**
 * View Routes — Single source of truth mapping view IDs to page components.
 *
 * When adding a new page:
 * 1. Import the component below
 * 2. Add an entry to VIEW_COMPONENTS
 * 3. Add the view to src/core/nav-tree.js
 *
 * Complex inline views (demos, analytics, about, etc.) are handled
 * directly in App.jsx renderMainContent() — they don't belong here.
 *
 * @generated — extracted from App.jsx renderMainContent()
 * @updated 2026-07-03
 */

// ── Trading ──
import HomeDashboardPage from '../pages/HomeDashboardPage.jsx';
import TradingStrategiesPage from '../pages/TradingStrategiesPage.jsx';
import StrategyDashboardPage from '../pages/StrategyDashboardPage.jsx';
import StrategyComparisonPage from '../pages/StrategyComparisonPage.jsx';
import TradeJournalPage from '../pages/TradeJournalPage.jsx';
import TradingPlansPage from '../pages/TradingPlansPage.jsx';
import CalculatorsPage from '../pages/CalculatorsPage.jsx';
import AccountsDashboardPage from '../pages/AccountsDashboardPage.jsx';
import OrderTestingPage from '../pages/OrderTestingPage.jsx';
import TradingTimelinePage from '../pages/TradingTimelinePage.jsx';
import PortfolioPage from '../pages/PortfolioPage.jsx';
import PortfolioEventsPage from '../pages/PortfolioEventsPage.jsx';
import TradeHistoryPage from '../pages/TradeHistoryPage.jsx';
import PositionsMonitorPage from '../pages/PositionsMonitorPage.jsx';
import CreateStrategyPage from '../pages/CreateStrategyPage.jsx';

// ── Scoring ──
import DirectivesManagerPage from '../pages/DirectivesManagerPage.jsx';
import LiveOrderingStackPage from '../pages/LiveOrderingStackPage.jsx';
import SeesArenaPage from '../pages/SeesArenaPage.jsx';
import SignalsWorkbenchPage from '../pages/SignalsWorkbenchPage.jsx';
import ExitSignalsPage from '../pages/ExitSignalsPage.jsx';
import ScoringRunsPage from '../pages/ScoringRunsPage.jsx';
import ScoringActivityLogsPage from '../pages/ScoringActivityLogsPage.jsx';
import ProtocolsPage from '../pages/ProtocolsPage.jsx';
import CreateProtocolsPage from '../pages/CreateProtocolsPage.jsx';
import StrategyBuilderPage from '../pages/StrategyBuilderPage.jsx';
import StrategyWizardPage from '../pages/StrategyWizardPage.jsx';

// ── Automation ──
import AutomationDashboardPage from '../pages/AutomationDashboardPage.jsx';
import AutomationRulesPage from '../pages/AutomationRulesPage.jsx';
import ExecutionQueuePage from '../pages/ExecutionQueuePage.jsx';

// ── Research ──
import ResearchOverviewPage from '../pages/ResearchOverviewPage.jsx';
import StockInvestigationPage from '../pages/StockInvestigationPage.jsx';
import SupportResistancePage from '../pages/SupportResistancePage.jsx';
import VolatilityAnalysisPage from '../pages/VolatilityAnalysisPage.jsx';
import TechnicalIndicatorsPage from '../pages/TechnicalIndicatorsPage.jsx';
import PatternScannerPage from '../pages/PatternScannerPage.jsx';
import MacroMonitorPage from '../pages/MacroMonitorPage.jsx';
import EarningsCalendarPage from '../pages/EarningsCalendarPage.jsx';
import PriceForecastPage from '../pages/PriceForecastPage.jsx';
import SectorRotationPage from '../pages/SectorRotationPage.jsx';
import MarketCorrelationsPage from '../pages/MarketCorrelationsPage.jsx';
import ChartComparisonPage from '../pages/ChartComparisonPage.jsx';
import AnalyseSymbolPage from '../pages/AnalyseSymbolPage.jsx';
import NewsIntelPage from '../pages/NewsIntelPage.jsx';
import EventsCalendarPage from '../pages/EventsCalendarPage.jsx';
import SocialNetworksPage from '../pages/SocialNetworksPage.jsx';

// ── Analysis / Speed ──
import SpeedTradingPage from '../pages/SpeedTradingPage.jsx';
import SpeedScannerPage from '../pages/SpeedScannerPage.jsx';
import BtcSpeedTradingPage from '../pages/BtcSpeedTradingPage.jsx';
import GoldSpeedTradingPage from '../pages/GoldSpeedTradingPage.jsx';

// ── Portfolio / Trading212 ──
import Mt5TradingPage from '../pages/Mt5TradingPage.jsx';
import Mt5StatusPage from '../pages/Mt5StatusPage.jsx';
import T212PortfolioPage from '../pages/T212PortfolioPage.jsx';
import T212ISAPage from '../pages/T212ISAPage.jsx';
import T212CFDPage from '../pages/T212CFDPage.jsx';

// ── Data ──
import DataAreaLandingPage from '../pages/DataAreaLandingPage.jsx';
import DatabaseTablesPage from '../pages/DatabaseTablesPage.jsx';
import BacktestDataPage from '../pages/BacktestDataPage.jsx';
import DataStatusPage from '../pages/DataStatusPage.jsx';
import DataElementsPage from '../pages/DataElementsPage.jsx';
import DecoderPage from '../pages/DecoderPage.jsx';
import CacheMonitorPage from '../pages/CacheMonitorPage.jsx';
import ActiveSymbolsPage from '../pages/ActiveSymbolsPage.jsx';
import AddSymbolPage from '../pages/AddSymbolPage.jsx';
import SymbolsBrowserPage from '../pages/SymbolsBrowserPage.jsx';
import SymbolDetailPage from '../pages/SymbolDetailPage.jsx';
import ImportJobsPage from '../pages/ImportJobsPage.jsx';
import ApiActivityPage from '../pages/ApiActivityPage.jsx';
import ApiEndpointsPage from '../pages/ApiEndpointsPage.jsx';
import SourcesPage from '../pages/SourcesPage.jsx';
import ProviderHealthPage from '../pages/ProviderHealthPage.jsx';
import MarketContextPage from '../pages/MarketContextPage.jsx';
import SeasonalityHeatmapPage from '../pages/SeasonalityHeatmapPage.jsx';
import GapScannerPage from '../pages/GapScannerPage.jsx';
import DirectivesConfigPage from '../pages/DirectivesConfigPage.jsx';
import RecentlyAnalysedSymbolsPage from '../pages/RecentlyAnalysedSymbolsPage.jsx';
import PlatformComparisonsPage from '../pages/PlatformComparisonsPage.jsx';

// ── Backtest / Strategies ──
import BacktestPage from '../pages/BacktestPage.jsx';
import MultiStrategyComparisonPage from '../pages/MultiStrategyComparisonPage.jsx';
import ScenarioAnalysisPage from '../pages/ScenarioAnalysisPage.jsx';
import StrategiesPage from '../pages/StrategiesPage.jsx';

// ── Status / System ──
import SystemStatusPage from '../pages/SystemStatusPage.jsx';
import SystemLogPage from '../pages/SystemLogPage.jsx';
import SetupWizardPage from '../pages/SetupWizardPage.jsx';
import FaqPage from '../pages/FaqPage.jsx';
import SettingsPage from '../pages/SettingsPage.jsx';
import ServerControlsPage from '../pages/ServerControlsPage.jsx';
import ReportsPage from '../pages/ReportsPage.jsx';
import CapabilityMapPage from '../pages/CapabilityMapPage.jsx';
import QATestingPage from '../pages/QATestingPage.jsx';
import DecisionTrailPage from '../pages/DecisionTrailPage.jsx';
import SymbolPage from '../pages/SymbolPage.jsx';
import ArchitectureFrameworkPage from '../pages/ArchitectureFrameworkPage.jsx';
import DiagramsPage from '../pages/DiagramsPage.jsx';

// ── Lab ──
import ComponentLabPage from '../pages/ComponentLabPage.jsx';
import ResponsiveLayoutLabPage from '../pages/ResponsiveLayoutLabPage.jsx';
import ChartsLabPage from '../pages/ChartsLabPage.jsx';
import ThemeLabPage from '../pages/ThemeLabPage.jsx';
import ThemeLabMotion from '../pages/ThemeLabMotion.jsx';
import ThemeLabTransitions from '../pages/ThemeLabTransitions.jsx';
import ThemeLabContainer from '../pages/ThemeLabContainer.jsx';
import ThemeLabScroll from '../pages/ThemeLabScroll.jsx';
import ThemeLabPopover from '../pages/ThemeLabPopover.jsx';
import LabLandingPage from '../pages/LabLandingPage.jsx';
import LabPage from '../pages/LabPage.jsx';
import PipelineGraphLabPage from '../pages/PipelineGraphLabPage.jsx';
import FeatureLabPage from '../pages/FeatureLabPage.jsx';
import PreferenceLab from '../pages/PreferenceLab.jsx';
import PerformanceLabPage from '../pages/PerformanceLabPage.jsx';
import SnapshotReplayPage from '../pages/SnapshotReplayPage.jsx';
import TripleScreenPage from '../pages/TripleScreenPage.jsx';
import HotStockPicksPage from '../pages/HotStockPicksPage.jsx';
import MetaStackPerformancePage from '../pages/MetaStackPerformancePage.jsx';
import MetaStackDisplayPage from '../pages/MetaStackDisplayPage.jsx';
import PortfolioLabPage from '../pages/PortfolioLabPage.jsx';
import ScoringDebugLab from '../pages/ScoringDebugLab.jsx';

// ── Training ──
import TrainingCandlePatternsPage from '../pages/TrainingCandlePatternsPage.jsx';
import CandlePatternsGuidePage from '../pages/CandlePatternsGuidePage.jsx';

// ── Watchlists ──
import UserWatchlistsPage from '../pages/UserWatchlistsPage.jsx';

// ── Other ──
import ABTestingPage from '../pages/ABTestingPage.jsx';
import AICostsPage from '../pages/AICostsPage.jsx';
import AILogViewerPage from '../pages/AILogViewerPage.jsx';
import AlgorithmLabPage from '../pages/AlgorithmLabPage.jsx';
import AlertCenterPage from '../pages/AlertCenterPage.jsx';
import DailyBriefingPage from '../pages/DailyBriefingPage.jsx';
import DailySummaryReportPage from '../pages/DailySummaryReportPage.jsx';
import RiskControlsPage from '../pages/RiskControlsPage.jsx';
import ThemePage from '../pages/ThemePage.jsx';
import ScoringOverviewPage from '../pages/ScoringOverviewPage.jsx';
import SnapshotLibraryPage from '../pages/SnapshotLibraryPage.jsx';
import PersonalFinancesPage from '../pages/PersonalFinancesPage.jsx';
import TradingStylesPage from '../pages/TradingStylesPage.jsx';
import ObjectivesPage from '../pages/ObjectivesPage.jsx';
import GlobalAllocatorPage from '../pages/GlobalAllocatorPage.jsx';
import HomeDashboard from '../pages/HomeDashboard.jsx';

// ── MAP ──────────────────────────────────────────────────────────────────────
export const VIEW_COMPONENTS = {
  // Trading
  'overview': HomeDashboardPage,
  'trading-strategies': TradingStrategiesPage,
  'strategy-comparison': StrategyComparisonPage,
  'trade-journal': TradeJournalPage,
  'trading-plans': TradingPlansPage,
  'calculators': CalculatorsPage,
  'accounts-dashboard': AccountsDashboardPage,
  'order-testing': OrderTestingPage,
  't212-portfolio': T212PortfolioPage,
  't212-isa': T212ISAPage,
  't212-cfd': T212CFDPage,
  'timeline': TradingTimelinePage,
  'portfolio-overview': PortfolioPage,
  'portfolio-events': PortfolioEventsPage,
  'trade-history': TradeHistoryPage,
  'positions-monitor': PositionsMonitorPage,
  'create-strategy': CreateStrategyPage,
  'mt5-trading': Mt5TradingPage,
  'mt5-demo-trading': Mt5TradingPage,
  'mt5-status': Mt5StatusPage,

  // Scoring
  'directives-manager': DirectivesManagerPage,
  'live-ordering-stack': LiveOrderingStackPage,
  'sees-arena': SeesArenaPage,
  'signals-workbench': SignalsWorkbenchPage,
  'exit-signals': ExitSignalsPage,
  'scoring-runs': ScoringRunsPage,
  'scoring-activity-logs': ScoringActivityLogsPage,
  'protocols': ProtocolsPage,
  'create-protocols': CreateProtocolsPage,
  'strategy-wizard': StrategyWizardPage,
  'scoring-overview': ScoringOverviewPage,
  'algorithm-lab': AlgorithmLabPage,

  // Automation
  'automation-dashboard': AutomationDashboardPage,
  'automation-rules': AutomationRulesPage,
  'execution-queue': ExecutionQueuePage,
  'alert-center': AlertCenterPage,
  'risk-controls': RiskControlsPage,

  // Research
  'research-overview': ResearchOverviewPage,
  'stock-investigation': StockInvestigationPage,
  'support-resistance': SupportResistancePage,
  'volatility-analysis': VolatilityAnalysisPage,
  'technical-indicators': TechnicalIndicatorsPage,
  'pattern-scanner': PatternScannerPage,
  'macro-monitor': MacroMonitorPage,
  'earnings-calendar': EarningsCalendarPage,
  'price-forecast': PriceForecastPage,
  'sector-rotation': SectorRotationPage,
  'market-correlations': MarketCorrelationsPage,
  'chart-comparison': ChartComparisonPage,
  'analyse-symbol': AnalyseSymbolPage,
  'news-intel': NewsIntelPage,
  'events-calendar': EventsCalendarPage,
  'social-networks': SocialNetworksPage,

  // Speed Trading
  'speed-trading': SpeedTradingPage,
  'speed-scanner': SpeedScannerPage,
  'btc-speed': BtcSpeedTradingPage,
  'gold-speed': GoldSpeedTradingPage,

  // Data
  'data-landing': DataAreaLandingPage,
  'database-tables': DatabaseTablesPage,
  'backtest-data': BacktestDataPage,
  'data-status': DataStatusPage,
  'data-elements': DataElementsPage,
  'decoder': DecoderPage,
  'transient-caches': CacheMonitorPage,
  'active-symbols': ActiveSymbolsPage,
  'add-symbol': AddSymbolPage,
  'symbols-browser': SymbolsBrowserPage,
  'symbol-detail': SymbolDetailPage,
  'import-jobs': ImportJobsPage,
  'api-activity': ApiActivityPage,
  'api-endpoints': ApiEndpointsPage,
  'sources': SourcesPage,
  'provider-health': ProviderHealthPage,
  'market-context': MarketContextPage,
  'seasonality-heatmap': SeasonalityHeatmapPage,
  'gap-scanner': GapScannerPage,
  'configure-directives': DirectivesConfigPage,
  'recently-analysed-symbols': RecentlyAnalysedSymbolsPage,
  'platform-comparisons': PlatformComparisonsPage,

  // Backtest / Strategies
  'backtest': BacktestPage,
  'strategies-compare': MultiStrategyComparisonPage,
  'scenario-analysis': ScenarioAnalysisPage,
  'strategies': TradingStrategiesPage,

  // Status / System
  'status': SystemStatusPage,
  'system-log': SystemLogPage,
  'setup': SetupWizardPage,
  'faq': FaqPage,
  'settings': SettingsPage,
  'server-controls': ServerControlsPage,
  'reports': ReportsPage,
  'capability-map': CapabilityMapPage,
  'qa-testing': QATestingPage,
  'architecture-framework': ArchitectureFrameworkPage,
  'diagrams': DiagramsPage,

  // Lab
  'component-lab': ComponentLabPage,
  'responsive-layout-lab': ResponsiveLayoutLabPage,
  'charts-lab': ChartsLabPage,
  'theme-lab': ThemeLabPage,
  'theme-lab-motion': ThemeLabMotion,
  'theme-lab-transitions': ThemeLabTransitions,
  'theme-lab-container': ThemeLabContainer,
  'theme-lab-scroll': ThemeLabScroll,
  'theme-lab-popover': ThemeLabPopover,
  'lab-landing': LabLandingPage,
  'pipeline-graph-lab': PipelineGraphLabPage,
  'lab': LabPage,
  'feature-lab': FeatureLabPage,
  'preference-lab': PreferenceLab,
  'user-preferences': PreferenceLab,
  'performance-lab': PerformanceLabPage,
  'snapshot-replay': SnapshotReplayPage,
  'triple-screen': TripleScreenPage,
  'hot-stock-picks': HotStockPicksPage,
  'daily-briefing': DailyBriefingPage,
  'decision-trail': DecisionTrailPage,
  'ab-testing': ABTestingPage,
  'ai-costs': AICostsPage,
  'ai-logs': AILogViewerPage,
  'daily-summary-report': DailySummaryReportPage,
  'metastack-display': MetaStackDisplayPage,
  'metastack-performance': MetaStackPerformancePage,
  'portfolio-lab': PortfolioLabPage,
  'scoring-debug-lab': ScoringDebugLab,
  'snapshots': SnapshotLibraryPage,

  // Training
  'candle-patterns': TrainingCandlePatternsPage,
  'candle-patterns-guide': CandlePatternsGuidePage,

  // Watchlists
  'user-watchlists': UserWatchlistsPage,
  'create-watchlist': UserWatchlistsPage,

  // Other
  'theme-packs': ThemePage,
  'personal-finances': PersonalFinancesPage,
  'trading-styles': TradingStylesPage,
  'objectives': ObjectivesPage,
  'allocator': GlobalAllocatorPage,
};
