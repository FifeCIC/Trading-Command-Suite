import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './architecture-framework.css'

const STATUS_SNAPSHOT = [
  'This page is the implementation front door for architecture-sensitive work.',
  'Use the workflow, matrix, intake, discovery, and contract sections before editing.',
  'Real contracts should live here, not only planning notes.',
  'Open decisions stay visible on the same surface as the rules.',
]

const ARCHITECTURE_INDEX = [
  'Status snapshot',
  'Architecture index',
  'Architecture tree',
  'Decision workflow',
  'Feature decision matrix',
  'Intake template',
  'Discovery commands',
  'Information sources',
  'System context',
  'Owner directory',
  'Contract inventory',
  'Current contract register',
  'Queue/provider contract',
  'Scoring/strategy contract',
  'AI guardrails',
  'Verification governance',
  'Definition of done',
  'Handoff checklist',
  'Known gaps',
  'Revision log',
]

const DOMAINS = [
  'Market data import and freshness',
  'Provider integration and health',
  'Directive execution',
  'Strategy aggregation',
  'Scoring and ranking',
  'Signals and decision support',
  'SEES presentation layer',
  'Operational governance and verification',
]

const SYSTEM_SPINE = [
  'Symbol selected',
  'Freshness checked',
  'Import triggered if stale or missing',
  'Market data stored',
  'Directives executed',
  'Strategy aggregates directive outputs',
  'Score and breakdown stored',
  'SEES ranks symbols',
  'User inspects rationale and timeframe fit',
]

const CURRENT_SLICE = [
  'Symbol CRUD is in place in NestJS',
  'Freshness check endpoint is implemented',
  'Import queue trigger and processor are implemented',
  'Provider health endpoint is implemented',
  'SEES mock page is already available in the shell',
]

