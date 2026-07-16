/**
 * EurUsdCacheService
 * ==================
 * Tick-level cache for EURUSD quote (DXY proxy).
 *
 * Problem: scoreWithGating() and rankAll() both fetch EURUSD from MT5
 * on every call — once per symbol per tick. This is redundant.
 *
 * Solution: Fetch once per tick, cache for 60s. Both services share
 * this cache. If MT5 is offline, returns undefined (directives handle it).
 */

import { Injectable, Logger } from '@nestjs/common';
import { AdapterFactory } from '../providers/adapter-factory';

@Injectable()
export class EurUsdCacheService {
  private readonly logger = new Logger(EurUsdCacheService.name);
  private cachedValue: number | undefined;
  private cachedAt: number = 0;
  private readonly TTL_MS = 60_000; // 60s — shorter than tick interval (5min)

  constructor(private readonly adapterFactory: AdapterFactory) {}

  /**
   * Returns the current EURUSD quote, cached per tick.
   * Returns undefined if MT5 is unavailable.
   */
  async getValue(): Promise<number | undefined> {
    const now = Date.now();
    if (this.cachedValue !== undefined && (now - this.cachedAt) < this.TTL_MS) {
      return this.cachedValue;
    }

    try {
      const mt5 = this.adapterFactory.create('mt5');
      if (!mt5) return undefined;
      const q = await mt5.getQuote('EURUSD');
      if (q?.last && q.last > 0) {
        this.cachedValue = q.last;
        this.cachedAt = now;
        return q.last;
      }
    } catch {
      this.logger.debug('EURUSD quote unavailable — MT5 may be offline');
    }
    return undefined;
  }

  /** Force-refresh on next getValue() call */
  invalidate(): void {
    this.cachedValue = undefined;
    this.cachedAt = 0;
  }
}
