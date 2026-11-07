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

/**
 * CHROME POLLERS — routes the frontend calls on a timer for its OWN display, whose rows carry no
 * diagnostic value beyond "the app was open" (#1241).
 *
 * ⚠️ MEASURED 2026-11-06, one ordinary day: ~130,000 of 132,184 `apiactivitylog` rows were the
 * frontend polling itself — `/alerts/active` 13,659, `/trading/mt5/candles` 13,980,
 * `/scoring/protocols` 11,009, `/automation/status` 10,721, `/speed/scan` 10,272, `/health` 8,763.
 * 58 MB a day, 22% of the database's total write volume, for observability noise.
 *
 * ⚠️ NARROW ON PURPOSE. `/trading/mt5/candles` is NOT in this list: it is the bridge call that says
 * whether bars are actually being fetched, and its absence would hide a provider stall. A skip list
 * that swallows real diagnostics is worse than the volume it saves.
 */
export const CHROME_POLLERS: readonly string[] = [
  '/health',
  '/alerts/active',
  '/automation/status',
  '/scoring/protocols',
  '/speed/scan',
  '/system/logs/status',
];

/**
 * shouldRecordActivity() — is this request worth a database row?
 *
 * ⚠️ A FAILURE IS ALWAYS RECORDED, whatever the route. The whole value of `apiactivitylog` is the
 * ability to see that something stopped working; dropping a 500 on `/health` because `/health` is a
 * "chrome poller" would delete exactly the rows anyone would go looking for.
 *
 * ⚠️ Writes are never skipped either. A POST is not a poll, and the method filter is what stops this
 * from quietly discarding a non-idempotent call someone was tracing.
 */
export function shouldRecordActivity(input: {
  endpoint: string;
  method: string;
  statusCode: number;
}): boolean {
  if (input.statusCode >= 400) return true;
  const method = (input.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return true;
  const path = input.endpoint.split('?')[0];
  return !CHROME_POLLERS.some((p) => path === p || path.startsWith(`${p}/`));
}

@Injectable()
export class ApiActivityService {  private readonly logger = new Logger(ApiActivityService.name);
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
