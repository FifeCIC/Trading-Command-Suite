/**
 * run-metrics.spec.ts — #1021.
 *
 * ⚠️ THE NULL CASE IS THE WHOLE POINT HERE, not a footnote. The issue's acceptance criteria say
 * `rate` must be `null` for a run with no trades — "never `0`, and never the signal rate" — because
 * `null` says "there was no trade to judge" and `0` says "every trade lost". The four copies this
 * module replaces disagreed on exactly that: three produced `0`-or-percent and one produced
 * `null`-or-fraction.
 *
 * These cases are pure and need no database, so they run in milliseconds and can be canaried.
 */
import {
  tradeWinRateFromRows,
  percentOrNull,
  countTradeWinRatesByRun,
  countTradeWinRate,
  NO_TRADES,
} from './run-metrics';

describe('run-metrics — one derivation of a run\'s TRADE win rate (#1021)', () => {
  describe('the null case — "no trades" is not "no wins"', () => {
    it('an empty run returns null, NOT 0', () => {
      const r = tradeWinRateFromRows([]);
      expect(r.trades).toBe(0);
      expect(r.fraction).toBeNull();
      // The regression guard. `0` is the value three of the four old copies produced.
      expect(r.fraction).not.toBe(0);
    });

    it('null and undefined input are treated as empty, not as a crash', () => {
      expect(tradeWinRateFromRows(null).fraction).toBeNull();
      expect(tradeWinRateFromRows(undefined).fraction).toBeNull();
    });

    it('a run where every trade lost is 0 — which is a DIFFERENT fact from null', () => {
      const allLosers = tradeWinRateFromRows([{ pnl: -5 }, { pnl: -1 }]);
      expect(allLosers.fraction).toBe(0);
      // ⚠️ This is the distinction the whole module exists to protect. If these two ever become
      // both-null or both-zero, the module has failed at its one job.
      expect(tradeWinRateFromRows([]).fraction).toBeNull();
      expect(allLosers.fraction).not.toBe(tradeWinRateFromRows([]).fraction);
    });
  });

  describe('the counting', () => {
    it('counts winners as pnl > 0, strictly', () => {
      const r = tradeWinRateFromRows([{ pnl: 10 }, { pnl: 0 }, { pnl: -3 }]);
      // ⚠️ A break-even trade is NOT a win. `gte: 0` would call this 2/3 and inflate every rate.
      expect(r.trades).toBe(3);
      expect(r.winners).toBe(1);
    });

    it('a null pnl is not a win and not a crash', () => {
      const r = tradeWinRateFromRows([{ pnl: null }, { pnl: 5 }]);
      expect(r.trades).toBe(2);
      expect(r.winners).toBe(1);
    });

    it('the fraction is 0–1, not a percentage', () => {
      // ⚠️ THE UNIT ASSERTION. Two of the four old copies produced a percent here and one produced
      // a fraction, under field names that did not say which. 1 of 4 is 0.25, never 25.
      const r = tradeWinRateFromRows([{ pnl: 1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }]);
      expect(r.fraction).toBeCloseTo(0.25, 10);
      expect(r.fraction).not.toBeCloseTo(25, 10);
    });
  });

  describe('percentOrNull — the only sanctioned conversion', () => {
    it('passes null straight through rather than turning it into 0', () => {
      expect(percentOrNull(null)).toBeNull();
    });

    it('converts a fraction to a 2dp percent', () => {
      expect(percentOrNull(0)).toBe(0);
      expect(percentOrNull(1)).toBe(100);
      expect(percentOrNull(0.6667)).toBeCloseTo(66.67, 2);
    });
  });

  describe('the DB derivation — batched, and consistent with the pure one', () => {
    /**
     * A minimal Prisma double. Two `groupBy` calls are issued per batch, so the double records the
     * calls — a per-run loop would show up here as an N+1 rather than passing silently.
     */
    function prismaDouble(byRun: Record<string, { trades: number; winners: number }>) {
      const calls: any[] = [];
      return {
        calls,
        backtestTrade: {
          groupBy: (args: any) => {
            calls.push(args);
            const winnersOnly = args.where?.pnl?.gt !== undefined;
            const ids: string[] = args.where?.runId?.in ?? [];
            return Promise.resolve(
              ids
                .map((id) => ({ runId: id, _count: { _all: winnersOnly ? (byRun[id]?.winners ?? 0) : (byRun[id]?.trades ?? 0) } }))
                .filter((r) => r._count._all > 0),
            );
          },
        },
      } as any;
    }

    it('uses TWO queries for MANY runs, not two per run', async () => {
      const p = prismaDouble({ a: { trades: 4, winners: 1 }, b: { trades: 2, winners: 2 } });
      await countTradeWinRatesByRun(p, ['a', 'b', 'c', 'd', 'e']);
      // ⚠️ A per-run implementation would issue 10. The point of the batch signature is that a
      // screen showing 50 runs does not become a 101-query N+1.
      expect(p.calls).toHaveLength(2);
    });

    it('agrees with the pure derivation on the SAME data', async () => {
      const p = prismaDouble({ a: { trades: 4, winners: 1 } });
      const dbRate = (await countTradeWinRatesByRun(p, ['a'])).get('a')!;
      const pureRate = tradeWinRateFromRows([{ pnl: 1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }]);
      // Two code paths, one answer — which is what stops them drifting apart again.
      expect(dbRate.trades).toBe(pureRate.trades);
      expect(dbRate.winners).toBe(pureRate.winners);
      expect(dbRate.fraction).toBeCloseTo(pureRate.fraction as number, 10);
    });

    it('a run with no rows is PRESENT in the map as null, not absent', async () => {
      const p = prismaDouble({ a: { trades: 3, winners: 1 } });
      const map = await countTradeWinRatesByRun(p, ['a', 'empty']);
      // ⚠️ "no row" and "not asked" must not look alike. An absent key would make a caller's
      // `?? 0` fallback silently reintroduce the very defect this module removes.
      expect(map.has('empty')).toBe(true);
      expect(map.get('empty')!.fraction).toBeNull();
      expect(map.get('a')!.fraction).toBeCloseTo(1 / 3, 10);
    });

    it('zero run ids issues NO query at all', async () => {
      const p = prismaDouble({});
      const map = await countTradeWinRatesByRun(p, []);
      expect(map.size).toBe(0);
      expect(p.calls).toHaveLength(0);
    });

    it('countTradeWinRate() gives the same answer as the batched form', async () => {
      const p = prismaDouble({ solo: { trades: 5, winners: 4 } });
      const one = await countTradeWinRate(p, 'solo');
      expect(one.trades).toBe(5);
      expect(one.fraction).toBeCloseTo(0.8, 10);
      // And for an id with nothing, it reports absence rather than a zero rate.
      const none = await countTradeWinRate(prismaDouble({}), 'missing');
      expect(none.fraction).toBeNull();
    });
  });

  it('NO_TRADES is the declared shape, and is not shared by reference', () => {
    expect(NO_TRADES).toEqual({ trades: 0, winners: 0, fraction: null });
    const a = tradeWinRateFromRows([]);
    a.trades = 99;
    // A returned object must not be the module constant, or one caller's edit leaks to every other.
    expect(NO_TRADES.trades).toBe(0);
  });
});
