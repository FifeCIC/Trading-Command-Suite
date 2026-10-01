/**
 * Provider Adapter Factory
 * =========================
 * Standardized factory for creating and managing provider adapters.
 * Handles registration, instantiation with auth/config, error states,
 * and failover between providers.
 *
 * Usage:
 *   const factory = new AdapterFactory();
 *   factory.register('alpaca', AlpacaAdapter, { apiKeyEnv: 'ALPACA_API_KEY' });
 *   const adapter = factory.create('alpaca');
 *   const candles = await adapter.getCandles('AAPL', '1h', 100);
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { IProviderAdapter, ProviderProfile } from './interfaces/provider-adapter.interface';
import { RateLimitTracker, RateLimitState } from './rate-limit-tracker';
import { RateLimitGovernor } from './rate-limit-governor.service';

/**
 * Capability types a provider can support.
 */
export type ProviderCapability = 'quotes' | 'candles' | 'profiles' | 'trades' | 'news' | 'fundamentals';

/**
 * Configuration metadata for a provider adapter.
 */
export interface AdapterConfig {
  /** Unique identifier (e.g. 'alpaca') */
  id: string;
  /** Human-readable name (e.g. 'Alpaca Markets') */
  name: string;
  /** Environment variable name for the API key */
  apiKeyEnv: string;
  /** Base URL for API calls */
  baseUrl?: string;
  /** Capabilities this provider supports */
  capabilities: ProviderCapability[];
  /** Active/disabled status */
  enabled: boolean;
  /** Priority for failover ordering (lower = higher priority) */
  failoverPriority: number;
}

/**
 * Constructor signature for adapter classes.
 */
export interface AdapterConstructor {
  new (...args: any[]): IProviderAdapter;
}

/**
 * Registration entry for a provider adapter type.
 */
interface AdapterRegistration {
  ctor: AdapterConstructor;
  config: AdapterConfig;
}

/**
 * A per-provider rate-limit view (#940). `source` names where the numbers came from, because the
 * governor shape and the tracker shape are NOT the same — merging them silently would hide which
 * fields are measured and which are a governor estimate.
 */
export type RateLimitView =
  | ({ source: 'tracker' } & RateLimitState)
  | ({ source: 'governor'; providerId: string } & Record<string, unknown>);

/** One provider that was asked for a profile and could not complete the request (#966). */
export interface ProfileFailure {
  provider: string;
  error: string;
}

/**
 * The outcome of a profile lookup (#966). Deliberately NOT `ProviderProfile | null` — three
 * genuinely different states collapse into that one shape, and the caller then renders them the
 * same way. See `AdapterFactory.resolveProfile()`.
 */
export interface ProfileResolution {
  profile: ProviderProfile | null;
  /** Which provider produced the profile, or null. */
  answeredBy: string | null;
  /** Every provider that was asked, in the order they were asked. */
  tried: string[];
  /** Providers whose request FAILED — "we could not judge". */
  failures: ProfileFailure[];
  /** Providers that answered cleanly and had nothing — "there is nothing to find". */
  emptyAnswers: string[];
  /** Every provider whose registration declares the `profiles` capability. */
  candidates: string[];
}

@Injectable()
export class AdapterFactory {
  private readonly logger = new Logger(AdapterFactory.name);
  private readonly registry = new Map<string, AdapterRegistration>();
  private readonly instances = new Map<string, IProviderAdapter>();
  private readonly instanceConfigs = new Map<string, AdapterConfig>();
  private readonly rateLimitTrackers = new Map<string, RateLimitTracker>();

  /**
   * ModuleRef lets us resolve adapter instances through the Nest DI container so
   * their injected dependencies (Logger services, PrismaService, BridgeEventService,
   * NotificationService, …) are actually wired. Without this, `new ctor()` produced
   * adapters with `undefined` deps — silently disabling bridge logging and order
   * persistence (GH #747). Optional so unit tests / manual `new AdapterFactory()`
   * still work, falling back to bare instantiation.
   */
  constructor(
    private readonly moduleRef?: ModuleRef,
    /**
     * GH #744 — the governor is the authoritative rate-limit source. It holds a real
     * per-provider limit table AND records live usage (every finnhub response calls
     * `recordCall`), whereas the factory's own trackers were never registered — so
     * selection saw `Infinity` remaining and never backed off. Optional so tests and
     * manual construction keep working.
     */
    @Optional() private readonly governor?: RateLimitGovernor,
  ) {}

