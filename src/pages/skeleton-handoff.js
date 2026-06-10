export const SKELETON_HANDOFF = {
  eventsCalendar: {
    backendOwners: [
      'Queue scheduler service',
      'Import jobs controller',
      'Calendar normalization pipeline',
    ],
    endpointContracts: [
      'GET /api/providers/health',
      'GET /api/imports/runs',
      'POST /api/imports/trigger/:symbolId',
    ],
    seedTargets: [
      'Fill provider capabilities array in the local provider manifest',
      'Define event endpoint entries in the local endpoint catalog',
      'Keep endpoint metadata export deterministic for agent-generated JSON snapshots',
    ],
    rateLimitRules: [
      'Honor per-endpoint rate_limit values from trading212-endpoints.php',
      'Use queued refreshes instead of page-render API calls',
      'Log call cadence for later ApiCalls table tracking',
    ],
    stateShape: {
      events: [],
      eventLocks: [],
      importStatus: {
        lastRunAt: null,
        queueDepth: 0,
      },
    },
  },
  newsIntel: {
    backendOwners: [
      'Provider adapter contract layer',
      'News normalization worker',
      'Signal enrichment service',
    ],
    endpointContracts: [
      'GET /api/providers/health',
      'GET /api/imports/runs',
      'GET /api/market-data/freshness/:symbolId',
    ],
    seedTargets: [
      'Register provider metadata arrays in the local provider manifest',
      'Add endpoint payload examples in the local endpoint catalog',
      'Generate JSON fixture output from endpoint arrays for UI test stubs',
    ],
    rateLimitRules: [
      'Respect endpoint-specific rate_limit windows before polling feeds',
      'Prefer stored records then queue background refresh',
      'Record source provider and imported timestamp on each item',
    ],
    stateShape: {
      headlines: [],
      sentiment: {
        score: 0,
        drift: 'neutral',
      },
      relevanceBySymbol: {},
    },
  },
  signalsWorkbench: {
    backendOwners: [
      'Directive scoring service',
      'Provider-backed context adapter',
      'Execution handoff contract owner',
    ],
    endpointContracts: [
      'GET /api/market-data/freshness/:symbolId',
      'GET /api/providers/health',
      'POST /api/imports/trigger/:symbolId',
    ],
    seedTargets: [
      'Map directive input arrays to provider capability flags from the local provider manifest',
      'Build endpoint-to-signal lookup JSON from local endpoint definitions',
      'Keep payload keys stable so execution queue parsing remains deterministic',
    ],
    rateLimitRules: [
      'Throttle trigger actions based on provider endpoint limits',
      'Do not call external provider endpoints directly from React view logic',
      'Use queue-backed fetch and status chips for stale/queued/failed states',
    ],
    stateShape: {
      activeSignals: [],
      conflicts: [],
      queuePreview: {
        readyCount: 0,
        blockedCount: 0,
      },
    },
  },
  strategyBuilder: {
    backendOwners: [
      'Strategy schema service',
      'Validation and preset registry',
      'Backtest contract stub owner',
    ],
    endpointContracts: [
      'GET /api/providers/health',
      'GET /api/market-data/freshness/:symbolId',
      'POST /api/imports/trigger/:symbolId',
    ],
    seedTargets: [
      'Use provider feature arrays from the local provider manifest as strategy capability gates',
      'Generate strategy preset JSON with explicit provider + endpoint requirements',
      'Keep schema fields aligned with local config keys and DTO names',
    ],
    rateLimitRules: [
      'Prevent backtest stubs from bypassing provider call throttles',
      'Reject presets that imply unsupported endpoint cadence',
      'Surface endpoint pacing warnings inside validation output',
    ],
    stateShape: {
      strategyDraft: {
        name: '',
        rules: [],
        riskProfile: 'balanced',
      },
      validation: {
        errors: [],
        warnings: [],
      },
    },
  },
  riskControls: {
    backendOwners: [
      'Risk policy engine',
      'Session lock service',
      'Circuit breaker state machine',
    ],
    endpointContracts: [
      'GET /api/providers/health',
      'GET /api/imports/runs',
      'GET /api/market-data/freshness/:symbolId',
    ],
    seedTargets: [
      'Use endpoint arrays as risk policy source of truth for allowed actions',
      'Store rate-limit-derived cool-down windows in structured config JSON',
      'Mirror provider IDs exactly as declared in the local provider manifest',
    ],
    rateLimitRules: [
      'Risk checks must block actions that exceed provider cadence',
      'Apply stricter guardrails to order endpoints with 1-second windows',
      'Require queue-based retries rather than direct rapid resubmits',
    ],
    stateShape: {
      profiles: [],
      circuit: {
        state: 'ready',
        reason: null,
      },
      blockedActions: [],
    },
  },
  executionQueue: {
    backendOwners: [
      'Execution queue controller',
      'Broker adapter layer',
      'Retry and audit logging service',
    ],
    endpointContracts: [
      'GET /api/providers/health',
      'POST /api/imports/trigger/:symbolId',
      'POST /api/providers/local-bridge/ingest',
    ],
    seedTargets: [
      'Populate endpoint manifest arrays from the local endpoint catalog',
      'Generate idempotent queue payload JSON from endpoint metadata',
      'Keep order route mapping in sync with provider class methods',
    ],
    rateLimitRules: [
      'Use per-endpoint rate_limit values to schedule retry backoff',
      'Separate read and write endpoint cadence for broker safety',
      'Log endpoint + response code per dispatch attempt for diagnostics',
    ],
    stateShape: {
      queue: [],
      dispatchStats: {
        pending: 0,
        retries: 0,
      },
      lastError: null,
    },
  },
}
