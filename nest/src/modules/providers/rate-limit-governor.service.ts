import { Injectable, Logger } from '@nestjs/common';

/**
 * RateLimitGovernor — centralized rate limit governance across all providers.
 *
 * Tracks remaining calls per provider, warns when limits approach,
 * and recommends adaptive scan intervals to prevent surprise outages.
 */
@Injectable()
export class RateLimitGovernor {
  private readonly logger = new Logger(RateLimitGovernor.name);

  /** Provider limits — free tier defaults, overridable */
  private readonly providerLimits: Record<string, ProviderLimitConfig> = {
    finnhub: {
      maxCallsPerMinute: 60,
      maxCallsPerDay: null,
      criticalThreshold: 10,    // Warn at 10 remaining
      warningThreshold: 20,     // Warn at 20 remaining
      adaptiveWindowMs: 60000,  // 1-minute sliding window
    },
    alphavantage: {
      maxCallsPerMinute: 5,
      maxCallsPerDay: 500,
      criticalThreshold: 2,
      warningThreshold: 3,
      adaptiveWindowMs: 60000,
    },
    fmp: {
      maxCallsPerMinute: null,
      maxCallsPerDay: 250,
      criticalThreshold: 25,
      warningThreshold: 50,
      adaptiveWindowMs: 86400000, // 24-hour window
    },
    twelvedata: {
      maxCallsPerMinute: 8,
      maxCallsPerDay: 800,
      criticalThreshold: 3,
      warningThreshold: 5,
      adaptiveWindowMs: 60000,
    },
    polygon: {
      maxCallsPerMinute: 5,
      maxCallsPerDay: null,
      criticalThreshold: 2,
      warningThreshold: 3,
      adaptiveWindowMs: 60000,
    },
    yahoo: {
      maxCallsPerMinute: null,   // Unofficial — be conservative
      maxCallsPerDay: null,
      criticalThreshold: 10,
      warningThreshold: 20,
      adaptiveWindowMs: 60000,
    },
    mt5: {
      maxCallsPerMinute: null,   // Local — effectively unlimited
      maxCallsPerDay: null,
      criticalThreshold: 0,
      warningThreshold: 0,
      adaptiveWindowMs: 0,
    },
    alpaca: {
      maxCallsPerMinute: 200,
      maxCallsPerDay: null,
      criticalThreshold: 20,
      warningThreshold: 40,
      adaptiveWindowMs: 60000,
    },
    trading212: {
      maxCallsPerMinute: null,   // Demo — generous limits
      maxCallsPerDay: null,
      criticalThreshold: 10,
      warningThreshold: 20,
      adaptiveWindowMs: 60000,
    },
  };

  private currentUsage: Map<string, ProviderUsage> = new Map();

  constructor() {
    // Initialize usage trackers for all configured providers
    for (const [id, config] of Object.entries(this.providerLimits)) {
      this.currentUsage.set(id, {
        callsThisMinute: 0,
        callsToday: 0,
        minuteWindowStart: Date.now(),
        dayWindowStart: Date.now(),
        lastWarningLevel: 'normal',
        consecutiveErrors: 0,
        keyExpired: false,
      });
    }
  }

  /**
   * Record a provider API call.
   * Called after every adapter request (success or failure).
   */
  recordCall(providerId: string, success: boolean, statusCode?: number): void {
    const usage = this.currentUsage.get(providerId);
    const config = this.providerLimits[providerId];
    if (!usage || !config) return;

    const now = Date.now();

    // Reset minute window if elapsed
    if (now - usage.minuteWindowStart > config.adaptiveWindowMs) {
      usage.callsThisMinute = 0;
      usage.minuteWindowStart = now;
    }

    // Reset day window if elapsed
    if (now - usage.dayWindowStart > 86400000) {
      usage.callsToday = 0;
      usage.dayWindowStart = now;
    }

    usage.callsThisMinute++;
    usage.callsToday++;

    // Track errors
    if (!success) {
      usage.consecutiveErrors++;
      if (statusCode === 401 || statusCode === 403) {
        usage.keyExpired = true;
      }
    } else {
      usage.consecutiveErrors = 0;
    }

    // Update warning level
    usage.lastWarningLevel = this.computeWarningLevel(providerId);
  }

