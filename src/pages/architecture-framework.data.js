export const STATUS_SNAPSHOT = [
  'This page is the implementation front door for architecture-sensitive work.',
  'Use the workflow, matrix, intake, discovery, and contract sections before editing.',
  'Real contracts should live here, not only planning notes.',
  'Open decisions stay visible on the same surface as the rules.',
  'Drift detection is built in — section index and contract register show verification badges. Mark items as verified as you review them.',
  'Agentic AI discoverability: /api/architecture/manifest endpoint provides machine-readable system map. Diagrams page has 11 Mermaid diagrams for all major subsystems. Capability Map tracks directive/provider/page coverage.',
  'Cross-page navigation: Architecture Framework ↔ Diagrams ↔ Capability Map are linked via nav buttons in each page header for agent and developer traversal.',
  '2026-06-23: Librarian audit — Diagrams page expanded from 5→11 diagrams (added Activation Gate, Exit Signals, Alert Center, Calibration, Scoring Gating, Provider Adapters). Rendering bug fixed (React key for DOM remount). Contract register date bumped. Cross-page navigation added. Architecture manifest endpoint implemented (GET /api/architecture/manifest).',
  '2026-06-19: Q291 — Timeframe-aware directive config. IDirective extended with activeWindow (time-gated) + timeModifiers (time-adjusted). DirectivesService.runAll() evaluates gates pre-calculate, modifiers post-calculate. session-open-effect directive has reference config (Mon–Fri, 09:00–16:30 America/New_York). Uses Intl.DateTimeFormat for IANA timezone resolution — no external lib.',
  '2026-06-19: Q289 — 9 strategy templates added to seed data (Kitchen Sink, High-Vol Scalper, VIX Regime, Bitcoin Specialist, Gold Hedge, Oil Trader, Forex Session, Tech Titans, Meme Stock). seed:strategies script added. Strategy config JSON extended with templateType, intendedTimeframe, symbols, category.',
  '2026-06-19: Nav-tree restructured — Training area restored (candle patterns, order testing, MT5 demo). Lab area reorganized (Lab Sandbox, Lab Overview, Feature Lab, Theme Lab, Motion Lab, Transitions Lab, Scroll Animations, Component Lab). Development retains core + Container Queries, Popover API, Algorithm Log, Backtest, Protocol Performance. Right-rail hidden by default (Dev Overlay toggle). Admin+Status moved into DevOverlay component.',
  '2026-06-18: Q287 — News Sentiment Data Pipeline. NewsArticle + NewsImportRun models added to Prisma. NewsImportService (Finnhub + dedup + category classification + cron every 6h). NewsIntelPage rebuilt with category tabs, import button, live data. StartupChecklist component added for dev action reminders.',
  '2026-06-17: Scoring model updated — directive maxScore replaces STRATEGY_WEIGHTS. Protocol max = sum of directive maxScores. No 100-cap.',
  '2026-06-17: New directive: fx-timing (FX Timing, v0.1.0 placeholder). New page: AnalyseSymbolPage (symbol selector + scoring breakdown + AI placeholder).',
  '2026-06-17: Nav-tree consolidated — platforms/ops/wizard → Status area. Builder trimmed 19→6. Testing area deleted.',
  '2026-06-17: New pages: ProtocolsOverview, AddSymbol, DataElements. Algorithm Lab → Algorithm Log (real data). Training reorganized.',
  '2026-06-23: MT5 Bridge v2 — Flask replaced with http.server (mt5_bridge_v2.py). v1 archived. Single startup connection instead of per-request. Multi-account support. ⚠️ KNOWN_GAP: port 5000/5001 mismatch between bridge and NestJS .env.',
  '2026-06-23: Bitcoin Speed Protocol (btc-speed-v1) — 16 directives with variable maxScores (40–200). speed-momentum directive created (5-candle ROC + volume amp). 3 crypto directives unstubbed (crypto-fear-greed fetches Alternative.me, btc-halving-cycle with 4-phase scoring, crypto-weekend-effect). BTC_SPEED_GROUPS registered. Rarity percentile gauge (ScoreSnapshot table, Standard→Cyclical→Black Swan bands). Protocols page built with code + DB protocol listing.',
  '2026-06-23: Directive clamp audit — 29 files fixed: Math.min(100) → Math.min(this.maxScore). volume-confirmation bug fixed (maxScore 85→100). MT5 clamp() updated.',
  '2026-06-23: Architecture honesty update — Trading execution layer accurately documented: Layer 1 (execution/MT5 endpoints) exists, Layer 2 (strategy bridge) and Layer 3 (automated decision loop) do NOT. Fake claims (automated scheduler, completed strategy bridge) corrected.',
  '2026-06-23: Trade audit trail wired — TradeRecorderService injected into Mt5TradingService. Every order placed through TCS (manual/agent/strategy) recorded to Trade table with origin field (user|agent|strategy|system). OrderDto validation fixed with class-validator decorators. Bridge API mismatch resolved (order_type→type string, retcode→success). Trade history endpoint returns all attempts with origin attribution. End-to-end verified: EURUSD buy placed via TCS as agent, recorded in DB.',
  '2026-06-23: Protocols page overhaul — directive groups with maxScores displayed per protocol. Risk gate badges show multiplier range (e.g. Gate 30%–120%). Advisory metadata added (trading style, recommended timeframe, avg hold time, win rate target, ideal use). All 6 code protocols annotated.',
  '2026-06-23: Protocol rename + new scalp — btc-speed-v1 renamed "BTC Investment Monitor V1" (medium-term monitoring, NOT scalping). New btc-scalp-v1 "BTC Tick Scalp V1" created for sub-minute speed trading: 14 directives, heavy risk gating (0.5–1.3), 5s–30s timeframe, seconds-to-minutes holds, 65–75% win rate target.',
  '2026-06-23: New speed protocols — xau-speed-v1 (Gold Speed Scalp V1, 14 directives, 0.4–1.3 gate) and oil-speed-v1 (Oil Speed Scalp V1, 14 directives, 0.45–1.3 gate). Both designed for XTrend $1–$5 sub-minute trading. SpeedScanService + POST /api/speed/scan endpoint built — batch-scores all Tier A/B symbols against their best protocol, returns ranked results with top pick. Scanner panel added to SpeedTradingPage with real-time 5s polling, click-to-switch symbols.',
  '2026-06-23: SPY/QQQ protocols — spy-speed-v1 (options-driven micro-structure, gamma pinning, 0DTE mechanics), spy-day-v1 (session structure, VWAP, power hour), qqq-speed-v1 (high-beta momentum, tech earnings boost), qqq-day-v1 (trend following, concentration risk awareness). Scanner maps SPX500/US500→spy-speed-v1, TECH100/US100→qqq-speed-v1.',
]

export const ARCHITECTURE_INDEX = [
  { name: 'Status snapshot', status: 'done' },
  { name: 'Architecture index', status: 'done' },
  { name: 'Architecture tree', status: 'done' },
  { name: 'Decision workflow', status: 'done' },
  { name: 'Feature decision matrix', status: 'done' },
  { name: 'Intake template', status: 'done' },
  { name: 'Discovery commands', status: 'done' },
  { name: 'Information sources', status: 'done' },
  { name: 'System context', status: 'done' },
  { name: 'Owner directory', status: 'done' },
  { name: 'Contract inventory', status: 'done' },
  { name: 'Current contract register', status: 'done' },
  { name: 'Queue/provider contract', status: 'done' },
  { name: 'Scoring/strategy contract', status: 'done' },
  { name: 'Calibration system', status: 'done' },
  { name: 'Activation gate and conditions', status: 'done' },
  { name: 'Exit signal system', status: 'done' },
  { name: 'Alert center architecture', status: 'done' },
  { name: 'AI guardrails', status: 'done' },
  { name: 'Verification governance', status: 'done' },
  { name: 'Definition of done', status: 'done' },
  { name: 'Handoff checklist', status: 'done' },
  { name: 'Known gaps', status: 'done' },
  { name: 'Revision log', status: 'done' },
]

export const DOMAINS = [
  'Market data import and freshness',
  'Provider integration and health',
  'Directive execution',
  'Calibration and weight overrides',
  'Condition detection and activation gate',
  'Strategy aggregation',
  'Scoring and ranking',
  'Exit signal system',
  'Signals and decision support',
  'Alert center and notifications',
  'Training and pattern detection',
  'SEES presentation layer',
  'Algorithm lab and pipeline visualization',
  'Portfolio and trading execution',
  'Operational governance and verification',
  'Automation and multi-protocol orchestration',
]

export const SYSTEM_SPINE = [
  'Symbol selected',
  'Freshness checked',
  'Import triggered if stale or missing',
  'Market data stored',
  'Condition detection runs (entropy, Hurst, session, BOS, range)',
  'Activation gate evaluates suitability vs conditions (active/reduced/muted/boosted)',
  'Directives executed (entry + exit), calibration overrides applied',
  'Strategy aggregates directive outputs',
  'Score and breakdown stored',
  'Exit urgency evaluated alongside entry score',
  'SEES ranks symbols',
  'User inspects rationale and timeframe fit',
  '── Automation Loop (planned) ──',
  'Protocol scheduler dispatches scoring runs',
  'Rate-limit-aware cache deduplicates API calls',
  'Multi-protocol runner executes parallel pipelines',
  'Results streamed to dashboard (stack view / grid view)',
  'Execution queue manages hot-add/remove of protocols',
]