  /** Below this many calls remaining, prefer another provider. */
  private static readonly MIN_REMAINING = 5;
  /**
   * Remaining value for a provider with no known limit. Deliberately FINITE: an
   * unknown provider must not win a "highest remaining" comparison against a
   * provider whose limit we actually know (that is the bug this replaced).
   */
  private static readonly UNKNOWN_REMAINING = 50;

  /**
   * GH #744 — make a missing governor LOUD. It is injected optionally so tests and
   * manual construction work, but in the running app its absence silently returns
   * selection to "everyone is unlimited", i.e. the exact outage this fixed.
   */
  onModuleInit(): void {
    if (!this.governor) {
      this.logger.warn(
        'No RateLimitGovernor injected — provider selection cannot see live rate limits ' +
        '(failover will not trigger; check ProvidersModule providers)',
      );
    }
  }

  /** Register a rate limit tracker for an adapter instance. */
  setRateLimiter(instanceId: string, tracker: RateLimitTracker): void {
    this.rateLimitTrackers.set(instanceId, tracker);
  }

  /**
   * Get the live rate-limit state for every provider (#940).
   *
   * ⚠️ The GOVERNOR is the authoritative source (GH #744) — it holds a real per-provider limit
   * table AND records live usage. This factory's own `rateLimitTrackers` were NEVER registered:
   * nothing calls `setRateLimiter`, so returning only those produced an EMPTY array on
   * `GET /api/providers/rate-limits` — the very surface the `provider-failover` diagram
   * describes. Governor state is the base; a factory tracker, when one exists, overrides it.
   *
   * Each entry carries `source: 'governor' | 'tracker'` so the origin is visible rather than
   * inferred — the two shapes differ, and silently merging them would hide which fields are real.
   */
  getAllRateLimits(): RateLimitView[] {
    const byId = new Map<string, RateLimitView>();
    const governorProviders = this.governor?.getStatus().providers ?? {};
    for (const [id, state] of Object.entries(governorProviders)) {
      byId.set(id, { source: 'governor', ...state });
    }
    for (const tracker of this.rateLimitTrackers.values()) {
      const state = tracker.getState();
      byId.set(state.providerId, { source: 'tracker', ...state });
    }
    return [...byId.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  /** Get tracker for a specific adapter instance. */
  getRateLimiter(instanceId: string): RateLimitTracker | undefined {
    return this.rateLimitTrackers.get(instanceId);
  }

  /**
   * resolveProfile() — ask every registered provider that DECLARES the `profiles` capability,
   * in failover-priority order, and REPORT what happened (#966).
   *
   * ⚠️ WHY THIS IS NOT `adapterFactory.create('finnhub').getProfile(...)` INLINE
   * --------------------------------------------------------------------------
   * That is what `SymbolsService.getSnapshot()` used to do, and it was wrong twice over:
   *
   *   1. **ONE hardcoded provider, no fallback.** Five registered adapters implement a real
   *      profile (finnhub, fmp, polygon, yahoo, alpha-vantage) and 3 of them have their API key
   *      set in `nest/.env`. A single name meant a Finnhub hiccup became "this company has no
   *      sector".
   *   2. **Every failure became the same `null`.** A dead key, a 429, a timeout and "this symbol
   *      genuinely has no profile" were indistinguishable at the API and rendered `—` in the UI —
   *      `development-philosophy` §7, "fine" and "cannot judge" must never render the same.
   *
   * The candidate list is DERIVED from the registry by declared capability, never typed here, so
   * registering a new profile-capable adapter in `providers.module.ts` is the only change needed —
   * the same rule #940 applied to `availableProviders`.
   *
   * Ordering is `failoverPriority` (low number = high priority), which is the existing meaning of
   * that field. Providers that are `enabled: false` are skipped.
   *
   * The result distinguishes the three outcomes the caller must not collapse:
   *   • `answeredBy` set           → a real profile
   *   • `emptyAnswers` non-empty   → providers were asked and none had one ("no profile exists")
   *   • `failures` non-empty       → providers were asked and the ASK FAILED (we cannot judge)
   */
  async resolveProfile(symbol: string): Promise<ProfileResolution> {
    const candidates = this.listAdapters()
      .filter((c) => c.enabled !== false && (c.capabilities || []).includes('profiles'))
      .sort((a, b) => (a.failoverPriority ?? 50) - (b.failoverPriority ?? 50))
      .map((c) => c.id);

    const tried: string[] = [];
    const failures: ProfileFailure[] = [];
    const emptyAnswers: string[] = [];

    for (const id of candidates) {
      tried.push(id);
      let adapter: IProviderAdapter | null = null;
      try {
        adapter = this.create(id);
      } catch (e) {
        failures.push({ provider: id, error: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (!adapter || typeof adapter.getProfile !== 'function') continue;
      try {
        const profile = await adapter.getProfile(symbol);
        // A profile counts as an ANSWER only if it carries a fundamental. A name-only response
        // must not short-circuit the chain — every adapter can echo the ticker back.
        if (profile && (profile.sector || profile.industry || profile.marketCap)) {
          return { profile, answeredBy: id, tried, failures, emptyAnswers, candidates };
        }
        emptyAnswers.push(id);
      } catch (e) {
        failures.push({ provider: id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return { profile: null, answeredBy: null, tried, failures, emptyAnswers, candidates };
  }

  /**
   * Register a provider adapter class with its configuration.
   * Does NOT create an instance — call create() to instantiate.
   */
  register(
    id: string,
    ctor: AdapterConstructor,
    config: Partial<AdapterConfig> = {},
  ): void {
    const defaults: AdapterConfig = {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      apiKeyEnv: `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`,
      capabilities: ['quotes', 'candles'],
      enabled: true,
      failoverPriority: 50,
    };

    const merged: AdapterConfig = { ...defaults, ...config, id };

    this.registry.set(id, { ctor, config: merged });
    this.logger.debug(`Registered adapter: ${id} (${merged.name})`);
  }

  /**
   * Instantiate an adapter, preferring the Nest DI-managed singleton so injected
   * dependencies are present. Falls back to a bare `new` when ModuleRef is absent
   * (tests) or the class is not a registered provider.
   */
  private instantiate(ctor: AdapterConstructor): IProviderAdapter {
    if (this.moduleRef) {
      try {
        return this.moduleRef.get(ctor as any, { strict: false }) as IProviderAdapter;
      } catch {
        // Not a DI provider (or not resolvable) — fall through to bare construction.
      }
    }
    return new ctor();
  }

  /**
   * Create (or retrieve cached) adapter instance.
   * Reads the API key from the environment on creation.
   */
  create(id: string): IProviderAdapter | null {
    const existing = this.instances.get(id);
    if (existing) return existing;

    const registration = this.registry.get(id);
    if (!registration) {
      this.logger.warn(`No adapter registered for id: ${id}`);
      return null;
    }

    if (!registration.config.enabled) {
      this.logger.debug(`Adapter ${id} is disabled, skipping creation`);
      return null;
    }

    try {
      const instance = this.instantiate(registration.ctor);
      this.instances.set(id, instance);
      this.instanceConfigs.set(id, registration.config);
      this.logger.log(`Created adapter instance: ${id}`);
      return instance;
    } catch (error) {
      this.logger.error(
        `Failed to create adapter ${id}: ${String(error)}`,
      );
      return null;
    }
  }

  /**
   * Get the active adapter with smart rate-limit-aware selection.
   * Picks the provider with the highest remaining rate limit, skipping providers
   * that are tripped or below MIN_REMAINING.
   *
   * GH #744: remaining now comes from the RateLimitGovernor (real per-provider
   * limit + live usage). It used to read only this factory's own trackers, which
   * nothing ever registered, so every provider looked unlimited (`Infinity`) and
   * the skip/failover logic below could never trigger.
   */
  getActive(preferredId?: string): IProviderAdapter | null {
    if (preferredId) {
      const instance = this.create(preferredId);
      if (instance) return instance;
    }

    // One governor snapshot per call — it rebuilds a status object for every
    // configured provider, so it must not run once per candidate.
    const governorStatus = this.governor?.getStatus().providers;

    // Collect all usable instances with their rate limit info
    const candidates: Array<{ id: string; instance: IProviderAdapter; remaining: number }> = [];
    const throttled: Array<{ id: string; instance: IProviderAdapter; remaining: number; reason: string }> = [];

    for (const [id, instance] of this.instances) {
      const { remaining, reason } = this.remainingFor(id, governorStatus);

      if (reason) {
        this.logger.debug(`Skipping ${id} — ${reason}`);
        throttled.push({ id, instance, remaining, reason });
        continue;
      }
      if (remaining < AdapterFactory.MIN_REMAINING) {
        const low = `${remaining} remaining (<${AdapterFactory.MIN_REMAINING})`;
        this.logger.debug(`Skipping ${id} — ${low}`);
        throttled.push({ id, instance, remaining, reason: low });
        continue;
      }

      candidates.push({ id, instance, remaining });
    }

    if (candidates.length === 0 && throttled.length > 0) {
      // Everything is throttled. Return the least-exhausted provider rather than
      // falling through to "create anything from the registry", which bypassed the
      // limits entirely — the path that burned API keys.
      throttled.sort((a, b) => b.remaining - a.remaining);
      const pick = throttled[0];
      this.logger.warn(
        `All providers throttled — least-exhausted is ${pick.id} (${pick.reason})`,
      );
      return pick.instance;
    }

    if (candidates.length === 0) {
      // No cached instances — try creating from registry in priority order
      const sorted = Array.from(this.registry.entries())
        .sort(([, a], [, b]) => a.config.failoverPriority - b.config.failoverPriority);

      for (const [id] of sorted) {
        const instance = this.create(id);
        if (instance) return instance;
      }
      return null;
    }

    // Pick the candidate with the highest remaining rate limit
    candidates.sort((a, b) => b.remaining - a.remaining);

    // Always state the choice and its remaining budget — GH #744's acceptance
    // criterion is a finite count in this log (it used to read "Infinity").
    const summary = candidates.length > 1
      ? `${candidates[0].id} (${candidates[0].remaining} remaining) over ${candidates[1].id} (${candidates[1].remaining} remaining)`
      : `${candidates[0].id} (${candidates[0].remaining} remaining)`;
    this.logger.debug(`Rate-limit aware selection: ${summary}`);

    return candidates[0].instance;
  }

  /**
   * Remaining calls for a provider, from the single authoritative source:
   * a tracker registered for this instance → the governor → a finite default.
   * Never `Infinity` (GH #744).
   */
  private remainingFor(
    id: string,
    governorStatus?: Record<string, { remainingEstimate: number }>,
  ): { remaining: number; reason?: string } {
    const tracker = this.rateLimitTrackers.get(id);
    if (tracker) {
      const state = tracker.getState();
      if (!tracker.isUsable()) return { remaining: state.remaining, reason: 'rate limited or tripped' };
      return { remaining: state.remaining };
    }

    const status = governorStatus?.[id];
    if (this.governor && status) {
      const verdict = this.governor.canCall(id);
      if (!verdict.allowed) {
        return { remaining: status.remainingEstimate, reason: verdict.reason ?? 'not allowed right now' };
      }
      return { remaining: status.remainingEstimate };
    }

    return { remaining: AdapterFactory.UNKNOWN_REMAINING };
  }

  /**
   * Get an adapter's configuration.
   */
  getConfig(id: string): AdapterConfig | null {
    return this.instanceConfigs.get(id) ?? this.registry.get(id)?.config ?? null;
  }

  /**
   * List all registered adapter IDs and their configs.
   */
  listAdapters(): AdapterConfig[] {
    const configs: AdapterConfig[] = [];
    for (const [id] of this.registry) {
      configs.push(this.instanceConfigs.get(id) ?? this.registry.get(id)!.config);
    }
    return configs;
  }

  /**
   * Get all adapter instances that support brokerage operations
   * (portfolio queries, order execution).
   * Used by the automation loop to iterate over connected brokers.
   */
  getBrokerageAdapters(): IProviderAdapter[] {
    const brokers: IProviderAdapter[] = [];
    for (const [id, instance] of this.instances) {
      if (instance.supportsBrokerage) {
        brokers.push(instance);
      }
    }
    // Also check registered-but-not-yet-created adapters with 'trades' capability
    for (const [id, reg] of this.registry) {
      if (!this.instances.has(id) && reg.config.capabilities.includes('trades')) {
        const instance = this.create(id);
        if (instance?.supportsBrokerage) {
          brokers.push(instance);
        }
      }
    }
    return brokers;
  }

  /**
   * Check if a provider has credentials configured.
   */
  hasCredentials(id: string): boolean {
    const config = this.getConfig(id);
    if (!config) return false;
    return Boolean(process.env[config.apiKeyEnv]);
  }

  /**
   * Get credentials for a provider as a headers-compatible object.
   */
  getCredentials(id: string): Record<string, string> | null {
    const config = this.getConfig(id);
    if (!config) return null;
    const key = process.env[config.apiKeyEnv];
    if (!key) return null;
    return { 'X-API-Key': key };
  }
}
