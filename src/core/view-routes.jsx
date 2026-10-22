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
// TradingStrategiesPage was RETIRED 2026-09-23 (owner, option A). Its table + sticky sidebar layout
// moved to StrategiesListPage (`/trading/trading-bots`), so TWO view ids had to go with it:
//   'trading-strategies'  -> the routed view
//   'strategies'          -> an ORPHAN id with no nav entry and no view-meta key; nothing routed to
//                            it, so it was only discoverable by deleting the import and watching
//                            what broke. Both mappings are removed rather than left dangling.
import StrategyComparisonPage from '../pages/StrategyComparisonPage.jsx';
import StrategyMonitorPage from '../pages/StrategyMonitorPage.jsx';
// The canonical bot index (#504 consolidation, 2026-07-29). It was built and then referenced by
// nothing - no route, no nav entry, no view-meta entry - so a finished registry was invisible.
// Surfaced 2026-09-18, then renamed to `trading-bots` (docs/trading-bot-model.md §5).
import StrategiesListPage from '../pages/StrategiesListPage.jsx';
import StrategyCreatePage from '../pages/StrategyCreatePage.jsx';
// #864 — the per-bot truth view. Reached at /trading/strategy/:strategyId, NOT from the sidebar:
// it is a detail page for one bot, so it has no nav entry (the same shape as /trading/symbol/:ticker).
import ViewStrategyPage from '../pages/ViewStrategyPage.jsx';
// #876 — STRATEGIES, derived from unique (protocol x treatment) combinations. Different from
// `Trading Bots` above, which lists `trading_strategy` ROWS.
import DerivedStrategiesPage from '../pages/DerivedStrategiesPage.jsx';
import AbStrategiesPage from '../pages/AbStrategiesPage.jsx';
import TradeJournalPage from '../pages/TradeJournalPage.jsx';
import TradingPlansPage from '../pages/TradingPlansPage.jsx';
import CalculatorsPage from '../pages/CalculatorsPage.jsx';
import OrderTestingPage from '../pages/OrderTestingPage.jsx';
import PortfolioPage from '../pages/PortfolioPage.jsx';
import PortfolioEventsPage from '../pages/PortfolioEventsPage.jsx';
import TradeHistoryPage from '../pages/TradeHistoryPage.jsx';
import PositionsMonitorPage from '../pages/PositionsMonitorPage.jsx';
import StrategyLibraryPage from '../pages/StrategyLibraryPage.jsx';

