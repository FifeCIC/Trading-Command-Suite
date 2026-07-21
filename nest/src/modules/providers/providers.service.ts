import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { AdapterFactory } from './adapter-factory';
import { IProviderAdapter } from './interfaces/provider-adapter.interface';

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
            (credentialsConfigured ? 'unknown' : 'missing-credentials'),
          message:
            row?.message ??
            (credentialsConfigured
              ? 'No health check recorded yet'
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
