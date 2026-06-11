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

import { Injectable, Logger } from '@nestjs/common';
import { IProviderAdapter } from './interfaces/provider-adapter.interface';

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

@Injectable()
export class AdapterFactory {
  private readonly logger = new Logger(AdapterFactory.name);
  private readonly registry = new Map<string, AdapterRegistration>();
  private readonly instances = new Map<string, IProviderAdapter>();
  private readonly instanceConfigs = new Map<string, AdapterConfig>();

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
      const instance = new registration.ctor();
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
   * Get the active adapter, with optional failover.
   * Tries providers in failoverPriority order until one returns a healthy instance.
   */
  getActive(preferredId?: string): IProviderAdapter | null {
    if (preferredId) {
      const instance = this.create(preferredId);
      if (instance) return instance;
    }

    // Sort by failover priority (lower = first)
    const sorted = Array.from(this.instanceConfigs.entries())
      .sort(([, a], [, b]) => a.failoverPriority - b.failoverPriority);

    for (const [id] of sorted) {
      if (id === preferredId) continue; // already tried
      const instance = this.instances.get(id);
      if (instance) return instance;
    }

    // Try creating any registered adapter
    for (const [id] of this.registry) {
      if (id === preferredId) continue;
      const instance = this.create(id);
      if (instance) return instance;
    }

    return null;
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
