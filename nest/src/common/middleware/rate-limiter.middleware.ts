import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimiterMiddleware.name);
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly limit = DEFAULT_LIMIT;
  private readonly windowMs = DEFAULT_WINDOW_MS;

  constructor() {
    // Clean up expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60_000);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = this.store.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(ip, entry);
    }

    entry.count++;

    const remaining = Math.max(0, this.limit - entry.count);
    const resetSec = Math.ceil((entry.resetAt - now) / 1000);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', this.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSec);

    if (entry.count > this.limit) {
      this.logger.warn(`Rate limit exceeded for IP ${ip} (${entry.count}/${this.limit})`);
      res.status(429).json({
        statusCode: 429,
        message: 'Too Many Requests',
        retryAfter: resetSec,
      });
      return;
    }

    next();
  }

  private cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      if (now > entry.resetAt) {
        this.store.delete(ip);
      }
    }
  }
}