const DECISION_WORKFLOW = [
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

const FEATURE_MATRIX = [
  ['Bridge payload or local setup', 'Bridge/provider layer', 'Bridge route, token, payload, normalization, storage'],
  ['External provider integration', 'Provider factory and queue processor', 'Provider adapter plus queue and storage contract'],
  ['Admin or React UI', 'Presentation layer', 'UI data mode plus endpoint response contract'],
  ['Background import or refresh', 'Queue/data runtime', 'Queue action plus storage and UI status contract'],
  ['Scoring directive or strategy', 'Scoring system', 'Directive/strategy input, output, scale, and fixtures'],
  ['REST endpoint', 'Endpoint owner', 'Method, auth, request, response, failures'],
  ['Database or storage change', 'Storage owner', 'Owner, schema version, read path, write path, retention'],
  ['Security or admin action', 'Security/form handling layer', 'Auth, sanitization, escaping, redaction'],
]

const INTAKE_TEMPLATE = [
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

const DISCOVERY_COMMANDS = [
  'Inspect routes, handlers, queues, storage, providers, assets, scoring, and security paths before implementation.',
  'Use discovery to find the existing owner rather than creating a second system.',
  'Treat discovery as part of the feature, not optional prep work.',
]

const INFORMATION_SOURCES = [
  'Runtime facts and registered application boundaries',
  'Existing codebase contracts and owner classes',
  'Bridge and provider evidence',
  'Queue and storage flow',
  'React and admin UI contracts',
  'Security and verification evidence',
]

const SYSTEM_CONTEXTS = [
  ['Platform Runtime', 'Owns routing, scheduling, auth boundaries, storage access, and asset registration.'],
  ['Core Application', 'Owns shared architecture: directives, freshness, queues, providers, storage, diagnostics, and UI contracts.'],
  ['Extensions', 'Add packaging or extension-specific behavior without duplicating core contracts.'],
  ['Local Bridge', 'Posts local data through the approved ingest boundary and token model.'],
  ['External Providers', 'Supply data through capability, credential, queue, normalization, and storage rules.'],
  ['Background Queue And Storage', 'Handles slow work, duplicate prevention, retries, status, and persistence.'],
  ['Admin And React UI', 'Shows explicit data states and triggers approved actions through endpoints.'],
]

const OWNER_DIRECTORY = [
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

const CONTRACTS = [
  'REST route contract',
  'Queue action contract',
  'Storage contract',
  'Provider adapter contract',
  'Bridge payload contract',
  'UI data mode contract',
  'Directive and strategy contract',
]

const CONTRACT_CARDS = [
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

const CURRENT_ROUTE_CONTRACTS = [
  {
    route: 'POST /providers/local-bridge/ingest',
    method: 'POST',
    permission: 'Token-protected local bridge boundary',
    owner: 'Bridge ingest controller',
    contract: 'Accepts local payloads, verifies token, normalizes fields, stores rows, and returns health.',
  },
  {
    route: 'GET /providers/local-bridge/latest',
    method: 'GET',
    permission: 'Authenticated operator or admin access',
    owner: 'Bridge read controller',
    contract: 'Reads latest stored rows with filters and does not call the source bridge directly.',
  },
  {
    route: 'GET /providers/health',
    method: 'GET',
    permission: 'Authenticated operator or admin access',
    owner: 'Provider health controller',
    contract: 'Returns stored provider health from application state.',
  },
  {
    route: 'GET /market-data/freshness/:symbolId',
    method: 'GET',
    permission: 'Authenticated local operator access',
    owner: 'Market data controller',
    contract: 'Checks staleness against stored bars and may queue refresh when configured.',
  },
  {
    route: 'POST /imports/trigger/:symbolId',
    method: 'POST',
    permission: 'Authenticated local operator access',
    owner: 'Import jobs controller',
    contract: 'Queues import work and records a concrete import run.',
  },
]

const CURRENT_FLOW_CONTRACTS = [
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

const DATA_STATES = [
  ['stored', 'Fresh or acceptable stored data exists.'],
  ['cached', 'A cached snapshot is serving the view.'],
  ['stale', 'Stored data exists but is older than the allowed SLA.'],
  ['queued', 'A refresh/import/scoring item is pending or processing.'],
  ['empty', 'No stored data is available yet.'],
  ['failed', 'The last provider, queue, normalization, or storage attempt failed.'],
  ['no-provider', 'No configured provider can supply the required data shape.'],
  ['developer-demo', 'Demo data is visible only in developer mode.'],
]

const QUEUE_PROVIDER_CARDS = [
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

const SCORING_STRATEGY_CARDS = [
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
    summary: 'Scores must be interpreted through directive or strategy metadata, not global assumptions.',
    items: [
      'Output must state score value, max score or scale, confidence or evidence, and failure or insufficient-data reason.',
      'Tests and UI must not assume every score is a hard-coded 0-100 percentage.',
      'If a directive produces components, store enough evidence for diagnostics and explanation.',
    ],
  },
  {
    title: 'Strategy Contract',
    summary: 'Strategies combine directive outputs through explicit weights, thresholds, and eligibility rules.',
    items: [
      'Document enabled directives, weights, thresholds, symbol universe, required data, and score aggregation method.',
      'Validate strategy configuration before execution and surface missing directive or data requirements clearly.',
      'Do not silently skip required directives without recording evidence and UI state.',
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

const MAINTENANCE_WORKFLOW = [
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

const AI_GUARDRAILS = [
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

const VERIFICATION_GOVERNANCE = [
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

const GOVERNANCE = [
  'Classify the work and inspect the owner before building.',
  'Preserve the selected contract and data flow during implementation.',
  'Run focused verification after implementation.',
  'Update the framework when contracts or responsibilities change.',
]

const DEFINITION_OF_DONE = [
  'Ownership confirmed.',
  'Contract updated.',
  'Data flow preserved.',
  'Security preserved.',
  'UI state is honest.',
  'Verification recorded.',
]

const HANDOFF_CHECKLIST = [
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

const KNOWN_GAPS = [
  'Core versus extension boundary still needs final ownership rules in some areas.',
  'React endpoint schema standard should become explicit early.',
  'Automated architecture inventory is still a future decision.',
  'Browser-level verification path is not automated yet.',
  'This page should later reflect live contracts and system state.',
]

const REVISION_LOG = [
  'Front Door: added workflow, matrix, intake, and discovery concepts.',
  'System Boundaries: added context and ownership visibility.',
  'Contracts: added concrete route, bridge, queue, UI, and scoring contract categories.',
  'Governance: added guardrails, verification, definition of done, and gaps.',
]

const SECTION_META = [
  { id: 'status', title: 'Status Snapshot', terms: [...STATUS_SNAPSHOT, ...CURRENT_SLICE] },
  { id: 'tree', title: 'Architecture Tree', terms: [...DOMAINS, ...SYSTEM_SPINE] },
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
  { id: 'governance', title: 'Governance And Guardrails', terms: [...MAINTENANCE_WORKFLOW.flatMap((item) => [item.title, item.summary, ...item.items]), ...AI_GUARDRAILS.flatMap((item) => [item.title, item.summary, ...item.items]), ...VERIFICATION_GOVERNANCE.flatMap((item) => [item.title, item.summary, ...item.items]), ...DEFINITION_OF_DONE, ...HANDOFF_CHECKLIST] },
  { id: 'gaps', title: 'Known Gaps And Revision Log', terms: [...KNOWN_GAPS, ...REVISION_LOG] },
]

function normalize(value) {
  return String(value).toLowerCase()
}

function matchesQuery(query, terms) {
  if (!query) {
    return true
  }

  const lower = normalize(query)
  return terms.some((term) => normalize(term).includes(lower))
}

function SectionBlock({ id, title, summary, collapsed, onToggle, children }) {
  return (
    <section id={id} className="architecture-section">
      <div className="architecture-section-header">
        <div>
          <h2>{title}</h2>
          {summary && <p>{summary}</p>}
        </div>
        <button type="button" className="architecture-toggle" onClick={() => onToggle(id)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && children}
    </section>
  )
}

function CardGrid({ cards }) {
  return (
    <div className="architecture-grid architecture-grid-wide">
      {cards.map((card) => (
        <article className="architecture-card" key={card.title}>
          <h3>{card.title}</h3>
          <p>{card.summary}</p>
          <ul>
            {card.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

export default function ArchitectureFrameworkPage() {
  const [query, setQuery] = useState('')
  const [collapsedSections, setCollapsedSections] = useState([])

  const providerHealthQuery = useQuery({
    queryKey: ['architecture', 'provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
  })

  const importRunsQuery = useQuery({
    queryKey: ['architecture', 'import-runs'],
    queryFn: () => apiGet('/api/imports/runs?limit=5'),
  })

  const providerHealth = Array.isArray(providerHealthQuery.data) ? providerHealthQuery.data : []
  const recentImportRuns = Array.isArray(importRunsQuery.data) ? importRunsQuery.data : []

  const visibleSections = useMemo(() => {
    return SECTION_META.filter((section) => matchesQuery(query, section.terms))
  }, [query])

  const visibleIds = useMemo(() => new Set(visibleSections.map((section) => section.id)), [visibleSections])

  function toggleSection(sectionId) {
    setCollapsedSections((current) =>
      current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId],
    )
  }

  function collapseAll() {
    setCollapsedSections(SECTION_META.map((section) => section.id))
  }

  function expandAll() {
    setCollapsedSections([])
  }

  return (
    <main className="architecture-page">
      <section className="architecture-hero">
        <div>
          <p className="eyebrow">Trading Command Suite</p>
          <h1>Architecture Framework</h1>
          <p className="architecture-subcopy">
            This page is the in-app mirror of the project north star. It exists early so design,
            implementation, and AI-assisted work all reference the same model while the system is still small.
          </p>
        </div>
        <div className="architecture-status-card">
          <p><strong>Priority:</strong> P0 foundation</p>
          <p><strong>Role:</strong> active decision reference</p>
          <p><strong>Mode:</strong> interactive shell now, live contract surface next</p>
        </div>
      </section>

      <section className="architecture-controls-bar">
        <label className="architecture-search">
          <span>Filter Sections</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflow, contracts, owners, queues..."
          />
        </label>
        <div className="architecture-actions">
          <button type="button" onClick={expandAll}>Expand All</button>
          <button type="button" onClick={collapseAll}>Collapse All</button>
        </div>
      </section>

      <section className="architecture-index-shell">
        <h2>Architecture Index</h2>
        <div className="architecture-index-grid">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="architecture-index-chip"
              onClick={() => scrollToSection(section.id)}
            >
              {section.title}
            </button>
          ))}
        </div>
      </section>

      {visibleIds.has('status') && (
        <SectionBlock
          id="status"
          title="Status Snapshot"
          summary="Quick orientation before using the detailed sections below."
          collapsed={collapsedSections.includes('status')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Operating Mode</h3>
              <ul>
                {STATUS_SNAPSHOT.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Current Build Slice</h3>
              <ul>
                {CURRENT_SLICE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Live Runtime Snapshot</h3>
              {providerHealthQuery.isLoading && <p>Checking provider health...</p>}
              {providerHealthQuery.error && <p>Provider health is not reachable from this shell yet.</p>}
              {!providerHealthQuery.isLoading && !providerHealthQuery.error && (
                <ul>
                  <li>Providers tracked: {providerHealth.length}</li>
                  <li>
                    Healthy providers: {providerHealth.filter((item) => item.status === 'healthy').length}
                  </li>
                  <li>
                    Missing credentials: {providerHealth.filter((item) => item.status === 'missing-credentials').length}
                  </li>
                  <li>Recent import runs loaded: {recentImportRuns.length}</li>
                </ul>
              )}
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('tree') && (
        <SectionBlock
          id="tree"
          title="Architecture Tree"
          summary="The React version keeps the same knowledge shape as the mapper: domains, components, contracts, workflows, and verification rules in one place."
          collapsed={collapsedSections.includes('tree')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Core Domains</h3>
              <ul>
                {DOMAINS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>System Spine</h3>
              <ol>
                {SYSTEM_SPINE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('workflow') && (
        <SectionBlock
          id="workflow"
          title="Decision Workflow"
          summary="Start here before changing code. This keeps new work aligned with existing systems, data contracts, security boundaries, and future UI needs."
          collapsed={collapsedSections.includes('workflow')}
          onToggle={toggleSection}
        >
          <CardGrid cards={DECISION_WORKFLOW} />
        </SectionBlock>
      )}

      {visibleIds.has('matrix') && (
        <SectionBlock
          id="matrix"
          title="Feature Decision Matrix"
          summary="After classifying a change, use this matrix to choose the likely owner and required contract."
          collapsed={collapsedSections.includes('matrix')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>Feature Type</th>
                    <th>Likely Owner</th>
                    <th>Required Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_MATRIX.map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td>{row[1]}</td>
                      <td>{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('intake') && (
        <SectionBlock
          id="intake"
          title="Intake Template"
          summary="Use this intake before architecture-sensitive work so the owner, data flow, contract, and verification path are explicit."
          collapsed={collapsedSections.includes('intake')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            {INTAKE_TEMPLATE.map((group) => (
              <article className="architecture-card" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('discovery') && (
        <SectionBlock
          id="discovery"
          title="Discovery And Sources"
          summary="Use discovery to find existing routes, handlers, storage, queues, assets, scoring contracts, and boundary evidence before implementation."
          collapsed={collapsedSections.includes('discovery')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Discovery Commands</h3>
              <ul>
                {DISCOVERY_COMMANDS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Information Sources</h3>
              <ul>
                {INFORMATION_SOURCES.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('context') && (
        <SectionBlock
          id="context"
          title="System Context"
          summary="Use these boundaries to decide where work belongs before creating files, routes, storage, queues, or UI components."
          collapsed={collapsedSections.includes('context')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            {SYSTEM_CONTEXTS.map((item) => (
              <article className="architecture-card" key={item[0]}>
                <h3>{item[0]}</h3>
                <p>{item[1]}</p>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('owners') && (
        <SectionBlock
          id="owners"
          title="Owner Directory"
          summary="Use this directory to find the first place to inspect or extend before creating new implementation paths."
          collapsed={collapsedSections.includes('owners')}
          onToggle={toggleSection}
        >
          <CardGrid cards={OWNER_DIRECTORY} />
        </SectionBlock>
      )}

      {visibleIds.has('contracts') && (
        <SectionBlock
          id="contracts"
          title="Contract Inventory"
          summary="Use these contract cards when a feature adds or changes routes, queues, storage, UI data modes, or bridge payloads."
          collapsed={collapsedSections.includes('contracts')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Contract Types</h3>
              <ul>
                {CONTRACTS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
          <CardGrid cards={CONTRACT_CARDS} />
        </SectionBlock>
      )}

      {visibleIds.has('register') && (
        <SectionBlock
          id="register"
          title="Current Contract Register"
          summary="Concrete contracts already present in the codebase or now established as migration proofs. Update this when routes, payloads, read paths, or response shapes change."
          collapsed={collapsedSections.includes('register')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Method</th>
                    <th>Permission</th>
                    <th>Owner</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENT_ROUTE_CONTRACTS.map((row) => (
                    <tr key={row.route}>
                      <td>{row.route}</td>
                      <td>{row.method}</td>
                      <td>{row.permission}</td>
                      <td>{row.owner}</td>
                      <td>{row.contract}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="architecture-card architecture-card-full">
            <h3>Live Provider Health Register</h3>
            {providerHealthQuery.isLoading && <p>Loading live provider health...</p>}
            {providerHealthQuery.error && <p>Live provider health is not available from the current API base URL.</p>}
            {!providerHealthQuery.isLoading && !providerHealthQuery.error && providerHealth.length === 0 && (
              <p>No provider health entries have been recorded yet.</p>
            )}
            {!providerHealthQuery.isLoading && !providerHealthQuery.error && providerHealth.length > 0 && (
              <div className="architecture-table-wrap">
                <table className="architecture-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Credentials</th>
                      <th>Checked At</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerHealth.map((row) => (
                      <tr key={row.provider}>
                        <td>{row.displayName || row.provider}</td>
                        <td>{row.status}</td>
                        <td>{row.credentialsConfigured ? 'configured' : 'missing'}</td>
                        <td>{row.checkedAt || 'not yet checked'}</td>
                        <td>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="architecture-card architecture-card-full">
            <h3>Recent Import Runs</h3>
            {importRunsQuery.isLoading && <p>Loading recent import runs...</p>}
            {importRunsQuery.error && <p>Recent import runs are not reachable from the current API base URL.</p>}
            {!importRunsQuery.isLoading && !importRunsQuery.error && recentImportRuns.length === 0 && (
              <p>No import runs have been recorded yet.</p>
            )}
            {!importRunsQuery.isLoading && !importRunsQuery.error && recentImportRuns.length > 0 && (
              <div className="architecture-table-wrap">
                <table className="architecture-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Provider</th>
                      <th>Timeframe</th>
                      <th>Status</th>
                      <th>Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentImportRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{run.symbol?.ticker || run.symbolId}</td>
                        <td>{run.provider}</td>
                        <td>{run.timeframe}</td>
                        <td>{run.status}</td>
                        <td>{run.requestedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="architecture-grid architecture-grid-wide">
            {CURRENT_FLOW_CONTRACTS.map((flow) => (
              <article className="architecture-card" key={flow.title}>
                <h3>{flow.title}</h3>
                <ul>
                  {flow.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('queue') && (
        <SectionBlock
          id="queue"
          title="Queue And Provider Contract"
          summary="Concrete rules for provider-backed data so external calls stay behind freshness, queue, adapter, storage, and UI status boundaries."
          collapsed={collapsedSections.includes('queue')}
          onToggle={toggleSection}
        >
          <CardGrid cards={QUEUE_PROVIDER_CARDS} />
          <div className="architecture-card architecture-card-full">
            <h3>Queue And UI Data States</h3>
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {DATA_STATES.map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td>{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('scoring') && (
        <SectionBlock
          id="scoring"
          title="Scoring And Strategy Contract"
          summary="Concrete rules for directive, strategy, stored-score, and scoring UI work so score behavior remains testable and explainable."
          collapsed={collapsedSections.includes('scoring')}
          onToggle={toggleSection}
        >
          <CardGrid cards={SCORING_STRATEGY_CARDS} />
        </SectionBlock>
      )}

      {visibleIds.has('governance') && (
        <SectionBlock
          id="governance"
          title="Governance And Guardrails"
          summary="Use these workflow, guardrail, verification, and completion rules to keep architecture-sensitive work reliable."
          collapsed={collapsedSections.includes('governance')}
          onToggle={toggleSection}
        >
          <CardGrid cards={MAINTENANCE_WORKFLOW} />
          <CardGrid cards={AI_GUARDRAILS} />
          <CardGrid cards={VERIFICATION_GOVERNANCE} />
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Definition Of Done</h3>
              <ul>
                {DEFINITION_OF_DONE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Handoff Checklist</h3>
              <ul>
                {HANDOFF_CHECKLIST.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('gaps') && (
        <SectionBlock
          id="gaps"
          title="Known Gaps And Revision Log"
          summary="Keep unresolved architecture decisions and local change history visible on the same page as the implementation rules."
          collapsed={collapsedSections.includes('gaps')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Known Gaps</h3>
              <ul>
                {KNOWN_GAPS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Revision Log</h3>
              <ul>
                {REVISION_LOG.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}
    </main>
  )
}
