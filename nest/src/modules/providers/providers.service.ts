import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  async getHealth() {
    const modeInfo = this.modeService.getModeInfo();
    let dbRows: Awaited<ReturnType<PrismaService['providerHealth']['findMany']>> = [];

    try {
      dbRows = await this.prisma.providerHealth.findMany();
    } catch (error) {
      this.logger.warn(`Database unavailable while loading provider health: ${String(error)}`);
    }

    const dbByProvider = new Map(dbRows.map((row) => [row.provider.toLowerCase(), row]));

    return {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      providers: PROVIDERS.map((provider) => {
      const credentialsConfigured = Boolean(process.env[provider.envKey]);
      const row = dbByProvider.get(provider.id);

      return {
        provider: provider.id,
        displayName: provider.name,
        endpoint: provider.endpoint,
        credentialsConfigured,
        status: row?.status ?? (credentialsConfigured ? 'unknown' : 'missing-credentials'),
        message: row?.message ?? (credentialsConfigured ? 'No health check recorded yet' : 'Missing API credentials'),
        checkedAt: row?.checkedAt?.toISOString() ?? null,
        latencyMs: row?.latencyMs ?? null,
      };
    }),
    };
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
