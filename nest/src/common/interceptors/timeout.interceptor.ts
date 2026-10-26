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
 *
 * ── TWO DEADLINES, NOT ONE (#1139) ──────────────────────────────────────────────────────────────
 * `DEFAULT_TIMEOUT_MS` applies to everything. A route that declares `@LongRunning(ms)` gets its own,
 * because a single global number cannot be right for both "an endpoint that is hanging" and "an
 * endpoint that is scoring 3,000 bars". Measured 2026-10-26: `POST /api/backtest/run` returned 504
 * at 30 s mid-run, so the Backtest Lab could never show a result for a real window.
 *
 * ⚠️ The override is read from ROUTE metadata. `Reflect.getMetadata` is used directly rather than
 * injecting `Reflector` — because `main.ts` constructs this interceptor with `new TimeoutInterceptor()`
 * inside `useGlobalInterceptors()`, where Nest's DI does not run and an injected dependency would be
 * silently `undefined`. That failure mode is invisible: the guard would keep enforcing the default and
 * look healthy. A first attempt at this fix DID inject `Reflector` and the route still returned 504 at
 * 30 s — measured 2026-10-26. Reading the metadata directly removes the dependency entirely.
 *
 * A route that declares nothing keeps the default, which is the property that makes the default
 * meaningful.
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
import { LONG_RUNNING_MS } from '../decorators/long-running.decorator';

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Resolve the deadline for one request. Pure, so it can be asserted without an HTTP stack. */
export function resolveDeadline(routeOverride: unknown): number {
  const ms = Number(routeOverride);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT_MS;
}

/** Handler metadata wins over class metadata; an absent or invalid value falls back to the default. */
export function deadlineFor(context: ExecutionContext): number {
  const own = Reflect.getMetadata(LONG_RUNNING_MS, context.getHandler());
  if (own !== undefined) return resolveDeadline(own);
  return resolveDeadline(Reflect.getMetadata(LONG_RUNNING_MS, context.getClass()));
}

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const deadline = deadlineFor(context);

    return next.handle().pipe(
      timeout(deadline),
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
