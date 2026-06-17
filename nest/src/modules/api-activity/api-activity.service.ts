import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ApiActivityRecord {
  endpoint: string;
  method: string;
  provider?: string | null;
  statusCode: number;
  durationMs: number;
  responseSize: number;
  timestamp?: Date | string;
}

interface ActivityFilters {
  provider?: string;
  limit?: number;
}

function inferProvider(endpoint: string): string | null {
  const lower = endpoint.toLowerCase();
  const providers = [
    'trading212',
    'mt5',
    'alpaca',
    'alpha-vantage',
    'alphavantage',
    'polygon',
    'finnhub',
    'twelve-data',
    'yahoo',
    'fmp',
  ];
  const match = providers.find((provider) => lower.includes(provider));
  if (!match) return null;
  if (match === 'alphavantage') return 'alpha-vantage';
  if (match === 'yahoo') return 'yahoo-finance';
  return match;
}

@Injectable()
export class ApiActivityService {
  private readonly logger = new Logger(ApiActivityService.name);
  private readonly fallbackRecords: ApiActivityRecord[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ApiActivityRecord): Promise<void> {
    const record = {
      ...input,
      endpoint: input.endpoint.slice(0, 220),
      provider: input.provider ?? inferProvider(input.endpoint),
      timestamp: input.timestamp ?? new Date(),
    };

    if (!this.prisma.isAvailable) {
      this.fallbackRecords.unshift(record);
      this.fallbackRecords.splice(250);
      return;
    }

    try {
      await (this.prisma as any).apiActivityLog.create({ data: record });
    } catch (error) {
      this.logger.debug(`Could not persist API activity: ${String(error)}`);
      this.fallbackRecords.unshift(record);
      this.fallbackRecords.splice(250);
    }
  }

  async list(filters: ActivityFilters = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

    if (!this.prisma.isAvailable) {
      return {
        records: this.applyFallbackFilters(filters).slice(0, limit),
        source: 'memory',
      };
    }

    try {
      const records = await (this.prisma as any).apiActivityLog.findMany({
        where: filters.provider ? { provider: filters.provider } : undefined,
        orderBy: { timestamp: 'desc' },
        take: limit,
      }) as ApiActivityRecord[];
      return { records, source: 'database' };
    } catch (error) {
      this.logger.debug(`Could not read API activity: ${String(error)}`);
      return {
        records: this.applyFallbackFilters(filters).slice(0, limit),
        source: 'memory',
      };
    }
  }

  async summary(filters: ActivityFilters = {}) {
    const { records, source } = await this.list({ ...filters, limit: 500 });
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = records.filter((record: ApiActivityRecord) => new Date(record.timestamp ?? 0).getTime() >= oneHourAgo);
    const successCount = recent.filter((record: ApiActivityRecord) => record.statusCode < 400).length;
    const errorCount = recent.length - successCount;
    const avgLatencyMs = recent.length
      ? Math.round(recent.reduce((sum: number, record: ApiActivityRecord) => sum + record.durationMs, 0) / recent.length)
      : 0;

    const latencyBuckets = Array.from({ length: 12 }, (_, index) => {
      const bucketStart = oneHourAgo + index * 5 * 60 * 1000;
      const bucketEnd = bucketStart + 5 * 60 * 1000;
      const bucketRecords = recent.filter((record: ApiActivityRecord) => {
        const time = new Date(record.timestamp ?? 0).getTime();
        return time >= bucketStart && time < bucketEnd;
      });
      return {
        label: new Date(bucketStart).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        count: bucketRecords.length,
        avgLatencyMs: bucketRecords.length
          ? Math.round(bucketRecords.reduce((sum: number, record: ApiActivityRecord) => sum + record.durationMs, 0) / bucketRecords.length)
          : 0,
      };
    });

    const providers = [...new Set(records.map((record: ApiActivityRecord) => record.provider).filter(Boolean))].sort();

    return {
      source,
      totalCount: records.length,
      recentCount: recent.length,
      successCount,
      errorCount,
      avgLatencyMs,
      providers,
      latencyBuckets,
    };
  }

  async endpointUsage(provider?: string) {
    const { records } = await this.list({ provider, limit: 500 });
    const usage = new Map<string, { lastCalledAt: Date; callCount: number; errorCount: number }>();

    for (const record of records) {
      const key = `${record.method.toUpperCase()} ${record.endpoint}`;
      const previous = usage.get(key);
      const timestamp = new Date(record.timestamp ?? 0);
      usage.set(key, {
        lastCalledAt:
          previous && previous.lastCalledAt.getTime() > timestamp.getTime()
            ? previous.lastCalledAt
            : timestamp,
        callCount: (previous?.callCount ?? 0) + 1,
        errorCount: (previous?.errorCount ?? 0) + (record.statusCode >= 400 ? 1 : 0),
      });
    }

    return {
      usage: Array.from(usage.entries()).map(([key, value]) => {
        const [method, ...pathParts] = key.split(' ');
        return {
          method,
          endpoint: pathParts.join(' '),
          ...value,
        };
      }),
    };
  }

  private applyFallbackFilters(filters: ActivityFilters) {
    return filters.provider
      ? this.fallbackRecords.filter((record) => record.provider === filters.provider)
      : this.fallbackRecords;
  }
}
