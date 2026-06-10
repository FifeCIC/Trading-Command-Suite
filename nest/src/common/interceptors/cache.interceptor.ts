/**
 * Cache Interceptor
 * =================
 * In-memory response cache for GET endpoints with configurable TTL.
 * Adds X-Cache: HIT/MISS headers to responses.
 *
 * Usage:
 *   @UseInterceptors(new CacheInterceptor(30000))
 *   @Get('my-endpoint')
 *
 * TTL is in milliseconds.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

interface CacheEntry {
  body: unknown;
  timestamp: number;
}

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;

  constructor(ttlMs = 30000) {
    this.ttl = ttlMs;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only cache GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    const cacheKey = `${request.url}`;
    const now = Date.now();
    const entry = this.cache.get(cacheKey);

    if (entry && now - entry.timestamp < this.ttl) {
      response.header('X-Cache', 'HIT');
      this.logger.debug(`Cache HIT for ${cacheKey}`);
      return of(entry.body);
    }

    response.header('X-Cache', 'MISS');

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          this.cache.set(cacheKey, { body, timestamp: Date.now() });
        },
        error: () => {
          // Do not cache error responses
          this.cache.delete(cacheKey);
        },
      }),
    );
  }

  /** Clear the entire cache or a specific key. */
  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}
