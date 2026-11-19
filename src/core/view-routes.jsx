/**
 * View Routes — Single source of truth mapping view IDs to page components.
 *
 * When adding a new page:
 * 1. Add a LAZY import below — `const Foo = lazy(() => import('../pages/Foo.jsx'));`
 * 2. Add an entry to VIEW_COMPONENTS
 * 3. Add the view to src/core/nav-tree.js
 *
 * ⚠️ EVERY page import here must be `lazy` (#1280, 2026-11-15). It used to be a plain `import`, and
 * because App.jsx renders `VIEW_COMPONENTS[view]`, that put **all 153 page modules into the entry
 * chunk** — 4.65 MB, within 354 KB of the PWA precache cap that FAILS the build when exceeded. Lazy
 * imports cut the entry chunk to 0.68 MB. App.jsx supplies the required `<Suspense>` boundary, so a
 * plain `import` here is still *correct* at runtime — it just puts the page on the critical path for
 * every user, which is the thing this file exists to avoid. `check-bundle-budget.mjs` (C2 ratchet)
 * will fail the build when the entry chunk grows.
 *
 * Complex inline views (demos, analytics, about, etc.) are handled
 * directly in App.jsx renderMainContent() — they don't belong here.
 *
 * @generated — extracted from App.jsx renderMainContent()
 * @updated 2026-11-15 — lazy imports (#1280)
 */

import { lazy } from 'react';

// ── Trading ──
// TradingStrategiesPage was RETIRED 2026-09-23 (owner, option A). Its table + sticky sidebar layout
// moved to StrategiesListPage (`/bots/trading-bots`), so TWO view ids had to go with it:
//   'trading-strategies'  -> the routed view
//   'strategies'          -> an ORPHAN id with no nav entry and no view-meta key; nothing routed to
//                            it, so it was only discoverable by deleting the import and watching
//                            what broke. Both mappings are removed rather than left dangling.
const StrategyComparisonPage = lazy(() => import('../pages/StrategyComparisonPage.jsx'));
const StrategyMonitorPage = lazy(() => import('../pages/StrategyMonitorPage.jsx'));
// The canonical bot index (#504 consolidation, 2026-07-29). It was built and then referenced by
// nothing - no route, no nav entry, no view-meta entry - so a finished registry was invisible.
// Surfaced 2026-09-18, then renamed to `trading-bots` (docs/trading-bot-model.md §5).
const StrategiesListPage = lazy(() => import('../pages/StrategiesListPage.jsx'));
const StrategyCreatePage = lazy(() => import('../pages/StrategyCreatePage.jsx'));
// #864 — the per-bot truth view. Reached at /trading/strategy/:strategyId, NOT from the sidebar:
// it is a detail page for one bot, so it has no nav entry (the same shape as /trading/symbol/:ticker).
const ViewStrategyPage = lazy(() => import('../pages/ViewStrategyPage.jsx'));
// #876 — STRATEGIES, derived from unique (protocol x treatment) combinations. Different from
// `Trading Bots` above, which lists `trading_strategy` ROWS.
const DerivedStrategiesPage = lazy(() => import('../pages/DerivedStrategiesPage.jsx'));
const AbStrategiesPage = lazy(() => import('../pages/AbStrategiesPage.jsx'));
const TradeJournalPage = lazy(() => import('../pages/TradeJournalPage.jsx'));
const TradingPlansPage = lazy(() => import('../pages/TradingPlansPage.jsx'));
const CalculatorsPage = lazy(() => import('../pages/CalculatorsPage.jsx'));
const OrderTestingPage = lazy(() => import('../pages/OrderTestingPage.jsx'));
const PortfolioPage = lazy(() => import('../pages/PortfolioPage.jsx'));
const PortfolioEventsPage = lazy(() => import('../pages/PortfolioEventsPage.jsx'));
const TradeHistoryPage = lazy(() => import('../pages/TradeHistoryPage.jsx'));
const PositionsMonitorPage = lazy(() => import('../pages/PositionsMonitorPage.jsx'));
const StrategyLibraryPage = lazy(() => import('../pages/StrategyLibraryPage.jsx'));
const DayTopWinnersPage = lazy(() => import('../pages/DayTopWinnersPage.jsx'));
const DayTopLosersPage = lazy(() => import('../pages/DayTopLosersPage.jsx'));
const MostActivePage = lazy(() => import('../pages/MostActivePage.jsx'));

