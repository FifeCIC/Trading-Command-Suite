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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { FaultsService } from '../faults/faults.service';

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
  private notifications: any = null; // NotificationService injected optionally

  /** Maximum consecutive errors before marking as failed */
  private readonly MAX_ERRORS = 3;

  /** How long to wait before retrying a failed provider (ms) */
  private readonly RETRY_AFTER_MS = 300_000; // 5 min

  constructor(@Optional() private readonly faults?: FaultsService) {
    // NotificationService injected via setter to avoid circular dependency.
    // ⚠️ `FaultsService` is a CONSTRUCTOR parameter because it does not depend back on this module,
    // and `@Optional()` because several specs construct this service bare (`new ProviderDegradation-
    // Service()`). An absent registry degrades to "not recorded", never to a throw — a diagnostic
    // must not be able to break the error path it is observing.
  }

  /** Set notification service reference (called by module after construction) */
  setNotificationService(service: any): void {
    this.notifications = service;
  }

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
      this.notifyStatusChange(providerId, 'healthy', 'Recovered from failed state');
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
      const wasHealthy = existing?.status === 'healthy' || existing?.status === 'degraded' || !existing;
      this.states.set(providerId, {
        status: 'failed',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `Auth failure (HTTP ${httpStatus}): ${error}`,
      });
      if (wasHealthy) {
        this.logger.warn(`${providerId}: auth failure — marked as failed until key is updated`);
        this.notifyStatusChange(providerId, 'failed', `Auth failure (HTTP ${httpStatus}) — ${error}`);
      }
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
      const wasNotFailed = existing?.status !== 'failed';
      this.states.set(providerId, {
        status: 'failed',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `${errors} consecutive errors: ${error}`,
      });
      if (wasNotFailed) {
        this.logger.warn(`${providerId}: marked as failed after ${errors} errors`);
        this.notifyStatusChange(providerId, 'failed', `Failed after ${errors} consecutive errors`);
      }
    } else {
      this.states.set(providerId, {
        status: 'degraded',
        lastChecked: Date.now(),
        consecutiveErrors: errors,
        reason: `${errors} consecutive errors: ${error}`,
      });
    }
  }

  /** Send a notification when provider status changes */
  private notifyStatusChange(providerId: string, status: string, detail: string): void {
    // ⚠️ THE FAULT IS RECORDED BEFORE THE `notifications` GUARD BELOW, and the order is load-bearing.
    // That guard returns early when no notification channel is wired, which is the NORMAL state in
    // tests and on a machine with notifications off — so a fault recorded after it would be silently
    // dropped exactly when nobody is watching, which is the failure this registry exists to end.
    if (status === 'failed') this.recordFailureFault(providerId, detail);

    if (!this.notifications) return;
    try {
      this.notifications.send({
        event: 'provider-degraded',
        title: `Provider ${status === 'failed' ? 'FAILED' : 'RECOVERED'}: ${providerId}`,
        body: `${providerId} is now ${status}. ${detail}`,
        metadata: { providerId, status, detail },
      });
    } catch (err) {
      // Never let notification errors cascade
      this.logger.debug(`Failed to send provider notification: ${(err as Error).message}`);
    }
  }

  /**
   * Persist the failure so it survives the restart that used to erase it.
   *
   * ⚠️ `count` COUNTS EPISODES, NOT CALLS. This is invoked from `notifyStatusChange`, which fires on
   * a STATUS TRANSITION (`healthy|degraded → failed`), so a provider that fails and recovers ten
   * times contributes 10 — while a provider stuck failing contributes 1 and ages via `lastSeen`.
   * Wiring this into `reportError` instead would have made `count` a measure of traffic, which is
   * a number that grows fastest when the app is *working*.
   *
   * Fire-and-forget on purpose: a registry that can throw into the adapter's error path is worse
   * than no registry, and the failure is logged rather than swallowed.
   */
  private recordFailureFault(providerId: string, detail: string): void {
    if (!this.faults) return;
    // 'finnhub' -> 'TCS-PROVIDER-FINNHUB'. The code must match `TCS-<PATHWAY>-<CONDITION>` and must
    // be stable: the same provider must always produce the same code or its history splits in two.
    const token = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    void this.faults
      .record({
        code: `TCS-PROVIDER-${token}`,
        title: `Provider ${providerId} failed`,
        area: 'provider',
        severity: 'warning',
        evidence: { providerId, detail, at: new Date().toISOString() },
      })
      .catch((err) => this.logger.debug(`Could not record provider fault: ${(err as Error).message}`));
  }

  /** Reset a provider to unknown (for testing or manual recovery) */
  reset(providerId: string): void {
    this.states.delete(providerId);
    this.logger.log(`${providerId}: reset to unknown`);
  }
}