export const CURRENT_SLICE = [
  'Symbol CRUD is in place in NestJS',
  'Freshness check endpoint is implemented',
  'Import queue trigger and processor are implemented',
  'Provider health endpoint is implemented',
  '50+ scoring directives live (MQL5-absorbed, custom, exit signals)',
  'Calibration system with 16 seeded symbol/directive overrides',
  'Exit signal system — 4 exit directives (momentum-exhaustion, target-achieved, regime-shift-exit, time-stop)',
  'Condition detection + activation gate system (ConditionVector → active/reduced/muted/boosted)',
  'Directive suitability registry — 40+ directives tagged by regime, volatility, instrument, timeframe',
  'Alert center — 8 alert types, live polling, severity levels, snooze/dismiss/acknowledge',
  'Algorithm Lab — real-time pipeline visualization (FETCH → SCORE → RANK → FILTER → SIGNAL)',
  'Training area — candle pattern detection with TradingView charts',
  'MT5 adapter + Python bridge v2 (http.server, port 5000). Flask v1 archived to scripts/mt5-bridge/archived/. Multi-account support. ⚠️ NestJS .env expects port 5001 — mismatch needs resolution.',
  'Trading212 portfolio import with live portfolio data',
  'Automated daily trading scheduler (Mon-Fri 9AM cron) ⚠️ NOT YET BUILT — no trading cron jobs exist. Agent-originated trades supported via origin field in order pipeline ✅.',
  'Trading execution layer — MT5 bridge posts/closes/modifies orders. ✅ TradeRecorderService wired — all orders (manual/agent/strategy) logged with origin attribution.',
  'Trading strategy bridge — TradingStrategyService exists with evaluate/execute, seeded BTC strategy. ⚠️ Partially built — needs real data import + scheduled evaluation.',
  'Trading algorithm loop — ⚠️ NOT YET BUILT. No scheduler watches symbols, scores them, and decides whether to trade.',
  'Keyboard speed trading — B/S/C keys, size presets, Shift 2x',
  'Backtest engine + lightweight chart with RSI/MACD/EMA overlays',
  'SEES Live Stack — filters to 5 strategy-weighted directives, real data source indicators',
  'Bitcoin Speed Protocol (btc-speed-v1→BTC Investment Monitor V1) — 16 directives, variable maxScore (40–200), halving cycle bonus, rarity percentile gauge. Renamed from "Speed Scalp" — this is a medium-term monitoring protocol, NOT for sub-minute scalping. ✅',
  'BTC Tick Scalp V1 (btc-scalp-v1) — 14 directives, true sub-minute scalping: 5s–30s candles, seconds-to-minutes holds, heavy risk gating (0.5–1.3), 65–75% win rate target. Designed for XTrend $1 speed trading. ✅',
  'Gold Speed Scalp V1 (xau-speed-v1) — 14 directives, gold-specific micro-structure scalping with macro sentiment context (DXY, real rates). ✅',
  'Oil Speed Scalp V1 (oil-speed-v1) — 14 directives, crude-specific scalping with supply/geopolitics context, NY session focused. ✅',
  'Speed Trading Scanner — POST /api/speed/scan batch-scores Tier A/B symbols. Best Opportunities panel on SpeedTradingPage with 5s polling, ranked display, click-to-switch. Diagram added to DiagramsPage. ⚠️ Needs market data seeding for full coverage.',
  'SPY/QQQ Protocols — 4 new: spy-speed-v1 (gamma pinning, options-flow micro-structure), spy-day-v1 (opening range, VWAP, power hour), qqq-speed-v1 (higher beta momentum), qqq-day-v1 (tech trend following, earnings season awareness). All exploit options market mechanics without trading options. ✅',
  'Protocols page — lists code-registered + DB strategies with API usage examples ✅',
  'Strategy creation + duplication — any strategy can be a template',
  'Portfolio view — holdings, P&L, manual trading with real Trading212 data',
  'Nav reorganization — SEES, Strategy Builder moved to Scoring area with section dividers',
  'Protocol Risk Gating — multiplicative scoring: risk directives gate Technical + Sentiment (not additive)',
  'Unified MT5 Trading page — merged Mt5TradingPage, UnifiedTradingPage, Mt5DemoTradingPage into one page with demo/live toggle, account switching dropdown, platform selector, and live-mode safety confirmations',
]

export const DECISION_WORKFLOW = [
  {
    title: '1. Classify The Work',
    summary: 'Name the type of change before deciding where it belongs.',
    items: [
      'Choose one primary type: provider, bridge, REST route, React/admin UI, scoring directive, queue action, storage schema, automation, shortcode, or developer tool.',
      'Name the owner: core app, extension, local bridge, browser UI, or external service.',
      'State whether the feature is release-facing, developer-only, experimental, or migration support.',
    ],
  },
  {
    title: '2. Find The Existing System',
    summary: 'Search the current architecture before adding new classes, routes, queues, storage, or UI paths.',
    items: [
      'Search for existing classes, routes, queue actions, options, tables, asset handles, and helper functions.',
      'Prefer extending the nearest existing owner over creating a parallel system.',
      'If a new system is necessary, document the concrete gap it fills.',
    ],
  },
  {
    title: '3. Choose The Data Flow',
    summary: 'Decide how data moves before writing handlers or UI code.',
    items: [
      'Provider-backed data should read stored data first, queue refresh when stale or missing, normalize in the processor, store results, then render from storage.',
      'Bridge/local-terminal data should cross through the approved ingest route, verify the token, normalize payloads, store rows, then score from stored data.',
      'React/admin UI should read through approved endpoints and show explicit states: live, cached, queued, stored, empty, failed, or developer-only demo.',
    ],
  },
  {
    title: '4. Document The Contract',
    summary: 'Make the implementation contract visible where future agents can find it.',
    items: [
      'Record endpoint method, permission model, request fields, response shape, owner, and failure states.',
      'Record queue trigger, duplicate prevention, processor, storage target, freshness rule, and retry behavior.',
      'Record storage owner, schema version, read path, write path, retention, and migration impact.',
    ],
  },
  {
    title: '5. Apply Guardrails',
    summary: 'Avoid shortcuts that make the architecture harder to maintain.',
    items: [
      'Do not call external providers during page rendering when stored or queued flow is required.',
      'Do not bypass auth boundaries, secret redaction, or logging rules.',
      'Do not add duplicate queue managers, adapter frameworks, asset loaders, route families, or global data blobs without an architecture note.',
    ],
  },
  {
    title: '6. Verify And Update The Framework',
    summary: 'Finish by proving the change and keeping this page current.',
    items: [
      'Run syntax checks and targeted tests for touched code.',
      'Smoke-test the affected route, queue, UI, or bridge path.',
      'Update the architecture framework in the same pass when contracts, boundaries, storage, queues, routes, or responsibilities change.',
    ],
  },
]

export const FEATURE_MATRIX = [
  ['Bridge payload or local setup', 'Bridge/provider layer', 'Bridge route, token, payload, normalization, storage'],
  ['External provider integration', 'Provider factory and queue processor', 'Provider adapter plus queue and storage contract'],
  ['Admin or React UI', 'Presentation layer', 'UI data mode plus endpoint response contract'],
  ['Background import or refresh', 'Queue/data runtime', 'Queue action plus storage and UI status contract'],
  ['Scoring directive or strategy', 'Scoring system', 'Directive/strategy input, output, scale, and fixtures'],
  ['REST endpoint', 'Endpoint owner', 'Method, auth, request, response, failures'],
  ['Database or storage change', 'Storage owner', 'Owner, schema version, read path, write path, retention'],
  ['Security or admin action', 'Security/form handling layer', 'Auth, sanitization, escaping, redaction'],
]

export const INTAKE_TEMPLATE = [
  {
    title: 'Work Classification',
    items: ['Feature type', 'Primary owner', 'Release mode'],
  },
  {
    title: 'Architecture Fit',
    items: ['Existing system inspected', 'Gap requiring new owner or subsystem', 'Matching contract sections affected'],
  },
  {
    title: 'Data And Contract',
    items: ['Data source', 'Data sink', 'Request/response or input/output shape', 'Freshness, queue, or storage impact'],
  },
  {
    title: 'Security And Verification',
    items: ['Auth boundary', 'Secret or token handling', 'Required validation', 'Verification plan'],
  },
]

export const DISCOVERY_COMMANDS = [
  'Inspect routes, handlers, queues, storage, providers, assets, scoring, and security paths before implementation.',
  'Use discovery to find the existing owner rather than creating a second system.',
  'Treat discovery as part of the feature, not optional prep work.',
]

export const INFORMATION_SOURCES = [
  'Runtime facts and registered application boundaries',
  'Existing codebase contracts and owner classes',
  'Bridge and provider evidence',
  'Queue and storage flow',
  'React and admin UI contracts',
  'Security and verification evidence',
]

export const SYSTEM_CONTEXTS = [
  ['Platform Runtime', 'Owns routing, scheduling, auth boundaries, storage access, and asset registration.'],
  ['Core Application', 'Owns shared architecture: directives, freshness, queues, providers, storage, diagnostics, and UI contracts.'],
  ['Extensions', 'Add packaging or extension-specific behavior without duplicating core contracts.'],
  ['Local Bridge', 'Posts local data through the approved ingest boundary and token model.'],
  ['External Providers', 'Supply data through capability, credential, queue, normalization, and storage rules.'],
  ['Background Queue And Storage', 'Handles slow work, duplicate prevention, retries, status, and persistence.'],
  ['Admin And React UI', 'Shows explicit data states and triggers approved actions through endpoints.'],
]

export const OWNER_DIRECTORY = [
  {
    title: 'Development Architecture Surface',
    summary: 'Owns this page as the implementation front door.',
    items: [
      'Architecture docs and React page own the front-door workflow.',
      'Update this section when workflow, ownership map, contracts, or guardrails change.',
      'Keep architecture-sensitive decisions discoverable here rather than scattering them.',
    ],
  },
  {
    title: 'Bridge And Local Provider Runtime',
    summary: 'Owns local ingest, config, latest, health, and stored scoring proof behavior.',
    items: [
      'Backend integration module should own bridge routes and token verification.',
      'Normalization, storage, health, and scoring behavior should remain in the same runtime boundary.',
      'Extension packaging or setup guidance should not duplicate concrete storage or scoring contracts.',
    ],
  },
  {
    title: 'Queue And Background Data Flow',
    summary: 'Owns provider-backed work that should not block page rendering.',
    items: [
      'Queue processor owns imports, refresh jobs, and duplicate prevention.',
      'Data-flow contracts should stay visible beside queue behavior.',
      'UI should reflect queued and processing states from storage, not inference.',
    ],
  },
  {
    title: 'Provider Factory And Adapters',
    summary: 'Owns external provider selection, capability, normalization, and provider-specific behavior.',
    items: [
      'Provider classes live in the backend integration layer.',
      'Adapter and normalization contracts should be explicit and testable.',
      'Capability decisions should be checked before adding new provider patterns.',
    ],
  },
  {
    title: 'Scoring Directives And Strategy Logic',
    summary: 'Owns score contracts, directive testing, stored scoring evidence, and strategy behavior.',
    items: [
      'Scoring services should own directive metadata, fixtures, and strategy rules.',
      'Tests must validate score ranges and shapes against directive or strategy contracts, not hard-coded assumptions.',
      'Stored scoring evidence remains mandatory for explanation and diagnostics.',
    ],
  },
  {
    title: 'Admin And Front-End Assets',
    summary: 'Owns shell/UI asset registration, conditional loading, and future React surface boundaries.',
    items: [
      'Register reusable assets centrally where possible.',
      'Load by page or route context instead of ad hoc feature-level duplication.',
      'React data flows should stay behind approved endpoint contracts.',
    ],
  },
  {
    title: 'Security And Form Handling',
    summary: 'Owns permissions, auth patterns, sanitization, response safety, and redaction.',
    items: [
      'Endpoints must declare the auth model clearly.',
      'UI and logs should never expose full credentials or bridge tokens.',
      'Security posture should be named before implementation, not inferred after.',
    ],
  },
  {
    title: 'Testing And Verification',
    summary: 'Owns validation, route and queue smoke checks, and architecture-sensitive verification.',
    items: [
      'Run focused verification for changed endpoints, queue processors, storage routines, and UI screens.',
      'Keep architecture drift visible by checking the framework against implementation changes.',
      'Treat missing runtime verification as a recorded limitation, not invisible debt.',
    ],
  },
]

export const CONTRACTS = [
  'REST route contract',
  'Queue action contract',
  'Storage contract',
  'Provider adapter contract',
  'Bridge payload contract',
  'UI data mode contract',
  'Directive and strategy contract',
]

