import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { IProviderAdapter } from './interfaces/provider-adapter.interface';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { AlphaVantageAdapter } from './adapters/alpha-vantage.adapter';
import { Trading212Adapter } from './adapters/trading212.adapter';

type ProviderConfig = {
  id: string;
  name: string;
  envKey: string;
  endpoint: string;
};

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'alpaca',
    name: 'Alpaca',
    envKey: 'ALPACA_API_KEY',
    endpoint: 'https://paper-api.alpaca.markets',
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage',
    envKey: 'ALPHA_VANTAGE_API_KEY',
    endpoint: 'https://www.alphavantage.co',
  },
  {
    id: 'trading212',
    name: 'Trading212',
    envKey: 'TRADING212_API_KEY',
    endpoint: 'https://live.trading212.com',
  },
];

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);
  private readonly adapters: Map<string, IProviderAdapter> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly alpacaAdapter: AlpacaAdapter,
    private readonly alphaVantageAdapter: AlphaVantageAdapter,
    private readonly trading212Adapter: Trading212Adapter,
  ) {
    this.adapters.set('alpaca', alpacaAdapter);
    this.adapters.set('alphavantage', alphaVantageAdapter);
    this.adapters.set('trading212', trading212Adapter);
  }

  /**
   * Get the active provider adapter based on environment config.
   * Priority: PROVIDER_ACTIVE env var, then first configured provider, then alpaca as default.
   */
  getActiveAdapter(): IProviderAdapter {
    const activeProviderId = process.env.PROVIDER_ACTIVE?.toLowerCase();
    
    if (activeProviderId && this.adapters.has(activeProviderId)) {
      return this.adapters.get(activeProviderId)!;
    }

    // Fallback: find first provider with credentials
    for (const provider of PROVIDERS) {
      if (process.env[provider.envKey] && this.adapters.has(provider.id)) {
        return this.adapters.get(provider.id)!;
      }
    }

    // Default to Alpaca
    return this.alpacaAdapter;
  }

  /**
   * Get a specific adapter by ID.
   */
  getAdapter(providerId: string): IProviderAdapter | null {
    return this.adapters.get(providerId.toLowerCase()) || null;
  }

  /**
   * Get all available adapters.
   */
  getAllAdapters(): IProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  async getHealth() {
    const modeInfo = this.modeService.getModeInfo();
    let dbRows: Awaited<ReturnType<PrismaService['providerHealth']['findMany']>> = [];

    try {
      dbRows = await this.prisma.providerHealth.findMany();
    } catch (error) {
      this.logger.warn(`Database unavailable while loading provider health: ${String(error)}`);
    }

    const dbByProvider = new Map(dbRows.map((row) => [row.provider.toLowerCase(), row]));
    const activeAdapter = this.getActiveAdapter();

    return {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      activeProvider: activeAdapter ? this.getProviderIdFromAdapter(activeAdapter) : null,
      providers: PROVIDERS.map((provider) => {
        const credentialsConfigured = Boolean(process.env[provider.envKey]);
        const row = dbByProvider.get(provider.id);
        const adapter = this.adapters.get(provider.id);

        return {
          provider: provider.id,
          displayName: provider.name,
          endpoint: provider.endpoint,
          adapterType: adapter?.name || 'Unknown',
          credentialsConfigured,
          status: row?.status ?? (credentialsConfigured ? 'unknown' : 'missing-credentials'),
          message: row?.message ?? (credentialsConfigured ? 'No health check recorded yet' : 'Missing API credentials'),
          checkedAt: row?.checkedAt?.toISOString() ?? null,
          latencyMs: row?.latencyMs ?? null,
        };
      }),
    };
  }

  private getProviderIdFromAdapter(adapter: IProviderAdapter): string | null {
    for (const [id, adapterInstance] of this.adapters.entries()) {
      if (adapterInstance === adapter) {
        return id;
      }
    }
    return null;
  }

  async updateHealth(provider: string, status: string, message?: string, latencyMs?: number | null) {
    const providerId = provider.toLowerCase();
    const knownProvider = PROVIDERS.find((item) => item.id === providerId);

    const envKey = knownProvider?.envKey;
    const credentialsOk = envKey ? Boolean(process.env[envKey]) : false;

    return this.prisma.providerHealth.upsert({
      where: { provider: providerId },
      update: {
        status,
        message,
        latencyMs: latencyMs ?? null,
        checkedAt: new Date(),
        credentialsOk,
        endpoint: knownProvider?.endpoint ?? providerId,
      },
      create: {
        provider: providerId,
        status,
        message,
        latencyMs: latencyMs ?? null,
        checkedAt: new Date(),
        credentialsOk,
        endpoint: knownProvider?.endpoint ?? providerId,
      },
    });
  }
}
