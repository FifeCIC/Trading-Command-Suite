import { StopGuardianService } from './stop-guardian.service';

/**
 * exhaustion-observer.spec.ts — the UP-move exhaustion OBSERVER (#995).
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT, AND WHY THE TEST IS ABOUT *WHEN IT IS SILENT*.
 *
 * The guardian's four directives are ALL trail-followers — they tighten BEHIND price, so their
 * input is where price HAS BEEN. Nothing notices a move LOSING MOMENTUM. The two exhaustion
 * directives that already exist cannot cover it, and the reason is DIRECTION, not availability:
 * both are `directionBias: 'bullish'` — "the DOWN-move is exhausting, buy the dip".
 *
 * An observer that fires too readily is worse than none: it fills a table with rows that make a
 * non-signal look measurable. So most of these tests assert that it does NOT record, and each
 * names the reason. A guard never seen to fail is decoration — see the canaries below.
 *
 * ⚠️ HOW TO CANARY THIS FILE (do it before trusting it).
 *   1. In `observeExhaustion`, change `if (!(prior > 0)) return;` to `if (false) return;`.
 *      `test_does_not_fire_on_deceleration_after_a_decline` must FAIL.
 *   2. Delete the cooldown early-return (`if (Date.now() - lastAt < ...) return;`).
 *      `test_cooldown_records_once_not_every_tick` must FAIL.
 *   Restore byte-for-byte and confirm both pass again.
 */
