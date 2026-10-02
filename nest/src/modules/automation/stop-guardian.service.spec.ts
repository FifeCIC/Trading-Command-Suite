import {
  StopGuardianService,
  declaredStopDistance,
  trailDistanceFor,
  trailDistanceProblem,
  resolvePositionOwner,
  stopAdjustmentReason,
} from './stop-guardian.service';

/**
 * mt5Double() — the bridge double for this spec (#1030).
 *
 * ⚠️ WHY THIS EXISTS INSTEAD OF A `global.fetch` MOCK. The guardian used to reach the bridge with
 * its own `fetch` against ONE hardcoded URL, so mocking `global.fetch` was the entire contract. It
 * now goes through `Mt5ConnectionManager`, which owns the broker registry — a `fetch` mock would
 * stand in for a path the service no longer uses, and every assertion built on it would keep
 * passing while testing nothing. So the double stands in for the MANAGER, and each recorded modify
 * keeps the `brokerId` it was addressed to — which is the property #1030 is about.
 */
function mt5Double(opts: {
  /** Positions exactly as `getAllPositions()` returns them: every row stamped with its `brokerId`. */
  positions?: any[];
  /** Bars for every broker, unless `barsByBroker` overrides a specific one. */
  bars?: any[];
  /**
   * Per-broker bars. Models a bridge that simply does not carry the symbol — the measured GER40
   * case, where `:5000` answers 200 with ZERO bars and `:5001` answers with data.
   */
  barsByBroker?: Record<number, any[]>;
  brokerIds?: number[];
  /**
   * A broker refusal (`{success:false, error}`), as a string. `null`/absent = the modify succeeds.
   */
  modifyFails?: string | null;
  /** HTTP status for the refusal. `0` models a TRANSPORT failure — the bridge never answered. */
  modifyStatus?: number;
} = {}) {
  const modifyCalls: Array<{ ticket: number; sl?: number; tp?: number; brokerId?: number }> = [];
  const modifyOrder = jest.fn(
    async (ticket: number, sl?: number, tp?: number, brokerId?: number) => {
      modifyCalls.push({ ticket, sl, tp, brokerId });
      if (opts.modifyFails) {
        return { ok: false, status: opts.modifyStatus ?? 400, error: opts.modifyFails, brokerId };
      }
      return { ok: true, success: true, brokerId };
    },
  );
  const getCandles = jest.fn(
    async (symbol: string, _tf?: string, _limit?: number, brokerId?: number) => {
      if (opts.barsByBroker && brokerId != null) return opts.barsByBroker[brokerId] ?? [];
      return opts.bars ?? [];
    },
  );
  const manager = {
    getAllPositions: jest.fn(async () => opts.positions ?? []),
    getBrokerIds: jest.fn(() => opts.brokerIds ?? [2]),
    getCandles,
    modifyOrder,
  };
  return { manager: manager as any, modifyCalls, modifyOrder, getCandles };
}

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
      mt5Double().manager,
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
      const { manager } = mt5Double({
        positions: [
          { ticket: 1, symbol: 'XAUUSD', type, volume: 1, priceOpen: 100, priceCurrent: 100, sl: type === 'buy' ? 90 : 110, tp: null, profit: 0, comment: 'TCS s1', brokerId: 2 },
        ],
        bars,
      });

      return new StopGuardianService(
        { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
        { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
        manager,
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

    const { manager } = mt5Double({
      positions: [
        { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 1, priceOpen: 100, priceCurrent: 100, sl: 90, tp: null, profit: 0, comment: 'TCS s1', brokerId: 2 },
      ],
      bars,
    });

    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
      { runAll } as any,
      manager,
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
      const parsed = JSON.parse(refusalBody);
      const { manager, modifyCalls } = mt5Double({
        positions: [
          { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 1, priceOpen: 100, priceCurrent: 100, sl: 0, tp: null, profit: 0, comment: 'TCS s1', brokerId: 2 },
        ],
        bars: bars30(),
        modifyFails: String(parsed.error),
        modifyStatus: 400,
      });

      const service = new StopGuardianService(
        { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
        { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
        manager,
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
        expect(modifyCalls.length).toBe(1); // the probe that discovers the closure
        expect(service.getState().marketClosedBackoff).toEqual([
          { symbol: 'XAUUSD', retryAt: expect.any(String) },
        ]);

        await service.tick();
        expect(modifyCalls.length).toBe(1); // skipped — no bridge call at all

        jest.setSystemTime(Date.now() + 500); // past the 400ms window — fires no timers
        await service.tick();
        expect(modifyCalls.length).toBe(2); // probe after expiry
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
        expect(modifyCalls.length).toBe(2); // both ticks attempted
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
    const recordAdjustment = jest.fn();
    const { manager, modifyCalls } = mt5Double({
      positions: [
        {
          ticket: 7, symbol: 'XAUUSD', type: 'buy', volume: 1,
          priceOpen: opts.priceOpen ?? 100, priceCurrent: opts.priceCurrent,
          sl: opts.sl, tp: null, profit: 0, comment: 'TCS s1', brokerId: 2,
        },
      ],
      bars: opts.bars,
    });

    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: opts.slPct ?? 1 }]) } as any,
      { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
      manager,
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

  // ── #1034 — THE AUDIT STRING'S DENOMINATOR, AND WHY IT LOOKED LIKE 413 BREACHES ───────────
  //
  // ⚠️ THE CASE BELOW IS THE MEASURED DEFECT, reproduced exactly. `slPct` is declared against
  // ENTRY, but `dist` was recorded against CURRENT price. On a position 0.081% in profit the same
  // absolute trail becomes a SMALLER percentage, so `dist < slPct` followed BY ARITHMETIC — the
  // panel reported 413 breaches of an invariant that had not been breached, and the number grew
  // with every position that went into profit. The GBPUSD row from the issue is reproduced here
  // so that reverting the denominator fails a test instead of quietly inflating a count.
  describe('#1034 — the recorded distance is a percentage of ENTRY, not of current price', () => {
    it('a position in profit does NOT shrink the recorded percentage', () => {
      const entry = 100;
      const current = 100.081;         // the issue's GBPUSD row: slPct=1, +0.081% in profit
      const declared = declaredStopDistance(entry, 1); // = 1.0 price units

      const reason = stopAdjustmentReason({
        stopConfidence: 55,
        atrValue: 4.26786,
        trailDistance: declared,
        entryPrice: entry,
        slPct: 1,
      });

      // ⚠️ THE REGRESSION GUARD. Against the entry the trail IS the declared distance, so the row
      // reads 1.000 — at the floor, not inside it. The old denominator produced 0.999 here, which
      // the panel then reported as a breach of the very invariant the value satisfies.
      expect(reason).toContain('dist=1.000%');
      expect(reason).not.toContain('dist=0.999%');

      // Proof the old denominator is what produced 0.999, rather than asserting it from memory.
      const underOldDenominator = ((declared / current) * 100).toFixed(3);
      expect(underOldDenominator).toBe('0.999');
    });

    it('carries the declared slPct OF THE TIME, so a later retune cannot retro-label the row', () => {
      const reason = stopAdjustmentReason({
        stopConfidence: 55, atrValue: 7.71, trailDistance: 0.538, entryPrice: 100, slPct: 0.3,
      });
      // Gold Swing 1H declared ~0.3% on 2026-09-23 and declares 1.5% today. The row must record
      // what was in force when it was written; the panel judges against THIS, not today's config.
      expect(reason).toContain('slPct=0.3');
    });

    it('says n/a rather than 0.000% when the entry is unreadable', () => {
      // `0.000%` would read as a real measurement of zero — "the stop sits on the price" — where
      // the truth is that no percentage can be computed. The two must not render the same.
      const reason = stopAdjustmentReason({
        stopConfidence: 55, atrValue: 4, trailDistance: 1, entryPrice: 0, slPct: 1,
      });
      expect(reason).toContain('dist=n/a%');
      expect(reason).not.toContain('dist=0.000%');
    });
  });

  // ── #1018 — WHICH BOT OPENED THIS POSITION ──────────────────────────────────────────────────
  //
  // ⚠️ These are the tests that make the fix falsifiable. The defect was a SYMBOL match standing in
  // for an OWNER match, on a symbol carrying EIGHT active bots. Every refusal case below is
  // load-bearing: the whole point is that an unestablished owner must NOT be guessed, because a
  // guess writes another bot's `slPct` onto a live position as the #927 floor.
  describe('resolvePositionOwner (#1018)', () => {
    const NAMES = ['Gold Scalp M5', 'Gold Scalp M5 (copy)', 'Wellington NZDJPY Session', 'Tech Giants - NVDA'];

    it('resolves an EXACT stamped name', () => {
      expect(resolvePositionOwner('TCS Tech Giants - NVDA', NAMES)).toEqual({ name: 'Tech Giants - NVDA', via: 'exact' });
    });

    it('resolves a TRUNCATED comment when exactly one name matches — the measured live case', () => {
      // Measured 2026-09-28: MT5 truncated this to 27 chars, so exact equality alone would have
      // left the position UNGUARDED with nothing said. 'TCS Wellington NZDJPY Sessi'.
      expect(resolvePositionOwner('TCS Wellington NZDJPY Sessi', NAMES))
        .toEqual({ name: 'Wellington NZDJPY Session', via: 'unique-prefix' });
    });

    it('REFUSES when the truncated comment is a prefix of TWO names (the real copy-pair case)', () => {
      // ⚠️ MY FIRST VERSION OF THIS TEST WAS WRONG, and the suite caught it: it used
      // `'TCS Gold Scalp M5'`, which IS an exact name — so the exact tier correctly won and the
      // assertion failed. Ambiguity needs a stamp that is NOT a name but prefixes two.
      // 'Gold Scalp M5' and 'Gold Scalp M5 (copy)' both exist, so a truncation at 'Gold Scalp'
      // genuinely cannot be attributed. Guessing here applies the wrong bot's slPct as the #927
      // floor on a live position.
      expect(resolvePositionOwner('TCS Gold Scalp', NAMES)).toBeNull();
    });

    it('tolerates a CASE difference — an MT5 comment is editable, so a mismatch must not silently unguard', () => {
      expect(resolvePositionOwner('TCS tech giants - nvda', NAMES))
        .toEqual({ name: 'Tech Giants - NVDA', via: 'exact' });
      // ⚠️ The canonical spelling is returned, never the one stamped on the position.
      expect(resolvePositionOwner('TCS wellington nzdjpy sessi', NAMES)?.name)
        .toBe('Wellington NZDJPY Session');
    });

    it('REFUSES an unknown owner', () => {
      expect(resolvePositionOwner('TCS No Such Bot', NAMES)).toBeNull();
    });

    it('REFUSES a comment that is not ours at all', () => {
      expect(resolvePositionOwner('some broker note', NAMES)).toBeNull();
      expect(resolvePositionOwner('', NAMES)).toBeNull();
      expect(resolvePositionOwner(null, NAMES)).toBeNull();
      expect(resolvePositionOwner(undefined, NAMES)).toBeNull();
      expect(resolvePositionOwner('TCS  ', NAMES)).toBeNull(); // prefix but no name stamped
    });

    it('a SHORT name is not stolen by a longer one that starts with it', () => {
      // Exact match must win over prefix, or 'Gold Scalp M5' would be ambiguous with itself.
      expect(resolvePositionOwner('TCS Gold Scalp M5', ['Gold Scalp M5'])).toEqual({ name: 'Gold Scalp M5', via: 'exact' });
    });

    // ── TIER 3 — PUNCTUATION LOSS (added 2026-09-29) ──────────────────────────────────────────
    //
    // ⚠️ THE MEASURED LIVE CASE, NOT A HYPOTHETICAL. `XAUUSD #152698800224` on broker :5000, opened
    // 2026-09-29 13:11, carried the comment **`TCS Gold Swing 1H copy`** while its bot is named
    // **`Gold Swing 1H (copy)`** — MT5 had STRIPPED THE PARENTHESES. Tier 1 missed (not equal) and
    // tier 2 missed (not a prefix of `Gold Swing 1H (copy)`), so that position was left UNMANAGED
    // for **341 consecutive ticks**, warned every 30s but only into a console log. The NZDJPY case
    // above is TRUNCATION; this is the same MT5 mutation through punctuation, and it was not covered.
    //
    // ⚠️ CANARY: delete tier 3 from `resolvePositionOwner()` and the first test below fails — it is
    // the only assertion that distinguishes tier 3 from a refusal.
    it('resolves a PUNCTUATION-STRIPPED name — the measured `Gold Swing 1H copy` case', () => {
      const gold = ['Gold Swing 1H', 'Gold Swing 1H (copy)'];
      expect(resolvePositionOwner('TCS Gold Swing 1H copy', gold))
        .toEqual({ name: 'Gold Swing 1H (copy)', via: 'normalised' });
    });

    it('the normalised tier does NOT weaken the exact tier', () => {
      // A name that IS exact must still win outright, rather than being flattened toward a neighbour.
      expect(resolvePositionOwner('TCS Gold Swing 1H', ['Gold Swing 1H', 'Gold Swing 1H (copy)']))
        .toEqual({ name: 'Gold Swing 1H', via: 'exact' });
    });

    it('the normalised tier KEEPS the uniqueness rule — a flattening collision is still refused', () => {
      // Synthetic pair, labelled as such: two names differing ONLY by punctuation flatten to the
      // same string. A stamp matching neither exactly nor as a prefix must still refuse rather than
      // pick one. Tier 3 adds a way to match; it does not relax the discipline tiers 1–2 had.
      expect(resolvePositionOwner('TCS AB', ['A B', 'A-B'])).toBeNull();
    });
  });

  // ── #1018 — THE MAGIC PATH, AND THE ONE THING IT MUST NOT DO ────────────────────────────────
  //
  // The block above covers the FALLBACK half. These cover the durable half and its safety
  // property — neither of which had ANY test, which is why the magic code could be written, built
  // and seeded while remaining unobservable.
  describe('owner attribution by magic (#1018)', () => {
    const MAGIC_BOT = { active: true, mode: 'auto', symbol: 'XAUUSD', id: 'b1', name: 'Magic Bot', slPct: 1, magic: 234105 };
    const COMMENT_BOT = { active: true, mode: 'auto', symbol: 'XAUUSD', id: 'b2', name: 'Comment Bot', slPct: 1, magic: 234106 };

    /**
     * Short bars drive the `bars.length < 14` branch — the cheapest path to `makeGuarded`.
     *
     * ⚠️ `comment` deliberately names a REAL, resolvable bot in every case. A test whose comment is
     * unreadable could pass for the wrong reason: "no owner found" and "magic not consulted" look
     * identical from the outside.
     */
    function serviceWithPosition(pos: Record<string, unknown>) {
      // `brokerId` first so a caller-supplied one wins, but the default is present: the manager
      // always stamps it, and a position without one is not something the service ever sees.
      const { manager } = mt5Double({ positions: [{ brokerId: 2, ...pos }], bars: [] });
      const service = new StopGuardianService(
        { findAll: jest.fn().mockResolvedValue([MAGIC_BOT, COMMENT_BOT]) } as any,
        { runAll: jest.fn().mockResolvedValue(new Map()) } as any,
        manager,
        { recordAdjustment: jest.fn() } as any,
      );
      service.state.enabled = true;
      return service;
    }

    const rawPos = (over: Record<string, unknown> = {}) => ({
      ticket: 7, symbol: 'XAUUSD', type: 'buy', volume: 1,
      priceOpen: 100, priceCurrent: 100, sl: 99, tp: null, profit: 0,
      comment: 'TCS Comment Bot',
      ...over,
    });

    it('prefers MAGIC over a comment that names a different, entirely real bot', async () => {
      // ⚠️ The comment here resolves CLEANLY to 'Comment Bot'. So this cannot pass by "an owner was
      // found" — the two paths disagree, and it only passes if MAGIC WON.
      // ⚠️ CANARY: move the comment branch above the magic branch in `tick()` and this fails with
      // strategyName 'Comment Bot'.
      const service = serviceWithPosition(rawPos({ magic: 234105 }));
      try {
        await service.tick();
        const g = service.state.guardedPositions.find((p) => p.ticket === 7);
        expect(g?.strategyName).toBe('Magic Bot');
        expect(g?.ownerVia).toBe('magic');
        expect(service.state.ownerAttribution).toMatchObject({ viaMagic: 1, viaComment: 0 });
      } finally {
        service.stop();
      }
    });

    it('an unmatched magic is a CONTRADICTION — never resolved from the comment', async () => {
      // THE safety property, and the one an obvious implementation gets wrong. Falling through to
      // the comment would hand a reassigned/unknown bot's position to whichever name the truncated,
      // human-editable comment happens to carry — and the guardian would then write THAT bot's
      // `slPct` onto a live position as the #927 declared-distance floor.
      //
      // ⚠️ The comment is resolvable, so the assertion is on `unresolved` and not merely on absence:
      // a fall-through implementation WOULD guard the position, and a test that only checked
      // `guardedPositions` would pass it.
      // ⚠️ CANARY: replace the `continue` after `unresolved.push(...)` with a fall-through and this
      // fails — 'Comment Bot' becomes the owner.
      const service = serviceWithPosition(rawPos({ magic: 999999 }));
      try {
        await service.tick();
        const un = service.state.ownerAttribution?.unresolved ?? [];
        expect(un).toHaveLength(1);
        expect(un[0]).toContain('magic=999999');
        expect(un[0]).toContain('matches NO bot');
        expect(service.state.guardedPositions).toHaveLength(0);
        expect(service.state.ownerAttribution).toMatchObject({ viaMagic: 0, viaComment: 0 });
      } finally {
        service.stop();
      }
    });

    it('the bridge default 234000 means "no bot attributed" and still falls back to the comment', async () => {
      // Every position opened BEFORE per-bot magics existed carries 234000, and magic is immutable,
      // so those can never be attributed by magic. Treating 234000 as a real magic would divert the
      // entire pre-existing book into `unresolved` and the guardian would stop managing it — the
      // fallback is live code, not a courtesy.
      // ⚠️ CANARY: delete the `Number(m) !== BRIDGE_DEFAULT_MAGIC` condition and this fails — the
      // position lands in `unresolved` instead of resolving from its comment.
      const service = serviceWithPosition(rawPos({ magic: 234000 }));
      try {
        await service.tick();
        const g = service.state.guardedPositions.find((p) => p.ticket === 7);
        expect(g?.strategyName).toBe('Comment Bot');
        expect(g?.ownerVia).toBe('comment:exact');
        expect(service.state.ownerAttribution).toMatchObject({ viaMagic: 0, viaComment: 1, unresolved: [] });
      } finally {
        service.stop();
      }
    });
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
      expect(modifyCalls[0].sl).toBe(102);
      expect(modifyCalls[0].sl).not.toBe(102.94);
      // #927 acceptance box 4 — `stop_adjustment` can be read without recomputing ATR.
      //
      // ⚠️ CHANGED 2026-10-01 (#1034). This asserted `dist=0.971%` — the declared 1.0 divided by
      // `priceCurrent` 103. That is the ENTRY-denominated `slPct` compared against a
      // CURRENT-price-denominated `dist`, and it is why the panel reported 413 breaches of an
      // invariant that had not been breached: on any position in profit the recorded percentage is
      // arithmetically smaller than the declared one. The assertion did not merely fail to catch the
      // defect — it ENCODED it, which is why every run agreed the behaviour was correct.
      //
      // The declared distance is 1.0 risk-units on a 100 entry, so the row reads 1.000%.
      expect(recordAdjustment).toHaveBeenCalledTimes(1);
      expect(recordAdjustment.mock.calls[0][0].reason).toContain('dist=1.000%');
      expect(recordAdjustment.mock.calls[0][0].reason).not.toContain('dist=0.971%');
      // The row must describe itself, so the panel can judge it without today's config (#1034 B).
      expect(recordAdjustment.mock.calls[0][0].reason).toContain('slPct=1');
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
      expect(modifyCalls[0].sl).toBe(100);
    } finally {
      service.stop();
    }
  });
});