// ── Scoring ──
const DirectivesManagerPage = lazy(() => import('../pages/DirectivesManagerPage.jsx'));
const DirectiveViewerPage = lazy(() => import('../pages/DirectiveViewerPage.jsx'));
const DirectiveImpactAuditPage = lazy(() => import('../pages/DirectiveImpactAuditPage.jsx'));
const LadderPage = lazy(() => import('../pages/LadderPage.jsx'));
const AbLadderPage = lazy(() => import('../pages/AbLadderPage.jsx'));
const SeesArenaPage = lazy(() => import('../pages/SeesArenaPage.jsx'));
const ExitSignalsPage = lazy(() => import('../pages/ExitSignalsPage.jsx'));
// #988 — the guardian's own history, read from `stop_adjustment` + `sim_tsl_event`.
const StopGuardianStatsPage = lazy(() => import('../pages/StopGuardianStatsPage.jsx'));
const ScoringActivityLogsPage = lazy(() => import('../pages/ScoringActivityLogsPage.jsx'));
const SignalsOverviewPage = lazy(() => import('../pages/SignalsOverviewPage.jsx'));
const ProtocolsPage = lazy(() => import('../pages/ProtocolsPage.jsx'));
const ProtocolTrailPage = lazy(() => import('../pages/ProtocolTrailPage.jsx'));
const SinglesMonitorPage = lazy(() => import('../pages/SinglesMonitorPage.jsx'));
const ProtocolsLadderPage = lazy(() => import('../pages/ProtocolsLadderPage.jsx'));
const SymbolsLadderPage = lazy(() => import('../pages/SymbolsLadderPage.jsx'));
// ⚠️ `ThemePage` import REMOVED 2026-10-13 with the page itself (owner request) — it was the Theme
// Packs gallery, whose pack chooser now lives in the Appearance area. Leaving the import would have
// broken the build the moment the file was deleted, which is the correct order: route, then file.
const AppearanceAreaPage = lazy(() => import('../pages/AppearanceAreaPage.jsx'));
// ⚠️ THESE TWO IMPORTS WERE MISSING ON FIRST ATTEMPT (2026-10-13) and the BUILD PASSED WITHOUT THEM.
// The route map below referenced `AppearanceMotionPage` / `AppearanceFormsPage` while nothing imported
// them, so the map held two undefined identifiers. Vite does not fail on that — it is a runtime
// ReferenceError, and the whole app rendered "App Failed to Load" with the name of the missing
// identifier as the only clue. The lesson is not "be careful": it is that **a green build does not
// prove a view works**, and this page pair was only caught by opening the route in the browser.
const AppearanceMotionPage = lazy(() => import('../pages/AppearanceMotionPage.jsx'));
// Element groups — the sections of the retired Theme Lab, split by what a reader is deciding.
// They all render ONE component (`ThemeLabSections`) with a different `group` prop, so the examples
// exist once. A missing import here is the failure mode this repo keeps re-finding: the route map
// references an identifier that was never imported, Vite still builds, and the app renders
// "<Name> is not defined" at runtime. Verify new routes in the browser, not by a green build.
const AppearanceColourPage = lazy(() => import('../pages/AppearanceColourPage.jsx'));
const AppearanceSurfacesPage = lazy(() => import('../pages/AppearanceSurfacesPage.jsx'));
const AppearanceDataDisplayPage = lazy(() => import('../pages/AppearanceDataDisplayPage.jsx'));
const AppearanceInteractivePage = lazy(() => import('../pages/AppearanceInteractivePage.jsx'));
const AppearancePatternsPage = lazy(() => import('../pages/AppearancePatternsPage.jsx'));
const AppearanceInfoPage = lazy(() => import('../pages/AppearanceInfoPage.jsx'));
const AppearanceFormsPage = lazy(() => import('../pages/AppearanceFormsPage.jsx'));
const ProtocolsPerformancePage = lazy(() => import('../pages/ProtocolsPerformancePage.jsx'));
// MetaStackPipelinePage import REMOVED 2026-10-08 — the view was merged into Pipeline Graph Lab,
// which imports the board directly. The file still exists as that board.
const CreateProtocolsPage = lazy(() => import('../pages/CreateProtocolsPage.jsx'));
const StrategyWizardPage = lazy(() => import('../pages/StrategyWizardPage.jsx'));

