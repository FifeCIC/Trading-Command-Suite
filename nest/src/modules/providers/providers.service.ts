import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { AdapterFactory } from './adapter-factory';
import { IProviderAdapter } from './interfaces/provider-adapter.interface';

/**
 * Providers whose MARKET-DATA endpoints are public — no API key required (#891).
 *
 * ⚠️ WHY THIS IS A DISPLAY RULE, NOT A GATE
 * -----------------------------------------
 * `GET /api/providers/health` reported binance as `missing-credentials`
 * ("Missing API credentials"), which reads as "the data path is broken".
 * It is not: Binance's klines/ticker endpoints are public — verified by
 * fetching 12,000 crypto bars with no key in the environment (#891). The
 * missing credential is real for TRADING (no key = no orders, and no order
 * path exists yet) and irrelevant for market data. `hasCredentials()` is only
 * consulted for display and recording, so this set changes the LABEL a human
 * reads, never a fetch.
 */
const CREDENTIAL_FREE_DATA_PROVIDERS = new Set(['binance']);

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Get the active provider adapter based on environment config or factory failover.
   */
  getActiveAdapter(): IProviderAdapter {
    const preferredId = process.env.PROVIDER_ACTIVE?.toLowerCase();
    const instance = this.adapterFactory.getActive(preferredId);

    if (instance) return instance;

    // Last resort: try creating any registered adapter
    const adapters = this.adapterFactory.listAdapters();
    for (const config of adapters) {
      const created = this.adapterFactory.create(config.id);
      if (created) return created;
    }

    this.logger.error('No provider adapters available');
    throw new Error('No provider adapters registered');
  }

  /**
   * Get a specific adapter by ID via the factory.
   */
  getAdapter(providerId: string): IProviderAdapter | null {
    return this.adapterFactory.create(providerId.toLowerCase());
  }

  /**
   * Get all available adapters via the factory.
   */
  getAllAdapters(): IProviderAdapter[] {
    const instances: IProviderAdapter[] = [];
    for (const config of this.adapterFactory.listAdapters()) {
      const instance = this.adapterFactory.create(config.id);
      if (instance) instances.push(instance);
    }
    return instances;
  }

  async getHealth() {
    const modeInfo = this.modeService.getModeInfo();
    let dbRows: Awaited<
      ReturnType<PrismaService['providerHealth']['findMany']>
    > = [];

    try {
      dbRows = await this.prisma.providerHealth.findMany();
    } catch (error) {
      this.logger.warn(
        `Database unavailable while loading provider health: ${String(error)}`,
      );
    }

    const dbByProvider = new Map(
      dbRows.map((row) => [row.provider.toLowerCase(), row]),
    );
    const activeAdapter = this.getActiveAdapter();
    const adapterConfigs = this.adapterFactory.listAdapters();

    return {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      activeProvider: activeAdapter?.name ?? null,
      providers: adapterConfigs.map((config) => {
        const credentialsConfigured = this.adapterFactory.hasCredentials(config.id);
        // Public market-data provider (e.g. binance): no key is EXPECTED, so a
        // missing key is not a fault — see CREDENTIAL_FREE_DATA_PROVIDERS above.
        const credentialFree = CREDENTIAL_FREE_DATA_PROVIDERS.has(config.id);
        const row: any = dbByProvider.get(config.id);
        const adapter = this.adapterFactory.create(config.id);

        return {
          provider: config.id,
          displayName: config.name,
          endpoint: config.baseUrl ?? '',
          adapterType: adapter?.name || 'Unknown',
          credentialsConfigured,
          status:
            row?.status ??
            (credentialsConfigured || credentialFree ? 'unknown' : 'missing-credentials'),
          message:
            row?.message ??
            (credentialsConfigured
              ? 'No health check recorded yet'
              : credentialFree
                ? 'No API key required for market data'
                : 'Missing API credentials'),
          checkedAt: row?.checkedAt?.toISOString() ?? null,
          latencyMs: row?.latencyMs ?? null,
          // Broker-aware feature gating (Sprint 2026-07-04)
          features: config.id === 'mt5' ? {
            dxySource: 'eurusd-proxy' as const,
            dxyNote: 'Your broker does not offer DXY futures. USD strength estimated from EURUSD (57.6% of DXY basket).',
          } : undefined,
        };
      }),
    };
  }

  async updateHealth(
    provider: string,
    status: string,
    message?: string,
    latencyMs?: number | null,
  ) {
    const providerId = provider.toLowerCase();
    const config = this.adapterFactory.getConfig(providerId);
    const credentialsOk = this.adapterFactory.hasCredentials(providerId);

    return this.prisma.providerHealth.upsert({
      where: { provider: providerId },
      update: {
        status,
        message,
        latencyMs: latencyMs ?? null,
        checkedAt: new Date(),
        credentialsOk,
        endpoint: config?.baseUrl ?? providerId,
      },
      create: {
        provider: providerId,
        status,
        message,
        latencyMs: latencyMs ?? null,
        checkedAt: new Date(),
        credentialsOk,
        endpoint: config?.baseUrl ?? providerId,
      },
    });
  }
}
