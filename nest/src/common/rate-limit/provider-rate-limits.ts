/**
 * Provider Rate Limit Configuration
 * ==================================
 * Central source-of-truth for all provider rate limits.
 * Used by both RateLimiterMiddleware (inbound) and adapter RateLimitTracker (outbound).
 *
 * Each entry defines the minimum interval between calls to an endpoint.
 * The middleware enforces this on inbound requests to /api/* routes.
 * The adapter enforces this on outbound calls to the provider's API.
 *
 * refreshPolicy:
 *   'manual-only' — pages must NOT auto-refresh; user clicks Refresh button
 *   'auto'        — auto-refresh allowed (local sources, MT5, database)
 *   'auto-on-data'— auto-refresh only when new data arrives
 */

export type RefreshPolicy = 'manual-only' | 'auto' | 'auto-on-data';

export interface ProviderEndpointLimit {
  /** API path segment (e.g. 'account/cash', 'portfolio', 'orders/market') */
  endpoint: string;
  /** Minimum milliseconds between calls */
  minIntervalMs: number;
  /** Human-readable label */
  label: string;
}

export interface ProviderRateConfig {
  provider: string;
  routePatterns: string[];
  endpoints: ProviderEndpointLimit[];
  defaultIntervalMs: number;
  refreshPolicy: RefreshPolicy;
}

/**
 * Master rate-limit registry.
 * Add new providers here to get automatic middleware + adapter protection.
 */
export const PROVIDER_RATE_LIMITS: ProviderRateConfig[] = [
  {
    provider: 'trading212',
    routePatterns: [
      '/api/portfolio',
      '/api/portfolio/trading212',
      '/api/portfolio/holdings',
      '/api/portfolio/scores',
    ],
    endpoints: [
      { endpoint: 'account/cash', minIntervalMs: 2_500, label: 'Account (1 req / 2s recommended)' },
      { endpoint: 'portfolio', minIntervalMs: 5_500, label: 'Portfolio (1 req / 5s recommended)' },
      { endpoint: 'orders/market', minIntervalMs: 5_500, label: 'Orders (1 req / 5s recommended)' },
      { endpoint: 'orders/limit', minIntervalMs: 5_500, label: 'Limit Orders (1 req / 5s recommended)' },
      { endpoint: 'orders', minIntervalMs: 5_500, label: 'Order List (1 req / 5s recommended)' },
      { endpoint: 'quotes', minIntervalMs: 1_000, label: 'Quotes' },
      { endpoint: 'candles', minIntervalMs: 2_000, label: 'Candles' },
    ],
    defaultIntervalMs: 3_000,
    refreshPolicy: 'manual-only',
  },
  {
    provider: 'mt5',
    routePatterns: [
      '/api/providers/mt5',
      '/api/trading/mt5',
    ],
    endpoints: [
      { endpoint: 'account', minIntervalMs: 2_000, label: 'Account' },
      { endpoint: 'positions', minIntervalMs: 3_000, label: 'Positions' },
      { endpoint: 'order', minIntervalMs: 5_000, label: 'Order Placement' },
      { endpoint: 'history', minIntervalMs: 5_000, label: 'Trade History' },
    ],
    defaultIntervalMs: 3_000,
    refreshPolicy: 'auto',
  },
  {
    provider: 'alpaca',
    routePatterns: [
      '/api/providers/alpaca',
      '/api/providers/test/alpaca',
    ],
    endpoints: [
      { endpoint: 'account', minIntervalMs: 1_000, label: 'Account' },
      { endpoint: 'orders', minIntervalMs: 2_000, label: 'Orders' },
      { endpoint: 'positions', minIntervalMs: 2_000, label: 'Positions' },
    ],
    defaultIntervalMs: 1_000,
    refreshPolicy: 'manual-only',
  },
];

/**
 * Look up rate config for a provider.
 */
export function getProviderRateConfig(providerId: string): ProviderRateConfig | undefined {
  return PROVIDER_RATE_LIMITS.find((p) => p.provider === providerId);
}

/**
 * Get the minimum interval for a specific endpoint call.
 */
export function getEndpointInterval(providerId: string, endpointPath: string): number {
  const config = getProviderRateConfig(providerId);
  if (!config) return 5_000; // conservative default
  const match = config.endpoints.find((e) => endpointPath.includes(e.endpoint));
  return match?.minIntervalMs ?? config.defaultIntervalMs;
}