// ── Automation ──

// ── Research ──
const ResearchNotesPage = lazy(() => import('../pages/ResearchNotesPage.jsx'));
const StockInvestigationPage = lazy(() => import('../pages/StockInvestigationPage.jsx'));
const SupportResistancePage = lazy(() => import('../pages/SupportResistancePage.jsx'));
const VolatilityAnalysisPage = lazy(() => import('../pages/VolatilityAnalysisPage.jsx'));
const TechnicalIndicatorsPage = lazy(() => import('../pages/TechnicalIndicatorsPage.jsx'));
const PatternScannerPage = lazy(() => import('../pages/PatternScannerPage.jsx'));
const MacroMonitorPage = lazy(() => import('../pages/MacroMonitorPage.jsx'));
const EarningsCalendarPage = lazy(() => import('../pages/EarningsCalendarPage.jsx'));
const EarningsWhispersPage = lazy(() => import('../pages/EarningsWhispersPage.jsx'));
const PriceForecastPage = lazy(() => import('../pages/PriceForecastPage.jsx'));
const SectorRotationPage = lazy(() => import('../pages/SectorRotationPage.jsx'));
const MarketCorrelationsPage = lazy(() => import('../pages/MarketCorrelationsPage.jsx'));
const ChartComparisonPage = lazy(() => import('../pages/ChartComparisonPage.jsx'));
const AnalyseSymbolPage = lazy(() => import('../pages/AnalyseSymbolPage.jsx'));
const NewsIntelPage = lazy(() => import('../pages/NewsIntelPage.jsx'));
const EventsCalendarPage = lazy(() => import('../pages/EventsCalendarPage.jsx'));
const SocialNetworksPage = lazy(() => import('../pages/SocialNetworksPage.jsx'));

// ── Analysis / Speed ──
const SpeedScannerPage = lazy(() => import('../pages/SpeedScannerPage.jsx'));
const BtcSpeedTradingPage = lazy(() => import('../pages/BtcSpeedTradingPage.jsx'));

// ── Portfolio / Trading212 ──
// ⚠️ RESTORED 2026-10-01. This import was removed by scripts/delete-views.cjs when the
// `mt5-demo-trading` map entry went: that page file is mapped to TWO ids, so removing one id must
// not remove the import the other still needs. The script now checks whether any surviving map
// entry still names the component before touching its import line.
const Mt5TradingPage = lazy(() => import('../pages/Mt5TradingPage.jsx'));
// Moved out of the deleted /automation/execution-queue page, 2026-10-02 — the requirement is for the
// Protocol Queue tab to live in Protocols and the Scheduled Jobs tab in Status.
const ProtocolQueuePage = lazy(() => import('../pages/ProtocolQueuePage.jsx'));
const ScheduledJobsPage = lazy(() => import('../pages/ScheduledJobsPage.jsx'));
const Mt5StatusPage = lazy(() => import('../pages/Mt5StatusPage.jsx'));
const T212PortfolioPage = lazy(() => import('../pages/T212PortfolioPage.jsx'));
const T212ISAPage = lazy(() => import('../pages/T212ISAPage.jsx'));
// Accounts area — added 2026-11-06 (requirement): the venues/accounts, and the data vendors.
const BrokersPage = lazy(() => import('../pages/BrokersPage.jsx'));
const VendorsPage = lazy(() => import('../pages/VendorsPage.jsx'));

