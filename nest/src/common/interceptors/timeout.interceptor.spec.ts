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
  nearDeadlineAtMs,
  nearDeadlineWarning,
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

/**
 * ── #1140: the routes that were still on the 30 s default ───────────────────────────────────────
 *
 * The per-route override shipped with `POST /run` only. Its SIBLINGS on the same path were never
 * declared, so the identical 504 was still waiting for them — measured 2026-11-13:
 *
 *   optimize       5x5 default grid x `await this.run()`  = 25 full backtests (one run = 298 s)
 *   walk-forward   calls optimize(), then re-runs train + test on 730/365-day windows  = >2x
 *   coverage       144 registered directives x 365 days of bars  = ~52,000 evaluations
 *
 * These assertions read the deadline through the REAL metadata path (`Reflect`), not through a
 * local constant, so they fail if a decorator is removed OR if the interceptor stops reading it.
 */
describe('Long-running routes are declared, not inherited (#1140)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BacktestController } = require('../../modules/backtest/backtest.controller');

  const deadlineOf = (method: string): number => {
    const fn = BacktestController.prototype[method];
    expect(typeof fn).toBe('function');
    return resolveDeadline(Reflect.getMetadata(LONG_RUNNING_MS, fn));
  };

  it.each([
    ['run', 600_000, 'measured 298 s; 2x headroom'],
    ['optimize', 1_800_000, 'measured 49.5 s for a 400-run grid (24.8 s for 100)'],
    ['walkForward', 3_600_000, 'measured 206.4 s for a 15x15 grid on 300/250-day windows'],
  ])('%s() declares its own deadline (%s)', (method, expected) => {
    expect(deadlineOf(method as string)).toBe(expected);
    expect(deadlineOf(method as string)).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  // ⚠️ The mirror case, and it is not padding: an over-applied override is indistinguishable from no
  // timeout. These only READ stored runs, create a record, or bound their own work — decorating them
  // would blind the hang guard on the routes most likely to be hit in a loop.
  it.each([
    ['repeatCheck', 'reads stored runs, does arithmetic on their scoreSeries'],
    ['compareRuns', 'reads stored runs'],
    ['createExperiment', 'inserts one row'],
    ['stopSweep', 'arithmetic over one stored run\'s recorded excursions'],
    // ⚠️ Measured 2026-11-13: 201 in 1.16 s for 144 directives x 365d. I had decorated this at 900 s
    // by counting the loop shape, and the measurement proved the count wrong about the cost. This
    // case exists so the next agent cannot re-add the decorator on the strength of the loop count.
    ['directiveCoverage', 'measured 1.16 s — it bounds itself with take: days + 30'],
  ])('%s() correctly keeps the 30 s default (%s)', (method) => {
    expect(deadlineOf(method as string)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe('Near-deadline warning (#1140)', () => {
  it('warns at 80% of the deadline, for both the default and an override', () => {
    expect(nearDeadlineAtMs(30_000)).toBe(24_000);
    expect(nearDeadlineAtMs(600_000)).toBe(480_000);
  });

  it('names the route, the elapsed time and the deadline — a bare 504 names none of them', () => {
    const msg = nearDeadlineWarning('BacktestController.optimize', 24_000, 30_000);
    expect(msg).toContain('BacktestController.optimize');
    expect(msg).toContain('24000ms');
    expect(msg).toContain('30000ms');
    expect(msg).toContain('80%');
    expect(msg).toContain('@LongRunning');
  });

  it('fires WHILE the request is still running, so there is time to act', async () => {
    jest.useFakeTimers();
    const interceptor = new TimeoutInterceptor();
    const warn = jest.spyOn((interceptor as any).logger, 'warn').mockImplementation(() => {});
    const never = { handle: () => new (require('rxjs').Observable)(() => () => {}) } as any;

    interceptor.intercept(contextWith(undefined), never);
    jest.advanceTimersByTime(nearDeadlineAtMs(DEFAULT_TIMEOUT_MS) - 1);
    expect(warn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('of its 30000ms deadline');

    jest.useRealTimers();
    warn.mockRestore();
  });

  it('does NOT warn once the request has completed — accusing a success is worse than silence', async () => {
    jest.useFakeTimers();
    const interceptor = new TimeoutInterceptor();
    const warn = jest.spyOn((interceptor as any).logger, 'warn').mockImplementation(() => {});

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contextWith(undefined), { handle: () => of({ ok: true }) } as any)
        .subscribe({ next: () => {}, complete: () => resolve() });
    });

    // Well past the near-deadline point: the timer must have been cleared by finalize.
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS * 2);
    expect(warn).not.toHaveBeenCalled();

    jest.useRealTimers();
    warn.mockRestore();
  });
});
