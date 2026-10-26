import { SetMetadata } from '@nestjs/common';

/**
 * `LONG_RUNNING_MS` — a per-route override for the global request deadline (#1139).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `TimeoutInterceptor` enforces ONE deadline for every route: 30 s. That is the right default — it
 * is what stops a hung endpoint holding a connection open forever — but it is the wrong deadline for
 * an endpoint whose CORRECT behaviour is to take minutes.
 *
 * Measured 2026-10-26: `POST /api/backtest/run` over the frozen development window returns
 * **504 TCS-SYS-005 (`seconds: 30`)** mid-run. The whole point of the Backtest Lab is that endpoint,
 * and the page's own client timeout is 300 s — so the client was waiting for an answer the server was
 * configured never to produce. Stored runs stopped at 2026-10-22 21:55.
 *
 * ── WHY NOT RAISE THE GLOBAL DEADLINE ──────────────────────────────────────────────────────────
 * Because the 30 s default is load-bearing on every OTHER route. A global "10 minutes" would leave
 * a deadlocked query holding a socket for ten minutes on hundreds of endpoints, and would hide the
 * very hang the interceptor was added to catch. The narrow fix is to let the one route that has a
 * reason to be slow say so, in the place where that reason is visible.
 *
 * ── HOW TO USE IT ──────────────────────────────────────────────────────────────────────────────
 * ```ts
 * @Post('run')
 * @LongRunning(300_000)          // ms
 * async run(@Body() body: Request) { … }
 * ```
 * Apply it ONLY where the slowness is intractable work (a scored bar loop), never to paper over a
 * query that should be indexed. An over-applied override is indistinguishable from no timeout.
 */
export const LONG_RUNNING_MS = 'LONG_RUNNING_MS';

/** Raise this route's request deadline to `ms` milliseconds. */
export const LongRunning = (ms: number) => SetMetadata(LONG_RUNNING_MS, ms);