// ── Data ──
const DataAreaLandingPage = lazy(() => import('../pages/DataAreaLandingPage.jsx'));
const DatabaseTablesPage = lazy(() => import('../pages/DatabaseTablesPage.jsx'));
const BacktestDataPage = lazy(() => import('../pages/BacktestDataPage.jsx'));
const BacktestRunsPage = lazy(() => import('../pages/BacktestRunsPage.jsx'));
// #1295 — the experiment registry page. Same lazy pattern as every other route.
const BacktestExperimentsPage = lazy(() => import('../pages/BacktestExperimentsPage.jsx'));
const WalkForwardSurvivorsPage = lazy(() => import('../pages/WalkForwardSurvivorsPage.jsx'));
const CurrentStrategyPage = lazy(() => import('../pages/CurrentStrategyPage.jsx'));
const DataStatusPage = lazy(() => import('../pages/DataStatusPage.jsx'));
const DataElementsPage = lazy(() => import('../pages/DataElementsPage.jsx'));
const DecoderPage = lazy(() => import('../pages/DecoderPage.jsx'));
const CacheMonitorPage = lazy(() => import('../pages/CacheMonitorPage.jsx'));
const ActiveSymbolsPage = lazy(() => import('../pages/ActiveSymbolsPage.jsx'));
const SymbolsBrowserPage = lazy(() => import('../pages/SymbolsBrowserPage.jsx'));
// #958 — what the BROKERS offer (14,000+ instruments) versus what the app has onboarded (~218).
// Distinct from Symbols Browser, which lists only the ONBOARDED set — the difference between the
// two is the entire finding, so they must not be merged into one list.
const BrokerCataloguePage = lazy(() => import('../pages/BrokerCataloguePage.jsx'));
const ScreenerPage = lazy(() => import('../pages/ScreenerPage.jsx'));
// ⚠️ `SymbolDetailPage` was DELETED 2026-11-18 (#1266). It read `useParams().symbolId`, and NO route
// declared `:symbolId` — so every query stayed `enabled: false` and every panel rendered blank. It had
// no nav entry, no `view-meta` row and no hidden-route row: a 450-line page reachable only by typing a
// URL that rendered nothing. `SymbolPage` (`'symbol'`, 1,055 lines) already serves the real surface at
// `/trading/symbol/:ticker` and `/research/symbol/:ticker`, so wiring this one would have created a
// SECOND symbol page for the same job.
const ImportJobsPage = lazy(() => import('../pages/ImportJobsPage.jsx'));
const ApiActivityPage = lazy(() => import('../pages/ApiActivityPage.jsx'));
const ApiEndpointsPage = lazy(() => import('../pages/ApiEndpointsPage.jsx'));
const SourcesPage = lazy(() => import('../pages/SourcesPage.jsx'));
const ProviderHealthPage = lazy(() => import('../pages/ProviderHealthPage.jsx'));
const MarketContextPage = lazy(() => import('../pages/MarketContextPage.jsx'));
const SeasonalityHeatmapPage = lazy(() => import('../pages/SeasonalityHeatmapPage.jsx'));
const GapScannerPage = lazy(() => import('../pages/GapScannerPage.jsx'));
const RecentlyAnalysedSymbolsPage = lazy(() => import('../pages/RecentlyAnalysedSymbolsPage.jsx'));
const PlatformComparisonsPage = lazy(() => import('../pages/PlatformComparisonsPage.jsx'));

// ── Backtest / Strategies ──
const BacktestProtocolsPage = lazy(() => import('../pages/BacktestProtocolsPage.jsx'));
const BacktestStrategiesPage = lazy(() => import('../pages/BacktestStrategiesPage.jsx'));
const ScenarioAnalysisPage = lazy(() => import('../pages/ScenarioAnalysisPage.jsx'));