// ── Scoring ──
import DirectivesManagerPage from '../pages/DirectivesManagerPage.jsx';
import DirectiveViewerPage from '../pages/DirectiveViewerPage.jsx';
import DirectiveImpactAuditPage from '../pages/DirectiveImpactAuditPage.jsx';
import LadderPage from '../pages/LadderPage.jsx';
import AbLadderPage from '../pages/AbLadderPage.jsx';
import SeesArenaPage from '../pages/SeesArenaPage.jsx';
import ExitSignalsPage from '../pages/ExitSignalsPage.jsx';
// #988 — the guardian's own history, read from `stop_adjustment` + `sim_tsl_event`.
import StopGuardianStatsPage from '../pages/StopGuardianStatsPage.jsx';
import ScoringActivityLogsPage from '../pages/ScoringActivityLogsPage.jsx';
import SignalsOverviewPage from '../pages/SignalsOverviewPage.jsx';
import ProtocolsPage from '../pages/ProtocolsPage.jsx';
import ProtocolTrailPage from '../pages/ProtocolTrailPage.jsx';
import SinglesMonitorPage from '../pages/SinglesMonitorPage.jsx';
import ProtocolsLadderPage from '../pages/ProtocolsLadderPage.jsx';
import SymbolsLadderPage from '../pages/SymbolsLadderPage.jsx';
// ⚠️ `ThemePage` import REMOVED 2026-10-13 with the page itself (owner request) — it was the Theme
// Packs gallery, whose pack chooser now lives in the Appearance area. Leaving the import would have
// broken the build the moment the file was deleted, which is the correct order: route, then file.
import AppearanceAreaPage from '../pages/AppearanceAreaPage.jsx';
// ⚠️ THESE TWO IMPORTS WERE MISSING ON FIRST ATTEMPT (2026-10-13) and the BUILD PASSED WITHOUT THEM.
// The route map below referenced `AppearanceMotionPage` / `AppearanceFormsPage` while nothing imported
// them, so the map held two undefined identifiers. Vite does not fail on that — it is a runtime
// ReferenceError, and the whole app rendered "App Failed to Load" with the name of the missing
// identifier as the only clue. The lesson is not "be careful": it is that **a green build does not
// prove a view works**, and this page pair was only caught by opening the route in the browser.
import AppearanceMotionPage from '../pages/AppearanceMotionPage.jsx';
// Element groups — the sections of the retired Theme Lab, split by what a reader is deciding.
// They all render ONE component (`ThemeLabSections`) with a different `group` prop, so the examples
// exist once. A missing import here is the failure mode this repo keeps re-finding: the route map
// references an identifier that was never imported, Vite still builds, and the app renders
// "<Name> is not defined" at runtime. Verify new routes in the browser, not by a green build.
import AppearanceColourPage from '../pages/AppearanceColourPage.jsx';
import AppearanceSurfacesPage from '../pages/AppearanceSurfacesPage.jsx';
import AppearanceDataDisplayPage from '../pages/AppearanceDataDisplayPage.jsx';
import AppearanceInteractivePage from '../pages/AppearanceInteractivePage.jsx';
import AppearancePatternsPage from '../pages/AppearancePatternsPage.jsx';
import AppearanceFormsPage from '../pages/AppearanceFormsPage.jsx';
import ProtocolsPerformancePage from '../pages/ProtocolsPerformancePage.jsx';
// MetaStackPipelinePage import REMOVED 2026-10-08 — the view was merged into Pipeline Graph Lab,
// which imports the board directly. The file still exists as that board.
import CreateProtocolsPage from '../pages/CreateProtocolsPage.jsx';
import StrategyWizardPage from '../pages/StrategyWizardPage.jsx';

// ── Automation ──

// ── Research ──
import ResearchNotesPage from '../pages/ResearchNotesPage.jsx';
import StockInvestigationPage from '../pages/StockInvestigationPage.jsx';
import SupportResistancePage from '../pages/SupportResistancePage.jsx';
import VolatilityAnalysisPage from '../pages/VolatilityAnalysisPage.jsx';
import TechnicalIndicatorsPage from '../pages/TechnicalIndicatorsPage.jsx';
import PatternScannerPage from '../pages/PatternScannerPage.jsx';
import MacroMonitorPage from '../pages/MacroMonitorPage.jsx';
import EarningsCalendarPage from '../pages/EarningsCalendarPage.jsx';
import EarningsWhispersPage from '../pages/EarningsWhispersPage.jsx';
import PriceForecastPage from '../pages/PriceForecastPage.jsx';
import SectorRotationPage from '../pages/SectorRotationPage.jsx';
import MarketCorrelationsPage from '../pages/MarketCorrelationsPage.jsx';
import ChartComparisonPage from '../pages/ChartComparisonPage.jsx';
import AnalyseSymbolPage from '../pages/AnalyseSymbolPage.jsx';
import NewsIntelPage from '../pages/NewsIntelPage.jsx';
import EventsCalendarPage from '../pages/EventsCalendarPage.jsx';
import SocialNetworksPage from '../pages/SocialNetworksPage.jsx';

// ── Analysis / Speed ──
import SpeedScannerPage from '../pages/SpeedScannerPage.jsx';
import BtcSpeedTradingPage from '../pages/BtcSpeedTradingPage.jsx';

// ── Portfolio / Trading212 ──
// ⚠️ RESTORED 2026-10-01. This import was removed by scripts/delete-views.cjs when the
// `mt5-demo-trading` map entry went: that page file is mapped to TWO ids, so removing one id must
// not remove the import the other still needs. The script now checks whether any surviving map
// entry still names the component before touching its import line.
import Mt5TradingPage from '../pages/Mt5TradingPage.jsx';
// Moved out of the deleted /automation/execution-queue page, 2026-10-02 — the owner asked for the
// Protocol Queue tab to live in Protocols and the Scheduled Jobs tab in Status.
import ProtocolQueuePage from '../pages/ProtocolQueuePage.jsx';
import ScheduledJobsPage from '../pages/ScheduledJobsPage.jsx';
import Mt5StatusPage from '../pages/Mt5StatusPage.jsx';
import T212PortfolioPage from '../pages/T212PortfolioPage.jsx';
import T212ISAPage from '../pages/T212ISAPage.jsx';