  /**
   * Get current rate limit status for all providers.
   */
  getStatus(): GovernorStatus {
    const providers: Record<string, ProviderStatus> = {};

    for (const [id, usage] of this.currentUsage) {
      const config = this.providerLimits[id];
      if (!config) continue;

      const remaining = this.computeRemaining(id);
      const warningLevel = this.computeWarningLevel(id);
      const recommendedInterval = this.recommendInterval(id);

      providers[id] = {
        providerId: id,
        callsThisMinute: usage.callsThisMinute,
        callsToday: usage.callsToday,
        maxPerMinute: config.maxCallsPerMinute,
        maxPerDay: config.maxCallsPerDay,
        remainingEstimate: remaining,
        warningLevel,
        recommendedScanIntervalMs: recommendedInterval,
        keyExpired: usage.keyExpired,
        circuitBreakerTripped: usage.consecutiveErrors >= 3,
      };
    }

    const overallStatus: 'healthy' | 'warning' | 'critical' =
      Object.values(providers).some((p) => p.warningLevel === 'critical') ? 'critical' :
      Object.values(providers).some((p) => p.warningLevel === 'warning') ? 'warning' :
      'healthy';

    return {
      overallStatus,
      providers,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Recommended scan interval based on provider rate limits.
   * Slower intervals when limits are tight.
   */
  recommendScanInterval(providerId?: string): number {
    if (!providerId) {
      // Aggregate: use the worst recommendation across all providers
      let worst = 5000;
      for (const id of this.currentUsage.keys()) {
        const rec = this.recommendInterval(id);
        worst = Math.max(worst, rec);
      }
      return worst;
    }
    return this.recommendInterval(providerId);
  }

  /**
   * Check if a provider can handle another call.
   */
  canCall(providerId: string): { allowed: boolean; reason?: string } {
    const usage = this.currentUsage.get(providerId);
    const config = this.providerLimits[providerId];
    if (!usage || !config) return { allowed: true };

    if (usage.keyExpired) {
      return { allowed: false, reason: 'API key expired or invalid (401/403)' };
    }

    if (usage.consecutiveErrors >= 3) {
      return { allowed: false, reason: 'Circuit breaker tripped — 3+ consecutive errors' };
    }

    const remaining = this.computeRemaining(providerId);
    if (remaining <= 0) {
      return { allowed: false, reason: `Rate limit exhausted (0/${config.maxCallsPerMinute ?? config.maxCallsPerDay ?? '?'} remaining)` };
    }

    return { allowed: true };
  }

  // ── Private ──────────────────────────────────────────────

  private computeRemaining(providerId: string): number {
    const usage = this.currentUsage.get(providerId);
    const config = this.providerLimits[providerId];
    if (!usage || !config) return 999;

    // Use the most constrained limit
    let remaining = 999;
    if (config.maxCallsPerMinute) {
      const minuteRemaining = config.maxCallsPerMinute - usage.callsThisMinute;
      remaining = Math.min(remaining, minuteRemaining);
    }
    if (config.maxCallsPerDay) {
      const dayRemaining = config.maxCallsPerDay - usage.callsToday;
      remaining = Math.min(remaining, dayRemaining);
    }
    return Math.max(0, remaining);
  }

  private computeWarningLevel(providerId: string): 'normal' | 'warning' | 'critical' {
    const usage = this.currentUsage.get(providerId);
    const config = this.providerLimits[providerId];
    if (!usage || !config) return 'normal';

    if (usage.keyExpired || usage.consecutiveErrors >= 3) return 'critical';

    const remaining = this.computeRemaining(providerId);
    if (remaining <= config.criticalThreshold) return 'critical';
    if (remaining <= config.warningThreshold) return 'warning';
    return 'normal';
  }

  private recommendInterval(providerId: string): number {
    const level = this.computeWarningLevel(providerId);
    switch (level) {
      case 'critical': return 60000;  // 1 scan/minute
      case 'warning':  return 30000;  // 2 scans/minute
      default:         return 10000;  // 6 scans/minute baseline
    }
  }
}

// ── Types ─────────────────────────────────────────────────

interface ProviderLimitConfig {
  maxCallsPerMinute: number | null;
  maxCallsPerDay: number | null;
  criticalThreshold: number;
  warningThreshold: number;
  adaptiveWindowMs: number;
}

interface ProviderUsage {
  callsThisMinute: number;
  callsToday: number;
  minuteWindowStart: number;
  dayWindowStart: number;
  lastWarningLevel: string;
  consecutiveErrors: number;
  keyExpired: boolean;
}

export interface ProviderStatus {
  providerId: string;
  callsThisMinute: number;
  callsToday: number;
  maxPerMinute: number | null;
  maxPerDay: number | null;
  remainingEstimate: number;
  warningLevel: 'normal' | 'warning' | 'critical';
  recommendedScanIntervalMs: number;
  keyExpired: boolean;
  circuitBreakerTripped: boolean;
}

export interface GovernorStatus {
  overallStatus: 'healthy' | 'warning' | 'critical';
  providers: Record<string, ProviderStatus>;
  updatedAt: string;
}