// ── Status / System ──
const SystemLogPage = lazy(() => import('../pages/SystemLogPage.jsx'));
const HealthDashboardPage = lazy(() => import('../pages/HealthDashboardPage.jsx'));
const CommandsReferencePage = lazy(() => import('../pages/CommandsReferencePage.jsx'));
const SetupWizardPage = lazy(() => import('../pages/SetupWizardPage.jsx'));
const FaqPage = lazy(() => import('../pages/FaqPage.jsx'));
const GlossaryPage = lazy(() => import('../pages/GlossaryPage.jsx'));
const SettingsPage = lazy(() => import('../pages/SettingsPage.jsx'));
const SettingsDatabasePage = lazy(() => import('../pages/SettingsDatabasePage.jsx'));
const SettingsEducationPage = lazy(() => import('../pages/SettingsEducationPage.jsx'));
const TradingSettingsPage = lazy(() => import('../pages/TradingSettingsPage.jsx'));
// #617 — the settings split. General shed its META.Stack-layer sections to these three, so
// each layer's configuration now sits on the page it governs.
const AppearanceSettingsPage = lazy(() => import('../pages/AppearanceSettingsPage.jsx'));
const ScoringSettingsPage = lazy(() => import('../pages/ScoringSettingsPage.jsx'));
const AutomationSettingsPage = lazy(() => import('../pages/AutomationSettingsPage.jsx'));
const ServerControlsPage = lazy(() => import('../pages/ServerControlsPage.jsx'));
const ReportsPage = lazy(() => import('../pages/ReportsPage.jsx'));
const CapabilityMapPage = lazy(() => import('../pages/CapabilityMapPage.jsx'));
const MetaStackStatusPage = lazy(() => import('../pages/MetaStackStatusPage.jsx'));
const QATestingPage = lazy(() => import('../pages/QATestingPage.jsx'));
const TheoryRegistryPage = lazy(() => import('../pages/TheoryRegistryPage.jsx'));
const DesignObservationsPage = lazy(() => import('../pages/DesignObservationsPage.jsx'));
const SymbolPage = lazy(() => import('../pages/SymbolPage.jsx'));
const ArchitectureFrameworkPage = lazy(() => import('../pages/ArchitectureFrameworkPage.jsx'));
const UiReviewPage = lazy(() => import('../pages/UiReviewPage.jsx'));
const DiagramsPage = lazy(() => import('../pages/DiagramsPage.jsx'));
const BlockedSignalsPage = lazy(() => import('../pages/BlockedSignalsPage.jsx'));
// #1190 — the trend READING experiment. Development because it is an experiment first.
const TrendReadingPage = lazy(() => import('../pages/TrendReadingPage.jsx'));
const MoversTreatmentPage = lazy(() => import('../pages/MoversTreatmentPage.jsx'));
const QueuedChangesPage = lazy(() => import('../pages/QueuedChangesPage.jsx'));
// Performance Change (2026-09-28) — the CHANGE lens over the same stored data: period over period,
// not a running total. Sits beside Blocked Signals because both answer a question from the DB.
const PerformanceChangePage = lazy(() => import('../pages/PerformanceChangePage.jsx'));
const MetaStackExplorerPage = lazy(() => import('../pages/MetaStackExplorerPage.jsx'));
const FileInventoryPage = lazy(() => import('../pages/FileInventoryPage.jsx'));

// ── Lab ──
const PositionLifecyclePage = lazy(() => import('../pages/PositionLifecyclePage.jsx'));
const ResponsiveLayoutLabPage = lazy(() => import('../pages/ResponsiveLayoutLabPage.jsx'));
const ChartsLabPage = lazy(() => import('../pages/ChartsLabPage.jsx'));
// ⚠️ REMOVED 2026-10-13: `import ThemeLabPage from '../pages/ThemeLabPage.jsx';` — the page is
// retired and deleted. If you are here because a route stopped resolving, the redirect lives in App.jsx
// (/development/theme-lab → /appearance/layout-guide); do not re-add the import.
const PipelineGraphLabPage = lazy(() => import('../pages/PipelineGraphLabPage.jsx'));
const IdentityMapLabPage = lazy(() => import('../pages/IdentityMapLabPage.jsx'));
const FeatureLabPage = lazy(() => import('../pages/FeatureLabPage.jsx'));
const PreferenceLab = lazy(() => import('../pages/PreferenceLab.jsx'));
const PerformanceLabPage = lazy(() => import('../pages/PerformanceLabPage.jsx'));
const SnapshotReplayPage = lazy(() => import('../pages/SnapshotReplayPage.jsx'));
const MetaStackCockpitPage = lazy(() => import('../pages/MetaStackCockpitPage.jsx'));
const ScoringDebugLab = lazy(() => import('../pages/ScoringDebugLab.jsx'));

// ── Training ──
const TrainingCandlePatternsPage = lazy(() => import('../pages/TrainingCandlePatternsPage.jsx'));
const CandlePatternsGuidePage = lazy(() => import('../pages/CandlePatternsGuidePage.jsx'));

// ── Watchlists ──
const UserWatchlistsPage = lazy(() => import('../pages/UserWatchlistsPage.jsx'));
const RegisteredMoversPage = lazy(() => import('../pages/RegisteredMoversPage.jsx'));

