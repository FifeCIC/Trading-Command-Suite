/**
 * #1020 — the exit-verdict rule, and the mistake it must not repeat.
 *
 * ⚠️ WHY THIS SPEC EXISTS AT ALL. The rule was inline in a private method of the service, so the
 * defect it now fixes had NO test, and the two directives it silently muted were invisible for as
 * long as they existed. A rule that cannot be called cannot be canaried. Extracting `arguesExitFor()`
 * is what made these assertions possible.
 */
import { arguesExitFor, ExitConsensusService } from './exit-consensus.service';

describe('arguesExitFor (#1020)', () => {
  describe('directional — unchanged, and it must STAY unchanged', () => {
    it('a bearish claim argues an exit on a LONG', () => {
      expect(arguesExitFor('buy', 'bearish', 10)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a bearish claim does NOT argue an exit on a SHORT', () => {
      expect(arguesExitFor('sell', 'bearish', 10)).toEqual({ arguesExit: false, via: null });
    });

    it('a bullish claim argues an exit on a SHORT', () => {
      expect(arguesExitFor('sell', 'bullish', 10)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a neutral class argues nothing when no threshold is declared', () => {
      // This is the pre-#1020 behaviour, and it is CORRECT for a directive with no authority.
      expect(arguesExitFor('buy', 'neutral', 100)).toEqual({ arguesExit: false, via: null });
    });
  });

  describe('side-agnostic — the path #1020 adds', () => {
    it('a score AT the declared threshold argues an exit, for a LONG', () => {
      expect(arguesExitFor('buy', 'neutral', 70, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });

    it('...and for a SHORT — being side-agnostic is the whole point', () => {
      expect(arguesExitFor('sell', 'neutral', 70, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });

    it('one point below does NOT argue — the boundary is inclusive, so it is named here', () => {
      expect(arguesExitFor('buy', 'neutral', 69.99, 70)).toEqual({ arguesExit: false, via: null });
    });

    it('regime-shift-exit is the case this exists for: neutral class, score 100, reason "Exit recommended"', () => {
      // Measured live 2026-09-29: this directive reached score 100 with an explicit "Exit
      // recommended." reason while `arguesExit` was false on every one of 17 open positions.
      expect(arguesExitFor('buy', 'neutral', 100, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });
  });

  describe('THE REGRESSION THIS MUST NEVER REPEAT', () => {
    // ⚠️ THE FIRST DESIGN keyed on `directionBias === 'neutral'` to mean "read the score instead of
    // the class". That would have SILENTLY DISABLED `chandelier-exit` — it declares neutral bias
    // while emitting real bullish/bearish classes and arguing 6 exits on live data.
    //
    // `directive.interface.ts` already documented why: "a `neutral` directionBias is valid for a
    // dynamic TWO-SIDED directive." Reading the declarations is what caught it, before it shipped.
    //
    // The structural guard is the function's SIGNATURE — it takes no `directionBias`, so there is
    // nothing to re-key on. These tests pin the behaviour that would have been lost.
    it('a directional claim still wins for a directive that ALSO declares a threshold', () => {
      // chandelier-exit's live shape: neutral bias, real bearish class, threshold irrelevant.
      expect(arguesExitFor('buy', 'bearish', 50, 70)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('direction is reported when BOTH would argue — the more specific claim wins', () => {
      expect(arguesExitFor('buy', 'bearish', 90, 70)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a neutral class with a threshold NOT met still argues nothing', () => {
      expect(arguesExitFor('sell', 'neutral', 12, 70)).toEqual({ arguesExit: false, via: null });
    });

    it('an UNDECLARED threshold grants NO authority — time-stop\'s deliberate state', () => {
      // time-stop cannot see position age (its own comment: "needs position open time which isn't in
      // bars"), so declaring a threshold would put a second momentum signal into the verdict under a
      // name claiming otherwise. A real time stop already exists:
      // position-time-stop.service.ts / closeReason 'system:time-stop' — 46 rows measured.
      expect(arguesExitFor('buy', 'neutral', 80, undefined)).toEqual({ arguesExit: false, via: null });
    });
  });
});

/**
 * #1033 REGRESSION — the broker read must call a method `Mt5Adapter` ACTUALLY HAS.
 *
 * ⚠️ WHAT WENT WRONG. #1033 changed `assessAll()`'s read from `this.mt5.getPositions()` to
 * `(this.mt5 as any).getAllPositions()`. `getAllPositions()` exists on `Mt5ConnectionManager` and
 * `Mt5TradingService`, but NOT on `Mt5Adapter` — which is what `this.mt5` is. The call threw
 * `this.mt5.getAllPositions is not a function`, the `catch` swallowed it and returned `[]`, and
 * the Exit Signals page rendered "No open positions to evaluate." while **11 MT5 positions were
 * live** (measured 2026-10-01; the swallow is visible in `nest/logs/console-build-api.log`).
 *
 * The `as any` cast is what made it invisible: it silenced the compiler that would have named the
 * missing method. An empty book and a swallowed TypeError rendered identically — this repo's most
 * expensive failure signature, "plausible output, no error".
 *
 * ⚠️ THE GUARD. The mock below defines ONLY what `Mt5Adapter` actually provides. If the service
 * ever reaches for a method the adapter does not have, the call throws inside `assessAll()`, the
 * empty array comes back, and the first test fails. The second test proves that empty path is
 * REACHABLE — so the first cannot pass for the wrong reason.
 */
describe('ExitConsensusService.assessAll — the broker read (#1033 regression)', () => {
  /** One open position in the shape `Mt5Adapter.getPositions()` returns. */
  const livePosition = {
    ticker: 'XAUUSD',
    symbol: 'XAUUSD',
    side: 'buy',
    avgCost: 4184.04,
    currentPrice: 4167.86,
    sl: 4100,
    openedAt: new Date(Date.now() - 3_600_000).toISOString(),
    brokerTicket: '123456',
    brokerId: 2,
  };

  function build(mt5: any): ExitConsensusService {
    const prisma = {
      symbol: { findFirst: jest.fn(async () => ({ id: 'sym-xauusd' })) },
      tradingStrategy: { findMany: jest.fn(async () => []) },
    } as any;
    // No bars, no directives, no score history — enough to reach the assessment, not to judge it.
    const marketData = { getBars: jest.fn(async () => []) } as any;
    const directives = { get: jest.fn(() => null) } as any;
    const protocolGating = {} as any;
    const scoreHistory = { getHistoryByTicker: jest.fn(async () => []) } as any;
    return new ExitConsensusService(prisma, mt5, marketData, directives, protocolGating, scoreHistory);
  }

  it('returns ONE assessment per open position — the read must not come back empty', async () => {
    const mt5 = { getPositions: jest.fn(async () => [livePosition]) };
    const out = await build(mt5).assessAll();
    expect(mt5.getPositions).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('XAUUSD');
    expect(out[0].ticket).toBe('123456');
  });

  it('CANARY: a read that THROWS still returns [] — the empty path #1033 shipped must stay reachable', async () => {
    const mt5 = {
      getPositions: jest.fn(async () => {
        throw new TypeError('this.mt5.getAllPositions is not a function');
      }),
    };
    await expect(build(mt5).assessAll()).resolves.toEqual([]);
  });
});
