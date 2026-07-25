/**
 * ProviderCacheService — standard caching pattern for external provider data.
 *
 * Principles:
 *   1. Provider data is stored in our DB tables (single source of truth)
 *   2. API endpoints serve from DB — never wait on a live provider call
 *   3. Refresh is explicit (import/sync endpoints), with configurable cooldown
 *   4. Frontend never sees "loading" because a provider is slow
 *
 * Usage per provider:
 *   - cache.setCooldown('trading212', 60_000);  // 60s between imports
 *   - if (cache.canRefresh('trading212')) { ... fetch from provider ... }
 *   - Upsert data into DB tables (never delete-all)
 *   - cache.touch('trading212');  // update last refresh time
 *   - Read endpoints always go to DB, never to provider API
 *
 * This is intentionally NOT a generic cache — it's a cooldown guard.
 * The actual cache IS the database tables themselves (Position, Account, etc.)
 */

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProviderCacheService {
  private readonly logger = new Logger(ProviderCacheService.name);
  private readonly cooldowns = new Map<string, number>();
  private readonly lastRefresh = new Map<string, number>();

  /** Set the minimum interval between refreshes for a provider. */
  setCooldown(provider: string, ms: number): void {
    this.cooldowns.set(provider, ms);
  }

  /** Check if enough time has passed since the last refresh. */
  canRefresh(provider: string): boolean {
    const cooldown = this.cooldowns.get(provider) ?? 30_000;
    const last = this.lastRefresh.get(provider) ?? 0;
    return Date.now() - last >= cooldown;
  }

  /** Record a successful refresh. */
  touch(provider: string): void {
    this.lastRefresh.set(provider, Date.now());
  }

  /** Seconds remaining before the next refresh is allowed. */
  remainingSec(provider: string): number {
    const cooldown = this.cooldowns.get(provider) ?? 30_000;
    const last = this.lastRefresh.get(provider) ?? 0;
    const elapsed = Date.now() - last;
    return Math.max(0, Math.ceil((cooldown - elapsed) / 1000));
  }

  /** How long ago was the last refresh, in seconds. */
  lastRefreshAgoSec(provider: string): number {
    const last = this.lastRefresh.get(provider);
    if (!last) return Infinity;
    return Math.floor((Date.now() - last) / 1000);
  }

  /** Get cache status for health checks. */
  getStatus(provider: string): { canRefresh: boolean; lastRefreshSec: number; cooldownRemainingSec: number } {
    return {
      canRefresh: this.canRefresh(provider),
      lastRefreshSec: this.lastRefreshAgoSec(provider),
      cooldownRemainingSec: this.remainingSec(provider),
    };
  }
}
