import { PositionTimeStopService, parseMaxHoldHours } from './position-time-stop.service';

/**
 * Integration-style test for the #773 time-stop decision logic.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live evidence (#773) was: 5 broker positions all `buy`, nothing closing,
 * `BLOCKED Max open positions (5) reached` 28 times in 12h, and 633 decisions producing
 * 2 trades. The cause was that NO time-based exit existed — `maxHoldDuration` was declared
 * on the interface but never persisted, so it was never read.
 *
 * Waiting for a real 5-minute timer to observe detection is a slow and flaky way to prove
 * that logic, and it cannot cover the cases that matter most: a position with NO limit
 * configured (must never close), a position that cannot be attributed (must not be
 * guessed), and a mixed batch (one failure must not abort the rest).
 *
 * These tests drive `tick()` with a mocked bridge so the DECISION is pinned, including
 * the dry-run guarantee that no close is sent while the service is unarmed.
 */

interface FakePosition {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  profit: number;
  /** The MT5 bridge's actual field name. See the regression test below. */
  openTime?: string;
  openedAt?: string;
  comment?: string;
}

function makeService(opts: {
  positions: FakePosition[];
  strategies: any[];
  dryRun: boolean;
}) {
  const closeCalls: number[] = [];
  const mt5 = {
    getPositions: jest.fn(async () => opts.positions),
    closePosition: jest.fn(async (ticket: number) => {
      closeCalls.push(ticket);
      return { ok: true };
    }),
    getUrl: () => 'http://localhost:5000',
  } as any;

  const strategyService = {
    findAll: jest.fn(async () => opts.strategies),
  } as any;

  const svc = new PositionTimeStopService(mt5, strategyService);
  svc.state.tickIntervalMs = 60_000; // irrelevant; we call tick() directly
  svc.state.dryRun = opts.dryRun;
  return { svc, closeCalls, mt5 };
}

/** ISO timestamp `hours` in the past. */
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