export const CONTRACT_CARDS = [
  {
    title: 'REST Route Contract',
    summary: 'Required when adding or changing API endpoints.',
    items: [
      'Document namespace, path, HTTP method, auth model, owner class, request fields, response fields, and error responses.',
      'Name the authentication model explicitly.',
      'Define the exact response shape before building UI against it.',
    ],
  },
  {
    title: 'Queue Action Contract',
    summary: 'Required when adding queued imports, scoring runs, refresh jobs, or diagnostics.',
    items: [
      'Document trigger source, action name, duplicate prevention, processor method, retry behavior, and failure state.',
      'State whether the queue is user-triggered, schedule-triggered, bridge-triggered, or system-triggered.',
      'UI must display queued, processing, failed, stale, empty, or completed states from storage instead of guessing.',
    ],
  },
  {
    title: 'Storage Contract',
    summary: 'Required when adding or changing durable data structures.',
    items: [
      'Document owner, schema version, read path, write path, indexes, retention, and migration impact.',
      'Prefer central migration or install routines for durable structures.',
      'Secrets and tokens must be stored, displayed, redacted, and logged according to sensitivity.',
    ],
  },
  {
    title: 'Provider Adapter Contract',
    summary: 'Required when integrating market, broker, research, social, or alternative data providers.',
    items: [
      'Document provider capability, credential requirements, rate-limit behavior, supported methods, and normalized output shape.',
      'Route provider-backed fetches through existing freshness, factory, adapter, and queue systems.',
      'Do not let UI render paths call provider APIs directly.',
    ],
  },
  {
    title: 'UI Data Mode Contract',
    summary: 'Required when adding React or operator displays.',
    items: [
      'State whether the view is live, stored, cached, stale, queued, empty, failed, static config, or developer-only demo.',
      'State which endpoint or storage path supplies each visible value.',
      'Controls that trigger work must call approved endpoints or queue actions and then render explicit status.',
    ],
  },
]

export const CONTRACT_REGISTER_LAST_UPDATED = '2026-06-23'

export const CURRENT_ROUTE_CONTRACTS = [
  {
    route: 'POST /providers/local-bridge/ingest',
    method: 'POST',
    permission: 'Token-protected local bridge boundary',
    owner: 'Bridge ingest controller',
    contract: 'Accepts local payloads, verifies token, normalizes fields, stores rows, and returns health.',
    status: 'active',
  },
  {
    route: 'GET /providers/local-bridge/latest',
    method: 'GET',
    permission: 'Authenticated operator or admin access',
    owner: 'Bridge read controller',
    contract: 'Reads latest stored rows with filters and does not call the source bridge directly.',
    status: 'active',
  },
  {
    route: 'GET /providers/health',
    method: 'GET',
    permission: 'Authenticated operator or admin access',
    owner: 'Provider health controller',
    contract: 'Returns stored provider health from application state.',
    status: 'active',
  },
  {
    route: 'GET /market-data/freshness/:symbolId',
    method: 'GET',
    permission: 'Authenticated local operator access',
    owner: 'Market data controller',
    contract: 'Checks staleness against stored bars and may queue refresh when configured.',
    status: 'active',
  },
  {
    route: 'POST /imports/trigger/:symbolId',
    method: 'POST',
    permission: 'Authenticated local operator access',
    owner: 'Import jobs controller',
    contract: 'Queues import work and records a concrete import run.',
    status: 'active',
  },
  {
    route: 'GET /api/symbols',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Symbols controller',
    contract: 'Returns all symbols with active status. Supports CRUD via POST/PATCH.',
    status: 'active',
  },
  {
    route: 'GET /api/scoring/ranked',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Scoring controller',
    contract: 'Returns ranked symbols with directive breakdown, confidence, signal classification.',
    status: 'migration',
  },
  {
    route: 'GET /api/scoring/algorithm-lab/state',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Algorithm lab controller',
    contract: 'Returns pipeline state with real scoring data for all/one strategy.',
    status: 'active',
  },
  {
    route: 'POST /api/scoring/algorithm-lab/pause/:strategyId',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Algorithm lab controller',
    contract: 'Pauses pipeline display updates for the given strategy.',
    status: 'active',
  },
  {
    route: 'POST /api/scoring/algorithm-lab/resume/:strategyId',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Algorithm lab controller',
    contract: 'Resumes pipeline display updates for the given strategy.',
    status: 'active',
  },
  {
    route: 'GET /api/scoring/algorithm-lab/runs',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Algorithm log controller',
    contract: 'Triggers a real scoring run via ScoringService.rankAll() and records per-symbol scores. Returns run history.',
    status: 'active',
  },
  {
    route: 'GET /api/scoring/protocols',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Protocols controller',
    contract: 'Lists all scoring protocols with directive counts, maxPossibleScore, scheduler status, and recent activity feed.',
    status: 'active',
  },
  {
    route: 'GET /api/scoring/gated/:symbol',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Protocol gating controller',
    contract: 'Returns multiplicatively-gated score for a single symbol. Risk directives gate Technical + Sentiment scores multiplicatively (not additively). Query: ?timeframe=1d&bars=100.',
    status: 'active',
  },
  {
    route: 'GET /api/scoring/gated/portfolio',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Protocol gating controller',
    contract: 'Returns multiplicatively-gated scores for all portfolio positions. Same gating logic as single-symbol endpoint applied to every holding.',
    status: 'active',
  },
  {
    route: 'GET /api/fx/rate/:pair',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'FX controller (Q289 — planned)',
    contract: 'Returns real-time FX rate for a currency pair (e.g. USD/GBP). Requires FX data provider integration.',
    status: 'planned',
  },
  {
    route: 'GET /api/calibrations',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Calibration controller',
    contract: 'Returns all symbol calibrations with weight multipliers, decay modifiers, volatility adjustments.',
    status: 'active',
  },
  {
    route: 'GET /api/calibrations/:symbol',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Calibration controller',
    contract: 'Returns calibrations for a specific symbol.',
    status: 'active',
  },
  {
    route: 'POST /api/calibrations',
    method: 'POST',
    permission: 'Admin access',
    owner: 'Calibration controller',
    contract: 'Creates or updates a symbol calibration override.',
    status: 'active',
  },
  {
    route: 'DELETE /api/calibrations/:id',
    method: 'DELETE',
    permission: 'Admin access',
    owner: 'Calibration controller',
    contract: 'Removes a calibration override.',
    status: 'active',
  },
  {
    route: 'POST /api/calibrations/reload',
    method: 'POST',
    permission: 'Admin access',
    owner: 'Calibration controller',
    contract: 'Reloads all calibrations from the database into cache.',
    status: 'active',
  },
  {
    route: 'GET /api/alerts/active',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Returns currently active alerts with severity levels.',
    status: 'active',
  },
  {
    route: 'GET /api/alerts/history',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Returns alert history with optional limit parameter.',
    status: 'active',
  },
  {
    route: 'GET /api/alerts/count',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Returns active/critical counts for badge display.',
    status: 'active',
  },
  {
    route: 'POST /api/alerts/:id/acknowledge',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Marks an alert as acknowledged/seen.',
    status: 'active',
  },
  {
    route: 'POST /api/alerts/:id/dismiss',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Removes an alert from the active list.',
    status: 'active',
  },
  {
    route: 'POST /api/alerts/:id/snooze',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Snoozes an alert for 15 minutes.',
    status: 'active',
  },
  {
    route: 'GET /api/alerts/config',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Alerts controller',
    contract: 'Returns alert type configuration with enable/disable state.',
    status: 'active',
  },
  {
    route: 'PUT /api/alerts/config/:id',
    method: 'PUT',
    permission: 'Admin access',
    owner: 'Alerts controller',
    contract: 'Toggles an alert type on or off.',
    status: 'active',
  },
  {
    route: 'GET /api/training/candle-patterns',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Training controller',
    contract: 'Returns detected candle patterns for a symbol using 8 pattern directives.',
    status: 'active',
  },
  {
    route: 'GET /api/training/candle-patterns/history',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Training controller',
    contract: 'Returns historical pattern detections with date range.',
    status: 'active',
  },
  {
    route: 'GET /api/training/pattern-accuracy/:patternId',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Training controller',
    contract: 'Returns accuracy statistics for a specific pattern.',
    status: 'active',
  },
  {
    route: 'GET /api/portfolio/trading212/validate',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Portfolio controller',
    contract: 'Validates Trading212 connection using stored credentials.',
    status: 'active',
  },
  {
    route: 'POST /api/portfolio/trading212/import',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Portfolio controller',
    contract: 'Imports live portfolio from Trading212 with position and P&L data.',
    status: 'active',
  },
  {
    route: 'POST /api/strategies/:id/duplicate',
    method: 'POST',
    permission: 'Authenticated operator access',
    owner: 'Strategies controller',
    contract: 'Duplicates a strategy with (Copy) suffix for use as a template.',
    status: 'active',
  },
  {
    route: 'GET /api/backtest/chart-data',
    method: 'GET',
    permission: 'Authenticated operator access',
    owner: 'Backtest controller',
    contract: 'Returns chart-ready OHLCV with RSI/MACD/EMA overlays for symbol+timeframe.',
    status: 'active',
  },
]

export const CURRENT_FLOW_CONTRACTS = [
  {
    title: 'Local Bridge Ingest Flow',
    facts: [
      'Source: local terminal bridge or script posts quote or candle payloads.',
      'Boundary: token-protected ingest route.',
      'Validation: token verification plus payload normalization.',
      'Storage: normalized local data rows.',
      'Read Path: latest, health, and score flows read stored state.',
    ],
  },
  {
    title: 'Provider-Backed UI Flow',
    facts: [
      'Source: external provider APIs.',
      'Boundary: provider classes, capability checks, freshness checks, queue processor, and storage.',
      'Storage: dedicated tables or equivalent owned by the feature contract.',
      'Read Path: UI reads stored, cached, queued, stale, failed, or empty states.',
      'Rule: no external provider calls during render when queued or stored flow applies.',
    ],
  },
  {
    title: 'React Admin Flow',
    facts: [
      'Source: approved REST endpoints.',
      'Auth: app auth for operator actions; local bridge token only for ingest.',
      'Assets: central shell asset and runtime system.',
      'State: components must show loading, stored, cached, stale, queued, empty, failed, and success states explicitly.',
      'Rule: do not embed secrets, direct provider calls, or untyped global blobs in components.',
    ],
  },
]

export const DATA_STATES = [
  ['stored', 'Fresh or acceptable stored data exists.'],
  ['cached', 'A cached snapshot is serving the view.'],
  ['stale', 'Stored data exists but is older than the allowed SLA.'],
  ['queued', 'A refresh/import/scoring item is pending or processing.'],
  ['empty', 'No stored data is available yet.'],
  ['failed', 'The last provider, queue, normalization, or storage attempt failed.'],
  ['no-provider', 'No configured provider can supply the required data shape.'],
  ['developer-demo', 'Demo data is visible only in developer mode.'],
]

