/**
 * Cache Service — Lightweight in-memory cache for provider API responses
 * =======================================================================
 * Reduces external API calls and rate limit pressure.
 * Cache TTL: 30s quotes, 5min candles, 1h symbol lists.
 *
 * Used by provider adapters to cache responses.
 * Exposes stats via CacheController for monitoring.
 */

import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry {
  value: unknown;
  ttl: number; // absolute expiry timestamp (ms)
  hits: number;
  createdAt: number;
}

interface CacheStats {
  key: string;
  valueType: string;
  age: number;    // seconds since created
  ttl: number;    // seconds until expiry
  hits: number;
  size: number;   // approximate bytes of JSON
}

const DEFAULT_TTL_MS = 30_000; // 30 seconds

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private store = new Map<string, CacheEntry>();
  private totalHits = 0;
  private totalMisses = 0;

  /** Get a cached value. Returns null if missing or expired. */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.totalMisses++;
      return null;
    }

    if (Date.now() > entry.ttl) {
      this.store.delete(key);
      this.totalMisses++;
      return null;
    }

    entry.hits++;
    this.totalHits++;
    return entry.value as T;
  }

  /** Set a cached value with optional TTL in ms. */
  set(key: string, value: unknown, ttlMs?: number): void {
    const ttl = Date.now() + (ttlMs ?? DEFAULT_TTL_MS);
    this.store.set(key, {
      value,
      ttl,
      hits: 0,
      createdAt: Date.now(),
    });
  }

  /** Delete a specific cache key. */
  del(key: string): void {
    this.store.delete(key);
  }

  /** Clear all cache entries. */
  clear(): void {
    this.store.clear();
    this.logger.log('Cache cleared');
  }

  /** Remove expired entries. */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.ttl) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Pruned ${removed} expired cache entries`);
    }
    return removed;
  }

  /** Get stats for all cache entries. */
  getStats(): { totalEntries: number; totalHits: number; totalMisses: number; hitRate: number; entries: CacheStats[] } {
    this.prune(); // Clean expired before reporting

    const entries: CacheStats[] = [];
    const now = Date.now();

    for (const [key, entry] of this.store) {
      entries.push({
        key,
        valueType: typeof entry.value === 'object' ? Array.isArray(entry.value) ? 'array' : 'object' : typeof entry.value,
        age: Math.round((now - entry.createdAt) / 1000),
        ttl: Math.round((entry.ttl - now) / 1000),
        hits: entry.hits,
        size: JSON.stringify(entry.value).length,
      });
    }

    const total = this.totalHits + this.totalMisses;

    return {
      totalEntries: entries.length,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? Math.round((this.totalHits / total) * 100) : 0,
      entries: entries.sort((a, b) => b.hits - a.hits),
    };
  }
}