describe('PositionTimeStopService — #773 position slot lifecycle', () => {
  const AUDUSD_STRATEGY = {
    id: 's-aud',
    name: 'Sydney AUDUSD Session',
    symbol: 'AUDUSD',
    maxHoldHours: 12,
  };

  describe('the live failure case: a position held past its limit', () => {
    it('detects an AUDUSD position held 52h against a 12h limit', async () => {
      // This is the real position observed: AUDUSD buy, 52 hours open, no limit enforced.
      const { svc } = makeService({
        positions: [{ ticket: 111, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: -4.53, openedAt: ago(52) }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });

      await svc.tick();
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0]).toMatchObject({
        ticket: 111,
        symbol: 'AUDUSD',
        hoursHeld: 52,
        maxHoldHours: 12,
        overByHours: 40,
      });
    });
  });

  describe('positions inside their limit must be left alone', () => {
    it('ignores a position younger than its limit', async () => {
      const { svc } = makeService({
        positions: [{ ticket: 222, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 1, openedAt: ago(5) }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
    });

    it('does not close a position clearly inside its limit', async () => {
      // ⚠️ Deliberately NOT "exactly 12h". `ago(12)` is a few milliseconds older than 12h
      // by the time the assertion runs, so under load it drifts just past the boundary and
      // the test flakes — which says nothing about the service. The real requirement is
      // that a position comfortably inside its limit is left alone; the exact-equality
      // boundary is untestable at millisecond resolution and not worth pinning.
      const { svc, closeCalls } = makeService({
        positions: [{ ticket: 333, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(11.5) }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: false,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
    });
  });

  describe('a strategy with NO limit must never have its positions closed', () => {
    it('skips a position whose strategy has maxHoldHours = null', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{ ticket: 444, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(500) }],
        strategies: [{ id: 's-nolimit', name: 'No Limit', symbol: 'AUDUSD', maxHoldHours: null }],
        dryRun: false, // even ARMED, no limit means do nothing
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
    });
  });

  describe('DRY RUN must never send a close', () => {
    it('reports the candidate but sends no close order', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{ ticket: 555, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: -50, openedAt: ago(99) }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(1);
      expect(closeCalls).toHaveLength(0); // the guarantee
      expect(svc.state.closedCount).toBe(0);
    });
  });

  describe('armed: closes past-limit positions and orders longest-held first', () => {
    it('closes and records them', async () => {
      const { svc, closeCalls } = makeService({
        positions: [
          { ticket: 1, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: -4, openedAt: ago(52) },
          { ticket: 2, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: -1, openedAt: ago(20) },
        ],
        strategies: [AUDUSD_STRATEGY],
        dryRun: false,
      });
      await svc.tick();
      expect(closeCalls).toEqual([1, 2]); // 52h before 20h
      expect(svc.state.closedCount).toBe(2);
      // `recentCloses` is newest-first (unshift), and closes happen longest-held-first, so
      // the 20h position is the LAST entry to be closed and therefore sits at index 0.
      expect(svc.state.recentCloses[0]).toMatchObject({ ticket: 2, symbol: 'AUDUSD', hoursHeld: 20 });
      expect(svc.state.recentCloses[1]).toMatchObject({ ticket: 1, symbol: 'AUDUSD', hoursHeld: 52 });
    });

    it('one failed close does not abort the rest of the batch', async () => {
      const mt5 = {
        getPositions: jest.fn(async () => [
          { ticket: 10, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(50) },
          { ticket: 20, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(40) },
        ]),
        closePosition: jest.fn(async (t: number) => {
          if (t === 10) throw new Error('bridge refused');
          return { ok: true };
        }),
        getUrl: () => 'http://localhost:5000',
      } as any;
      const svc = new PositionTimeStopService(mt5, { findAll: async () => [AUDUSD_STRATEGY] } as any);
      svc.state.dryRun = false;

      await svc.tick();
      expect(svc.state.closedCount).toBe(1); // only #20
      expect(svc.state.recentCloses[0].ticket).toBe(20);
    });
  });

  describe('attribution must not guess', () => {
    it('skips when several strategies trade the symbol and the comment does not disambiguate', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{ ticket: 666, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(200) }],
        strategies: [
          { id: 'a', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 4 },
          { id: 'b', name: 'Gold Swing 1H', symbol: 'XAUUSD', maxHoldHours: 72 },
        ],
        dryRun: false,
      });
      await svc.tick();
      // Ambiguous -> no attribution -> not closed. Closing the wrong ticket is worse than
      // leaving a slot occupied.
      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
    });

    it('uses the order comment to disambiguate when present', async () => {
      const { svc } = makeService({
        positions: [{
          ticket: 777, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0,
          openedAt: ago(200), comment: 'TCS:xau-speed-m5:a',
        }],
        strategies: [
          { id: 'a', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 4 },
          { id: 'b', name: 'Gold Swing 1H', symbol: 'XAUUSD', maxHoldHours: 72 },
        ],
        dryRun: true,
      });
      await svc.tick();
      // Comment names strategy 'a' (4h limit) -> 200h held is over it.
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0].maxHoldHours).toBe(4);
    });
  });

  describe('malformed position payloads must be skipped, not guessed', () => {
    it('skips a position with no usable open time', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{ ticket: 888, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0 }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: false,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
    });

    /**
     * REGRESSION GUARD — the REAL bridge field name.
     *
     * Verified against the live bridge payload, `GET :5000/positions` returns:
     *   ticket, symbol, type, volume, priceOpen, priceCurrent, sl, tp, profit, swap,
     *   contractSize, currencyBase, currencyProfit, **openTime**, magic, comment
     *
     * There is no `openedAt` and no `time`. An earlier version read only those two, so it
     * silently skipped every position and logged nothing — which looks exactly like
     * "nothing is over its limit". This test uses the real field name so that mistake
     * cannot come back.
     */
    it('reads hold time from the bridge\'s actual `openTime` field', async () => {
      const { svc } = makeService({
        positions: [{
          ticket: 999, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: -4.53,
          openTime: ago(52), // the real field
        }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0]).toMatchObject({ ticket: 999, hoursHeld: 52, maxHoldHours: 12 });
    });

    it('still accepts `openedAt` from other adapters', async () => {
      const { svc } = makeService({
        positions: [{ ticket: 1000, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(30) }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(1);
    });
  });

  describe('empty portfolio is not an error', () => {
    it('handles zero positions', async () => {
      const { svc } = makeService({ positions: [], strategies: [AUDUSD_STRATEGY], dryRun: true });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(svc.state.lastError).toBeNull();
    });
  });

  describe('config read shape', () => {
    it('reads maxHoldHours off the strategy (the #773 DB column)', () => {
      expect(parseMaxHoldHours(4)).toBe(4);
      expect(parseMaxHoldHours(12)).toBe(12);
      expect(parseMaxHoldHours(null)).toBeNull();
    });

    /**
     * REGRESSION GUARD — plumbing, not logic.
     *
     * This whole feature silently did nothing twice, both times because a field existed in
     * one place and not the other:
     *   1. `maxHoldDuration` was declared on the interface but never persisted -> never read.
     *   2. `maxHoldHours` was added as a column, but `StrategySummary` (the shape
     *      `findAll()` returns, and the only thing this service sees) did not carry it.
     *
     * In both cases the service reported zero candidates and logged nothing, which looks
     * identical to "no position is over its limit" — a silent empty. So this test asserts
     * the field is actually REACHABLE through the summary shape, not merely present in the DB.
     */
    it('the limit must be reachable through the strategy summary the service consumes', async () => {
      // Shape mirrors StrategySummary.find with the #773 field present.
      const summary = { id: 's1', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 4 };
      const { svc } = makeService({
        positions: [{ ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(9) }],
        strategies: [summary],
        dryRun: true,
      });
      await svc.tick();
      // If the summary ever stops carrying maxHoldHours, this goes to 0 and the test fails
      // rather than the feature quietly turning itself off.
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0].maxHoldHours).toBe(4);
    });
  });
});