export const QUEUE_PROVIDER_CARDS = [
  {
    title: 'Provider Selection',
    summary: 'Choose providers through existing capability and configuration paths.',
    items: [
      'Determine whether the provider supports the required data shape and method contract.',
      'Check credentials, enablement, suitability, and provider health before queueing work.',
      'Reject unsuitable providers explicitly instead of silently falling back to fake or incompatible data.',
    ],
  },
  {
    title: 'Freshness Decision',
    summary: 'Read stored data first and decide whether a refresh is needed.',
    items: [
      'Read storage before adding provider work.',
      'Apply the feature freshness SLA or documented stale threshold.',
      'If data is fresh enough, render stored or cached state without queueing duplicate fetches.',
    ],
  },
  {
    title: 'Queue Trigger',
    summary: 'Queue external work instead of doing it in the page request.',
    items: [
      'Check for an active duplicate queue item before queueing.',
      'Create the queue item through the existing queue processor contract.',
      'Dispatch the processor according to current queue rules.',
    ],
  },
  {
    title: 'Processor And Adapter',
    summary: 'Normalize provider-specific responses before storage.',
    items: [
      'The queue processor performs the external provider request.',
      'Provider-specific responses are normalized through the relevant adapter or service method.',
      'Store the normalized shape expected by scoring, UI, diagnostics, or downstream contracts.',
    ],
  },
  {
    title: 'Storage And Evidence',
    summary: 'Persist enough data and metadata to explain runtime state.',
    items: [
      'Store records plus source, imported timestamp, provider, and failure evidence where applicable.',
      'Expose row counts, last import time, active queue state, and provider readiness to UI surfaces.',
      'Do not use demo data as a hidden substitute for missing provider-backed storage.',
    ],
  },
  {
    title: 'UI Refresh Loop',
    summary: 'UI should report state and re-read after actions.',
    items: [
      'Render stored data, queue state, stale or empty state, or failure state explicitly.',
      'Refresh buttons should enqueue work or call approved stored-data endpoints.',
      'After triggering work, poll or re-read server state instead of assuming completion.',
    ],
  },
]

export const SCORING_STRATEGY_CARDS = [
  {
    title: 'Directive Input Contract',
    summary: 'Directives must declare and receive the data shape they actually require.',
    items: [
      'Identify symbol, timeframe, stored price data, historical data, provider-derived context, user settings, and strategy context before scoring.',
      'Do not let directives fetch provider data inline when stored or queued data flow applies.',
      'When input shape changes, update directive metadata, fixtures, tests, and this contract if the change affects implementation rules.',
    ],
  },
  {
    title: 'Directive Output Contract',
    summary: 'Each directive declares its own maxScore — scores flow from directive ranges, not a fixed 0–100.',
    items: [
      'Output must state score value, maxScore, confidence, signalClass, and failure or insufficient-data reason.',
      'Directive maxScores replace old-style strategy weights — a directive with maxScore=180 naturally dominates one with maxScore=90.',
      'Protocol maxPossibleScore = sum of all directive maxScores. No artificial 100-cap — scores are unbounded within directive ranges.',
    ],
  },
  {
    title: 'Strategy (Protocol) Contract',
    summary: 'Protocols combine directive scores through explicit maxScore-based aggregation — the range IS the weight.',
    items: [
      'Each directive declares maxScore (scoring range). Protocol maxPossibleScore = sum of all directive maxScores.',
      'Normalized score = (totalScore / maxPossibleScore) × 100. Entry/Watch thresholds are % of protocol max.',
      'Protocol and directive versions tracked via version field + ProtocolVersion model for change detection and audit.',
    ],
  },
  {
    title: 'Stored Scoring Flow',
    summary: 'Scoring execution should be reproducible from stored inputs.',
    items: [
      'Read stored symbol, price, historical, provider, bridge, or research evidence before scoring.',
      'Queue or trigger prerequisite imports through approved data-flow paths when inputs are missing or stale.',
      'Write score rows, run summaries, evidence, timestamps, and data-readiness evidence through the owning storage contract.',
    ],
  },
  {
    title: 'Scoring UI State',
    summary: 'Scoring screens must explain whether results are executable, queued, stale, incomplete, or developer-only.',
    items: [
      'Show stored score age, latest run status, scoreable symbol count, missing input reason, and active queue state where relevant.',
      'Developer-mode scoring controls must remain gated until release-facing execution is intentionally approved.',
      'Buttons that run scoring should call approved handlers and re-read stored evidence afterward.',
    ],
  },
  {
    title: 'Testing Contract',
    summary: 'Scoring tests should protect behavior, not just class loading.',
    items: [
      'Validate directive required methods, input safety, output shape, score scale, and scenario fixtures.',
      'Use fixture scenarios for insufficient data, stale data, valid stored data, and provider or queue recovery paths.',
      'When scoring contracts change, update tests before treating UI output as reliable.',
    ],
  },
  {
    title: 'Forbidden Shortcuts',
    summary: 'Scoring code is especially sensitive to plausible but wrong shortcuts.',
    items: [
      'Do not mix demo or random values into release-facing score output.',
      'Do not make scoring correctness depend on page-render provider calls.',
      'Do not normalize all scores as percentages unless the directive or strategy contract says that is valid.',
    ],
  },
]

// ── Phase 2: New Subsystems ──────────────────────────────────────────

export const CALIBRATION_SYSTEM = [
  {
    title: 'Purpose',
    summary: 'Symbol-specific weight overrides that adjust directive scores before aggregation.',
    items: [
      'Calibrations let the system learn which directives matter most for specific symbols.',
      'Stored in SymbolCalibration table — loaded into memory cache on startup.',
      'Applied after directive.calculate() but before weighted aggregation in scoring pipeline.',
      '16 calibrations seeded covering DOGEUSD, XAUUSD, NVDA, BTCUSD, EURUSD, TECH100.',
    ],
  },
  {
    title: 'Calibration Fields',
    summary: 'Each calibration record carries weight, decay, and volatility adjustments.',
    items: [
      'weightMultiplier — scales the directive score (e.g., 3.0 = triple weight for news-sentiment on DOGEUSD).',
      'decayModifier — reduces score impact over time for time-sensitive directives.',
      'volatilityAdjustment — amplifies or dampens scores in volatile regimes.',
      'reason — human-readable justification for the override.',
      'Composite: adjustedScore = rawScore × weightMultiplier × (1 + volatilityAdjustment).',
    ],
  },
  {
    title: 'API Contracts',
    summary: 'REST endpoints for calibration management.',
    items: [
      'GET /api/calibrations — all calibrations with full details.',
      'GET /api/calibrations/:symbol — filter to one symbol.',
      'POST /api/calibrations — create or update a calibration override.',
      'DELETE /api/calibrations/:id — remove an override.',
      'POST /api/calibrations/reload — refresh cache from database.',
    ],
  },
  {
    title: 'Scoring Pipeline Integration',
    summary: 'Calibrations sit between directive calculation and weighted aggregation.',
    items: [
      '1. Each directive calculates raw score from stored market data.',
      '2. CalibrationService.applyCalibrations(symbol, results) applies matching overrides.',
      '3. Adjusted scores flow into weighted aggregation, dominance/suppression, confluence.',
      '4. Calibrated scores stored alongside raw scores for audit trail.',
    ],
  },
]

export const ACTIVATION_GATE_SYSTEM = [
  {
    title: 'Purpose',
    summary: 'Pre-scoring condition detection that adjusts how directives fire based on market regime.',
    items: [
      'ConditionDetectorService runs before scoring and produces a ConditionVector.',
      'ConditionVector captures: entropy level, Hurst exponent, session type, break-of-structure status, range state.',
      'ActivationGateService evaluates directive suitability metadata against the ConditionVector.',
      'Result: each directive is classified as active, reduced, muted, or boosted with a weight multiplier.',
    ],
  },
  {
    title: 'Trigger System',
    summary: '8 built-in triggers that fire based on detected market conditions.',
    items: [
      'strong-trend — high entropy + trending Hurst + BOS confirmed → boost trend-following directives.',
      'high-vol — volatility envelope above p85 → boost volatility directives, reduce mean-reversion.',
      'compression — range contraction + low entropy → boost breakout directives.',
      'ranging — low entropy + no BOS → boost mean-reversion, reduce trend-following.',
      'asian-session — low volume Asian hours → reduce all directives, muted scoring.',
      'london-us-overlap — peak liquidity window → boost volume-based directives.',
      'bearish-structure — lower highs + lower lows + BOS → boost bearish directives.',
      'bullish-structure — higher highs + higher lows + BOS → boost bullish directives.',
    ],
  },
  {
    title: 'Directive Suitability Registry',
    summary: '40+ directives tagged with regime, volatility, instrument, and timeframe metadata.',
    items: [
      'regimeType: trending / ranging / any — determines which market regime the directive suits.',
      'volatilityLevel: low / normal / high / any — volatility band where the directive performs best.',
      'instrumentTypes: forex / stocks / crypto / indices / commodities — which asset classes.',
      'minTimeframe: 5m / 15m / 1h / 4h / 1d — minimum bar duration for meaningful output.',
      'category: trend / mean-reversion / volatility / volume / pattern / microstructure / macro / risk / session.',
    ],
  },
  {
    title: 'Gate Output States',
    summary: 'How the activation gate classifies each directive before scoring.',
    items: [
      'active — full weight, no modification (suitability matches conditions).',
      'boosted — weight multiplied by boost factor (strong condition alignment).',
      'reduced — weight reduced by dampening factor (partial condition mismatch).',
      'muted — weight set to zero (condition mismatch, directive not applicable).',
    ],
  },
]

export const EXIT_SIGNAL_SYSTEM = [
  {
    title: 'Purpose',
    summary: 'Four exit-focused directives that run alongside entry scores to determine when to close positions.',
    items: [
      'Exit directives evaluate stored market data against exit criteria.',
      'Exit urgency scores feed into the same scoring pipeline alongside entry scores.',
      'Designed to wire into SEES exit urgency column (Phase 2 integration).',
      'Each exit directive has its own priority level (P50-P80) and scoring scale.',
    ],
  },
  {
    title: 'Exit Directives',
    summary: 'Four directives covering momentum, target, regime, and time-based exits.',
    items: [
      'momentum-exhaustion (P65) — RSI > 70 + declining volume → high exit urgency.',
      'target-achieved (P60) — Price at ATR-based target (1.5× ATR from swing) → binary exit signal.',
      'regime-shift-exit (P80) — Entropy spike detection → market breakdown → urgent exit.',
      'time-stop (P50) — Momentum decay over position age → time-based exit urgency.',
    ],
  },
  {
    title: 'Scoring Integration',
    summary: 'Exit directives use the same indicator utilities and pipeline as entry directives.',
    items: [
      'All use existing indicator utils (RSI, ATR, entropy).',
      'Registered in directives.module.ts alongside entry directives.',
      'Exit urgency scores are stored with the same ScoringRun/DirectiveRun model.',
      'UI should show exit urgency as a separate column alongside total score.',
    ],
  },
]

