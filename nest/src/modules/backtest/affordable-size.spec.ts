import { applyAffordability, DEFAULT_MAX_LEVERAGE } from './affordable-size';

/**
 * #1142 — the sizing floor that turned $10,000 into a $77,600 position.
 *
 * ⚠️ The direction that matters most is the one that REFUSES. A guard that only ever caps would still
 * let a 7.76× position through whenever one unit is unaffordable; a guard that only ever refuses would
 * disable trading entirely. Both are asserted here.
 */
describe('applyAffordability', () => {
  it('passes an affordable request through untouched', () => {
    const r = applyAffordability({ requestedUnits: 10, pricePerUnit: 100, equity: 10_000 });
    expect(r).toMatchObject({ units: 10, notional: 1000, notionalPct: 0.1, refused: false, capped: false });
  });

  it('CAPS a request larger than the account can afford, and says it capped', () => {
    // 200 shares at $100 = $20,000 on a $10,000 account.
    const r = applyAffordability({ requestedUnits: 200, pricePerUnit: 100, equity: 10_000 });
    expect(r.units).toBe(100);
    expect(r.notional).toBe(10_000);
    expect(r.notionalPct).toBe(1);
    expect(r.capped).toBe(true);
    expect(r.refused).toBe(false);
  });

  it('REFUSES when one unit costs more than the whole account — the BTC case', () => {
    // The measured defect: BTC ≈ $77,600, account $10,000, and the old floor forced 1 unit.
    const r = applyAffordability({ requestedUnits: 1, pricePerUnit: 77_600, equity: 10_000 });
    expect(r.refused).toBe(true);
    expect(r.units).toBe(0);
    expect(r.notional).toBe(0);
    expect(r.refusedBecause).toContain('too large for this account');
  });

  it('lets leverage deliberately raise the ceiling', () => {
    const r = applyAffordability({ requestedUnits: 1, pricePerUnit: 77_600, equity: 10_000, maxLeverage: 10 });
    expect(r.refused).toBe(false);
    expect(r.units).toBe(1);
    expect(r.notionalPct).toBeCloseTo(7.76, 2);
  });

  it('REFUSES a zero-unit request instead of quietly making it 1', () => {
    // The exact substitution the old `if (positionSize < 1) positionSize = 1` performed.
    const r = applyAffordability({ requestedUnits: 0, pricePerUnit: 100, equity: 10_000 });
    expect(r.refused).toBe(true);
    expect(r.units).toBe(0);
    // The message must carry the arithmetic, not just the verdict.\n    expect(r.refusedBecause).toContain('no whole units');\n    expect(r.refusedBecause).toContain('100.00');\n    expect(r.refusedBecause).toContain('10000.00');
  });

  it.each([
    ['a zero entry price', { requestedUnits: 1, pricePerUnit: 0, equity: 10_000 }],
    ['a NaN entry price', { requestedUnits: 1, pricePerUnit: Number.NaN, equity: 10_000 }],
    ['a zero account', { requestedUnits: 1, pricePerUnit: 100, equity: 0 }],
    ['a NaN account', { requestedUnits: 1, pricePerUnit: 100, equity: Number.NaN }],
    ['zero leverage', { requestedUnits: 1, pricePerUnit: 100, equity: 10_000, maxLeverage: 0 }],
  ])('REFUSES rather than guessing when given %s', (_name, input) => {
    const r = applyAffordability(input as never);
    expect(r.refused).toBe(true);
    expect(r.units).toBe(0);
  });

  it('defaults to UNLEVERAGED — a caller that says nothing cannot accidentally borrow', () => {
    expect(DEFAULT_MAX_LEVERAGE).toBe(1);
    const r = applyAffordability({ requestedUnits: 1000, pricePerUnit: 100, equity: 10_000 });
    expect(r.notionalPct).toBe(1);
  });

  it('the relationship the Lab prints: riskPct ÷ slPct IS the notional multiple', () => {
    // fixedPercent sizes notional = equity × riskPct / slPct, so the cap binds above 1×.
    // With 2% risk on a 1% stop the request is 2× the account and must be halved by the cap.
    const equity = 10_000;
    const price = 50;
    const requestedNotional = equity * (2 / 1);        // riskPct 2, slPct 1
    const requestedUnits = Math.floor(requestedNotional / price); // 400 units = $20,000
    const r = applyAffordability({ requestedUnits, pricePerUnit: price, equity });
    expect(r.capped).toBe(true);
    expect(r.notionalPct).toBe(1);
  });

  /**
   * ── #1170: THE STEP IS THE BROKER'S, AND A MISSING STEP IS NOT A STEP OF 1 ──────────────────────
   *
   * Whole units made four instruments untestable at a $10,000 account: BTC ≈$58k, US30 ≈$45k,
   * USTEC/GER40 ≈$22k. MEASURED on the MetaQuotes bridge 2026-11-01: US30 is `volumeStep 0.1`,
   * `contractSize 1`, so **0.2 units is a valid 0.2-lot order** and costs $9,010 — tradeable. The
   * engine refused it because it only knew how to count to 1.
   */
  describe('unit granularity (#1170)', () => {
    it('sizes an index CFD in 0.1 steps instead of refusing it', () => {
      // US30 at $45,053, a $10,000 account, 1× leverage. Whole units = 0 → the old refusal.
      const r = applyAffordability({
        requestedUnits: 1,          // the sizing model wanted a whole unit
        pricePerUnit: 45_053,
        equity: 10_000,
        unitStep: 0.1,
        minUnits: 0.1,
      });
      expect(r.refused).toBe(false);
      expect(r.units).toBeCloseTo(0.2, 10);
      expect(r.notional).toBeCloseTo(9_010.6, 2);
      expect(r.granularity).toBe('broker');
      expect(r.unitStepApplied).toBe(0.1);
    });

    it('still refuses when even the SMALLEST order is unaffordable', () => {
      // BTC at $87,000 with a 1-unit step: 0.11 units does not exist, so there is no order to place.
      // ⚠️ This is the case #1170 must NOT "fix" by inventing a fraction — the bridge reports BTC as
      // `volumeStep 1`, and a broker would reject 0.5.
      const r = applyAffordability({
        requestedUnits: 1,
        pricePerUnit: 87_000,
        equity: 10_000,
        unitStep: 1,
        minUnits: 1,
      });
      expect(r.refused).toBe(true);
      expect(r.refusedBecause).toContain('smallest tradeable size is 1');
    });

    it('rounds a request DOWN to a step boundary, never up', () => {
      // Rounding up would buy more than the risk budget asked for — the failure direction matters.
      const r = applyAffordability({
        requestedUnits: 0.37,
        pricePerUnit: 100,
        equity: 10_000,
        unitStep: 0.1,
        minUnits: 0.1,
      });
      expect(r.units).toBeCloseTo(0.3, 10);
      expect(r.notional).toBeCloseTo(30, 6);
    });

    it('has no floating-point dust on the boundary (0.1 × 3 must equal 0.3)', () => {
      // `Math.floor(x / 0.1) * 0.1` yields 0.30000000000000004 for a request of 0.3, which is not the
      // number a broker would echo back and not the number a stored run should carry.
      const r = applyAffordability({
        requestedUnits: 0.1 + 0.1 + 0.1,
        pricePerUnit: 100,
        equity: 10_000,
        unitStep: 0.1,
        minUnits: 0.1,
      });
      expect(r.units).toBe(0.3);
    });

    it('refuses a request BELOW the broker minimum rather than rounding up to it', () => {
      // The live path sends the size and the broker rejects it; rounding up would simulate a trade the
      // bot could never have placed, and at a larger size than was asked for.
      const r = applyAffordability({
        requestedUnits: 0.05,
        pricePerUnit: 100,
        equity: 10_000,
        unitStep: 0.1,
        minUnits: 0.1,
      });
      expect(r.refused).toBe(true);
      expect(r.refusedBecause).toContain('smallest tradeable size is 0.1');
    });

    it('reports assumed-whole when no step is known, so the run states its own assumption', () => {
      // ⚠️ The honest default. `null` is UNKNOWN; it must not read as "the broker said 1".
      const r = applyAffordability({
        requestedUnits: 3.9,
        pricePerUnit: 10,
        equity: 10_000,
        unitStep: null,
        minUnits: null,
      });
      expect(r.units).toBe(3);
      expect(r.granularity).toBe('assumed-whole');
      expect(r.unitStepApplied).toBe(1);
    });

    it('keeps whole shares whole — an equity with a 1 step is unchanged by this feature', () => {
      const r = applyAffordability({
        requestedUnits: 4.8,
        pricePerUnit: 250,
        equity: 10_000,
        unitStep: 1,
        minUnits: 1,
      });
      expect(r.units).toBe(4);
      expect(r.granularity).toBe('broker');
    });
  });
});
