/**
 * Provider Degradation Service
 * =============================
 * Tracks which providers are healthy, degraded, or failed so that
 * directives and services can gracefully skip external calls instead
 * of logging warnings or throwing errors.
 *
 * ── States ───────────────────────────────────────────────
 *   healthy   — Provider responding normally
 *   degraded  — Provider returning errors but may recover
 *   failed    — Provider consistently failing (skip all calls)
 *   unknown   — No health check recorded yet
 *
 * ── Usage ────────────────────────────────────────────────
 *   if (degradation.isAvailable('finnhub')) {
 *     await finnhub.getEarnings('AAPL');
 *   }
 */

import { Injectable, Logger } from '@nestjs/common';

export type ProviderHealth = 'healthy' | 'degraded' | 'failed' | 'unknown';

interface ProviderState {
  status: ProviderHealth;
  lastChecked: number;
  consecutiveErrors: number;
  reason: string;
}

@Injectable()
export class ProviderDegradationService {
  private readonly logger = new Logger(ProviderDegradationService.name);
  private readonly states = new Map<string, ProviderState>();

  /** Maximum consecutive errors before marking as failed */
  private readonly MAX_ERRORS = 3;

  /** How long to wait before retrying a failed provider (ms) */
  private readonly RETRY_AFTER_MS = 300_000; // 5 min

  // ── Public API ──────────────────────────────────────────

  /** Check if a provider should be called */
  isAvailable(providerId: string): boolean {
    const state = this.states.get(providerId);
    if (!state) return true; // Unknown → assume available

    if (state.status === 'healthy' || state.status === 'degraded') {
      return true;
    }

    if (state.status === 'failed') {
      const elapsed = Date.now() - state.lastChecked;
      if (elapsed >= this.RETRY_AFTER_MS) {
        // Retry window — allow one attempt
        this.logger.log(`${providerId}: retry window opened after ${Math.round(elapsed / 1000)}s`);
        this.states.set(providerId, { status: 'degraded', lastChecked: Date.now(), consecutiveErrors: 0, reason: 'retrying' });
        return true;
      }
      return false;
    }

    return true;
  }

  /** Get current status for display */
  getStatus(providerId: string): ProviderHealth {
    return this.states.get(providerId)?.status ?? 'unknown';
  }

  /** Get all provider states */
  getAll(): Array<{ providerId: string; status: ProviderHealth; reason: string }> {
    return Array.from(this.states.entries()).map(([providerId, state]) => ({
      providerId,
      status: state.status,
      reason: state.reason,
    }));
  }

  // ── Reporters (called by adapters/controllers) ──────────

  /** Report a successful call */
  reportSuccess(providerId: string): void {
    const existing = this.states.get(providerId);
    if (existing?.status === 'failed') {
      this.logger.log(`${providerId}: recovered from failed state`);
    }
    this.states.set(providerId, {
      status: 'healthy',
      lastChecked: Date.now(),
      consecutiveErrors: 0,
      reason: 'ok',
    });
  }

  /** Report an error — tracks consecutive failures */
  reportError(providerId: string, error: string, httpStatus?: number): void {
    const existing = this.states.get(providerId);
    const errors = (existing?.consecutiveErrors ?? 0) + 1;

    // 401/403 = auth failure = immediate fail (no recovery without key fix)
    if (httpStatus === 401 || httpStatus === 403) {
      this.states.set(providerId, {
        status: 'failed',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `Auth failure (HTTP ${httpStatus}): ${error}`,
      });
      this.logger.warn(`${providerId}: auth failure — marked as failed until key is updated`);
      return;
    }

    // Rate limiting — degraded but recoverable
    if (httpStatus === 429) {
      this.states.set(providerId, {
        status: 'degraded',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `Rate limited (HTTP 429)`,
      });
      return;
    }

    // Consecutive errors — degrade then fail
    if (errors >= this.MAX_ERRORS) {
      this.states.set(providerId, {
        status: 'failed',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `${errors} consecutive errors: ${error}`,
      });
      this.logger.warn(`${providerId}: marked as failed after ${errors} errors`);
    } else {
      this.states.set(providerId, {
        status: 'degraded',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `${errors} consecutive errors: ${error}`,
      });
    }
  }

  /** Reset a provider to unknown (for testing or manual recovery) */
  reset(providerId: string): void {
    this.states.delete(providerId);
    this.logger.log(`${providerId}: reset to unknown`);
  }
}