export const ALERT_CENTER_ARCHITECTURE = [
  {
    title: 'Purpose',
    summary: 'Centralized alert and notification system with severity levels, lifecycle management, and live polling.',
    items: [
      '8 pre-configured alert types covering MT5 bridge, API rate limits, data staleness, signals, backend health, database, strategy errors, and stop-loss.',
      '3 seeded active alerts for demonstration — periodic simulated alerts every 30s.',
      'In-memory state management with acknowledge/dismiss/snooze lifecycle.',
      '10s frontend polling for real-time updates from /api/alerts/active.',
    ],
  },
  {
    title: 'Alert Lifecycle',
    summary: 'Each alert progresses through states from creation to resolution.',
    items: [
      'active → alert is firing and visible in the Alert Center and could trigger push notifications.',
      'acknowledged → operator has seen the alert but it remains active until resolved.',
      'snoozed → alert is hidden for 15 minutes, then returns to active if not resolved.',
      'dismissed → alert is removed from active list (logged in history).',
      'History entries are timestamped and color-coded by severity for audit trail.',
    ],
  },
  {
    title: 'Severity Levels',
    summary: 'Four-tier severity system with color coding and urgency semantics.',
    items: [
      '🔴 critical — immediate action required (e.g., MT5 bridge offline, stop-loss triggered).',
      '🟠 high — needs attention soon (e.g., rate limit approaching, data staleness).',
      '🟡 warning — advisory (e.g., signal quality degradation, strategy error).',
      '🔵 info — informational (e.g., daily run completed, import finished).',
    ],
  },
  {
    title: 'API Contracts',
    summary: 'Seven REST endpoints for alert management.',
    items: [
      'GET /api/alerts/active — currently active alerts.',
      'GET /api/alerts/history?limit=N — historical alert log.',
      'GET /api/alerts/count — active/critical counts for badge display.',
      'POST /api/alerts/:id/acknowledge — mark as seen.',
      'POST /api/alerts/:id/dismiss — remove from active.',
      'POST /api/alerts/:id/snooze — snooze for 15 minutes.',
      'GET /api/alerts/config — alert type enable/disable configuration.',
      'PUT /api/alerts/config/:id — toggle alert type on/off.',
    ],
  },
]

export const MAINTENANCE_WORKFLOW = [
  {
    title: 'Before You Build',
    summary: 'Collect enough facts to avoid duplicating or bypassing existing architecture.',
    items: [
      'Classify the feature type, owner, data source, trust boundary, storage target, UI surface, and verification need.',
      'Search for existing classes, routes, queue actions, hooks, filters, options, tables, and asset handles.',
      'Read the relevant local docs only after identifying the system owner and data flow.',
    ],
  },
  {
    title: 'During Implementation',
    summary: 'Keep changes close to the existing owner and contract.',
    items: [
      'Extend existing systems through their documented hooks, factories, adapters, queue methods, or controller methods.',
      'Keep contract changes and UI state changes in the same implementation slice when possible.',
      'Update the framework when a route, queue action, storage shape, bridge boundary, or UI data mode changes.',
    ],
  },
  {
    title: 'After Implementation',
    summary: 'Leave evidence that the architecture still matches the code.',
    items: [
      'Run validation and focused behavior checks for touched code and surfaces.',
      'Smoke-test the relevant page or route when runtime context is available.',
      'Correct stale architecture entries immediately or mark them transitional with the owning system and next decision needed.',
    ],
  },
]

export const AI_GUARDRAILS = [
  {
    title: 'Do First',
    summary: 'Required first moves before editing code.',
    items: [
      'Search existing systems and read the nearest owner class before creating new files.',
      'Identify the intended data flow and contract before implementing UI or handlers.',
      'Prefer narrow changes that extend the current architecture over broad rewrites.',
    ],
  },
  {
    title: 'Do Not',
    summary: 'Shortcuts that create architectural debt or security risk.',
    items: [
      'Do not call external providers during page rendering when stored or queued flow is required.',
      'Do not bypass auth, token, redaction, or logging requirements.',
      'Do not add duplicate queue managers, adapter frameworks, asset loaders, route families, or global data blobs without documenting the gap.',
      'Do not use fake, random, or hardcoded demo data to make a feature appear functional. If real data does not exist, show "—", "No data", "—", or an empty-state icon. Never invent P&L figures, "In Use" flags, or trade counts.',
    ],
  },
  {
    title: 'UI Data Honesty',
    summary: 'Every visible value must be traceable to a real data source. If no data exists, say so.',
    items: [
      'Every number, status badge, checkmark, or currency value must come from storage or a live endpoint. No hardcoded demo values in release-facing pages.',
      'When a feature has no data yet: use "—" (em-dash), "No data", or a muted icon. Never invent plausible-looking values.',
      'Use the DATA_STATES vocabulary: empty, no-provider, queued, stored, cached, stale, failed — pick the honest one.',
      'If a column like "In Use" or "P&L" has no backend data source, do not render fake values. Either hide the column or show "—" for every row.',
      'Demo/seed data is acceptable ONLY for initial database seeding (Prisma seed scripts). It must never be hardcoded in React components.',
    ],
  },
  {
    title: 'React/Admin UI Rules',
    summary: 'Default rules for React surfaces and operator JavaScript.',
    items: [
      'Use approved endpoints and localized configuration; do not embed secrets or untyped blobs in components.',
      'Display loading, empty, stale, queued, failed, and success states explicitly.',
      'Register and load scripts through the central asset system unless a documented exception exists.',
    ],
  },
  {
    title: 'Security Rules',
    summary: 'Minimum security posture for implementation work.',
    items: [
      'Name the permission mechanism for every endpoint, form, bridge, or action.',
      'Sanitize input, surface explicit failures, redact secrets, and avoid logging full credentials or tokens.',
      'Keep token-authenticated routes as the integration boundary rather than direct database or filesystem writes.',
    ],
  },
]

export const VERIFICATION_GOVERNANCE = [
  {
    title: 'Code Verification',
    summary: 'Baseline checks before architecture-sensitive changes are considered done.',
    items: [
      'Run validation and lint or type checks on touched code.',
      'Run targeted tests or smoke checks for changed endpoints, queue processors, storage routines, and UI pages when available.',
      'Check that auth boundaries and response safety match the declared contract.',
    ],
  },
  {
    title: 'Runtime Verification',
    summary: 'Checks that prove the architecture works in runtime, not only in code.',
    items: [
      'Load the affected surface and confirm the displayed data mode matches stored, queued, cached, empty, or failed state.',
      'Smoke-test changed endpoints with expected auth and at least one expected failure response.',
      'For bridge changes, test rejected token, accepted payload normalization, storage, readback, health, and stored scoring.',
    ],
  },
  {
    title: 'Architecture Review Loop',
    summary: 'How this framework stays current.',
    items: [
      'Update this surface in the same change when contracts, owners, boundaries, storage, queue actions, or UI data modes change.',
      'Prefer correcting stale entries immediately over adding separate roadmap notes.',
      'Add automated inventory later only after the human-readable contract sections have proven useful.',
    ],
  },
]

export const GOVERNANCE = [
  'Classify the work and inspect the owner before building.',
  'Preserve the selected contract and data flow during implementation.',
  'Run focused verification after implementation.',
  'Update the framework when contracts or responsibilities change.',
]

export const DEFINITION_OF_DONE = [
  'Ownership confirmed.',
  'Contract updated.',
  'Data flow preserved.',
  'Security preserved.',
  'UI state is honest.',
  'Verification recorded.',
]

export const HANDOFF_CHECKLIST = [
  'Feature type classified with the Architecture Decision Matrix',
  'Existing owner or system inspected before adding new implementation paths',
  'Intake brief completed or answerable',
  'Discovery commands run for affected routes, queues, storage, assets, scoring, bridge, or security paths',
  'Route, queue, storage, provider, bridge, UI, or scoring contract updated when changed',
  'Data flow preserves stored, queued, provider, bridge, and scoring rules',
  'Security model names auth, token, sanitization, escaping, and redaction rules where applicable',
  'UI states are explicit: stored, cached, stale, queued, empty, failed, no-provider, developer-demo, or success',
  'Validation and relevant targeted tests or smoke checks completed',
  'Unrun checks, known gaps, or residual risks recorded clearly',
]

export const KNOWN_GAPS = [
  'TRADING212 SELL — agents repeatedly claim "API doesn\'t allow selling" and remove/re-add sell code. THIS IS WRONG. Verified flow: controller adds side:"sell" internally → importService places order → adapter sends {ticker, quantity} to Trading212 WITHOUT a side field. Trading212 auto-detects sell from existing position (signed quantity or position context). Do NOT send "side" to the Trading212 API. Do NOT remove sell capability. User confirmed buy AND sell work on demo.',
  'Trading212 account labels — AccountsDashboardPage shows "Investment" without Demo/Live label. Should show "Trading212 Demo" or "Trading212 Live" based on t212Account.mode.',
  'Trading Strategies page (trading-strategies) — hardcoded fake "In Use" checkmarks and P&L values (+£1,245, +£3,820, -£210). No strategies are actually running. Columns should show "—" until real strategy execution tracking exists. UI Data Honesty rule added to AI_GUARDRAILS, .agent-rules.md, and DEVELOPMENT-POLICY.md to prevent this pattern.',
  'MT5 Bridge port mismatch — v2 bridge on port 5000 (BRIDGE_PORT env), NestJS .env has MT5_BRIDGE_URL=http://localhost:5001. Bridge /health reports connected:false with 8900+ connection errors. Resolution: align ports to 5000 in .env or set BRIDGE_PORT=5001 when starting v2.',
  'MT5 Bridge v2 health — bridge self-reports disconnected but NestJS adapter may have working data endpoints. Root cause investigation needed.',
  'Agent coordination gap — Trading Agent rewrote MT5 bridge (Flask→http.server) without checking REVISION_LOG for recent MT5 work, resulting in duplicate effort. Coordination rules now in .agent-rules.md.',
  'Core versus extension boundary still needs final ownership rules in some areas.',
  'React endpoint schema standard should become explicit early.',
  'Automated architecture inventory is still a future decision.',
  'Browser-level verification path is not automated yet.',
  'This page should later reflect live contracts and system state.',
  'MT5 Python bridge status is not polled on this page — bridge health is separate from NestJS provider health.',
  'Contract register contains endpoints but not queue action or storage contracts — those are still documented only in code.',
  'Directive count on this page (71) drifts as new directives are added — needs an auto-detected count.',
  'Scoring pipeline integration with calibration only tested for 16 seeded calibrations, not bulk.',
  'Exit signal system not yet wired into SEES exit urgency column (Phase 2).',
  'No automated drift detection comparing documented contracts against actual route registrations.',
  'FX Timing directive (fx-timing) is a placeholder — requires FX data infrastructure (Q289) before producing real scores.',
  'Analyse Symbol page (Q274) has AI analysis placeholder — requires API provider config before multi-AI comparison works.',
  'Automation rate-limiting risk — without the Symbol Data Cache (Q503), parallel protocol runs would make 3x duplicate Finnhub/T212 calls per symbol in a 10-second window. Rate limits: Finnhub 60/min, T212 demo unknown, Alpha Vantage 5/min. Cache must be operational before multi-protocol execution goes live.',
]