// ── Other ──
const DailyBriefingPage = lazy(() => import('../pages/DailyBriefingPage.jsx'));
const RiskControlsPage = lazy(() => import('../pages/RiskControlsPage.jsx'));
// ⚠️ `ThemePage` (the Theme Packs gallery) was imported here until 2026-10-13, when the page was
// retired (owner request) and its pack chooser moved to the Appearance area. The ORDER matters:
// unregister the route, drop the import, THEN delete the file — deleting the file first leaves a stale
// import, so the build fails and the repository looks broken rather than moved.
const ScoringOverviewPage = lazy(() => import('../pages/ScoringOverviewPage.jsx'));
const SnapshotLibraryPage = lazy(() => import('../pages/SnapshotLibraryPage.jsx'));
const PersonalFinancesPage = lazy(() => import('../pages/PersonalFinancesPage.jsx'));
const TradingStylesPage = lazy(() => import('../pages/TradingStylesPage.jsx'));
const ObjectivesPage = lazy(() => import('../pages/ObjectivesPage.jsx'));
const RoadmapPage = lazy(() => import('../pages/RoadmapPage.jsx'));
const MonitoringPage = lazy(() => import('../pages/MonitoringPage.jsx'));
const DashboardPage = lazy(() => import('../pages/DashboardPage.jsx'));
const ScreenBoardPage = lazy(() => import('../pages/ScreenBoardPage.jsx'));
const ScreenCockpitPage = lazy(() => import('../pages/ScreenCockpitPage.jsx'));

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
  // Two of those strategies side by side, diffs marked (Requirement (2026-09-22)).
  'ab-strategies': AbStrategiesPage,
  // Trading — Legacy strategy pages (under review)
  'strategy-comparison': StrategyComparisonPage,
  'trade-journal': TradeJournalPage,
  'trading-plans': TradingPlansPage,
  'calculators': CalculatorsPage,
  'order-testing': OrderTestingPage,
  't212-portfolio': T212PortfolioPage,
  't212-isa': T212ISAPage,
  // Accounts area — 2026-11-06. `brokers` = venues + their accounts; `vendors` = sources of data.
  'brokers': BrokersPage,
  'vendors': VendorsPage,
  'portfolio-overview': PortfolioPage,
  'portfolio-events': PortfolioEventsPage,
  'trade-history': TradeHistoryPage,
  'positions-monitor': PositionsMonitorPage,
  'strategy-library': StrategyLibraryPage,
  'day-top-winners': DayTopWinnersPage,
  'day-top-losers': DayTopLosersPage,
  'most-active': MostActivePage,
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
  'backtest-runs': BacktestRunsPage,
  'backtest-experiments': BacktestExperimentsPage,
  'walk-forward-survivors': WalkForwardSurvivorsPage,
  'data-status': DataStatusPage,
  'data-elements': DataElementsPage,
  'decoder': DecoderPage,
  'transient-caches': CacheMonitorPage,
  'active-symbols': ActiveSymbolsPage,
  'symbols-browser': SymbolsBrowserPage,
  'broker-catalogue': BrokerCataloguePage,
  'screener': ScreenerPage,
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
  // ⚠️ SPLIT 2026-10-26 (requirement): one page per subject, so each is linkable and described
  // on its own. BacktestPage remains the shared implementation; these are its two routes.
  'backtest': BacktestProtocolsPage,
  'backtest-strategies': BacktestStrategiesPage,
  // ⚠️ ADDED 2026-11-04 (requirement). The A/B reference panels moved OFF the strategies page
  // (*"results displayed twice"*) onto this one, which is about a single strategy and its accepted
  // reference. It reads stored runs only — it never runs a backtest.
  'current-strategy': CurrentStrategyPage,
  // #1134 — `/lab/protocol-backtest` and `ProtocolBacktestPage.jsx` were MERGED into `/lab/backtest`
  // on 2026-10-22. The protocol surface is now the "Protocols" subject toggle on that page, and its
  // per-bar score table is `RunComparisonPanels.ScoreTable`. One route, one stored run history.
  // (`ProtocolScoreDetail`, named here until 2026-11-16, was imported by nothing and is deleted — #1135.)
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
  'trend-reading': TrendReadingPage,
  'movers-treatment': MoversTreatmentPage,
  'queued-changes': QueuedChangesPage,
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
  'registered-movers': RegisteredMoversPage,
  'create-watchlist': UserWatchlistsPage,

  // Other
  // ⚠️ 'theme-packs' REMOVED 2026-10-13 — the ThemePage gallery is retired (owner request); pack
  // selection lives in the Appearance area's chooser. Its route redirects there.
  // Appearance area — new 2026-10-13 (owner request). One entry per view the area will host; the
  // moved pages (Appearance, Screen Assignment, Responsive Layout Lab, Motion, Forms) land beside it.
  'layout-guide': AppearanceAreaPage,
  'patterns': AppearancePatternsPage,
  'info': AppearanceInfoPage,
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