describe('StopGuardianService — UP-move exhaustion observer (#995)', () => {
  /** 2k+1 closes, k = EXHAUSTION_WINDOW_BARS = 3. */
  const barsOf = (closes: number[]) => closes.map((close) => ({ close }));

  function make(stratOver: Record<string, unknown> = {}) {
    const svc = Object.create(StopGuardianService.prototype) as StopGuardianService;
    const recorded: any[] = [];
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (svc as any).adjustmentRecorder = {
      recordExhaustionEvent: jest.fn((p: any) => recorded.push(p)),
    };
    // ⚠️ REQUIRED, AND ITS ABSENCE MADE EVERY NEGATIVE TEST VACUOUS. `Object.create(prototype)`
    // skips class FIELD INITIALISERS, so `this.exhaustionLastAt` was `undefined` and every call
    // threw at `.get()` straight into the catch block — which swallows by design. So the observer
    // recorded nothing and the 'does NOT fire' tests passed FOR THE WRONG REASON. The harness must
    // supply what the initialisers would have.
    (svc as any).exhaustionLastAt = new Map<number, number>();
    (svc as any).EXHAUSTION_COOLDOWN_MS = 300_000;
    (svc as any).EXHAUSTION_WINDOW_BARS = 3;
    const strat = {
      id: 'bot-1',
      name: 'Gold Day-Trade M15',
      exhaustionObserveEnabled: true,
      exhaustionDecelPct: 50,
      ...stratOver,
    };
    const pos = (over: Record<string, unknown> = {}) =>
      ({ ticket: 152671260359, symbol: 'XAUUSD', type: 'buy', priceOpen: 100, priceCurrent: 103.15, ...over });
    return { svc, strat, pos, recorded };
  }

  const run = (svc: any, pos: any, strat: any, closes: number[]) =>
    svc.observeExhaustion(pos, strat, barsOf(closes));

  // Decelerating INTO the high: +2.6 prior, +0.55 recent → ~79% deceleration, last close IS the peak.
  const DECEL_INTO_HIGH = [100, 100.8, 101.7, 102.6, 103.0, 103.1, 103.15];

  it('fires on a move decelerating INTO a new high, and stores both halves raw', () => {
    const { svc, strat, pos, recorded } = make();
    run(svc, pos(), strat, DECEL_INTO_HIGH);

    expect(recorded).toHaveLength(1);
    const e = recorded[0];
    expect(e.symbol).toBe('XAUUSD');
    expect(e.side).toBe('buy');
    expect(e.thresholdPct).toBe(50);
    // ⚠️ The two halves are stored RAW, not just the verdict, so the threshold can be re-evaluated
    // later against the same firings without re-observing anything. The theory is `testing`.
    expect(e.priorProgressPct).toBeCloseTo(2.6, 3);
    expect(e.recentProgressPct).toBeCloseTo(0.55, 3);
    expect(e.decelPct).toBeCloseTo(78.85, 1);
    expect(e.peakPrice).toBe(103.15);
    expect(e.barsUsed).toBe(7);
    // ⚠️ PROVES THE RECORD DID NOT COME FROM THE CATCH PATH. Without this, a broken observer that
    // throws before recording would still be caught and this test could pass on a lucky shape.
    expect((svc as any).logger.warn).not.toHaveBeenCalled();
  });

  it('a firing is NOT the catch path — the negative tests are not vacuously true', () => {
    // Tamper check on the SUITE, not the code: every 'does NOT fire' test below would also pass if
    // the observer threw before recording and the catch swallowed it. This asserts that a POSITIVE
    // case reaches the recorder AND logs no warning, which is what makes their silence meaningful.
    const { svc, strat, pos, recorded } = make();
    run(svc, pos(), strat, DECEL_INTO_HIGH);
    expect(recorded).toHaveLength(1);
    expect((svc as any).logger.warn).not.toHaveBeenCalled();
  });

  it('is SILENT when the bot has it switched off — and that is the default', () => {
    const { svc, strat, pos, recorded } = make({ exhaustionObserveEnabled: false });
    run(svc, pos(), strat, DECEL_INTO_HIGH);
    expect(recorded).toHaveLength(0);
  });

  it('is SILENT when the threshold is NULL, and does NOT fall back to a default', () => {
    // ⚠️ A guessed threshold would record firings against a number nobody chose — evidence for a
    // fiction. NULL means "not configured", never "arm at zero".
    const { svc, strat, pos, recorded } = make({ exhaustionDecelPct: null });
    run(svc, pos(), strat, DECEL_INTO_HIGH);
    expect(recorded).toHaveLength(0);
  });

  it('does NOT fire on deceleration after a DECLINE — that is just a decline', () => {
    // ⚠️ THE FIXTURE MATTERS MORE THAN THE ASSERTION, AND THE FIRST VERSION WAS VACUOUS.
    //
    // It used a series that fell across the WHOLE window, which yields `decelPct = 0` — so the test
    // passed for a reason that had nothing to do with the `prior > 0` guard. The canary proved it:
    // removing that guard left all 12 tests green.
    //
    // To isolate the guard, the series must be one where the guard is the ONLY thing preventing a
    // fire: price FALLS then recovers to a new high, so `prior < 0` (the guard) while the latest
    // close IS the window max AND the deceleration ratio is a large positive number — here
    // (prior − recent) ÷ prior × 100 = 200%, which clears the 50% threshold comfortably.
    const { svc, strat, pos, recorded } = make();
    run(svc, pos({ priceCurrent: 110 }), strat, [110, 108, 107, 106, 106.5, 109, 110]);
    expect(recorded).toHaveLength(0);
    // Positive control on the fixture: the catch path is NOT why it stayed silent.
    expect((svc as any).logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT fire on ACCELERATION — progress growing is the opposite claim', () => {
    const { svc, strat, pos, recorded } = make();
    run(svc, pos({ priceCurrent: 102.8 }), strat, [100, 100.1, 100.2, 100.3, 101, 101.9, 102.8]);
    expect(recorded).toHaveLength(0);
  });

  it('does NOT fire when price has pulled back off the high', () => {
    // Decelerating, but no longer at the extreme — so it is not a claim about a move INTO a high.
    const { svc, strat, pos, recorded } = make();
    run(svc, pos({ priceCurrent: 103.0 }), strat, [100, 101, 102, 103, 103.1, 103.2, 103.0]);
    expect(recorded).toHaveLength(0);
  });

  it('does NOT fire below the threshold', () => {
    const { svc, strat, pos, recorded } = make({ exhaustionDecelPct: 95 });
    run(svc, pos(), strat, DECEL_INTO_HIGH); // ~79% < 95%
    expect(recorded).toHaveLength(0);
  });

  it('is SILENT on too few bars rather than guessing', () => {
    const { svc, strat, pos, recorded } = make();
    run(svc, pos(), strat, [100, 101, 102]); // needs 2k+1 = 7
    expect(recorded).toHaveLength(0);
  });

  it('cooldown records ONCE per window, not once per tick', () => {
    // ⚠️ `tick()` runs every few seconds; the bars change every 5 MINUTES. Without the cooldown one
    // decelerating bar writes an event on every tick for five minutes and the table is unreadable —
    // the "plausible rows, no signal" defect this repo keeps re-finding.
    const { svc, strat, pos, recorded } = make();
    for (let i = 0; i < 10; i++) run(svc, pos(), strat, DECEL_INTO_HIGH);
    expect(recorded).toHaveLength(1);
  });

  it('mirrors for a SELL — a falling move decelerating is the same code path', () => {
    const { svc, strat, recorded } = make();
    // ⚠️ THE MIRROR IS IN TIME, NOT JUST IN SIGN. The first version of this fixture descended
    // 102.6 → 100 over the recent half against 103.15 → 102.6 over the prior half, i.e. it
    // ACCELERATED downward, and the correct answer was "no fire". A sell's exhaustion is a fall
    // that is running out of steam: +2.6 then +0.55, exactly as the buy fixture rises.
    const sell = { ticket: 1, symbol: 'EURUSD', type: 'sell', priceOpen: 103.15, priceCurrent: 100 };
    run(svc, sell, strat, [103.15, 102.35, 101.45, 100.55, 100.15, 100.05, 100.0]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].side).toBe('sell');
    // ⚠️ PROGRESS IS NORMALISED TO ENTRY, so the absolute prices are not the numbers stored. This
    // sell entered at 103.15, so a 2.6 move is 2.52% — the BUY fixture's 2.6 is only exactly 2.6%
    // because its entry happens to be 100. Asserting the invariant rather than the coincidence.
    expect(recorded[0].priorProgressPct).toBeCloseTo((2.6 / 103.15) * 100, 3);
    expect(recorded[0].recentProgressPct).toBeCloseTo((0.55 / 103.15) * 100, 3);
    // The deceleration is a RATIO, so it is identical to the buy fixture and independent of entry.
    expect(recorded[0].decelPct).toBeCloseTo(78.85, 1);
    // Profit is in the FAVOURABLE direction for a sell: entry 103.15 → price 100.
    expect(recorded[0].profitPct).toBeCloseTo(3.05, 1);
    expect((svc as any).logger.warn).not.toHaveBeenCalled();
  });

  it('NEVER breaks the guardian — a throwing recorder does not propagate', () => {
    // ⚠️ This is instrumentation, not control flow. A throw here would abort the tick that does the
    // real stop management, so the observer must swallow it.
    const { svc, strat, pos } = make();
    (svc as any).adjustmentRecorder = {
      recordExhaustionEvent: jest.fn(() => { throw new Error('recorder exploded'); }),
    };
    expect(() => run(svc, pos(), strat, DECEL_INTO_HIGH)).not.toThrow();
    expect((svc as any).logger.warn).toHaveBeenCalled();
  });
});