// ── Data ──
import DataAreaLandingPage from '../pages/DataAreaLandingPage.jsx';
import DatabaseTablesPage from '../pages/DatabaseTablesPage.jsx';
import BacktestDataPage from '../pages/BacktestDataPage.jsx';
import DataStatusPage from '../pages/DataStatusPage.jsx';
import DataElementsPage from '../pages/DataElementsPage.jsx';
import DecoderPage from '../pages/DecoderPage.jsx';
import CacheMonitorPage from '../pages/CacheMonitorPage.jsx';
import ActiveSymbolsPage from '../pages/ActiveSymbolsPage.jsx';
import SymbolsBrowserPage from '../pages/SymbolsBrowserPage.jsx';
// #958 — what the BROKERS offer (14,000+ instruments) versus what the app has onboarded (~218).
// Distinct from Symbols Browser, which lists only the ONBOARDED set — the difference between the
// two is the entire finding, so they must not be merged into one list.
import BrokerCataloguePage from '../pages/BrokerCataloguePage.jsx';
import ScreenerPage from '../pages/ScreenerPage.jsx';
import SymbolDetailPage from '../pages/SymbolDetailPage.jsx';
import ImportJobsPage from '../pages/ImportJobsPage.jsx';
import ApiActivityPage from '../pages/ApiActivityPage.jsx';
import ApiEndpointsPage from '../pages/ApiEndpointsPage.jsx';
import SourcesPage from '../pages/SourcesPage.jsx';
import ProviderHealthPage from '../pages/ProviderHealthPage.jsx';
import MarketContextPage from '../pages/MarketContextPage.jsx';
import SeasonalityHeatmapPage from '../pages/SeasonalityHeatmapPage.jsx';
import GapScannerPage from '../pages/GapScannerPage.jsx';
import RecentlyAnalysedSymbolsPage from '../pages/RecentlyAnalysedSymbolsPage.jsx';
import PlatformComparisonsPage from '../pages/PlatformComparisonsPage.jsx';

// ── Backtest / Strategies ──
import BacktestPage from '../pages/BacktestPage.jsx';
import ScenarioAnalysisPage from '../pages/ScenarioAnalysisPage.jsx';

// ── Status / System ──
import SystemLogPage from '../pages/SystemLogPage.jsx';
import HealthDashboardPage from '../pages/HealthDashboardPage.jsx';
import CommandsReferencePage from '../pages/CommandsReferencePage.jsx';
import SetupWizardPage from '../pages/SetupWizardPage.jsx';
import FaqPage from '../pages/FaqPage.jsx';
import GlossaryPage from '../pages/GlossaryPage.jsx';
import SettingsPage from '../pages/SettingsPage.jsx';
import SettingsDatabasePage from '../pages/SettingsDatabasePage.jsx';
import SettingsEducationPage from '../pages/SettingsEducationPage.jsx';
import TradingSettingsPage from '../pages/TradingSettingsPage.jsx';
// #617 — the settings split. General shed its META.Stack-layer sections to these three, so
// each layer's configuration now sits on the page it governs.
import AppearanceSettingsPage from '../pages/AppearanceSettingsPage.jsx';
import ScoringSettingsPage from '../pages/ScoringSettingsPage.jsx';
import AutomationSettingsPage from '../pages/AutomationSettingsPage.jsx';
import ServerControlsPage from '../pages/ServerControlsPage.jsx';
import ReportsPage from '../pages/ReportsPage.jsx';
import CapabilityMapPage from '../pages/CapabilityMapPage.jsx';
import MetaStackStatusPage from '../pages/MetaStackStatusPage.jsx';
import QATestingPage from '../pages/QATestingPage.jsx';
import TheoryRegistryPage from '../pages/TheoryRegistryPage.jsx';
import DesignObservationsPage from '../pages/DesignObservationsPage.jsx';
import SymbolPage from '../pages/SymbolPage.jsx';
import ArchitectureFrameworkPage from '../pages/ArchitectureFrameworkPage.jsx';
import UiReviewPage from '../pages/UiReviewPage.jsx';
import DiagramsPage from '../pages/DiagramsPage.jsx';
import BlockedSignalsPage from '../pages/BlockedSignalsPage.jsx';
// Performance Change (2026-09-28) — the CHANGE lens over the same stored data: period over period,
// not a running total. Sits beside Blocked Signals because both answer a question from the DB.
import PerformanceChangePage from '../pages/PerformanceChangePage.jsx';
import MetaStackExplorerPage from '../pages/MetaStackExplorerPage.jsx';
import FileInventoryPage from '../pages/FileInventoryPage.jsx';