export const REVISION_LOG = [
  '2026-06-24: BACKTEST PERSISTENCE — BacktestRun + BacktestTrade Prisma models added. BacktestService refactored from in-memory Map to MySQL storage. Results now survive restarts. Symbol.backtestRuns relation added. New endpoint: GET /backtest/protocol/:protocolId. SETUP.md updated with full DB installation procedure (push, seed, generate, table inventory).',
  '2026-06-23: COST OPTIMISATION — Bootstrap tiered (Quick/Standard/Architecture). 15 stale github-issues archived. Agent read order reduced from one-size-fits-all 2,600 lines to task-based: ~500 (Quick), ~1,500 (Standard), ~2,600 (Architecture). COST-OPTIMISATION.md created as permanent record for future projects. Principles: tier from day one, archive aggressively, one-line summaries, consolidate before proliferating.',
  '2026-06-23: TRADING212 SELL MECHANISM DOCUMENTED — agents have cycled 3+ times adding/removing sell code claiming "API doesn\'t allow selling." The truth: Trading212 adapter sends {ticker, quantity} WITHOUT a side field — the API auto-detects sell from existing position. Controller (trading212-portfolio.controller.ts:51) adds side:"sell" ONLY for internal routing. DO NOT send "side" to Trading212. DO NOT remove sell capability. KNOWN_GAPS entry added as permanent reference.',
  '2026-06-23: NestJS operations guide updated in ecosystem.instructions.md — removed Intranet dependency for server lifecycle. Stop command now uses direct PowerShell port-based process termination. Added explicit warning: "Do NOT use Intranet for this project." Server is self-contained with own Server Controls page.',
  '2026-06-23: UI Data Honesty rule added to AI_GUARDRAILS (new card: every value traceable to real source, no fake demo data), .agent-rules.md (new section), and DEVELOPMENT-POLICY.md (anti-pattern). Trading Strategies page fake In-Use/P&L documented in KNOWN_GAPS.',
  '2026-06-23: Standard agent commands created — AUTONOMOUS-BATCH-RUN.md rewritten with "Next Prompt" (single) and "Batch Mode" (all) prompt blocks. Both follow DEVELOPMENT-POLICY.md lifecycle (CLAIM__→DONE__ with REVISION_LOG + HANDOFF_CHECKLIST). Old procedure replaced (predated current conventions).',
  '2026-06-23: Prompt folder audit — 25+ DONE__ files in prompts/ awaiting archival, 130+ agent-update records (oldest June 11), 2 stale CLAIM__ files, 2 MOVED__ files. Policy now defines strict state transitions and archival criteria.',
  '2026-06-23: MT5 Bridge v2 — Trading Agent migrated from Flask to http.server (mt5_bridge_v2.py, ~480 lines). v1 Flask bridge archived to scripts/mt5-bridge/archived/. v2 connects MT5 once at startup instead of per-request Flaks threading issue. KNOWN_GAP: port mismatch (v2 on 5000, NestJS .env expects 5001). Bridge /health reports connected:false with 8900+ connection errors — data endpoints may work independently of health check.',
  '2026-06-23: Agent coordination rules added to .agent-rules.md — pre-work checks, CLAIM__ convention, completion verification, HANDOFF_CHECKLIST enforcement, conflict resolution. Session bootstrap order expanded (architecture manifest + structural pages now steps 3-4).',
  '2026-06-23: Discussion docs audited — NEWS-DISSIPATION-CURVES marked IMPLEMENTED (Q287 banner), EXIT-SIGNALS stays in-progress (Q279), HOTAS-TRADING-INTERFACE stays deferred. 5 previously-implemented discussions documented as promoted/archived.',
  '2026-06-23: Diagrams extracted to docs/diagrams/SYSTEM-DIAGRAMS.md — all 11 Mermaid diagrams now available to agents reading the documentation folder without parsing JSX.',
  '2026-06-23: Automation architecture designed — multi-protocol orchestration layer planned with ProtocolRunner backend, rate-limit-aware data cache (deduplicate Finnhub/T212 calls across protocols), execution queue system. Diagrams page updated with Automation Architecture diagram. Prompts generated: Q501 (Automation Dashboard UI), Q502 (ProtocolRunner backend), Q503 (Symbol Data Cache), Q504 (Execution Queue), Q505 (SEES Multi-Protocol Integration). Existing systems targeted for revision: symbol data caching, API call deduplication, protocol-to-symbol mapping.',
  '2026-06-23: DOCUMENTATION-INDEX.md restructured — Agentic AI Discovery table added, Architecture Artifacts section added, discussion doc status table replaces flat list, endpoint count reconciled (14→17 modules).',
  '2026-06-23: Librarian audit — Diagrams page expanded 5→11 (added Activation Gate, Exit Signals, Alert Center, Calibration, Scoring Gating, Provider Adapters). Rendering bug fixed (React key remount). Cross-page navigation added between Architecture Framework ↔ Diagrams ↔ Capability Map.',
  '2026-06-23: Agentic AI discoverability — new GET /api/architecture/manifest endpoint in NestJS (machine-readable system map: 36 modules, providers, system spine, architecture index, nav-tree, UI cross-references). Registered in SystemModule.',
  '2026-06-23: Capability Map wired to live API data (TanStack Query: /api/providers/health, /api/directives) with hardcoded fallbacks. Subtitle corrected from "auto-generated" to "compiled from". Live data indicator + loading/error states added.',
  '2026-06-23: Contract register date bumped 2026-06-17→2026-06-23. STATUS_SNAPSHOT updated with audit entries.',
  'Front Door: added workflow, matrix, intake, and discovery concepts.',
  'System Boundaries: added context and ownership visibility.',
  'Contracts: added concrete route, bridge, queue, UI, and scoring contract categories.',
  'Governance: added guardrails, verification, definition of done, and gaps.',
  'Database Schema: added comprehensive entity-relationship diagram for AI guidance.',
  '2026-06-16: CURRENT_SLICE refreshed — 50+ directives, calibration, exit signals, activation gate, alerts, MT5 bridge, Trading212, algorithm lab, training, backtest, scheduler, keyboard trading.',
  '2026-06-16: Contract Register updated — 30+ new endpoints added (calibrations, alerts, training, portfolio, algorithm-lab, backtest, strategies).',
  '2026-06-16: Roadmap rebuilt — 8 domains reflecting actual sprint progress through Q241.',
  '2026-06-16: Known Gaps expanded with MT5 bridge, drift detection, auto-count gaps.',
  '2026-06-16: Phase 2 — 4 new subsystem sections added: Calibration System, Activation Gate & Conditions, Exit Signal System, Alert Center Architecture.',
  '2026-06-16: Architecture Index expanded from 20→24 sections. Architecture Tree domains updated with calibration, activation gate, exit signals, alerts, training, algorithm lab, portfolio.',
  '2026-06-16: SYSTEM_SPINE updated with condition detection, activation gate, calibration, and exit signal steps.',
  '2026-06-16: Phase 3 — Live status widgets added: System Health (uptime/DB latency/queue), Alert Center Status (active/critical counts), Calibration Status (total), Alerts/Calibrations/Uptime chips in control bar.',
  '2026-06-16: Phase 4 — Drift detection system added: per-section and per-contract verification state (localStorage), stale badges in section index (stale/review/✓), Verified column in contract register with Mark Verified buttons, control bar drift summary chip, Mark All Verified buttons.',
  '2026-06-16: CSS refactored to 40+ custom properties — all hardcoded colors centralized. a11y: focus-visible, aria-labels, sr-only, reduced-motion added.',
  '2026-06-16: Fixed 8 NestJS controllers with redundant @Controller(\"api/...\") paths (global prefix already adds /api). Rebuilt skill file .github/skills/update-architecture-framework/SKILL.md for architecture page maintenance.',
  '2026-06-17: Q263 — Nav-tree consolidation: platforms, ops, wizard areas merged into unified Status area (14 views). Testing area deleted. Builder trimmed from 19→6 views.',
  '2026-06-17: Q259 — Algorithm Lab replaced with Algorithm Log: all setInterval/simulation removed, real ScoringService data, PROTOTYPE badge, multi-pipeline architecture documented.',
  '2026-06-17: Q260 — Theme Exploration: default Carbon theme applied, system font stack, CSS variables. Q267 — Theme Packs page styling, color previews, apply/install flow.',
  '2026-06-17: Q264 — Builder cleanup: 13 pages deleted (WordPress-era placeholders). Q268 — Platform Comparisons full-width table with sticky headers and horizontal scroll.',
  '2026-06-19: Protocol Risk Gating implemented — DirectiveGroup registry (Technical/Sentiment/Risk), ProtocolGatingService (multiplicative scoring with risk floor 0.3/ceiling 1.2), GET /api/scoring/gated/:symbol and /portfolio endpoints. Directives now gate instead of just add.',
  '2026-06-19: Q300 — Unified MT5 Trading page: merged Mt5TradingPage, UnifiedTradingPage, and Mt5DemoTradingPage into single Mt5TradingPage.jsx with demo/live toggle, account switching dropdown, platform selector (MT5/T212/Alpaca), live-mode safety confirmations, and Close All with position count. Removed mt5-demo-trading from nav-tree Builder area. Dead imports cleaned from App.jsx.',
  '2026-06-17: Directive interface updated: maxScore field added (replaces STRATEGY_WEIGHTS). Each directive declares its own scoring range. Protocol max = sum of directive maxScores.',
  '2026-06-17: Scoring model changed: weighted average → sum of directive scores ÷ protocol max. No artificial 100-cap. version field added to IDirective + ProtocolVersion model in Prisma.',
  '2026-06-17: New pages: ProtocolsOverviewPage (activity dashboard + scheduler status), AddSymbolPage (search autocomplete + duplicate check), DataElementsPage (6 elements with status).',
  '2026-06-17: Training renamed: candle-patterns → Pattern Detection. New candle-patterns-guide for educational content. Data area: trading-platforms → sources slug.',
  '2026-06-17: Q273 — Data API monitoring consolidated: ApiActivityLog added, API Activity owns errors/latency, endpoint catalog has In Use status, cache policy kept for complex joins/provider responses with future queue warming.',
  '2026-06-17: Q279 — FX Timing directive created (fx-timing, v0.1.0). Placeholder until Q289 FX data infrastructure built. useFxRate hook + convertToGbp/formatGbp helpers added.',
  '2026-06-17: Q274 — Analyse Symbol page created with symbol selector, data snapshot, real scoring breakdown, AI placeholder, and action buttons. useCurrentSymbolStore (Zustand) added.',
  '2026-06-17: Q289 — FX Data Infrastructure prompt created (FxRate model, fx.service, fx.controller, provider integration). Prerequisite for Q279 Phase 2-5.',
  '2026-06-17: Q272 — Data Elements page created with 6 elements (RSI, MACD, EMA, ATR, Volume, Budget Gate), status badges, and coverage counts. manual-import deleted from nav.',
  '2026-06-17: Q273 — Deleted provider-health, sources-list, api-errors pages. ProviderHealthPage import and route removed from App.jsx.',
  '2026-06-16: Q235 (Multi-Screen Dashboard) and Q242 (HOTAS Gamepad Prototype) moved to .github/issues/ as GitHub-ready issues with dependency chain.',
]

