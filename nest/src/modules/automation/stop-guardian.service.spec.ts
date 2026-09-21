import {
  StopGuardianService,
  declaredStopDistance,
  trailDistanceFor,
  trailDistanceProblem,
} from './stop-guardian.service';

describe('Automation StopGuardianService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps scheduling after a tick with no active strategies', async () => {
    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      { getUrl: () => 'http://mt5.test' } as any,
      { recordAdjustment: jest.fn() } as any,
    );
    service.state.enabled = true;

    await service.tick();

    expect(service.state.nextTickAt).not.toBeNull();
    expect(jest.getTimerCount()).toBe(1);
    service.stop();
  });

  it('computes side-aware confidence — bullish evidence helps BUY, not SELL', async () => {
    const bullishEvidence = () =>
      new Map([
        ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bullish', reason: 'x' }],
        ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bullish', reason: 'x', metadata: { isFakeout: false } }],
      ]);

    const bars = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.now() - (30 - i) * 3600000).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000,
    }));

    const makeService = (type: 'buy' | 'sell') => {
      (global as any).fetch = jest.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('/positions')) {
          return {
            ok: true,
            json: async () => ({
              positions: [
                { ticket: 1, symbol: 'XAUUSD', type, volume: 1, priceOpen: 100, priceCurrent: 100, sl: type === 'buy' ? 90 : 110, tp: null, profit: 0, comment: 'TCS s1' },
              ],
            }),
          } as any;
        }
        if (u.includes('/candles')) {
          return { ok: true, json: async () => ({ bars }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      return new StopGuardianService(
        { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
        { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
        { getUrl: () => 'http://mt5.test' } as any,
        { recordAdjustment: jest.fn() } as any,
      );
    };

    const buyService = makeService('buy');
    buyService.state.enabled = true;
    await buyService.tick();
    expect(buyService.state.guardedPositions[0].stopConfidence).toBe(78);
    buyService.stop();

    const sellService = makeService('sell');
    sellService.state.enabled = true;
    await sellService.tick();
    expect(sellService.state.guardedPositions[0].side).toBe('SELL');
    expect(sellService.state.guardedPositions[0].stopConfidence).toBe(0);
    sellService.stop();
  });

  /**
   * #888 — the guardian must SCOPE its directive evaluation.
   *
   * `runAll(input)` with no filter runs EVERY registered directive. Measured 2026-09-18,
   * that was **505 directives per pass** (101 registered x 5 positions) costing 780ms, to
   * read the four IDs this service actually uses.
   *
   * ⚠️ CANARY: delete the `STOP_GUARDIAN_DIRECTIVES` argument from the `runAll(...)` call
   * and `filter` becomes `undefined` -> the `toBeInstanceOf(Set)` assertion fails. If this
   * test passes with the filter removed, it is not a guard.
   */
  it('#888 — passes a directive filter containing EXACTLY the four IDs it reads', async () => {
    const runAll = jest.fn().mockResolvedValue(
      new Map([
        ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bullish', reason: 'x' }],
        ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bullish', reason: 'x', metadata: { isFakeout: false } }],
      ]),
    );

    const bars = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.now() - (30 - i) * 3600000).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000,
    }));

    (global as any).fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/positions')) {
        return {
          ok: true,
          json: async () => ({
            positions: [
              { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 1, priceOpen: 100, priceCurrent: 100, sl: 90, tp: null, profit: 0, comment: 'TCS s1' },
            ],
          }),
        } as any;
      }
      if (u.includes('/candles')) {
        return { ok: true, json: async () => ({ bars }) } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
      { runAll } as any,
      { getUrl: () => 'http://mt5.test' } as any,
      { recordAdjustment: jest.fn() } as any,
    );
    service.state.enabled = true;
    await service.tick();
    service.stop();

    expect(runAll).toHaveBeenCalledTimes(1);
    const filter = runAll.mock.calls[0][1];

    expect(filter).toBeInstanceOf(Set);
    expect([...filter].sort()).toEqual([
      'atr-trailing-stop',
      'chandelier-exit',
      'supertrend',
      'wick-filter',
    ]);

    // The shape of the FIRST argument must stay the directive input (symbol + bars):
    // passing the filter in the wrong position would silently un-scope the call.
    expect(typeof runAll.mock.calls[0][0]).toBe('object');
    expect(runAll.mock.calls[0][0]).toHaveProperty('symbol', 'XAUUSD');
  });
});
  /**
   * #893 — a broker "Market closed" refusal must PAUSE the symbol, not be retried
   * every tick.
   *
   * Measured 2026-09-18: 3 refused edits per tick, one tick every 30s, all weekend.
   * The guardian arms a 15-minute per-symbol backoff off the broker's OWN refusal
   * (never a predicted closure) and skips the bridge call entirely until it expires.
   *
   * CANARY (both directions):
   *  - delete the `marketClosedUntil.set(...)` arming line in `applyModify` and the
   *    "no bridge call on the second tick" assertion fails;
   *  - widen the match to ANY refusal and the "Invalid stops" test fails — that
   *    refusal must keep retrying because it needs attention, not silence.
   */
  describe('#893 — "Market closed" arms a per-symbol backoff', () => {
    /**
     * ⚠️ The fake-timer install is repeated HERE, immediately before each test.
     * Measured 2026-09-19: `jest.advanceTimersByTime` inside this describe warned
     * "the timers APIs are not replaced with fake timers" even though the outer
     * beforeEach installs them — and the resulting REAL 30s tick chain outlived the
     * test, so jest never exited. Every test also stops the service in `finally`, so
     * an assertion failure can never leave it ticking again.
     *
     * Expiry is a `setSystemTime` re-base, NOT `advanceTimersByTime`: it moves the
     * clock without firing the guardian's own scheduled ticks (a real 16-minute jump
     * cascaded ~32 ticks). The backoff WINDOW is overridden per service so the
     * re-base can be small.
     */
    beforeEach(() => {
      jest.clearAllTimers();
      jest.useFakeTimers();
    });

    const bars30 = () =>
      Array.from({ length: 30 }, (_, i) => ({
        timestamp: new Date(Date.now() - (30 - i) * 3600000).toISOString(),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      }));

    const bullishEvidence = () =>
      new Map([
        ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
        ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bullish', reason: 'x' }],
        ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bullish', reason: 'x', metadata: { isFakeout: false } }],
      ]);

    /**
     * `sl: 0` drives the PROTECTIVE path, which bypasses the confidence gate — so
     * the test exercises the backoff without depending on ATR stop arithmetic.
     */
    const makeService = (refusalBody: string, backoffMs = 50) => {
      const modifyCalls = { count: 0 };
      (global as any).fetch = jest.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('/positions')) {
          return {
            ok: true,
            json: async () => ({
              positions: [
                { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 1, priceOpen: 100, priceCurrent: 100, sl: 0, tp: null, profit: 0, comment: 'TCS s1' },
              ],
            }),
          } as any;
        }
        if (u.includes('/candles')) {
          return { ok: true, json: async () => ({ bars: bars30() }) } as any;
        }
        if (u.includes('/order/modify')) {
          modifyCalls.count++;
          return { ok: false, status: 400, text: async () => refusalBody } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      const service = new StopGuardianService(
        { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
        { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
        { getUrl: () => 'http://mt5.test' } as any,
        { recordAdjustment: jest.fn() } as any,
      );
      (service as any).MARKET_CLOSED_BACKOFF_MS = backoffMs;
      service.state.enabled = true;
      return { service, modifyCalls };
    };

    it('skips the bridge while the backoff holds, probes again after expiry, and surfaces the pause', async () => {
      const { service, modifyCalls } = makeService('{"success": false, "error": "Market closed"}', 400);
      try {
        await service.tick();
        expect(modifyCalls.count).toBe(1); // the probe that discovers the closure
        expect(service.getState().marketClosedBackoff).toEqual([
          { symbol: 'XAUUSD', retryAt: expect.any(String) },
        ]);

        await service.tick();
        expect(modifyCalls.count).toBe(1); // skipped — no bridge call at all

        jest.setSystemTime(Date.now() + 500); // past the 400ms window — fires no timers
        await service.tick();
        expect(modifyCalls.count).toBe(2); // probe after expiry
      } finally {
        // An assertion failure must never leave the service ticking: a leaked REAL
        // 30s chain made jest hang for minutes instead of reporting the failure.
        service.stop();
      }
    });

    it('a NON-closed refusal must keep retrying — it needs attention, not silence', async () => {
      const { service, modifyCalls } = makeService('{"success": false, "error": "Invalid stops"}');
      try {
        await service.tick();
        await service.tick();
        expect(modifyCalls.count).toBe(2); // both ticks attempted
        expect(service.getState().marketClosedBackoff).toEqual([]);
      } finally {
        service.stop();
      }
    });
  });

/**
 * #927 — THE TRAIL DISTANCE FLOOR.
 * =================================
 *
 * MEASURED DEFECT (2026-09-21): the trail target was `currentPrice − 3 × ATR(5m)` with "never
 * loosen" as its only guard. On FX that distance is ~0.03–0.11% of price against a declared
 * `slPct` of ~1%, so a roughly-flat position had its stop moved ~20x closer to price in one
 * edit. Seven positions closed between 12:40 and 13:08 UTC, **every close price exactly a
 * guardian-set stop** (EURGBP −1.012% → −0.031%; NZDJPY −1.028% → +0.058%).
 *
 * ⚠️ CANARY DIRECTIONS, stated so the coverage can be checked rather than assumed:
 *   • the "tiny ATR" tick test FAILS against the old arithmetic (which would have sent a stop
 *     ~0.06 from price) — the defect direction;
 *   • the "profit trails at the declared distance" and "wide ATR still widens" tests FAIL if the
 *     floor is implemented by disabling trailing or by ignoring ATR — the restore direction.
 */
describe('#927 — a trail can never leave the stop inside the declared distance', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** ATR(5m) ≈ 0.02 — the measured FX shape: 3×ATR ≈ 0.06 against a declared 1.0. */
  const tinyAtrBars = () =>
    Array.from({ length: 30 }, () => ({
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      open: 100.01, high: 100.02, low: 100.0, close: 100.01, volume: 1000,
    }));

  /** ATR(5m) = 1.0 → 3×ATR = 3.0, genuinely wider than the declared 1.0. */
  const wideAtrBars = () =>
    Array.from({ length: 30 }, () => ({
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000,
    }));

  const bullishEvidence = () =>
    new Map([
      ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
      ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
      ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bullish', reason: 'x' }],
      ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bullish', reason: 'x', metadata: { isFakeout: false } }],
    ]);

  function makeService(opts: {
    bars: any[];
    priceCurrent: number;
    sl: number;
    priceOpen?: number;
    slPct?: number;
  }) {
    const modifyCalls: Array<{ body: any }> = [];
    const recordAdjustment = jest.fn();
    (global as any).fetch = jest.fn(async (url: unknown, init?: any) => {
      const u = String(url);
      if (u.includes('/positions')) {
        return {
          ok: true,
          json: async () => ({
            positions: [
              {
                ticket: 7, symbol: 'XAUUSD', type: 'buy', volume: 1,
                priceOpen: opts.priceOpen ?? 100, priceCurrent: opts.priceCurrent,
                sl: opts.sl, tp: null, profit: 0, comment: 'TCS s1',
              },
            ],
          }),
        } as any;
      }
      if (u.includes('/candles')) return { ok: true, json: async () => ({ bars: opts.bars }) } as any;
      if (u.includes('/order/modify')) {
        modifyCalls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        return { ok: true, json: async () => ({ success: true }) } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: opts.slPct ?? 1 }]) } as any,
      { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
      { getUrl: () => 'http://mt5.test' } as any,
      { recordAdjustment } as any,
    );
    service.state.enabled = true;
    return { service, modifyCalls, recordAdjustment };
  }

  it('declaredStopDistance is the strategy slPct in price units (the number both layers use)', () => {
    expect(declaredStopDistance(100, 1)).toBeCloseTo(1.0, 9);
    expect(declaredStopDistance(100, 2)).toBeCloseTo(2.0, 9);
    expect(declaredStopDistance(0, 1)).toBe(0);                 // unreadable entry → nothing to declare
    expect(declaredStopDistance(100, NaN)).toBeCloseTo(1.0, 9); // slPct fallback matches protectiveSl
  });

  it('3×ATR may WIDEN the trail but never tighten it inside the declared distance', () => {
    const declared = declaredStopDistance(100, 1);
    // The measured pathology: 3×ATR = 0.06 → the trail distance must be the declared 1.0.
    expect(trailDistanceFor(0.02, declared)).toBe(1.0);
    // A volatile market: 3×ATR = 4.5 → the ATR governs (restore direction).
    expect(trailDistanceFor(1.5, declared)).toBeCloseTo(4.5, 9);
  });

  it('validation refuses a distance inside the declared one, and admits one at or above it', () => {
    const declared = declaredStopDistance(100, 1);
    expect(trailDistanceProblem(0.06, declared)).toContain('inside the declared stop distance');
    expect(trailDistanceProblem(1.0, declared)).toBeNull(); // exactly at the floor is allowed
    expect(trailDistanceProblem(4.5, declared)).toBeNull();
    expect(trailDistanceProblem(0.06, 0)).toBeNull();       // nothing declared → nothing to enforce
  });

  it('THE CANARY — tiny ATR + flat price sends NO stop ~0.06 from price (the seven-close defect)', async () => {
    const { service, modifyCalls } = makeService({ bars: tinyAtrBars(), priceCurrent: 100, sl: 99 });
    try {
      await service.tick();
      // Old arithmetic: recommended = 100 − 0.06 = 99.94 → a tighten to 0.06% from price.
      // New: distance = max(3×ATR, declared 1.0) = 1.0 → recommended 99 = the current stop.
      expect(modifyCalls).toHaveLength(0);
      expect(service.getState().recentAdjustments).toEqual([]);
    } finally {
      service.stop();
    }
  });

  it('a profitable position trails at the DECLARED distance, and the reason records it as a %', async () => {
    const { service, modifyCalls, recordAdjustment } = makeService({ bars: tinyAtrBars(), priceCurrent: 103, sl: 99 });
    try {
      await service.tick();
      expect(modifyCalls).toHaveLength(1);
      // 103 − declared 1.0 = 102 (locks +2% from a 100 entry). The old arithmetic sent 102.94.
      expect(modifyCalls[0].body.sl).toBe(102);
      expect(modifyCalls[0].body.sl).not.toBe(102.94);
      // #927 acceptance box 4 — `stop_adjustment` can be read without recomputing ATR:
      // 1 / 103 = 0.971%.
      expect(recordAdjustment).toHaveBeenCalledTimes(1);
      expect(recordAdjustment.mock.calls[0][0].reason).toContain('dist=0.971%');
    } finally {
      service.stop();
    }
  });

  it('a genuinely volatile market still trails on the wider ATR distance (restore direction)', async () => {
    const { service, modifyCalls } = makeService({ bars: wideAtrBars(), priceCurrent: 103, sl: 99 });
    try {
      await service.tick();
      expect(modifyCalls).toHaveLength(1);
      // 3×ATR = 3.0 > declared 1.0 → 103 − 3 = 100, exactly the ATR trail (the fix must not
      // disable the mechanism it bounds).
      expect(modifyCalls[0].body.sl).toBe(100);
    } finally {
      service.stop();
    }
  });
});