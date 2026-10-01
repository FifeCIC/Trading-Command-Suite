import { PositionTimeStopService, parseMaxHoldHours } from './position-time-stop.service';
import { classifyMt5Comment } from '../providers/mt5-comment.util';
import { CLOSE_REASONS } from '../../common/trading/close-reason';

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
    // ⚠️ #1030 — `getAllPositions`, not `getPositions`. The service read the PRIMARY bridge only
    // (`getPositions()` with no argument), so a position on broker 3 was never evaluated for its
    // hold limit and its slot was never freed by the mechanism #773 added to free slots.
    getAllPositions: jest.fn(async () => opts.positions),
    closePosition: jest.fn(async (ticket: number, _brokerId?: number) => {
      closeCalls.push(ticket);
      return { ok: true };
    }),
    getBrokerIds: () => [2, 3],
  } as any;

  const strategyService = {
    findAll: jest.fn(async () => opts.strategies),
  } as any;

  // ⚠️ Added 2026-09-18 with the close-attribution work. The time-stop now records WHY it closed
  // a position (`trade.closeReason`), because its close history used to live only in memory and was
  // wiped on every restart — which is what made an investigation into unexpected exits impossible.
  // The mock records the writes so a test can assert the attribution actually happens.
  const closeReasonWrites: any[] = [];
  const prisma = {
    trade: {
      updateMany: jest.fn(async (args: any) => {
        closeReasonWrites.push(args);
        return { count: 1 };
      }),
    },
  } as any;

  const svc = new PositionTimeStopService(mt5, strategyService, prisma);
  svc.state.tickIntervalMs = 60_000; // irrelevant; we call tick() directly
  svc.state.dryRun = opts.dryRun;
  return { svc, closeCalls, mt5, closeReasonWrites };
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
        // #928 — the trigger is now part of the decision, so a reader can tell WHY without
        // re-deriving it from the numbers.
        trigger: 'max_hold',
      });
    });
  });

  /**
   * #928 — THE WIRING CANARY for the exit-side session boundary.
   *
   * ⚠️ This test exists to prove the boundary is REACHED from the real loop, not merely that the
   * comparison works. The comparison is pinned by `exit-trigger.spec.ts`; what can only be observed
   * here is that a bot declaring ONLY a boundary gets a candidate at all — the masking bug the
   * original `maxHoldHours === null` early-`continue` would have caused.
   *
   * ⚠️ `'00:00'` IS USED DELIBERATELY, because this service reads the real clock and there is no
   * injected clock at this level. `00:00` is always in the past for any observation time, so the
   * case cannot flake — the alternative (`'23:59'`, hoping to be before it) would pass all morning
   * and fail in the evening, which is a test passing for the wrong reason.
   */
  describe('#928 — the exit-side session boundary reaches the close path', () => {
    const BOUNDARY_ONLY = {
      id: 's-bound',
      name: 'Tokyo EURJPY Session',
      symbol: 'EURJPY',
      maxHoldHours: null, // ⚠️ NO hold limit — the whole point
      exitBeforeUtc: '00:00',
    };

    it('a BOUNDARY-ONLY bot produces a candidate (maxHoldHours null must not mask it)', async () => {
      const { svc } = makeService({
        positions: [{ ticket: 700, symbol: 'EURJPY', type: 'buy', volume: 0.01, profit: 3, openedAt: ago(2) }],
        strategies: [BOUNDARY_ONLY],
        dryRun: true,
      });

      await svc.tick();
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0]).toMatchObject({
        ticket: 700,
        trigger: 'exit_boundary',
        maxHoldHours: null,
        // 0 rather than a fabricated figure — there is no hold limit to be over.
        overByHours: 0,
      });
      expect(svc.state.lastSummary).toMatchObject({ boundaryConfigured: 1, boundaryDue: 1 });
    });

    it('a bot with NEITHER rule is still left completely alone', async () => {
      // The opt-in contract, asserted at the integration level: adding the boundary must not have
      // made an unbounded bot closeable.
      const { svc } = makeService({
        positions: [{ ticket: 701, symbol: 'EURJPY', type: 'buy', volume: 0.01, profit: 3, openedAt: ago(200) }],
        strategies: [{ ...BOUNDARY_ONLY, exitBeforeUtc: null }],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(svc.state.lastSummary).toMatchObject({ noLimitConfigured: 1, boundaryConfigured: 0 });
    });

    it('an UNREADABLE boundary closes nothing and is counted as a fault', async () => {
      const { svc } = makeService({
        positions: [{ ticket: 702, symbol: 'EURJPY', type: 'buy', volume: 0.01, profit: 3, openedAt: ago(2) }],
        strategies: [{ ...BOUNDARY_ONLY, exitBeforeUtc: '13:3' }],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(svc.state.lastSummary).toMatchObject({ boundaryInvalid: 1, boundaryConfigured: 0 });
      // and it is named in `skipped`, so it cannot be mistaken for a healthy idle service
      expect(svc.state.skipped.some((s) => s.reason.startsWith('exit_boundary_invalid:'))).toBe(true);
    });

    it('records the boundary-specific closeReason, not the time-stop one', async () => {
      // The two mechanisms must be distinguishable after the fact — a guessed reason is the defect
      // `close-reason.ts` exists to end.
      const { svc, closeCalls, closeReasonWrites } = makeService({
        positions: [{ ticket: 703, symbol: 'EURJPY', type: 'buy', volume: 0.01, profit: 3, openedAt: ago(2) }],
        strategies: [BOUNDARY_ONLY],
        dryRun: false,
      });
      await svc.tick();
      expect(closeCalls).toEqual([703]);
      const reasons = closeReasonWrites.map((w) => w?.data?.closeReason);
      expect(reasons).toContain(CLOSE_REASONS.SYSTEM_SESSION_EXIT);
      expect(reasons).not.toContain(CLOSE_REASONS.SYSTEM_TIME_STOP);
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
        getAllPositions: jest.fn(async () => [
          { ticket: 10, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(50), brokerId: 2 },
          { ticket: 20, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(40), brokerId: 3 },
        ]),
        closePosition: jest.fn(async (t: number) => {
          if (t === 10) throw new Error('bridge refused');
          return { ok: true };
        }),
        getBrokerIds: () => [2, 3],
      } as any;
      const svc = new PositionTimeStopService(mt5, { findAll: async () => [AUDUSD_STRATEGY] } as any, {
    trade: { updateMany: jest.fn(async () => ({ count: 0 })) },
  } as any);
      svc.state.dryRun = false;

      await svc.tick();
      expect(svc.state.closedCount).toBe(1); // only #20
      expect(svc.state.recentCloses[0].ticket).toBe(20);
    });

    /**
     * REGRESSION GUARD — the close must say WHY (2026-09-18).
     *
     * Measured that morning: 15 of 16 bot trades closed at 3–18% of the distance to their configured
     * SL/TP, and three closed inside five seconds. Nothing could name the closer, because this
     * service kept its history ONLY in memory and `trade` had no field for it. An hour of
     * elimination produced suspects and no cause.
     *
     * ⚠️ The assertion is on the WRITE, not on `state.recentCloses`. The in-memory entry is exactly
     * the thing that does NOT survive a restart, so a test that only checked it would pass while the
     * durable record stayed empty — i.e. it would pass while the defect it guards against was live.
     */
    it('records WHY it closed on the trade row, not only in memory', async () => {
      const { svc, closeReasonWrites } = makeService({
        positions: [
          { ticket: 42, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 1.23, openedAt: ago(52) },
        ],
        strategies: [AUDUSD_STRATEGY],
        dryRun: false,
      });

      await svc.tick();

      expect(closeReasonWrites).toHaveLength(1);
      expect(closeReasonWrites[0].where.brokerTicket).toBe('42');
      expect(closeReasonWrites[0].where.status).toBe('open');
      expect(closeReasonWrites[0].data.closeReason).toBe(CLOSE_REASONS.SYSTEM_TIME_STOP);
    });

    it('writes no close reason in DRY RUN — nothing closed, so nothing may be attributed', async () => {
      // The other direction: without this, a guard that always wrote a reason would pass the test
      // above and claim credit for a close that never happened.
      const { svc, closeReasonWrites } = makeService({
        positions: [
          { ticket: 42, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 1.23, openedAt: ago(52) },
        ],
        strategies: [AUDUSD_STRATEGY],
        dryRun: true,
      });

      await svc.tick();

      expect(closeReasonWrites).toHaveLength(0);
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────────────
   * THE REAL COMMENT FORMAT — measured 2026-09-17, and why this block exists
   * ─────────────────────────────────────────────────────────────────────────────────────
   *
   * The service read `/TCS:([^:]+):([^\s]+)/`. Measured against the 76 real
   * `trade.brokerComment` values:
   *
   *     LIKE 'TCS:%'   ->   0     (what the reader wanted)
   *     LIKE 'TCS %'   ->  59     (what the writer emits)
   *
   * So the regex matched NOTHING. Every position fell through to symbol-only matching, and
   * every multi-bot symbol — XAUUSD has 4 bots — was skipped. The reason this survived 29
   * passing tests: the older test above feeds `'TCS:xau-speed-m5:a'`, the DOCUMENTED format,
   * which nothing has ever produced. **A fixture that does not match reality only proves the
   * mock agrees with itself.**
   *
   * These tests use the strings taken from the live database and the live bridge payload.
   */
  describe('attribution parses the comment format that is ACTUALLY written', () => {
    it('parses the real name form and the score-suffixed form', () => {
      expect(classifyMt5Comment('TCS Gold Day-Trade M15'))
        .toEqual({ kind: 'strategy', name: 'Gold Day-Trade M15' });
      // Real row: 'TCS Sydney AUDUSD Session | 65%'
      expect(classifyMt5Comment('TCS Sydney AUDUSD Session | 65%'))
        .toEqual({ kind: 'strategy', name: 'Sydney AUDUSD Session' });
      // Real row: 'TCS Gold Day-Trade M15' with a trailing score
      expect(classifyMt5Comment('TCS London EURUSD Macro | 0%'))
        .toEqual({ kind: 'strategy', name: 'London EURUSD Macro' });
    });

    it('treats `TCS manual <protocol>` as a human trade, not a bot', () => {
      // Real rows: 'TCS manual forex-session-v1', 'TCS manual xau-speed-v1 | 283e4397'
      expect(classifyMt5Comment('TCS manual forex-session-v1').kind).toBe('manual');
      expect(classifyMt5Comment('TCS manual xau-speed-v1 | 283e4397').kind).toBe('manual');
    });

    it('still honours the legacy documented form', () => {
      expect(classifyMt5Comment('TCS:xau-speed-m5:a')).toEqual({ kind: 'strategy', name: 'a' });
    });

    it('returns none for absent or non-TCS comments', () => {
      // Real rows: 'Reconciled: no broker counterpart (stranded row)'
      expect(classifyMt5Comment('').kind).toBe('none');
      expect(classifyMt5Comment(null).kind).toBe('none');
      expect(classifyMt5Comment(undefined).kind).toBe('none');
      expect(classifyMt5Comment('Reconciled: no broker counterpart').kind).toBe('none');
    });

    /**
     * THE REGRESSION GUARD.
     *
     * The live XAUUSD failure, reproduced exactly: 4 bots trade XAUUSD and the comment names
     * one of them. Before the fix this produced ZERO candidates, because the comment parse
     * returned null and symbol-only matching then refused to guess.
     *
     * This test canaries by construction: it asserts a specific bot is selected. Revert the
     * parser to the colon-only form and it fails (0 candidates), so it cannot pass by accident.
     */
    it('attributes a 4-bot symbol from the real comment, instead of skipping it', async () => {
      const XAU_BOTS = [
        { id: 'xau-m5',  name: 'Gold Scalp M5',     symbol: 'XAUUSD', maxHoldHours: 12 },
        { id: 'xau-m15', name: 'Gold Day-Trade M15', symbol: 'XAUUSD', maxHoldHours: 12 },
        { id: 'xau-1h',  name: 'Gold Swing 1H',      symbol: 'XAUUSD', maxHoldHours: 12 },
        { id: 'xau-4h',  name: 'Gold Position 4H',   symbol: 'XAUUSD', maxHoldHours: 12 },
      ];
      const { svc, closeCalls } = makeService({
        positions: [{
          ticket: 152646482933, symbol: 'XAUUSD', type: 'buy', volume: 0.02, profit: -17.5,
          openedAt: ago(40),
          comment: 'TCS Gold Day-Trade M15', // the live string, verbatim
        }],
        strategies: XAU_BOTS,
        dryRun: false,
      });

      await svc.tick();

      expect(svc.state.skipped).toHaveLength(0);
      expect(svc.state.candidates).toHaveLength(1);
      expect(svc.state.candidates[0]).toMatchObject({
        ticket: 152646482933,
        strategyId: 'xau-m15',
        strategyName: 'Gold Day-Trade M15',
        hoursHeld: 40,
        maxHoldHours: 12,
      });
      expect(closeCalls).toEqual([152646482933]);
    });

    it('never closes a manual trade on the strength of a bot limit', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{
          ticket: 12, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0,
          openedAt: ago(500), comment: 'TCS manual forex-session-v1',
        }],
        strategies: [AUDUSD_STRATEGY],
        dryRun: false, // armed
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
      expect(svc.state.skipped[0].reason).toBe('manual_trade');
    });

    it('records WHY a position could not be attributed, so a skip is not a silent empty', async () => {
      const { svc, closeCalls } = makeService({
        positions: [{
          ticket: 13, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0,
          openedAt: ago(40), comment: 'TCS A Bot That Was Renamed',
        }],
        strategies: [
          { id: 'a', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 12 },
          { id: 'b', name: 'Gold Swing 1H', symbol: 'XAUUSD', maxHoldHours: 12 },
        ],
        dryRun: false,
      });
      await svc.tick();

      expect(svc.state.candidates).toHaveLength(0);
      expect(closeCalls).toHaveLength(0);
      // The point: an empty `candidates` is now accompanied by a NAMED reason.
      expect(svc.state.skipped).toHaveLength(1);
      expect(svc.state.skipped[0]).toMatchObject({
        ticket: 13,
        symbol: 'XAUUSD',
        reason: 'comment_no_match_multi_strategy',
        comment: 'TCS A Bot That Was Renamed',
        hoursHeld: 40,
      });
    });

    it('distinguishes "inside its limit" from "could not evaluate"', async () => {
      // Three positions: young (normal, NOT recorded), unattributable (a skip), and one that
      // is genuinely over its limit (a candidate).
      const { svc } = makeService({
        positions: [
          { ticket: 14, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(2) },
          { ticket: 15, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(40), comment: 'nonsense' },
        ],
        strategies: [
          AUDUSD_STRATEGY,
          { id: 'a', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 12 },
          { id: 'b', name: 'Gold Swing 1H', symbol: 'XAUUSD', maxHoldHours: 12 },
        ],
        dryRun: true,
      });
      await svc.tick();

      expect(svc.state.candidates).toHaveLength(0);
      // The young AUDUSD position is inside its limit — normal, and deliberately NOT recorded.
      expect(svc.state.skipped).toHaveLength(1);
      expect(svc.state.skipped[0].ticket).toBe(15);
      // 2 XAUUSD bots and an unparseable comment → refuse rather than guess.
      expect(svc.state.skipped[0].reason).toBe('ambiguous_multi_strategy');
    });

    it('reports an unattributed position whose bot has no limit configured', async () => {
      const { svc } = makeService({
        positions: [{ ticket: 16, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(500) }],
        strategies: [{ id: 's-nolimit', name: 'No Limit', symbol: 'AUDUSD', maxHoldHours: null }],
        dryRun: true,
      });
      await svc.tick();
      expect(svc.state.candidates).toHaveLength(0);
      // "this bot opted out" is now tellable apart from "this bot was never matched".
      expect(svc.state.skipped[0].reason).toBe('no_limit_configured');
    });
  });

  /**
   * The DENOMINATOR — `lastSummary`.
   *
   * ⚠️ Found by using the thing on live data, not by reasoning about it. `wouldClose: 0` with
   * `skippedCount: 0` is the SAME payload whether the service read 6 positions and found them all
   * inside their limit, or read ZERO positions because the bridge read is broken. The first
   * version of this fix closed that blind spot on the failure path (`skipped`) and left it wide
   * open on the happy path — which is the more dangerous of the two, because "nothing to do" reads
   * as a healthy result and no log line contradicts it.
   *
   * `positionsSeen` is the denominator. Without it there is no way to tell a working control from
   * a disconnected one.
   */
  describe('the evaluation summary makes a zero attributable', () => {
    it('counts what was seen, attributed and left alone', async () => {
      const { svc } = makeService({
        positions: [
          { ticket: 1, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(2) },
          { ticket: 2, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(3) },
          { ticket: 3, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(4) },
          { ticket: 4, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(40) },
        ],
        strategies: [AUDUSD_STRATEGY], // 12h limit
        dryRun: true,
      });
      await svc.tick();

      expect(svc.state.lastSummary).toEqual({
        positionsSeen: 4,
        brokersSeen: { 0: 4 }, // the fixtures carry no `brokerId`, so they read as unstamped
        attributed: 4,
        withinLimit: 3,
        noLimitConfigured: 0,
        skipped: 0,
        candidates: 1,
        // #928 — the exit boundary's own counters. Asserted explicitly rather than omitted: the
        // whole point of this summary is that a zero is ATTRIBUTABLE, and `toEqual` failing here is
        // how this spec caught the new counters the moment they were added. All zero because none
        // of these fixtures declares `exitBeforeUtc` — which is also the opt-in contract holding.
        boundaryConfigured: 0,
        boundaryDue: 0,
        boundaryInvalid: 0,
      });
    });

    it('reports positionsSeen: 0 when the broker returns nothing — NOT "all within limit"', async () => {
      const { svc } = makeService({ positions: [], strategies: [AUDUSD_STRATEGY], dryRun: true });
      await svc.tick();

      // The critical distinction: candidates 0 AND positionsSeen 0 means the read found nothing,
      // which is a different fact from candidates 0 with positionsSeen 6.
      expect(svc.state.lastSummary).toEqual({
        positionsSeen: 0,
        brokersSeen: {},
        attributed: 0,
        withinLimit: 0,
        noLimitConfigured: 0,
        skipped: 0,
        candidates: 0,
        // #928 — still zero when NOTHING was read. These are counters on the same summary, so an
        // empty read must not imply a boundary was configured.
        boundaryConfigured: 0,
        boundaryDue: 0,
        boundaryInvalid: 0,
      });
    });

    it('counts an unattributable position in BOTH attributed and skipped terms', async () => {
      const { svc } = makeService({
        positions: [
          { ticket: 5, symbol: 'AUDUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(30) },
          { ticket: 6, symbol: 'XAUUSD', type: 'buy', volume: 0.01, profit: 0, openedAt: ago(30), comment: 'junk' },
        ],
        strategies: [
          AUDUSD_STRATEGY,
          { id: 'a', name: 'Gold Scalp M5', symbol: 'XAUUSD', maxHoldHours: 12 },
          { id: 'b', name: 'Gold Swing 1H', symbol: 'XAUUSD', maxHoldHours: 12 },
        ],
        dryRun: true,
      });
      await svc.tick();

      const s = svc.state.lastSummary!;
      expect(s.positionsSeen).toBe(2);
      expect(s.attributed).toBe(1); // only AUDUSD resolved
      expect(s.skipped).toBe(1);    // the XAUUSD one, ambiguous
      expect(s.candidates).toBe(1); // AUDUSD at 30h vs a 12h limit
      // Seen = attributed + skipped when there is nothing malformed nested inside.
      expect(s.positionsSeen).toBe(s.attributed + s.skipped);
    });
  });
});