/**
 * #1030 — POST-ENTRY MANAGEMENT MUST ADDRESS THE ACCOUNT THAT HOLDS THE POSITION.
 * ===============================================================================
 *
 * MEASURED 2026-09-30, live, BEFORE the fix: `:5000` (broker 2) held 7 positions and `:5001`
 * (broker 3) held 2 — US500 and GER40. The guardian reported `7 guarded` on every tick and had
 * never seen the other two. Separately, `GET :5000/candles?symbol=GER40` answers `200` with ZERO
 * bars while `:5001` answers with data, so GER40 was invisible TWICE over: no position AND no bars,
 * and a tick skips any position with fewer than 14 bars. One bridge was wrong in two places.
 *
 * ⚠️ CANARY, both directions:
 *   • pass `undefined` instead of `pos.brokerId` in `modifyStop()` → the broker-3 assertions fail,
 *     because the edit is recorded against the primary;
 *   • drop `pos.brokerId` from `loadBars()` → the "bars from the position's own bridge" test fails,
 *     because the primary returns zero bars and the position is skipped.
 */
describe('#1030 — a second MT5 account is managed, not just the primary', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const bullishEvidence = () =>
    new Map([
      ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
      ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bullish', reason: 'x' }],
      ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bullish', reason: 'x' }],
      ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bullish', reason: 'x', metadata: { isFakeout: false } }],
    ]);

  /**
   * ⚠️ LOW ATR ON PURPOSE (the #927 fixture's shape). The trail distance is
   * `max(3×ATR, declared)`, so a realistic bar range makes 3×ATR dominate — the target lands
   * BELOW the existing stop, "never loosen" refuses it, and no edit is sent. A test that reasons
   * about the ROUTING of an edit must first make an edit happen.
   */
  const flatBars = () =>
    Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.now() - (30 - i) * 3600000).toISOString(),
      open: 100.5 + i * 0.01,
      high: 100.52 + i * 0.01,
      low: 100.48 + i * 0.01,
      close: 100.5 + i * 0.01,
      volume: 1000,
    }));

  /** A position as broker 3 reports it — the account the guardian could not see at all. */
  const broker3Position = () => ({
    ticket: 5001, symbol: 'GER40', type: 'buy', volume: 1,
    priceOpen: 100, priceCurrent: 103, sl: 99, tp: null, profit: 5,
    comment: 'TCS Index Bot', magic: 234200, brokerId: 3,
  });

  const indexBot = { active: true, mode: 'auto', symbol: 'GER40', id: 'i1', name: 'Index Bot', slPct: 1, magic: 234200 };

  const makeService = (opts: { barsByBroker?: Record<number, any[]>; bars?: any[] } = {}) => {
    const { manager, modifyCalls, getCandles } = mt5Double({
      positions: [broker3Position()],
      bars: opts.bars ?? flatBars(),
      barsByBroker: opts.barsByBroker,
      brokerIds: [2, 3],
    });
    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([indexBot]) } as any,
      { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
      manager,
      { recordAdjustment: jest.fn() } as any,
    );
    service.state.enabled = true;
    return { service, modifyCalls, getCandles };
  };

  it('GUARDS a position that only broker 3 reports, and names the account in the payload', async () => {
    const { service } = makeService();
    try {
      await service.tick();
      expect(service.state.guardedPositions).toHaveLength(1);
      expect(service.state.guardedPositions[0].symbol).toBe('GER40');
      expect(service.state.guardedPositions[0].brokerId).toBe(3);
    } finally {
      service.stop();
    }
  });

  it("addresses the stop edit to the POSITION's own account, not the primary", async () => {
    // THE money-path assertion. A modify aimed at the primary bridge names an account that does not
    // hold ticket 5001 — the broker answers "no such position", which reads as a data problem
    // rather than as a routing one.
    const { service, modifyCalls } = makeService();
    try {
      await service.tick();
      expect(modifyCalls.length).toBeGreaterThan(0);
      expect(modifyCalls[0].ticket).toBe(5001);
      expect(modifyCalls[0].brokerId).toBe(3);
    } finally {
      service.stop();
    }
  });

  it("loads bars from the POSITION's bridge — the primary answers 200 with zero bars", async () => {
    // The measured GER40 case. If the load asks the primary, `bars.length < 14` sends the position
    // down the skip path and NOTHING reports a fault — the tick still says `1 guarded`.
    const { service, getCandles } = makeService({ barsByBroker: { 2: [], 3: flatBars() } });
    try {
      await service.tick();
      const g = service.state.guardedPositions[0];
      expect(g).toBeDefined();
      // Evaluated, not skipped: a position with no usable bars carries confidence 0.
      expect(g.stopConfidence).not.toBe(0);
      // ...and the read really was addressed to broker 3 first.
      expect(getCandles.mock.calls[0][3]).toBe(3);
    } finally {
      service.stop();
    }
  });

  it('reports the per-bridge read, so a silent second account is visible', async () => {
    const { service } = makeService();
    try {
      await service.tick();
      expect(service.state.brokerCoverage).toEqual({
        brokersQueried: [2, 3],
        positionsByBroker: { 3: 1 },
      });
    } finally {
      service.stop();
    }
  });

  it('a TRANSPORT failure is NOT a market-closed refusal — no backoff is armed', async () => {
    // #892/#893 IN REVERSE, and the reason `modifyOrder` now returns `status`. `status: 0` means the
    // bridge was never reached. Collapsing that into "the broker refused" would pause the symbol for
    // 15 minutes after the bridge came back — trading a transient outage for a stop that stays
    // unmoved, which is the opposite of what #893 was for.
    const { manager, modifyCalls } = mt5Double({
      positions: [{ ...broker3Position(), sl: 0 }], // sl:0 drives the protective path
      bars: flatBars(),
      modifyFails: 'connect ECONNREFUSED 127.0.0.1:5001',
      modifyStatus: 0,
    });
    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([indexBot]) } as any,
      { runAll: jest.fn().mockResolvedValue(bullishEvidence()) } as any,
      manager,
      { recordAdjustment: jest.fn() } as any,
    );
    service.state.enabled = true;
    try {
      await service.tick();
      expect(modifyCalls).toHaveLength(1);
      expect(service.getState().marketClosedBackoff).toEqual([]);
      // The next tick retries rather than backing off.
      await service.tick();
      expect(modifyCalls).toHaveLength(2);
    } finally {
      service.stop();
    }
  });
});