// Database Schema for AI Guidance
export const DATABASE_SCHEMA = {
  coreEntities: [
    {
      table: 'Symbol',
      description: 'Trading symbols and company data',
      fields: ['id (PK)', 'ticker (unique)', 'name', 'exchange', 'type', 'active', 'createdAt', 'updatedAt'],
      relationships: [
        '→ Score (one-to-many)',
        '→ Signal (one-to-many)',
        '→ MarketBar (one-to-many)',
        '→ ImportRun (one-to-many)',
      ],
    },
    {
      table: 'Strategy',
      description: 'Trading strategies and rules',
      fields: ['id (PK)', 'name', 'description', 'config (JSON)', 'active', 'createdAt', 'updatedAt'],
      relationships: [
        '→ Directive (one-to-many)',
        '→ Score (one-to-many)',
        '→ Signal (one-to-many)',
      ],
    },
    {
      table: 'Directive',
      description: 'Scoring directive definitions',
      fields: ['id (PK)', 'strategyId (FK)', 'name', 'type', 'weight', 'config (JSON)', 'active', 'createdAt', 'updatedAt'],
      relationships: [
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'Score',
      description: 'Symbol scoring history',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'value', 'breakdown (JSON)', 'timestamp'],
      relationships: [
        '← Symbol (many-to-one)',
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'Signal',
      description: 'Trading signal records',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'type', 'strength', 'price', 'reason (JSON)', 'status', 'createdAt'],
      relationships: [
        '← Symbol (many-to-one)',
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'SymbolCalibration',
      description: 'Symbol/directive weight overrides',
      fields: ['id (PK)', 'symbol (unique with directiveId)', 'directiveId', 'weightMultiplier', 'reason', 'decayModifier', 'volatilityAdjustment', 'createdAt', 'updatedAt'],
      relationships: [],
      status: 'implemented',
    },
    {
      table: 'FaqEntry',
      description: 'FAQ search index',
      fields: ['id (PK)', 'question', 'answer', 'category', 'tags', 'order', 'createdAt', 'updatedAt'],
      relationships: [],
      status: 'implemented',
    },
  ],
  marketDataEntities: [
    {
      table: 'MarketBar',
      description: 'OHLCV price data from imports',
      fields: ['id (PK)', 'symbolId (FK)', 'provider', 'timeframe', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'importedAt'],
      relationships: [
        '← Symbol (many-to-one)',
      ],
      indexes: ['symbolId + timeframe + timestamp', 'provider + importedAt'],
    },
    {
      table: 'ImportRun',
      description: 'Data import job tracking',
      fields: ['id (PK)', 'symbolId (FK)', 'provider', 'timeframe', 'status', 'source', 'requestedAt', 'startedAt', 'completedAt', 'error'],
      relationships: [
        '← Symbol (many-to-one)',
      ],
      indexes: ['symbolId + requestedAt', 'status + requestedAt'],
    },
    {
      table: 'ProviderHealth',
      description: 'Provider connectivity status',
      fields: ['id (PK)', 'provider (unique)', 'status', 'message', 'latencyMs', 'checkedAt', 'credentialsOk', 'endpoint'],
      relationships: [],
      indexes: ['status + checkedAt'],
    },
    {
      table: 'ApiActivityLog',
      description: 'API request telemetry for activity feed, error dot, endpoint usage, and latency charts',
      fields: ['id (PK)', 'timestamp', 'endpoint', 'method', 'provider', 'statusCode', 'durationMs', 'responseSize'],
      relationships: [],
      indexes: ['timestamp', 'provider + timestamp', 'statusCode + timestamp', 'method + endpoint'],
    },
  ],
  plannedMetaTables: [
    {
      table: 'SymbolMeta',
      description: 'Extended symbol metadata',
      fields: ['id (PK)', 'symbolId (FK)', 'metaKey', 'metaValue', 'source', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'SymbolFundamentals',
      description: 'Fundamental data (PE, EPS, etc.)',
      fields: ['id (PK)', 'symbolId (FK)', 'metricName', 'metricValue', 'metricText', 'period', 'reportDate', 'source', 'createdAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'SymbolTechnical',
      description: 'Technical indicators by timeframe',
      fields: ['id (PK)', 'symbolId (FK)', 'indicatorName', 'indicatorValue', 'timeframe', 'calculationDate', 'source', 'createdAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'ApiCalls',
      description: 'API call tracking for rate limiting',
      fields: ['id (PK)', 'provider', 'endpoint', 'callTime', 'responseCode', 'responseTimeMs', 'cacheHit', 'errorMessage'],
      relationships: [],
    },
    {
      table: 'DataSourcesMeta',
      description: 'Data source configurations',
      fields: ['id (PK)', 'sourceName', 'sourceType', 'configKey', 'configValue', 'isActive', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'ApiCredentials',
      description: 'Encrypted API credentials',
      fields: ['id (PK)', 'provider (unique with type)', 'credentialType', 'encryptedValue', 'isActive', 'expiresAt', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'CacheMeta',
      description: 'Cache metadata for intelligent invalidation and future queue-based warming',
      fields: ['id (PK)', 'cacheKey (unique)', 'cacheGroup', 'dataType', 'symbolId (FK)', 'expiresAt', 'invalidationTriggers', 'createdAt'],
      relationships: [],
    },
    {
      table: 'StrategyMeta',
      description: 'Strategy parameters and configs',
      fields: ['id (PK)', 'strategyId (FK)', 'parameterName', 'parameterValue', 'parameterType', 'isRequired', 'updatedAt'],
      relationships: ['← Strategy (many-to-one)'],
    },
    {
      table: 'StrategyPerformance',
      description: 'Strategy performance tracking',
      fields: ['id (PK)', 'strategyId (FK)', 'metricName', 'metricValue', 'periodStart', 'periodEnd', 'symbolId (FK)', 'calculatedAt'],
      relationships: ['← Strategy (many-to-one)', '← Symbol (many-to-one)'],
    },
    {
      table: 'UserPreferences',
      description: 'User trading preferences',
      fields: ['id (PK)', 'userId (FK)', 'preferenceKey', 'preferenceValue', 'preferenceType', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'Watchlist',
      description: 'User watchlists',
      fields: ['id (PK)', 'userId (FK)', 'name', 'symbolIds (JSON array)', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'WatchlistMeta',
      description: 'Watchlist metadata',
      fields: ['id (PK)', 'watchlistId (FK)', 'metaKey', 'metaValue', 'updatedAt'],
      relationships: ['← Watchlist (many-to-one)'],
    },
    {
      table: 'CronMeta',
      description: 'CRON job metadata and status',
      fields: ['id (PK)', 'jobName (unique)', 'jobStatus', 'lastRun', 'nextRun', 'runCount', 'errorCount', 'lastError', 'configData (JSON)', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'ProcessMeta',
      description: 'Background process metadata',
      fields: ['id (PK)', 'processName', 'processType', 'status', 'progressPercent', 'totalItems', 'processedItems', 'errorMessage', 'startedAt', 'completedAt', 'createdAt'],
      relationships: [],
    },
    {
      table: 'MarketSessions',
      description: 'Market session information',
      fields: ['id (PK)', 'exchange', 'sessionDate', 'sessionType', 'openTime', 'closeTime', 'isTradingDay', 'notes'],
      relationships: [],
    },
    {
      table: 'NewsMeta',
      description: 'News sentiment metadata',
      fields: ['id (PK)', 'newsId (FK)', 'sentimentScore', 'relevanceScore', 'symbolMentions (JSON)', 'keywords (JSON)', 'sourceReliability', 'analyzedAt'],
      relationships: [],
    },
    {
      table: 'Order',
      description: 'Trading orders',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'orderType', 'side', 'quantity', 'price', 'status', 'createdAt', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)', '← Strategy (many-to-one)'],
    },
    {
      table: 'OrderExecution',
      description: 'Order execution history',
      fields: ['id (PK)', 'orderId (FK)', 'executedQuantity', 'executedPrice', 'executionTime', 'commission', 'executionVenue'],
      relationships: ['← Order (many-to-one)'],
    },
    {
      table: 'Position',
      description: 'Open trading positions',
      fields: ['id (PK)', 'symbolId (FK)', 'quantity', 'averagePrice', 'currentPrice', 'unrealizedPnL', 'openedAt', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'Trade',
      description: 'Completed trade records',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'entryPrice', 'exitPrice', 'quantity', 'realizedPnL', 'entryTime', 'exitTime', 'duration'],
      relationships: ['← Symbol (many-to-one)', '← Strategy (many-to-one)'],
    },
  ],
  keyRelationships: [
    'Symbol is the central entity - connects to scores, signals, market data, and imports',
    'Strategy defines rules - directives execute strategy logic',
    'Score links Symbol + Strategy - stores evaluation results with breakdown',
    'Signal links Symbol + Strategy - actionable trading signals',
    'MarketBar stores OHLCV data - linked to Symbol for price history',
    'ImportRun tracks data imports - linked to Symbol for freshness tracking',
    'SymbolCalibration overrides directive weights per symbol - linked to Symbol + Directive',
    'FaqEntry provides searchable knowledge base - standalone table',
    'Planned: SymbolMeta/Fundamentals/Technical extend Symbol with additional data',
    'Planned: StrategyMeta/Performance extend Strategy with parameters and tracking',
    'Planned: Order/Position/Trade tables for order management and trade tracking',
  ],
  dataFlow: [
    '1. Symbol created → 2. ImportRun queued → 3. MarketBar data stored',
    '4. Strategy + Directives defined → 5. Score calculated using MarketBar data',
    '5b. SymbolCalibration applied to directive scores before aggregation (weight multipliers)',
    '6. Signal generated based on Score → 7. Order created from Signal (planned)',
    'ProviderHealth tracked independently - monitors data source availability',
    'Meta tables store extended attributes without modifying core schema',
  ],
}

export const SECTION_META = [
  { id: 'status', title: 'Status Snapshot', terms: [...STATUS_SNAPSHOT, ...CURRENT_SLICE] },
  { id: 'index', title: 'Architecture Index — 24-Section Parity', terms: [...ARCHITECTURE_INDEX.map(item => item.name), 'parity', '24-section'] },
  { id: 'tree', title: 'Architecture Tree', terms: [...DOMAINS, ...SYSTEM_SPINE] },
  { id: 'schema', title: 'Database Schema', terms: ['database', 'schema', 'entity', 'relationship', 'table', 'foreign key', 'symbol', 'strategy', 'score', 'signal', 'market', 'import', 'directive'] },
  { id: 'workflow', title: 'Decision Workflow', terms: DECISION_WORKFLOW.flatMap((item) => [item.title, item.summary, ...item.items]) },
  { id: 'matrix', title: 'Feature Decision Matrix', terms: FEATURE_MATRIX.flat() },
  { id: 'intake', title: 'Intake Template', terms: INTAKE_TEMPLATE.flatMap((item) => [item.title, ...item.items]) },
  { id: 'discovery', title: 'Discovery And Sources', terms: [...DISCOVERY_COMMANDS, ...INFORMATION_SOURCES] },
  { id: 'context', title: 'System Context', terms: SYSTEM_CONTEXTS.flat() },
  { id: 'owners', title: 'Owner Directory', terms: OWNER_DIRECTORY.flatMap((item) => [item.title, item.summary, ...item.items]) },
  { id: 'contracts', title: 'Contract Inventory', terms: [...CONTRACTS, ...CONTRACT_CARDS.flatMap((item) => [item.title, item.summary, ...item.items])] },
  { id: 'register', title: 'Current Contract Register', terms: [...CURRENT_ROUTE_CONTRACTS.flatMap((item) => Object.values(item)), ...CURRENT_FLOW_CONTRACTS.flatMap((item) => [item.title, ...item.facts])] },
  { id: 'queue', title: 'Queue And Provider Contract', terms: [...DATA_STATES.flat(), ...QUEUE_PROVIDER_CARDS.flatMap((item) => [item.title, item.summary, ...item.items])] },
  { id: 'scoring', title: 'Scoring And Strategy Contract', terms: SCORING_STRATEGY_CARDS.flatMap((item) => [item.title, item.summary, ...item.items]) },
  { id: 'calibration', title: 'Calibration System', terms: [...CALIBRATION_SYSTEM.flatMap((item) => [item.title, item.summary, ...item.items]), 'override', 'weight', 'multiplier', 'adjust', 'seed', 'DOGEUSD', 'NVDA', 'XAUUSD', 'BTCUSD', 'score pipeline'] },
  { id: 'activation-gate', title: 'Activation Gate And Conditions', terms: [...ACTIVATION_GATE_SYSTEM.flatMap((item) => [item.title, item.summary, ...item.items]), 'condition', 'gate', 'Hurst', 'entropy', 'BOS', 'break of structure', 'trigger', 'regime', 'suitability', 'boost', 'mute', 'reduce', 'volatility'] },
  { id: 'exit-signals', title: 'Exit Signal System', terms: [...EXIT_SIGNAL_SYSTEM.flatMap((item) => [item.title, item.summary, ...item.items]), 'exit', 'close', 'momentum', 'exhaustion', 'RSI', 'ATR', 'target', 'time stop', 'regime shift'] },
  { id: 'alerts', title: 'Alert Center Architecture', terms: [...ALERT_CENTER_ARCHITECTURE.flatMap((item) => [item.title, item.summary, ...item.items]), 'alert', 'notification', 'severity', 'critical', 'warning', 'snooze', 'dismiss', 'acknowledge', 'mt5 bridge', 'rate limit', 'stop-loss', 'history'] },
  { id: 'governance', title: 'Governance And Guardrails', terms: [...MAINTENANCE_WORKFLOW.flatMap((item) => [item.title, item.summary, ...item.items]), ...AI_GUARDRAILS.flatMap((item) => [item.title, item.summary, ...item.items]), ...VERIFICATION_GOVERNANCE.flatMap((item) => [item.title, item.summary, ...item.items]), ...DEFINITION_OF_DONE, ...HANDOFF_CHECKLIST] },
  { id: 'gaps', title: 'Known Gaps And Revision Log', terms: [...KNOWN_GAPS, ...REVISION_LOG] },
  { id: 'roadmap', title: 'Roadmap', terms: ['roadmap', 'issue', 'github', 'sprint', 'p0', 'p1', 'p2', 'task', 'status', 'priority'] },
]

export const ROADMAP_ITEMS = [
  {
    domain: 'Scoring Directive Engine',
    items: [
      { issue: 'Q207', label: 'MQL5 Directives Batch 1 — 12 directives (market-entropy, hurst-memory, BOS, liquidity-sweep, FVG, etc.)', status: 'done', gh: null },
      { issue: 'Q205', label: 'MQL5 Article Absorption 2 — Falling-Risk Pyramid, Price Time Gaps', status: 'done', gh: null },
      { issue: 'Q226', label: 'Directive Suitability Registry — 40+ directives tagged with regime, volatility, instrument, timeframe', status: 'done', gh: null },
      { issue: 'Q225', label: 'Condition Detector + Activation Gate — pre-scoring condition vector with active/reduced/muted/boosted', status: 'done', gh: null },
      { issue: 'Q231', label: 'Symbol Calibration System — 16 seeded calibrations with weight multipliers', status: 'done', gh: null },
      { issue: 'Q232', label: 'Volatility Envelope Directive — range percentiles, anomalous detection', status: 'done', gh: null },
      { issue: 'Q238', label: 'Exit Signal System — 4 exit directives (momentum-exhaustion, target-achieved, regime-shift-exit, time-stop)', status: 'done', gh: null },
      { issue: 'Q227', label: 'Trigger System — 8 built-in triggers (strong trend, high vol, compression, ranging, etc.)', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Provider integration and health',
    items: [
      { issue: 'Q139', label: 'MT5 Adapter + Python Flask Bridge on port 5000', status: 'done', gh: null },
      { issue: 'Q230', label: 'Trading212 Live Portfolio Import with Basic Auth', status: 'done', gh: null },
      { issue: 'Q144-Q148', label: 'Provider adapters: Yahoo Finance, Polygon.io, Finnhub, Twelve Data, FMP', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Trading execution',
    items: [
      { issue: 'Q229', label: 'MT5 Demo Trading — placeOrder, closePosition, closeAll, getPositions, getAccount', status: 'done', gh: null },
      { issue: 'Q251', label: 'Unified Trading Page — merged MT5 Trading + MT5 Demo Trading into UnifiedTradingPage', status: 'done', gh: null },
      { issue: 'Q300', label: 'Merge MT5 Trading Pages — final merge into single Mt5TradingPage with demo/live toggle, account switching, platform selector, safety confirmations', status: 'done', gh: null },
      { issue: 'Q241', label: 'Keyboard Speed Trading — B/S/C keys, size presets 1-5, Shift 2x, arrow scroll/zoom', status: 'done', gh: null },
      { issue: 'Q203', label: 'MT5 Paper Trading via bridge on demo account', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Alerting and monitoring',
    items: [
      { issue: 'Q185', label: 'Alert Center — 8 alert types, severity levels, live polling, snooze/dismiss/acknowledge', status: 'done', gh: null },
      { issue: 'Q142', label: 'Smart Health Indicator Bar — fallback mode detection, live status chips', status: 'done', gh: null },
      { issue: 'Q149', label: 'Notifications system (email, Windows toast, Telegram, Discord)', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Algorithm Lab and training',
    items: [
      { issue: 'Q170', label: 'Algorithm Lab — pipeline visualization (FETCH → SCORE → RANK → FILTER → SIGNAL)', status: 'done', gh: null },
      { issue: 'Q228', label: 'Candle Pattern Training Area — 8 pattern directives, TradingView charts, backtest explorer', status: 'done', gh: null },
      { issue: 'Q143', label: 'Backtest Chart — TradingView lightweight charts with RSI/MACD/EMA overlays', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Automation and scheduling',
    items: [
      { issue: 'Q135', label: 'Automated Daily Trading Scheduler — Mon-Fri 9AM cron ⚠️ NOT BUILT — zero trading cron jobs exist', status: 'planned', gh: null },
      { issue: 'Q137', label: 'Execution Gates — 5 gate layers from WP plugin', status: 'done', gh: null },
      { issue: 'Q136', label: 'Risk Management — SL, TP, position sizing, drawdown limits', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Strategy and portfolio',
    items: [
      { issue: 'Q171', label: 'Strategy Creation Spree — 20+ strategies with projections', status: 'done', gh: null },
      { issue: 'Q173', label: 'Strategy Templates replaced with Duplicate Strategy', status: 'done', gh: null },
      { issue: 'Q197', label: 'Built-In Strategies — 8 purpose-specific (Forex, CFD, VIX, Gold, etc.)', status: 'done', gh: null },
      { issue: 'Q335', label: 'Protocol Gating — multiplicative risk scoring, BTC Speed Protocol, rarity percentile gauge, protocols page', status: 'done', gh: null },
      { issue: 'Q336', label: 'Directive clamp audit — 29 Math.min(100) → this.maxScore, volume-confirmation bug fix', status: 'done', gh: null },
      { issue: 'Q337', label: 'Crypto directives unstubbed — fear-greed (Alternative.me), halving-cycle (4-phase), weekend-effect', status: 'done', gh: null },
      { issue: 'Q161', label: 'Portfolio view with real Trading212 data', status: 'done', gh: null },
      { issue: 'Q133', label: 'Trading strategy with scoring + allocation + automation ⚠️ NOT BUILT — strategy bridge prompt created, implementation pending', status: 'planned', gh: null },
    ],
  },
  {
    domain: 'UI and navigation',
    items: [
      { issue: 'Q199', label: 'Nav cleanup — SEES + Strategy Builder moved to Scoring area with dividers', status: 'done', gh: null },
      { issue: 'Q177-Q195', label: 'Pages: ScoringActivityLog, TradeJournal, AdvancedResearch, Watchlists, AlertCenter, Focus, DirectiveCapabilities, OpsArea, PerformanceLab', status: 'done', gh: null },
      { issue: 'Q196', label: 'SEES Live Stack fix — show 5 strategy directives, data source indicators', status: 'done', gh: null },
      { issue: 'Q209', label: 'Directives page — show all 71 directives, fix accordion, improved design', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Backend infrastructure',
    items: [
      { issue: 'Q141', label: 'Backend startup reliability fix', status: 'done', gh: null },
      { issue: 'Q214', label: 'Score Storage — persist ALL directive scores per run (ScoringRun + DirectiveRun models)', status: 'done', gh: null },
      { issue: 'Q152', label: 'Auth module — JWT + API keys skeleton', status: 'done', gh: null },
    ],
  },
  {
    domain: 'Planned / next',
    items: [
      { issue: 'Q218', label: 'GitHub Issues Batch 1 — Chart, Pullback, VIX, WebSocket, PHP Porting, Log Viewer, Docs', status: 'planned', gh: null },
      { issue: 'GH #1', label: 'Multi-Strategy Dashboard', status: 'planned', gh: 'https://github.com/FifeCIC/trading-command-suite/issues/1' },
      { issue: 'GH #2', label: 'TradingView Chart Integration', status: 'planned', gh: 'https://github.com/FifeCIC/trading-command-suite/issues/2' },
      { issue: 'GH #4', label: 'VIX News Sentiment Engine', status: 'planned', gh: 'https://github.com/FifeCIC/trading-command-suite/issues/4' },
    ],
  },
]
