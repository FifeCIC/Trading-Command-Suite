/**
 * TimeoutInterceptor deadlines — the guard for #1139.
 *
 * The defect this pins: ONE global 30 s deadline applied to every route, including
 * `POST /api/backtest/run`, which scores one bar at a time and legitimately takes minutes. Measured
 * 2026-10-26 the route returned `504 TCS-SYS-005 params.seconds: 30` mid-run, so the Backtest Lab
 * could never display a result for a real window, and stored runs had stopped four days earlier.
 *
 * Two properties, and they pull in opposite directions, so both are asserted:
 *   1. a route that declares nothing keeps the 30 s default — the default is only meaningful if it
 *      still applies;
 *   2. a route that declares `@LongRunning(ms)` gets exactly its own value.
 *
 * A test that only checked (2) would pass on a build where the interceptor had stopped enforcing
 * anything at all.
 */
import { of, throwError } from 'rxjs';
import { TimeoutError } from 'rxjs';
import { GatewayTimeoutException } from '@nestjs/common';
import {
  TimeoutInterceptor,
  resolveDeadline,
  DEFAULT_TIMEOUT_MS,
} from './timeout.interceptor';
import { LONG_RUNNING_MS } from '../decorators/long-running.decorator';

/** Minimal ExecutionContext — the interceptor only ever asks for handler and class. */
function contextWith(handlerMeta: number | undefined) {
  const handler = function handler() { /* the resolved route method */ };
  if (handlerMeta !== undefined) {
    Reflect.defineMetadata(LONG_RUNNING_MS, handlerMeta, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
  } as any;
}

describe('TimeoutInterceptor deadlines (#1139)', () => {
  describe('resolveDeadline', () => {
    it('falls back to the 30 s default when the route declares nothing', () => {
      expect(resolveDeadline(undefined)).toBe(DEFAULT_TIMEOUT_MS);
      expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    });

    it('uses a declared override', () => {
      expect(resolveDeadline(300_000)).toBe(300_000);
    });

    // ⚠️ A malformed override must NOT become "no timeout". `timeout(0)` fires immediately and
    // `timeout(NaN)` never fires — two opposite failures from the same typo, so the guard is an
    // explicit whitelist rather than a truthiness check.
    it.each([0, -1, NaN, Infinity, 'soon', null])(
      'refuses the invalid override %p and keeps the default',
      (bad) => {
        expect(resolveDeadline(bad)).toBe(DEFAULT_TIMEOUT_MS);
      },
    );
  });

  describe('intercept', () => {
    // A pipeline that never emits, so only the deadline can settle it.
    const never = { handle: () => new (require('rxjs').Observable)(() => () => {}) } as any;

    it('an UNDECORATED route still times out at the default', async () => {
      jest.useFakeTimers();
      const interceptor = new TimeoutInterceptor();
      const result$ = interceptor.intercept(contextWith(undefined), never);
      const settled = new Promise<any>((resolve) => result$.subscribe({ error: resolve }));
      jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1);
      const err = await settled;
      jest.useRealTimers();
      expect(err).toBeInstanceOf(GatewayTimeoutException);
      expect((err as GatewayTimeoutException).getStatus()).toBe(504);
    });

    it('a DECORATED route survives past the default and fails at its own deadline', async () => {
      jest.useFakeTimers();
      const interceptor = new TimeoutInterceptor();
      const result$ = interceptor.intercept(contextWith(300_000), never);
      let settled: any = null;
      result$.subscribe({ error: (e) => { settled = e; } });

      // Past the default: an override that did not take effect would have thrown by now.
      jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 5_000);
      expect(settled).toBeNull();

      jest.advanceTimersByTime(300_000);
      expect(settled).toBeInstanceOf(GatewayTimeoutException);
      jest.useRealTimers();
    });

    it('passes a normal response straight through', (done) => {
      const interceptor = new TimeoutInterceptor();
      interceptor
        .intercept(contextWith(300_000), { handle: () => of({ ok: true }) } as any)
        .subscribe({
          next: (v) => { expect(v).toEqual({ ok: true }); done(); },
          error: done,
        });
    });

    it('does not convert a real error into a timeout', (done) => {
      const interceptor = new TimeoutInterceptor();
      const boom = new Error('provider down');
      interceptor
        .intercept(contextWith(undefined), { handle: () => throwError(() => boom) } as any)
        .subscribe({
          next: () => done(new Error('should not emit')),
          error: (e) => { expect(e).toBe(boom); expect(e).not.toBeInstanceOf(TimeoutError); done(); },
        });
    });
  });
});