/**
 * #1056 — the guardian must record WHY it left a position alone.
 *
 * WHY THIS SUITE EXISTS
 *
 * `guardedPositions` said which positions were CONSIDERED and `recentAdjustments` said what was
 * DONE. Neither carried the DECLINE, so "why did it leave this one alone?" was recorded nowhere —
 * not a table, not the structured log. FRA40 had **zero** `stop_adjustment` rows ever while its
 * peers were trailed, and the live payload could not say whether the guardian had evaluated it.
 *
 * ⚠️ THE CANARY IS THE PAIR OF ASSERTIONS, NOT EITHER ONE ALONE.
 *
 * A `no-bars` position and an evaluated position that found nothing to do produce the SAME
 * `stopConfidence` (0) and the SAME `recommendedSl` (null). So the fields a reader would naturally
 * reach for **cannot** tell them apart — this suite asserts the pair matches and the outcomes do
 * not. Delete the `'no-bars'` literal (or infer `outcome` from the other fields) and it fails.
 */
describe('StopGuardianService — the per-position OUTCOME (#1056)', () => {
  /** Flat bars: ATR is genuinely 0, so no trail level can be computed. */
  const flatBars = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: new Date(Date.now() - (n - i) * 3600000).toISOString(),
      open: 100, high: 100, low: 100, close: 100, volume: 1000,
    }));

  /** Four BEARISH signals against a BUY: aligned 0, opposing ~78 -> stopConfidence 0. */
  const bearishEvidence = () =>
    new Map([
      ['atr-trailing-stop', { score: 75, confidence: 0.7, signalClass: 'bearish', reason: 'x' }],
      ['supertrend', { score: 75, confidence: 0.7, signalClass: 'bearish', reason: 'x' }],
      ['chandelier-exit', { score: 80, confidence: 0.55, signalClass: 'bearish', reason: 'x' }],
      ['wick-filter', { score: 80, confidence: 0.7, signalClass: 'bearish', reason: 'x', metadata: { isFakeout: false } }],
    ]);

  const build = (bars: any[]) => {
    const { manager } = mt5Double({
      positions: [
        { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 1, priceOpen: 100, priceCurrent: 100, sl: 90, tp: null, profit: 0, comment: 'TCS s1', brokerId: 2 },
      ],
      bars,
    });
    return new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([{ active: true, mode: 'auto', symbol: 'XAUUSD', id: 's1', name: 'S1', slPct: 1 }]) } as any,
      { runAll: jest.fn().mockResolvedValue(bearishEvidence()) } as any,
      manager,
      { recordAdjustment: jest.fn() } as any,
    );
  };

  const guardedOutcome = async (svc: any) => {
    svc.state.enabled = true;
    await svc.tick();
    const row = svc.state.guardedPositions[0];
    svc.stop();
    return row;
  };

  it('⚠️ CANARY — identical stopConfidence AND recommendedSl, DIFFERENT outcomes', async () => {
    // Too few bars: everything downstream skips.
    const tooFew = await guardedOutcome(build(flatBars(5)));
    // Bars are fine; the ATR is genuinely 0, so there is no level to recommend and the consensus
    // is too low to tighten on anyway.
    const flatAtr = await guardedOutcome(build(flatBars(30)));

    // ⚠️ The pair a reader would infer from. IDENTICAL for both — so inference cannot work.
    expect(tooFew.stopConfidence).toBe(0);
    expect(flatAtr.stopConfidence).toBe(0);
    expect(tooFew.recommendedSl).toBeNull();
    expect(flatAtr.recommendedSl).toBeNull();

    // ...and the ONLY thing that separates them is the recorded outcome.
    expect(tooFew.outcome).toBe('no-bars');
    expect(flatAtr.outcome).toBe('below-threshold');
    expect(tooFew.outcome).not.toBe(flatAtr.outcome);
  });

  it('no considered position is left without an outcome', async () => {
    // The field is REQUIRED on `makeGuarded`, so a new push site cannot omit it silently — this
    // asserts the runtime consequence rather than the type.
    const row = await guardedOutcome(build(flatBars(30)));
    expect(typeof row.outcome).toBe('string');
    expect(row.outcome.length).toBeGreaterThan(0);
  });
});