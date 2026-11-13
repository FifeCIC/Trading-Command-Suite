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
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  GatewayTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError, finalize } from 'rxjs/operators';
import { LONG_RUNNING_MS } from '../decorators/long-running.decorator';

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How far into its deadline a request must get before a warning is logged (#1140).
 *
 * ── WHY A WARNING EXISTS AT ALL ────────────────────────────────────────────────────────────────
 * The per-route override fixed `POST /run`, and the SAME defect survived on its siblings: measured
 * 2026-11-13, `optimize` (a 5×5 grid = 25 full runs), `walk-forward` (optimize twice on 730/365-day
 * windows) and `coverage` (144 directives × 365 bars) all still carried the 30 s default. A route
 * that is 20 s of work away from a deadline looks perfectly healthy right up to the 504, and the
 * 504 carries only `{ seconds: 30 }` — it does not say WHICH route, or how close it was.
 *
 * At 80% the request is still running, so the line names the route and the elapsed time while
 * there is time to act. This is a SYMPTOM guard on purpose: it does not need to know why a route is
 * slow, so it cannot inherit a wrong theory about the cause.
 *
 * ⚠️ The warning is not a pass. A route that warns and then completes still warned, and a route
 * that warns on EVERY call is undeclared and should get its own `@LongRunning`.
 */
export const NEAR_DEADLINE_FRACTION = 0.8;

/** The elapsed time at which a request is considered near its deadline. */
export function nearDeadlineAtMs(deadlineMs: number): number {
  return Math.floor(deadlineMs * NEAR_DEADLINE_FRACTION);
}

/** One line naming what is about to time out. Pure, so it can be asserted without a server. */
export function nearDeadlineWarning(route: string, elapsedMs: number, deadlineMs: number): string {
  return (
    `${route} has run ${elapsedMs}ms of its ${deadlineMs}ms deadline ` +
    `(${Math.round((elapsedMs / deadlineMs) * 100)}%). If this route is SUPPOSED to take this ` +
    `long it needs @LongRunning(ms); if not, it is about to be reported as a hang.`
  );
}

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
  /**
   * ⚠️ `new Logger(...)` rather than injected, for the same reason `Reflect.getMetadata` is used
   * directly: `main.ts` builds this interceptor with `new TimeoutInterceptor()` OUTSIDE Nest's DI
   * container, so an injected dependency would be silently `undefined`.
   */
  private readonly logger = new Logger(TimeoutInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const deadline = deadlineFor(context);
    const startedAt = Date.now();
    const route = `${context.getClass()?.name ?? '?'}.${context.getHandler()?.name ?? '?'}`;

    const warnTimer = setTimeout(() => {
      this.logger.warn(
        nearDeadlineWarning(route, Date.now() - startedAt, deadline),
      );
    }, nearDeadlineAtMs(deadline));
    // Do not hold the event loop open, and make sure a normal completion cannot leave a warning
    // queued behind it — a warning fired AFTER the response is worse than none: it accuses a
    // request that has already succeeded.
    warnTimer.unref?.();

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
      finalize(() => clearTimeout(warnTimer)),
    );
  }
}