// ── Lab ──
import PositionLifecyclePage from '../pages/PositionLifecyclePage.jsx';
import ResponsiveLayoutLabPage from '../pages/ResponsiveLayoutLabPage.jsx';
import ChartsLabPage from '../pages/ChartsLabPage.jsx';
// ⚠️ REMOVED 2026-10-13: `import ThemeLabPage from '../pages/ThemeLabPage.jsx';` — the page is
// retired and deleted. If you are here because a route stopped resolving, the redirect lives in App.jsx
// (/development/theme-lab → /appearance/layout-guide); do not re-add the import.
import PipelineGraphLabPage from '../pages/PipelineGraphLabPage.jsx';
import IdentityMapLabPage from '../pages/IdentityMapLabPage.jsx';
import FeatureLabPage from '../pages/FeatureLabPage.jsx';
import PreferenceLab from '../pages/PreferenceLab.jsx';
import PerformanceLabPage from '../pages/PerformanceLabPage.jsx';
import SnapshotReplayPage from '../pages/SnapshotReplayPage.jsx';
import MetaStackCockpitPage from '../pages/MetaStackCockpitPage.jsx';
import ScoringDebugLab from '../pages/ScoringDebugLab.jsx';

// ── Training ──
import TrainingCandlePatternsPage from '../pages/TrainingCandlePatternsPage.jsx';
import CandlePatternsGuidePage from '../pages/CandlePatternsGuidePage.jsx';

// ── Watchlists ──
import UserWatchlistsPage from '../pages/UserWatchlistsPage.jsx';

// ── Other ──
import DailyBriefingPage from '../pages/DailyBriefingPage.jsx';
import RiskControlsPage from '../pages/RiskControlsPage.jsx';
// ⚠️ `ThemePage` (the Theme Packs gallery) was imported here until 2026-10-13, when the page was
// retired (owner request) and its pack chooser moved to the Appearance area. The ORDER matters:
// unregister the route, drop the import, THEN delete the file — deleting the file first leaves a stale
// import, so the build fails and the repository looks broken rather than moved.
import ScoringOverviewPage from '../pages/ScoringOverviewPage.jsx';
import SnapshotLibraryPage from '../pages/SnapshotLibraryPage.jsx';
import PersonalFinancesPage from '../pages/PersonalFinancesPage.jsx';
import TradingStylesPage from '../pages/TradingStylesPage.jsx';
import ObjectivesPage from '../pages/ObjectivesPage.jsx';
import RoadmapPage from '../pages/RoadmapPage.jsx';
import MonitoringPage from '../pages/MonitoringPage.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import ScreenBoardPage from '../pages/ScreenBoardPage.jsx';
import ScreenCockpitPage from '../pages/ScreenCockpitPage.jsx';

