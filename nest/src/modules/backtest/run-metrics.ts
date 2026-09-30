/**
 * run-metrics.ts — the ONE derivation of a backtest run's TRADE win rate (#1021).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * A backtest run carries TWO populations, and #980 established they must never be merged:
 *
 *   • `winRate` on the stored row is a **SIGNAL** rate — it lives over entry signals.
 *   • `totalTrades` is a **TRADE** count — it lives over `backtesttrade` rows.
 *
 * The trade rate is therefore not stored; it is COUNTED. #980's own text named the risk it left
 * behind: *"the trades are already in `backtesttrade`, so it is derivable, but deriving it per read
 * has to happen in every consumer — which is how the adapter got it wrong."*
 *
 * It then happened in FOUR places, in TWO unit conventions:
 *
 *   getSummary()        groupBy pair → a PERCENT
 *   compareRuns()       groupBy pair → a PERCENT
 *   listAllRuns()       groupBy pair → a PERCENT
 *   formatRunResult()   in-memory    → a FRACTION (0–1)
 *
 * That is the shape this repo has already paid for: a second implementation of the same rule
 * drifts, and only one copy gets the next fix. So this module is the single derivation, and the
 * units are in the IDENTIFIERS rather than in a comment — `fraction` is 0–1, and a percent is
 * obtained only through `percentOrNull()`, because a bare `rate` is exactly the ambiguity that let
 * one field name carry two scales.
 *
 * ── THE RULE THAT MATTERS MOST ───────────────────────────────────────────────────────────────
 *
 * `fraction` is **null when the run made no trades** — never `0`, and never the signal rate.
 *
 * `null` says "there was no trade to judge". `0` says "every trade lost". Collapsing them is the
 * defect class of #980: a run with no trades would render as a 0% win rate and read as a failure
 * rather than as an absence of information.
 */

import type { PrismaService } from '../../database/prisma.service';

/** What one run's trade population looks like. `fraction` is 0–1, or null when there are no trades. */
export interface TradeWinRate {
  /** Rows in `backtesttrade` for this run. */
  trades: number;
  /** Of those, the ones with `pnl > 0`. */
  winners: number;
  /**
   * `winners / trades`, as a FRACTION in 0–1.
   *
   * ⚠️ NULL when `trades === 0`. 0 would claim every trade lost; null says there was nothing to
   * judge. Use `percentOrNull()` for a display percentage — never multiply at the call site, which
   * is how the two conventions diverged in the first place.
   */
  fraction: number | null;
}

/** No trades is not a 0% win rate. Exported so the null case is spelled once. */
export const NO_TRADES: TradeWinRate = { trades: 0, winners: 0, fraction: null };

/**
 * A winning trade, declared ONCE. Three copies of `pnl: { gt: 0 }` are three chances for one of
 * them to drift to `gte: 0` — which would silently count a break-even trade as a win.
 */
export const WINNING_TRADE_WHERE = { pnl: { gt: 0 } } as const;

/**
 * percentOrNull() — the ONLY sanctioned fraction→percent conversion.
 *
 * Rounds to 2dp, matching every existing consumer, and passes `null` straight through so a caller
 * cannot accidentally turn "no trades" into `0`.
 */
export function percentOrNull(fraction: number | null): number | null {
  return fraction === null ? null : Math.round(fraction * 10000) / 100;
}

/**
 * tradeWinRateFromRows() — the PURE derivation, for a run whose trades are already in memory.
 *
 * ⚠️ Separate from the DB path on purpose: a caller that already holds the rows must not pay for a
 * query, and `formatRunResult()` is exactly that caller. Both produce the same SHAPE, which is what
 * stops the two conventions drifting again.
 */
export function tradeWinRateFromRows(rows: Array<{ pnl: number | null }> | null | undefined): TradeWinRate {
  const list = rows ?? [];
  if (list.length === 0) return { ...NO_TRADES };
  const winners = list.filter((t) => Number(t.pnl) > 0).length;
  return { trades: list.length, winners, fraction: winners / list.length };
}

/**
 * countTradeWinRatesByRun() — the DB derivation, for MANY runs in TWO queries.
 *
 * ⚠️ BATCHED DELIBERATELY. A per-run function would be called once per run and turn a 2-query
 * screen into an N+1 — the very thing this repo's query scanner flags. Callers pass every run id
 * they need; runs with no rows are present in the Map as `NO_TRADES` rather than absent, so a
 * caller cannot confuse "no row" with "not asked".
 */
export async function countTradeWinRatesByRun(
  prisma: PrismaService,
  runIds: string[],
): Promise<Map<string, TradeWinRate>> {
  const out = new Map<string, TradeWinRate>();
  for (const id of runIds) out.set(id, { ...NO_TRADES });
  if (runIds.length === 0) return out;

  const [counted, countedWins] = await Promise.all([
    prisma.backtestTrade.groupBy({
      by: ['runId'],
      where: { runId: { in: runIds } },
      _count: { _all: true },
    }),
    prisma.backtestTrade.groupBy({
      by: ['runId'],
      where: { runId: { in: runIds }, ...WINNING_TRADE_WHERE },
      _count: { _all: true },
    }),
  ]);

  const countedByRun = new Map(counted.map((c: any) => [c.runId, c._count._all]));
  const winsByRun = new Map(countedWins.map((c: any) => [c.runId, c._count._all]));

  for (const id of runIds) {
    const trades = countedByRun.get(id) ?? 0;
    const winners = winsByRun.get(id) ?? 0;
    out.set(id, trades > 0 ? { trades, winners, fraction: winners / trades } : { ...NO_TRADES });
  }
  return out;
}

/**
 * countTradeWinRate() — ONE run, by id.
 *
 * Provided for a caller that genuinely needs a single run and has no batch to join. Prefer
 * `countTradeWinRatesByRun()` when several runs are in play: this issues the same two queries for
 * one id, so calling it in a loop is an N+1.
 */
export async function countTradeWinRate(prisma: PrismaService, runId: string): Promise<TradeWinRate> {
  const map = await countTradeWinRatesByRun(prisma, [runId]);
  return map.get(runId) ?? { ...NO_TRADES };
}
