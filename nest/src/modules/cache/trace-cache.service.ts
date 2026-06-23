import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

/**
 * WordPress-style transient cache for API responses.
 *
 * Every provider API call is serialized to a deterministic key
 * (MD5 of method + URL + body), stored in the DB with a TTL,
 * and served from cache on subsequent identical requests.
 *
 * Also serves as a full audit trail for debugging — every call
 * is recorded with timing, status, and response preview.
 */

interface CachedResponse {
  key: string;
  statusCode: number;
  durationMs: number;
  responseBody: string;
  responsePreview: string;
  hit: boolean;
  createdAt: Date;
}

const TTL_MAP: Record<string, number> = {
  quote: 30_000,       // 30s — price quotes
  candles: 300_000,    // 5min — historical bars
  portfolio: 120_000,  // 2min — positions
  account: 120_000,    // 2min — account cash
  orders: 60_000,      // 1min — order status
  calendar: 900_000,   // 15min — earnings calendar
  default: 30_000,
};

@Injectable()
export class TraceCacheService {
  private readonly logger = new Logger(TraceCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch with trace cache.
   * On cache hit within TTL, returns cached response (no API call).
   * On cache miss, makes the real call, stores trace, returns result.
   */
  async cachedFetch(
    url: string,
    options: RequestInit & { traceCategory?: string } = {},
  ): Promise<{ response: Response; cached: boolean; traceKey: string }> {
    const method = options.method || 'GET';
    const body = options.body?.toString() || '';
    const category = options.traceCategory || 'default';
    const ttl = TTL_MAP[category] || TTL_MAP.default;

    // Deterministic cache key
    const raw = `${method}|${url}|${body}`;
    const key = crypto.createHash('md5').update(raw).digest('hex');

    // Check DB cache
    const cached = await this.prisma.apiTrace.findFirst({
      where: {
        cacheKey: key,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (cached) {
      this.logger.debug(`Cache HIT: ${key.substring(0, 8)} ${category} ${url.substring(0, 80)}`);
      return {
        response: new Response(cached.responseBody, {
          status: cached.statusCode,
          headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        }),
        cached: true,
        traceKey: key,
      };
    }

    // Cache miss — make real call
    this.logger.debug(`Cache MISS: ${key.substring(0, 8)} ${category} ${url.substring(0, 80)}`);
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      // Store failed call too
      await this.storeTrace(key, url, method, body, 0, Date.now() - start, '', `Error: ${(err as Error).message}`, null);
      throw err;
    }

    const duration = Date.now() - start;
    const responseText = await response.clone().text();
    const preview = responseText.substring(0, 1000);

    await this.storeTrace(key, url, method, body, response.status, duration, responseText, null, ttl);

    return {
      response: new Response(responseText, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), 'X-Cache': 'MISS' },
      }),
      cached: false,
      traceKey: key,
    };
  }

  /** Get recent traces for debugging. */
  async getRecentTraces(limit = 50) {
    return this.prisma.apiTrace.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        cacheKey: true,
        url: true,
        method: true,
        statusCode: true,
        durationMs: true,
        cached: true,
        preview: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  /** Get trace by cache key. */
  async getTrace(key: string) {
    return this.prisma.apiTrace.findFirst({
      where: { cacheKey: key },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Clear expired traces. */
  async prune(): Promise<number> {
    const result = await this.prisma.apiTrace.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} expired API traces`);
    }
    return result.count;
  }

  private async storeTrace(
    key: string,
    url: string,
    method: string,
    requestBody: string,
    statusCode: number,
    durationMs: number,
    responseBody: string,
    error: string | null,
    ttlMs: number | null,
  ) {
    const preview = responseBody.substring(0, 1000);
    const expiresAt = ttlMs
      ? new Date(Date.now() + ttlMs)
      : new Date(Date.now() + TTL_MAP.default);

    try {
      await this.prisma.apiTrace.create({
        data: {
          cacheKey: key,
          url: url.substring(0, 500),
          method,
          requestBody: requestBody.substring(0, 2000),
          statusCode,
          durationMs,
          responseBody,
          preview,
          error,
          cached: false,
          expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to store API trace: ${(err as Error).message}`);
    }
  }
}
