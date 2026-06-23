/**
 * Symbol Data Cache Service
 * =========================
 * TTL-based in-memory cache that deduplicates provider API calls
 * during a scoring run. Sits between ProtocolRunner and provider
 * adapters — ALL Automation provider requests MUST go through
 * this cache.
 *
 * Key format: {provider}:{symbol}:{endpoint}
 *
 * Default TTLs:
 *   Finnhub:      60s  (60 calls/min free tier)
 *   Trading212:   30s  (demo API)
 *   MT5 Bridge:    5s  (local, near real-time)
 *   Alpha Vantage: 65s (5 calls/min free tier)
 */

import { Injectable, Logger } from '@nestjs/common';

// ── Types ──────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number; // Date.now()
  ttl: number; // ms
  provider: string;
  symbol: string;
  endpoint: string;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  oldestEntryMs: number | null;
}

export interface CacheDebugEntry {
  key: string;
  provider: string;
  symbol: string;
  endpoint: string;
  fetchedAt: Date;
  ttlRemainingMs: number;
  expired: boolean;
}

// ── Default TTLs ─────────────────────────────────────────

const DEFAULT_TTLS: Record<string, number> = {
  finnhub: 60_000,
  'alpha-vantage': 65_000,
  trading212: 30_000,
  mt5: 5_000,
};

// ── Service ────────────────────────────────────────────────

@Injectable()
export class SymbolDataCacheService {
  private readonly logger = new Logger(SymbolDataCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();

  // Rate-limit tracking (v2 — currently informational only)
  private readonly rateCounters = new Map<string, { count: number; windowStart: number }>();

  // Stats
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  // ── Public API ───────────────────────────────────────

  /**
   * Get cached data or fetch + cache it.
   *
   * @param provider  — e.g. 'finnhub', 'trading212', 'mt5'
   * @param symbol    — e.g. 'NVDA', 'XAUUSD'
   * @param endpoint  — e.g. 'social-sentiment', 'quote', 'candles'
   * @param fetcher   — async function that calls the actual provider
   * @param ttl       — override default TTL (ms)
   */
  async getOrFetch<T>(
    provider: string,
    symbol: string,
    endpoint: string,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const key = this.makeKey(provider, symbol, endpoint);
    const effectiveTtl = ttl ?? DEFAULT_TTLS[provider.toLowerCase()] ?? 30_000;

    // Check cache
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (entry) {
      const age = Date.now() - entry.fetchedAt;
      if (age < entry.ttl) {
        this.hits++;
        this.logger.debug(`CACHE HIT  ${key} (age=${age}ms, ttl=${entry.ttl}ms)`);
        return entry.data;
      }
      // Expired — remove and count as eviction
      this.store.delete(key);
      this.evictions++;
      this.logger.debug(`CACHE EVICT ${key} (expired, age=${age}ms)`);
    }

    // Miss — fetch from provider
    this.misses++;
    this.logger.debug(`CACHE MISS ${key} → fetching from ${provider}`);

    const data = await fetcher();

    // Store
    this.store.set(key, {
      data,
      fetchedAt: Date.now(),
      ttl: effectiveTtl,
      provider,
      symbol: symbol.toUpperCase(),
      endpoint,
    });

    this.logger.debug(`CACHE STORE ${key} (ttl=${effectiveTtl}ms, storeSize=${this.store.size})`);
    return data;
  }

  /**
   * Invalidate cache entries.
   * @param provider — clear all for this provider
   * @param symbol   — optional: clear only a specific symbol
   */
  invalidate(provider: string, symbol?: string): void {
    const prefix = symbol
      ? this.makeKey(provider, symbol, '')
      : `${provider.toLowerCase()}:`;

    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }

    this.logger.debug(`CACHE INVALIDATE provider=${provider} symbol=${symbol ?? '*'} removed=${removed}`);
  }

  /** Clear all cache entries. */
  flush(): void {
    const count = this.store.size;
    this.store.clear();
    this.logger.debug(`CACHE FLUSH ${count} entries cleared`);
  }

  // ── Stats ────────────────────────────────────────────

  getStats(): CacheStats {
    let oldestEntryMs: number | null = null;
    const now = Date.now();

    for (const entry of this.store.values()) {
      const age = now - entry.fetchedAt;
      if (oldestEntryMs === null || age > oldestEntryMs) {
        oldestEntryMs = age;
      }
    }

    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      oldestEntryMs,
    };
  }

  /** Full debug dump — all entries with remaining TTL. */
  getDebugEntries(): CacheDebugEntry[] {
    const now = Date.now();
    const entries: CacheDebugEntry[] = [];

    for (const [key, entry] of this.store.entries()) {
      const age = now - entry.fetchedAt;
      const remaining = entry.ttl - age;
      entries.push({
        key,
        provider: entry.provider,
        symbol: entry.symbol,
        endpoint: entry.endpoint,
        fetchedAt: new Date(entry.fetchedAt),
        ttlRemainingMs: Math.max(0, remaining),
        expired: remaining <= 0,
      });
    }

    return entries.sort((a, b) => b.ttlRemainingMs - a.ttlRemainingMs);
  }

  // ── Rate-limit awareness (v2, informational) ─────────

  /**
   * Track an API call against a provider's rate limit window.
   * Returns true if within limits, false if approaching limit.
   */
  trackCall(provider: string, maxPerMinute: number): { allowed: boolean; used: number; remaining: number } {
    const key = provider.toLowerCase();
    const now = Date.now();
    let counter = this.rateCounters.get(key);

    if (!counter || now - counter.windowStart > 60_000) {
      counter = { count: 0, windowStart: now };
      this.rateCounters.set(key, counter);
    }

    counter.count++;
    const remaining = maxPerMinute - counter.count;

    return {
      allowed: counter.count <= maxPerMinute,
      used: counter.count,
      remaining: Math.max(0, remaining),
    };
  }

  /** Reset rate-limit counters for a provider. */
  resetRateCounter(provider: string): void {
    this.rateCounters.delete(provider.toLowerCase());
  }

  // ── Internal ─────────────────────────────────────────

  private makeKey(provider: string, symbol: string, endpoint: string): string {
    return `${provider.toLowerCase()}:${symbol.toUpperCase()}:${endpoint.toLowerCase()}`;
  }
}