// ── MAP ──────────────────────────────────────────────────────────────────────
export const VIEW_COMPONENTS = {
  // Trading — Canonical (2026-07-29 #504 consolidation)
  'strategy-monitor': StrategyMonitorPage,
  // A BOT = the execution policy. Shares `strategies-list.module.css` with StrategyMonitorPage.
  // Renamed from `strategies-registry` 2026-09-18 (docs/trading-bot-model.md §5, display-first).
  'trading-bots': StrategiesListPage,
  'bot-create': StrategyCreatePage,
  // #864 — one bot, every declared rule, with its enforcement status.
  'strategy-detail': ViewStrategyPage,
  // #876 — the strategies themselves: one card per distinct (protocol x treatment).
  'strategies-derived': DerivedStrategiesPage,
  // Two of those strategies side by side, diffs marked (owner, 2026-09-22).
  'ab-strategies': AbStrategiesPage,
  // Trading — Legacy strategy pages (under review)
  'strategy-comparison': StrategyComparisonPage,
  'trade-journal': TradeJournalPage,
  'trading-plans': TradingPlansPage,
  'calculators': CalculatorsPage,
  'order-testing': OrderTestingPage,
  't212-portfolio': T212PortfolioPage,
  't212-isa': T212ISAPage,
  'portfolio-overview': PortfolioPage,
  'portfolio-events': PortfolioEventsPage,
  'trade-history': TradeHistoryPage,
  'positions-monitor': PositionsMonitorPage,
  'strategy-library': StrategyLibraryPage,
  'mt5-trading': Mt5TradingPage,
  'mt5-status': Mt5StatusPage,
  'protocol-queue': ProtocolQueuePage,
  'scheduled-jobs': ScheduledJobsPage,

  // Scoring
  'directives-registry': DirectivesManagerPage,
  'directive-viewer': DirectiveViewerPage,
  'directive-impact-audit': DirectiveImpactAuditPage,
  'live-ordering-stack': LadderPage,
  'ab-ladder': AbLadderPage,
  'sees-arena': SeesArenaPage,
  'exit-signals': ExitSignalsPage,
  // #988 — placed beside `exit-signals` because both answer "what closes a position": one is the
  // signal view, this is the mechanism that MOVES the stop after entry.
  'stop-guardian': StopGuardianStatsPage,
  'scoring-activity-logs': ScoringActivityLogsPage,
  'protocols-registry': ProtocolsPage,
  'protocol-trail': ProtocolTrailPage,
  'singles-monitor': SinglesMonitorPage,
  'protocols-ladder': ProtocolsLadderPage,
  'symbols-ladder': SymbolsLadderPage,
  'protocols-performance': ProtocolsPerformancePage,
  // 'meta-stack-pipeline' REMOVED 2026-10-08 — merged into 'pipeline-graph-lab'.
  'create-protocols': CreateProtocolsPage,
  'protocol-builder': CreateProtocolsPage,
  'strategy-wizard': StrategyWizardPage,
  'scoring-overview': ScoringOverviewPage,
  'signals-overview': SignalsOverviewPage,

  // Automation
  'risk-controls': RiskControlsPage,

  // Research
  'research-notes': ResearchNotesPage,
  'stock-investigation': StockInvestigationPage,
  'support-resistance': SupportResistancePage,
  'volatility-analysis': VolatilityAnalysisPage,
  'technical-indicators': TechnicalIndicatorsPage,
  'pattern-scanner': PatternScannerPage,
  'macro-monitor': MacroMonitorPage,
  'earnings-calendar': EarningsCalendarPage,
  'earnings-whispers': EarningsWhispersPage,
  'price-forecast': PriceForecastPage,
  'sector-rotation': SectorRotationPage,
  'market-correlations': MarketCorrelationsPage,
  'chart-comparison': ChartComparisonPage,
  'analyse-symbol': AnalyseSymbolPage,
  'news-intel': NewsIntelPage,
  'events-calendar': EventsCalendarPage,
  'social-networks': SocialNetworksPage,

  // Speed Trading
  'speed-scanner': SpeedScannerPage,
  'btc-speed': BtcSpeedTradingPage,

  // Data
  'data-landing': DataAreaLandingPage,
  'database-tables': DatabaseTablesPage,
  'backtest-data': BacktestDataPage,
  'data-status': DataStatusPage,
  'data-elements': DataElementsPage,
  'decoder': DecoderPage,
  'transient-caches': CacheMonitorPage,
  'active-symbols': ActiveSymbolsPage,
  'symbols-browser': SymbolsBrowserPage,
  'broker-catalogue': BrokerCataloguePage,
  'screener': ScreenerPage,
  'symbol-detail': SymbolDetailPage,
  'symbol': SymbolPage,
  'import-jobs': ImportJobsPage,
  'api-activity': ApiActivityPage,
  'api-endpoints': ApiEndpointsPage,
  'sources': SourcesPage,
  'provider-health': ProviderHealthPage,
  'market-context': MarketContextPage,
  'seasonality-heatmap': SeasonalityHeatmapPage,
  'gap-scanner': GapScannerPage,
  'recently-analysed-symbols': RecentlyAnalysedSymbolsPage,
  'platform-comparisons': PlatformComparisonsPage,

  // Backtest / Strategies
  'backtest': BacktestPage,
  // #1134 — `/lab/protocol-backtest` and `ProtocolBacktestPage.jsx` were MERGED into `/lab/backtest`
  // on 2026-10-22. The protocol surface is now the "Protocols" subject toggle on that page, and its
  // per-bar score table is a drill-down (`ProtocolScoreDetail`). One route, one stored run history.
  'scenario-analysis': ScenarioAnalysisPage,
  // 'strategies' was removed with TradingStrategiesPage (2026-09-23) - see the note at the import site.

  // Status / System
  'commands': CommandsReferencePage,
  'system-log': SystemLogPage,
  'health-check': HealthDashboardPage,
  'setup': SetupWizardPage,
  'faq': FaqPage,
  'settings': SettingsPage,
  'settings-database': SettingsDatabasePage,
  'settings-education': SettingsEducationPage,
  'trading-settings': TradingSettingsPage,
  'appearance': AppearanceSettingsPage,
  'scoring-settings': ScoringSettingsPage,
  'automation': AutomationSettingsPage,
  'glossary': GlossaryPage,
  'server-controls': ServerControlsPage,
  'reports': ReportsPage,
  'capability-map': CapabilityMapPage,
  'meta-stack-status': MetaStackStatusPage,
  'dashboard': DashboardPage,
  'screen': ScreenBoardPage,
  'qa-testing': QATestingPage,
  'theory-registry': TheoryRegistryPage,
  'design-observations': DesignObservationsPage,
  'architecture-framework': ArchitectureFrameworkPage,
  'ui-review': UiReviewPage,
  'diagrams': DiagramsPage,
  'blocked-signals': BlockedSignalsPage,
  'performance-change': PerformanceChangePage,
  'meta-stack-explorer': MetaStackExplorerPage,
  'file-inventory': FileInventoryPage,

  // Lab
  'screen-assignment': ScreenCockpitPage,
  'responsive-layout-lab': ResponsiveLayoutLabPage,
  'charts-lab': ChartsLabPage,
  // ⚠️ 'theme-lab' REMOVED 2026-10-13 — the page is retired; its sections are the Appearance element
  // groups above. The route redirects rather than 404s.
  'pipeline-graph-lab': PipelineGraphLabPage,
  // Temporary diagnostic — see IdentityMapLabPage.jsx header. Remove once the identity
  // question is settled, or promote it to a permanent System page.
  'identity-map': IdentityMapLabPage,
  'feature-lab': FeatureLabPage,
  'preference-lab': PreferenceLab,
  'user-preferences': PreferenceLab,
  'performance-lab': PerformanceLabPage,
  'snapshot-replay': SnapshotReplayPage,
  'meta-stack-cockpit': MetaStackCockpitPage,
  'daily-briefing': DailyBriefingPage,
  'dual-protocol-inspector': ScoringDebugLab,
  'snapshots': SnapshotLibraryPage,
  'position-lifecycle': PositionLifecyclePage,

  // Training
  'candle-patterns': TrainingCandlePatternsPage,
  'candle-patterns-guide': CandlePatternsGuidePage,

  // Watchlists
  'user-watchlists': UserWatchlistsPage,
  'create-watchlist': UserWatchlistsPage,

  // Other
  // ⚠️ 'theme-packs' REMOVED 2026-10-13 — the ThemePage gallery is retired (owner request); pack
  // selection lives in the Appearance area's chooser. Its route redirects there.
  // Appearance area — new 2026-10-13 (owner request). One entry per view the area will host; the
  // moved pages (Appearance, Screen Assignment, Responsive Layout Lab, Motion, Forms) land beside it.
  'layout-guide': AppearanceAreaPage,
  'patterns': AppearancePatternsPage,
  'motion': AppearanceMotionPage,
  'forms': AppearanceFormsPage,
  'colour': AppearanceColourPage,
  'surfaces': AppearanceSurfacesPage,
  'data-display': AppearanceDataDisplayPage,
  'interactive': AppearanceInteractivePage,
  'monitoring': MonitoringPage,
  'roadmap': RoadmapPage,
  'personal-finances': PersonalFinancesPage,
  'trading-styles': TradingStylesPage,
  'objectives': ObjectivesPage,
};
