/**
 * EurUsdCacheService — DXY proxy data source
 * ===========================================
 * Tick-level cache for EURUSD quote from MT5, used as a DXY proxy.
 *
 * ── Why EURUSD as DXY proxy ──────────────────────────────
 * The US Dollar Index (DXY) is an ICE futures contract rarely available on
 * retail brokers (MetaQuotes-Demo doesn't offer it). EURUSD makes up 57.6%
 * of the DXY basket and has strong inverse correlation — it's a reliable proxy.
 *
 * DXY derivation (done by consumers, not here):
 *   EURUSD ≥ 1.15 → DXY ~98  (weak USD)
 *   EURUSD ≥ 1.08 → DXY ~103 (neutral)
 *   EURUSD < 1.08 → DXY ~108 (strong USD)
 *
 * ── Cache Strategy ───────────────────────────────────────
 * Problem: scoreWithGating() and rankAll() both call getQuote('EURUSD') on
 * every symbol per tick — redundant MT5 API calls.
 * Solution: Fetch once per tick, cache for 60s (shorter than the 120s tick
 * interval). Both scoring paths share this cache.
 *
 * ── Fallback ─────────────────────────────────────────────
 * Returns undefined if MT5 is offline. Directives handle missing data
 * with their own neutral/default returns.
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
