import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  PROVIDER_RATE_LIMITS,
  getEndpointInterval,
  ProviderRateConfig,
} from '../rate-limit/provider-rate-limits';

/**
 * Provider-aware rate limiter middleware.
 *
 * Throttles inbound requests per endpoint pattern based on the provider's
 * documented rate limits. Prevents the frontend from triggering back-to-back
 * API calls that would exhaust the provider's rate limit.
 *
 * Configured via PROVIDER_RATE_LIMITS in provider-rate-limits.ts.
 */

interface EndpointTracker {
  lastCallTime: number;
  intervalMs: number;
  label: string;
}

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimiterMiddleware.name);
  private readonly endpointTimers = new Map<string, EndpointTracker>();

  /** Build a lookup map: route pattern → interval from config */
  private readonly routeIntervalMap: Map<string, { intervalMs: number; label: string }>;

  constructor() {
    this.routeIntervalMap = new Map();
    for (const config of PROVIDER_RATE_LIMITS) {
      for (const ep of config.endpoints) {
        // Map each provider's route patterns to their tightest endpoint interval
        const interval = Math.min(
          ...config.endpoints.map((e) => e.minIntervalMs),
        );
        for (const pattern of config.routePatterns) {
          const existing = this.routeIntervalMap.get(pattern);
          if (!existing || interval < existing.intervalMs) {
            this.routeIntervalMap.set(pattern, {
              intervalMs: Math.max(interval, 1_000), // at least 1 second between calls
              label: `${config.provider} routes`,
            });
          }
        }
      }
    }

    // Also map legacy routes
    this.routeIntervalMap.set('/api/providers', { intervalMs: 2_000, label: 'provider health' });
    this.routeIntervalMap.set('/api/webhooks', { intervalMs: 1_000, label: 'webhooks' });

    this.logger.log(`Rate limiter configured with ${this.routeIntervalMap.size} route patterns`);
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Strip global prefix and query string for matching
    const rawPath = req.originalUrl?.split('?')[0] || req.url || '/';
    const path = rawPath.replace(/^\/api/, '') || '/';
    const now = Date.now();

    // Find the matching route pattern
    let matchInterval = 0;
    let matchLabel = '';
    for (const [pattern, info] of this.routeIntervalMap) {
      if (path.startsWith(pattern)) {
        matchInterval = info.intervalMs;
        matchLabel = info.label;
        break;
      }
    }

    // No rate limit for unmatched routes — pass through
    if (matchInterval === 0) {
      return next();
    }

    // Check if we've called this endpoint too recently.
    // Keyed by client IP + path so one client can't exhaust a provider's rate
    // limit while another is also polling. (Still per-process: counters reset on
    // restart — a fully shared limiter would need Redis/DB.)
    const clientKey = `${req.ip || 'unknown'}|${path}`;
    const tracker = this.endpointTimers.get(clientKey);
    if (tracker) {
      const elapsed = now - tracker.lastCallTime;
      if (elapsed < tracker.intervalMs) {
        const waitMs = tracker.intervalMs - elapsed;
        this.logger.warn(
          `Rate-limited ${path} (${matchLabel}): ${elapsed}ms since last call, ${waitMs}ms remaining`,
        );
        res.status(429).json({
          statusCode: 429,
          message: 'Too Many Requests — provider rate limit protection',
          retryAfterMs: waitMs,
          endpoint: path,
        });
        return;
      }
    }

    // Update tracker
    this.endpointTimers.set(clientKey, {
      lastCallTime: now,
      intervalMs: matchInterval,
      label: matchLabel,
    });

    // Set rate limit headers
    res.setHeader('X-RateLimit-Interval-Ms', matchInterval);

    next();
  }
}
