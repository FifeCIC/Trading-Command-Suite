/**
 * exit-quality-bars.ts — the true maximum favourable excursion, computed ONCE, off the request path.
 *
 * ⚠️ THE OBVIOUS IMPLEMENTATION IS TOO SLOW TO SERVE (measured 2026-11-07).
 * Joining `marketbar` to `trade` on `timestamp BETWEEN openedAt AND closedAt` is a range join, and
 * `marketbar` holds **1.61 million rows**. Measured against the live database:
 *
 *     no timeframe filter          398 trades   24,481 ms
 *     timeframe = '1m'             385 trades   34,490 ms
 *     timeframe = '5m'             394 trades   14,326 ms
 *
 * The composite index is `(symbolId, timeframe, timestamp)`, so filtering by timeframe should have
 * helped — it did not, because the cost is the range join itself, not the index. Serving that from
 * `GET /api/trading/exit-quality` would hold a connection for half a minute and then time out.
 *
 * ⚠️ SO IT IS COMPUTED IN THE BACKGROUND AND READ FROM MEMORY. The first caller gets an answer
 * immediately that says `computing` — never a silently incomplete set. This is the same shape as the
 * deferred boot diagnostics (#1232): expensive work moved off the path that must answer quickly.
 *
 * ⚠️ IT IS A CACHE WITH A TTL, NOT A SOURCE OF TRUTH. If it is stale or absent, say so; the stored
 * `peakProfitPct` remains the durable record, and this is the measurement that audits it.
 */
import { PrismaService } from '../../database/prisma.service';

export interface BarMaxState {
  /** tradeId → true maximum favourable excursion, in percent (signed by side). */
  map: Map<string, number>;
  /** Epoch ms of the last completed computation. */
  computedAt: number | null;
  /** True while a computation is in flight. */
  computing: boolean;
  /** Set when the last attempt failed — the surface reports it instead of pretending freshness. */
  error: string | null;
}

/** How long a completed computation is reused before it is recomputed on demand. */
export const BAR_MAX_TTL_MS = 6 * 60 * 60 * 1000;

const state: BarMaxState = { map: new Map(), computedAt: null, computing: false, error: null };

export function barMaxState(): BarMaxState {
  return state;
}

/** Only for tests — resets the module-level cache between cases. */
export function __resetBarMaxStateForTest(): void {
  state.map = new Map();
  state.computedAt = null;
  state.computing = false;
  state.error = null;
}

export function isBarMaxFresh(nowMs = Date.now()): boolean {
  return state.computedAt != null && nowMs - state.computedAt < BAR_MAX_TTL_MS;
}

/**
 * Compute the true maximum across every closed position, and store it.
 *
 * ⚠️ NOT AWAITED BY THE CALLER THAT TRIGGERS IT. It takes ~25 s; awaiting would put that on the
 * request. `computing` is set synchronously so two concurrent callers cannot both start it.
 *
 * ⚠️ A FAILURE IS RECORDED, NOT SWALLOWED. If the join throws, `error` carries the reason and every
 * bar-derived figure stays null — the surface then says "cannot judge", which is true.
 */
export async function refreshBarMax(prisma: PrismaService, sinceDays = 365): Promise<void> {
  if (state.computing) return;
  state.computing = true;
  state.error = null;
  try {
    const since = new Date(Date.now() - sinceDays * 86400000);
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; hi: number | null; lo: number | null; entry: number; shortf: number }>
    >(
      `SELECT t.id,
              MAX(m.high) AS hi,
              MIN(m.low)  AS lo,
              t.entryPrice AS entry,
              CASE WHEN LOWER(t.side) IN ('sell','short') THEN 1 ELSE 0 END AS shortf
         FROM trade t
         JOIN symbol s    ON s.ticker = t.symbol
         JOIN marketbar m ON m.symbolId = s.id
                         AND m.timestamp >= t.openedAt
                         AND m.timestamp <= t.closedAt
        WHERE t.closedAt >= ? AND t.pnlInvalid = 0 AND t.openedAt IS NOT NULL
        GROUP BY t.id, t.entryPrice, t.side`,
      since,
    );

    const map = new Map<string, number>();
    for (const r of rows) {
      const entry = Number(r.entry);
      if (!Number.isFinite(entry) || entry === 0) continue;
      const hi = r.hi == null ? null : Number(r.hi);
      const lo = r.lo == null ? null : Number(r.lo);
      if (hi == null || lo == null) continue;
      const pct = Number(r.shortf) === 1 ? ((entry - lo) / entry) * 100 : ((hi - entry) / entry) * 100;
      map.set(String(r.id), Number(pct.toFixed(4)));
    }

    state.map = map;
    state.computedAt = Date.now();
  } catch (err) {
    state.error = (err as Error).message || String(err);
  } finally {
    state.computing = false;
  }
}
