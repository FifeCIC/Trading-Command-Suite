export const PLUGIN_TAB_SKELETONS = {
  'trading-strategies': {
    title: 'Trading Strategies',
    subtitle: 'Execution strategy catalog with threshold gates and position intent bindings.',
    domain: 'Trading / Strategy Execution',
  },
  'sees-ready': {
    title: 'SEES Ready',
    subtitle: 'Production-readiness checks for directives, data freshness, and signal quality.',
    domain: 'Trading / SEES',
  },
  'sees-pro': {
    title: 'SEES Pro',
    subtitle: 'Advanced SEES operation surface for high-control ranking and workflow tuning.',
    domain: 'Trading / SEES',
  },
  calculators: {
    title: 'Calculators',
    subtitle: 'Position sizing, exposure, and scenario calculators for trade planning.',
    domain: 'Trading / Planning',
  },
  'trade-history': {
    title: 'Trade History',
    subtitle: 'Historical execution records with context and strategy linkage.',
    domain: 'Trading / Audit',
  },
  'manual-trading': {
    title: 'Manual Trading',
    subtitle: 'Operator execution surface for discretionary orders and controlled overrides.',
    domain: 'Trading / Operations',
  },
  'portfolio-overview': {
    title: 'Portfolio Overview',
    subtitle: 'Snapshot of account exposure, allocation drift, and performance posture.',
    domain: 'Trading / Portfolio',
  },
  'positions-monitor': {
    title: 'Positions Monitor',
    subtitle: 'Open position diagnostics, live risk posture, and per-symbol exposure watch.',
    domain: 'Trading / Positions',
  },
  'trade-journal': {
    title: 'Trade Journal',
    subtitle: 'Execution evidence and post-trade rationale tracking for review loops.',
    domain: 'Trading / Journaling',
  },
  'algorithm-lab': {
    title: 'Algorithm Lab',
    subtitle: 'Directive composition workspace for algorithm profiling and scenario analysis.',
    domain: 'Scoring / Algorithms',
  },
  'scoring-runs': {
    title: 'Scoring Runs',
    subtitle: 'Historical scoring run inspection with strategy/version comparisons.',
    domain: 'Scoring / Runtime',
  },
  'strategy-templates': {
    title: 'Strategy Templates',
    subtitle: 'Reusable strategy blueprints and baseline directive bundles.',
    domain: 'Scoring / Strategy',
  },
  'scoring-overview': {
    title: 'Scoring Overview',
    subtitle: 'Current directive system posture and scoring health summary.',
    domain: 'Scoring / Overview',
  },
  'configure-directives': {
    title: 'Configure Directives',
    subtitle: 'Directive configuration and weighting editor for score behavior control.',
    domain: 'Scoring / Directives',
  },
  'directives-status': {
    title: 'Directive Development Status',
    subtitle: 'Coverage and implementation maturity by directive.',
    domain: 'Scoring / Directives',
  },
  'create-scoring-strategies': {
    title: 'Create Scoring Strategies',
    subtitle: 'Compose new strategy profiles from directive bundles and constraints.',
    domain: 'Scoring / Strategy',
  },
  'manage-scoring-strategies': {
    title: 'Manage Scoring Strategies',
    subtitle: 'Edit and retire strategy definitions with version controls.',
    domain: 'Scoring / Strategy',
  },
  'view-scoring-strategies': {
    title: 'View Scoring Strategies',
    subtitle: 'Read-only strategy inspection and comparison workspace.',
    domain: 'Scoring / Strategy',
  },
  'scoring-activity-logs': {
    title: 'Scoring Activity Logs',
    subtitle: 'Run-time scoring traces, errors, and evidence timeline.',
    domain: 'Scoring / Operations',
  },
  'scoring-developer-mode': {
    title: 'Scoring Developer Mode',
    subtitle: 'Deep diagnostics and debug controls for scoring internals.',
    domain: 'Scoring / Development',
  },
  'research-overview': {
    title: 'Research Overview',
    subtitle: 'Aggregate research signal posture spanning macro, events, and sentiment.',
    domain: 'Research / Overview',
  },
  'sector-rotation': {
    title: 'Sector Rotation',
    subtitle: 'Cross-sector momentum and rotation context for watchlist bias.',
    domain: 'Research / Macro',
  },
  'market-correlations': {
    title: 'Market Correlations',
    subtitle: 'Correlation lens for risk clustering and diversification sanity checks.',
    domain: 'Research / Quant',
  },
  'technical-indicators': {
    title: 'Technical Indicators',
    subtitle: 'Indicator matrix and trend-state context for strategy support.',
    domain: 'Research / Technical',
  },
  'earnings-calendar': {
    title: 'Earnings Calendar',
    subtitle: 'Upcoming earnings schedule and volatility windows.',
    domain: 'Research / Events',
  },
  'social-networks': {
    title: 'Social Networks',
    subtitle: 'Social sentiment and platform-derived market context pipeline.',
    domain: 'Research / Sentiment',
  },
  'price-forecast': {
    title: 'Price Forecast',
    subtitle: 'Forecast workspace for scenario ranges and expected move framing.',
    domain: 'Research / Forecasting',
  },
  'pattern-scanner': {
    title: 'Pattern Scanner',
    subtitle: 'Rule-based and heuristic pattern detections for signal preparation.',
    domain: 'Research / Patterns',
  },
  'macro-monitor': {
    title: 'Macro Monitor',
    subtitle: 'Macro factor watchlist, event pressure, and directional regime context.',
    domain: 'Research / Macro',
  },
  'recently-analysed-symbols': {
    title: 'Recently Analysed Symbols',
    subtitle: 'Recent analysis queue with outputs, confidence, and freshness.',
    domain: 'Analysis / Pipeline',
  },
  'support-resistance': {
    title: 'Support & Resistance',
    subtitle: 'Interactive level mapping and break/retest diagnostics.',
    domain: 'Analysis / Technical',
  },
  'volatility-analysis': {
    title: 'Volatility Analysis',
    subtitle: 'Volatility regime detection and risk-adjusted context display.',
    domain: 'Analysis / Risk',
  },
  'data-elements': {
    title: 'Data Elements',
    subtitle: 'Data type definitions, update cadence, and handling rules.',
    domain: 'Data / Schema',
  },
  'manual-import': {
    title: 'Manual Import',
    subtitle: 'Operator-triggered data ingestion and one-off refresh controls.',
    domain: 'Data / Ingestion',
  },
  decoder: {
    title: 'Decoder',
    subtitle: 'Data decoding and mapping utilities for provider payloads.',
    domain: 'Data / Transformation',
  },
  'imports-history': {
    title: 'Imports History',
    subtitle: 'Import job audit trail, durations, and recovery status tracking.',
    domain: 'Data / Ingestion',
  },
  'api-activity': {
    title: 'API Activity',
    subtitle: 'Endpoint usage telemetry, response patterns, and throttling visibility.',
    domain: 'Data / API',
  },
  'api-endpoints': {
    title: 'API Endpoints',
    subtitle: 'Endpoint catalog with capability tags, pacing, and expected payloads.',
    domain: 'Data / API',
  },
  'transient-caches': {
    title: 'Transient Caches',
    subtitle: 'Transient cache visibility, expirations, and invalidation controls.',
    domain: 'Data / Caching',
  },
  'create-source': {
    title: 'Create Source',
    subtitle: 'Source creation flow for new providers and import adapters.',
    domain: 'Data / Sources',
  },
  'api-keys': {
    title: 'API Keys',
    subtitle: 'Credential inventory and provider key lifecycle controls.',
    domain: 'Data / Security',
  },
  'active-symbols': {
    title: 'Active Symbols',
    subtitle: 'Watchlist-ready active symbol set used by SEES and strategies.',
    domain: 'Watchlists / Core',
  },
  'user-watchlists': {
    title: 'User Watchlists',
    subtitle: 'Operator-defined watchlists with intent metadata and scope controls.',
    domain: 'Watchlists / User',
  },
  'create-watchlist': {
    title: 'Create Watchlist',
    subtitle: 'Flow to create scoped watchlists and attach strategy expectations.',
    domain: 'Watchlists / Authoring',
  },
  'automation-dashboard': {
    title: 'Automation Dashboard',
    subtitle: 'At-a-glance automation posture, schedules, and queue state.',
    domain: 'Automation / Overview',
  },
  'background-activity': {
    title: 'Background Activity',
    subtitle: 'Background process monitor for jobs, workers, and failures.',
    domain: 'Automation / Operations',
  },
  'automation-rules': {
    title: 'Bot Rules',
    subtitle: 'Global hard-rules for bots — entry, exit, lock, and safety automation.',
    domain: 'Automation / Rules',
  },
  'cron-scheduler': {
    title: 'Cron Scheduler',
    subtitle: 'Scheduled task windows for imports, scoring, and housekeeping.',
    domain: 'Automation / Scheduling',
  },
  'alert-center': {
    title: 'Alert Center',
    subtitle: 'Alert policy management and signal notification routing.',
    domain: 'Automation / Alerts',
  },
  'current-task': {
    title: 'Current Task',
    subtitle: 'Current development task context and delivery checkpoints.',
    domain: 'Development / Workflow',
  },
  'algorithm-debugger': {
    title: 'Algorithm Debugger',
    subtitle: 'Step-by-step algorithm trace and state transition diagnostics.',
    domain: 'Development / Diagnostics',
  },
  diagrams: {
    title: 'Diagrams',
    subtitle: 'Architecture and process diagram workspace.',
    domain: 'Development / Design',
  },
  'explore-tasks': {
    title: 'Explore Tasks',
    subtitle: 'Task discovery and backlog exploration for developer workflows.',
    domain: 'Development / Planning',
  },
  'duplicate-checker': {
    title: 'Duplicate Checker',
    subtitle: 'Duplicate detection utilities for entities and task artifacts.',
    domain: 'Development / Tooling',
  },
  'create-task': {
    title: 'Create Task',
    subtitle: 'Task authoring flow for new implementation actions.',
    domain: 'Development / Planning',
  },
  'dev-ai': {
    title: 'AI',
    subtitle: 'AI tooling surface for assisted analysis and generation helpers.',
    domain: 'Development / AI',
  },
  pointers: {
    title: 'Pointers',
    subtitle: 'Helpful pointers and in-context guidance for operator workflows.',
    domain: 'Development / Guidance',
  },
  layouts: {
    title: 'Layouts',
    subtitle: 'Layout experiments and shell composition testing.',
    domain: 'Development / UI',
  },
  'light-ui-library': {
    title: 'Light UI Library',
    subtitle: 'Component inventory for light-mode visual system.',
    domain: 'Development / UI',
  },
  'dark-ui-library': {
    title: 'Dark UI Library',
    subtitle: 'Component inventory for dark-mode visual system.',
    domain: 'Development / UI',
  },
  'jquery-ui': {
    title: 'jQuery UI',
    subtitle: 'Legacy component reference surface for compatibility migration.',
    domain: 'Development / Legacy',
  },
  assets: {
    title: 'Assets',
    subtitle: 'Asset pipeline inventory and packaging diagnostics.',
    domain: 'Development / Assets',
  },
  'developer-snippets': {
    title: 'Developer Snippets',
    subtitle: 'Reusable snippet library for faster development loops.',
    domain: 'Development / Tooling',
  },
  'listener-testing': {
    title: 'Listener Testing',
    subtitle: 'Event listener test bench for runtime behavior checks.',
    domain: 'Development / Diagnostics',
  },
  'workflow-wizards': {
    title: 'Workflow Wizards',
    subtitle: 'Guided setup flows for directives, strategies, and automation presets.',
    domain: 'Development / Workflow',
  },
  'focus-priority': {
    title: 'Focus Priority',
    subtitle: 'Highest-impact market factors affecting current position plans.',
    domain: 'Focus / Priority',
  },
  'focus-daily': {
    title: 'Focus Daily',
    subtitle: 'Daily market context and planning adjustments for active positions.',
    domain: 'Focus / Daily',
  },
  'focus-weekly': {
    title: 'Focus Weekly',
    subtitle: 'Weekly planning horizon and strategic posture review.',
    domain: 'Focus / Weekly',
  },
  'focus-advisor': {
    title: 'Focus Advisor',
    subtitle: 'Advisor-guided focus recommendations with rationale trails.',
    domain: 'Focus / Advisor',
  },
  'platform-api-management': {
    title: 'API Management',
    subtitle: 'Trading platform API controls, keys, and provider routing rules.',
    domain: 'Trading Platforms / Management',
  },
  'platform-api-efficiency': {
    title: 'API Efficiency',
    subtitle: 'Efficiency diagnostics for provider calls, pacing, and batching.',
    domain: 'Trading Platforms / Performance',
  },
  'platform-comparisons': {
    title: 'API Provider Comparisons',
    subtitle: 'Side-by-side provider capability matrix to guide architecture decisions.',
    domain: 'Trading Platforms / Architecture',
  },
  'platform-switches': {
    title: 'Trading Platform Switches',
    subtitle: 'Platform switch controls with safety checks and migration traces.',
    domain: 'Trading Platforms / Operations',
  },
  'audit-log': {
    title: 'Audit Log',
    subtitle: 'Operational event audit stream and change traceability.',
    domain: 'Ops / Governance',
  },
  'qa-lab': {
    title: 'QA Lab',
    subtitle: 'Test design and validation workflows for feature hardening.',
    domain: 'Testing / QA',
  },
  'performance-lab': {
    title: 'Performance Lab',
    subtitle: 'Performance profiling and regression checks for heavy workflows.',
    domain: 'Testing / Performance',
  },
  'long-run-tests': {
    title: 'Long-Run Tests',
    subtitle: 'Long-duration reliability tests with schedule and evidence tracking.',
    domain: 'Testing / Reliability',
  },
  'settings-trading-api': {
    title: 'Trading API Settings',
    subtitle: 'Provider API setup and policy controls for trading integration.',
    domain: 'Settings / Integrations',
  },
  'settings-shortcodes': {
    title: 'Shortcodes Settings',
    subtitle: 'Shortcode registry and rendering behavior configuration.',
    domain: 'Settings / Output',
  },
  'settings-symbols': {
    title: 'Symbols Settings',
    subtitle: 'Symbol handling defaults and taxonomy-level settings.',
    domain: 'Settings / Symbols',
  },
  'settings-database': {
    title: 'Database Settings',
    subtitle: 'Database policy, maintenance, and schema-level controls.',
    domain: 'Settings / Database',
  },
  'settings-bugnet': {
    title: 'BugNet Settings',
    subtitle: 'Bug and diagnostics routing configuration.',
    domain: 'Settings / Diagnostics',
  },
  'settings-education': {
    title: 'Education Settings',
    subtitle: 'Education and onboarding content options for guided usage.',
    domain: 'Settings / Onboarding',
  },
  'user-preferences': {
    title: 'User Preferences',
    subtitle: 'Operator-level defaults, layout options, and interface preferences.',
    domain: 'Settings / Personalization',
  },
}
