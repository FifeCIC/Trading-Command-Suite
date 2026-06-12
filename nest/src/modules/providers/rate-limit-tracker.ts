/**
 * Rate Limit Tracker
 * ==================
 * Tracks rate limit state per adapter instance.
 * Supports circuit breaker (3 consecutive 429s → trip for 2 min).
 * Used by AdapterFactory for smart provider switching.
 */

import { Logger } from '@nestjs/common';

export interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: number | null;
  usedInWindow: number;
  consecutive429s: number;
  tripped: boolean;
  trippedAt: number | null;
  warning: boolean;
  instanceId: string;
  providerId: string;
}

const TRIP_THRESHOLD = 3;
const COOLDOWN_MS = 120_000; // 2 minutes
const LOW_REMAINING_WARNING = 5;

export class RateLimitTracker {
  private readonly logger = new Logger(RateLimitTracker.name);
  private state: RateLimitState;

  constructor(
    readonly instanceId: string,
    readonly providerId: string,
    limit = 200,
  ) {
    this.state = this.freshState(instanceId, providerId, limit);
  }

  private freshState(instanceId: string, providerId: string, limit: number): RateLimitState {
    return {
      remaining: limit,
      limit,
      resetAt: null,
      usedInWindow: 0,
      consecutive429s: 0,
      tripped: false,
      trippedAt: null,
      warning: false,
      instanceId,
      providerId,
    };
  }

  /** Call after every API response to update rate limit state. */
  recordResponse(
    status: number,
    headers?: { 'ratelimit-remaining'?: string; 'ratelimit-limit'?: string; 'ratelimit-reset'?: string },
  ): void {
    // Check for circuit breaker cooldown expiry
    if (this.state.tripped && this.state.trippedAt) {
      if (Date.now() - this.state.trippedAt >= COOLDOWN_MS) {
        this.logger.log(`Circuit breaker released for ${this.instanceId} after cooldown`);
        this.state = this.freshState(this.instanceId, this.providerId, this.state.limit);
      } else {
        return; // Still tripped, don't update
      }
    }

    if (status === 429) {
      this.state.consecutive429s++;
      if (this.state.consecutive429s >= TRIP_THRESHOLD) {
        this.state.tripped = true;
        this.state.trippedAt = Date.now();
        this.logger.warn(
          `Circuit breaker TRIPPED for ${this.instanceId} (${this.state.consecutive429s} consecutive 429s)`,
        );
      }
      // Decrement remaining on 429 even without headers
      this.state.remaining = Math.max(0, this.state.remaining - 1);
      return;
    }

    // Successful response — reset consecutive 429 counter
    this.state.consecutive429s = 0;

    // Parse rate limit headers if provided
    if (headers) {
      if (headers['ratelimit-remaining'] !== undefined) {
        this.state.remaining = parseInt(headers['ratelimit-remaining'], 10) || 0;
      }
      if (headers['ratelimit-limit'] !== undefined) {
        this.state.limit = parseInt(headers['ratelimit-limit'], 10) || this.state.limit;
      }
      if (headers['ratelimit-reset'] !== undefined) {
        this.state.resetAt = parseInt(headers['ratelimit-reset'], 10) || null;
      }
    }

    // Decrement remaining if no header was provided and call was successful
    if (!headers?.['ratelimit-remaining']) {
      this.state.remaining = Math.max(0, this.state.remaining - 1);
    }

    this.state.usedInWindow = this.state.limit - this.state.remaining;
    this.state.warning = this.state.remaining <= LOW_REMAINING_WARNING;
  }

  /** Get current state snapshot. */
  getState(): RateLimitState {
    return { ...this.state };
  }

  /** Check if this adapter is usable. */
  isUsable(): boolean {
    if (this.state.tripped) {
      // Check if cooldown has expired
      if (this.state.trippedAt && Date.now() - this.state.trippedAt >= COOLDOWN_MS) {
        return true; // Will be reset on next recordResponse
      }
      return false;
    }
    return this.state.remaining > 0;
  }

  /** Reset state (e.g., after health check confirms recovery). */
  reset(): void {
    this.state = this.freshState(this.instanceId, this.providerId, this.state.limit);
    this.logger.log(`Rate limit state reset for ${this.instanceId}`);
  }
}
