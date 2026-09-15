/**
 * TimeoutInterceptor — fails requests that exceed a configurable deadline.
 *
 * NestJS doesn't enforce request timeouts by default. A hung endpoint
 * (infinite loop, deadlock, or missing await) spins forever with no response.
 * This interceptor returns 504 Gateway Timeout after the deadline.
 *
 * ⚠️ It must be `GatewayTimeoutException` (504), NOT `RequestTimeoutException`. Nest's
 * RequestTimeoutException is **408**, which means "the client took too long to send its request" —
 * the opposite party, and the wrong diagnosis for a hung server query. This file's comment claimed
 * 504 for months while the code returned 408; the notice contract test (#826 Phase 1) caught it.
 *
 * Registered globally in main.ts via app.useGlobalInterceptors().
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  GatewayTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds max per request

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () => new GatewayTimeoutException('Request timed out'),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
