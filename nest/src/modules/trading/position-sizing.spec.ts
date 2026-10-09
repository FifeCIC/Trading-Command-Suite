/**
 * #843 — the sizing model, proved as a MODEL, not "a trade happened".
 *
 * The load-bearing test is `equal risk on two very different instruments`: the whole point of the
 * issue is that 0.01 lots of EURUSD and 0.01 lots of gold are not the same risk, so a spec that
 * only checks "volume > 0" would pass for the broken behaviour it replaces. This one computes the
 * MONEY RISK each resulting order actually takes and asserts the two land within one volume step
 * of each other — and, for contrast, that the old fixed-lot path does not.
 *
 * Boundaries are pinned both directions on purpose: below/above the step, exactly at min, exactly
 * at max, float noise at a step boundary (0.3 / 0.1), and every UNKNOWN input (equity, step, min,
 * tick value) which must REFUSE rather than guess — an unknown is not a zero.
 */
import {
  computeSizing,
  applyVolumeConstraints,
  valuePerPriceUnitPerLot,
} from './position-sizing';

describe('#843 computeSizing — the model maths', () => {
  it('atrEqualRisk: two very different instruments risk the SAME fraction of equity', () => {
    const equity = 10_000;
    const riskPct = 1; // $100 to lose on either symbol, if sizing is really equal-risk

    // XAUUSD-like: 1.0 of price = $100 per lot (tickSize 0.01 × tickValue 1.0 × 100... i.e. tickValue/tickSize = 100)
    const goldPerLot = valuePerPriceUnitPerLot(1.0, 0.01)!;    // $100 per 1.0 price move per lot
    const goldStop = 2400 * 0.01;                               // 1% stop on a $2400 price
    const gold = computeSizing({ model: 'atrEqualRisk', equity, riskPct, entryPrice: 2400, stopDistance: goldStop });
    const goldLots = applyVolumeConstraints(gold.rawSize! / goldPerLot, { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 });
    const goldMoneyRisk = goldLots.volume! * goldStop * goldPerLot;

    // EURUSD-like: 1.0 of price = $100,000 per lot
    const fxPerLot = valuePerPriceUnitPerLot(1.0, 0.00001)!;   // $100,000 per 1.0 price move per lot
    const fxStop = 1.10 * 0.01;                                 // 1% stop on a $1.10 price
    const fx = computeSizing({ model: 'atrEqualRisk', equity, riskPct, entryPrice: 1.10, stopDistance: fxStop });
    const fxLots = applyVolumeConstraints(fx.rawSize! / fxPerLot, { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 });
    const fxMoneyRisk = fxLots.volume! * fxStop * fxPerLot;

    // Both near the $100 target — within 15% (the difference is step-flooring, not the model).
    expect(goldMoneyRisk).toBeGreaterThan(equity * 0.01 * 0.85);
    expect(goldMoneyRisk).toBeLessThan(equity * 0.01 * 1.15);
    expect(fxMoneyRisk).toBeGreaterThan(equity * 0.01 * 0.85);
    expect(fxMoneyRisk).toBeLessThan(equity * 0.01 * 1.15);

    // CONTRAST — what the pre-#843 path did: same 0.01 lot on both. The gold order would risk
    // 0.01 × 24 × 100 = $24, the FX order 0.01 × 0.011 × 100000 = $11 — i.e. neither is 1% of
    // $10,000, and they are not equal to each other. This is the defect, stated as arithmetic.
    const goldOldRisk = 0.01 * goldStop * goldPerLot; //   $24
    const fxOldRisk = 0.01 * fxStop * fxPerLot;       //   $11
    expect(Math.abs(goldOldRisk - fxOldRisk)).toBeGreaterThan(10); // not equal
    expect(Math.abs(goldOldRisk - 100)).toBeGreaterThan(50);       // and not the configured 1%
  });

  it('fixedPercent: raw = equity × riskPct% ÷ stop distance', () => {
    const r = computeSizing({ model: 'fixedPercent', equity: 10_000, riskPct: 2, entryPrice: 100, stopDistance: 5 });
    expect(r.rawSize).toBeCloseTo((10_000 * 0.02) / 5, 10); // 40 units
    expect(r.usedStopDistance).toBe(5);
  });

  it('fixedPercent: no usable stop falls back to the entry price (denominator recorded)', () => {
    const r = computeSizing({ model: 'fixedPercent', equity: 10_000, riskPct: 2, entryPrice: 100, stopDistance: null });
    expect(r.rawSize).toBeCloseTo((10_000 * 0.02) / 100, 10);
    expect(r.usedStopDistance).toBeNull();
  });

  it('fixedDollar: raw = amount ÷ entry price', () => {
    const r = computeSizing({ model: 'fixedDollar', equity: 10_000, entryPrice: 250, fixedAmount: 500 });
    expect(r.rawSize).toBeCloseTo(2, 10);
  });

  it('fixedLot: returns the lot unchanged and needs nothing else', () => {
    const r = computeSizing({ model: 'fixedLot', fixedLot: 0.07 });
    expect(r.rawSize).toBe(0.07);
    expect(r.unusable).toBeNull();
  });

  it('kelly: neutral prior can REFUSE (no edge) — a caller-visible state, not a number', () => {
    // tp 1% vs sl 2% → b = 0.5 → f = (0.25 − 0.5)/0.5 = −0.5 → no edge at the 50% prior.
    const r = computeSizing({ model: 'kellyFull', equity: 10_000, entryPrice: 100, tpPct: 1, slPct: 2 });
    expect(r.rawSize).toBeNull();
    expect(r.unusable?.code).toBe('SIZING-KELLY-NO-EDGE');
  });

  it('kelly: positive edge is capped, and kellyHalf halves the capped fraction', () => {
    // b = 3 → f = (1.5 − 0.5)/3 = 0.3333 → capped at 25% → raw = equity × 0.25 / price.
    const full = computeSizing({ model: 'kellyFull', equity: 10_000, entryPrice: 100, tpPct: 3, slPct: 1, kellyCapPct: 25 });
    expect(full.rawSize).toBeCloseTo((10_000 * 0.25) / 100, 10);
    const half = computeSizing({ model: 'kellyHalf', equity: 10_000, entryPrice: 100, tpPct: 3, slPct: 1, kellyCapPct: 25 });
    expect(half.rawSize).toBeCloseTo((10_000 * 0.125) / 100, 10);
  });

  it('unknown inputs REFUSE with a named code — never a guessed default', () => {
    expect(computeSizing({ model: 'fixedPercent', equity: null, riskPct: 1, entryPrice: 100 }).unusable?.code).toBe('SIZING-NO-EQUITY');
    expect(computeSizing({ model: 'fixedPercent', equity: 1000, riskPct: null, entryPrice: 100 }).unusable?.code).toBe('SIZING-NO-RISK-PCT');
    expect(computeSizing({ model: 'atrEqualRisk', equity: 1000, riskPct: 1, entryPrice: 100 }).unusable?.code).toBe('SIZING-NO-STOP');
    expect(computeSizing({ model: 'kellyFull', equity: 1000, entryPrice: 100, tpPct: null, slPct: 1 }).unusable?.code).toBe('SIZING-NO-TPSL');
  });
});

describe('#843 applyVolumeConstraints — broker facts, not maths', () => {
  it('rounds DOWN to the step', () => {
    const r = applyVolumeConstraints(0.047, { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 });
    expect(r).toMatchObject({ ok: true, volume: 0.04, action: 'rounded' });
  });

  it('float noise at a step boundary does NOT lose a whole step (0.3 ÷ 0.1)', () => {
    const r = applyVolumeConstraints(0.3, { volumeMin: 0.1, volumeMax: 50, volumeStep: 0.1 });
    expect(r.volume).toBe(0.3); // naive Math.floor(0.3/0.1) yields 0.2
  });

  it('raises to the minimum and says so', () => {
    const r = applyVolumeConstraints(0.003, { volumeMin: 0.1, volumeMax: 50, volumeStep: 0.01 });
    expect(r).toMatchObject({ ok: true, volume: 0.1, action: 'raised-to-min' });
  });

  it('caps at the maximum and says so', () => {
    const r = applyVolumeConstraints(5, { volumeMin: 0.01, volumeMax: 2, volumeStep: 0.01 });
    expect(r).toMatchObject({ ok: true, volume: 2, action: 'capped-at-max' });
  });

  it('volumeMax 0/absent = NO CEILING (the bridge\u2019s own `volume_max > 0` semantics)', () => {
    const r = applyVolumeConstraints(5, { volumeMin: 0.01, volumeMax: 0, volumeStep: 0.01 });
    expect(r).toMatchObject({ ok: true, volume: 5, action: 'rounded' });
  });

  it('UNKNOWN step or minimum refuses with TCS-TRADE-023 — never a guess', () => {
    const noStep = applyVolumeConstraints(0.05, { volumeMin: 0.01, volumeMax: 50, volumeStep: null });
    expect(noStep.ok).toBe(false);
    expect(noStep.noticeCode).toBe('TCS-TRADE-023');
    const noMin = applyVolumeConstraints(0.05, { volumeMin: null, volumeMax: 50, volumeStep: 0.01 });
    expect(noMin.ok).toBe(false);
    expect(noMin.noticeCode).toBe('TCS-TRADE-023');
  });

  it('impossible constraints (max < min) refuse rather than trade a wrong size', () => {
    const r = applyVolumeConstraints(1, { volumeMin: 5, volumeMax: 2, volumeStep: 0.01 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('impossible');
  });

  it('non-finite or non-positive raw refuses', () => {
    expect(applyVolumeConstraints(0, { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 }).ok).toBe(false);
    expect(applyVolumeConstraints(NaN, { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 }).ok).toBe(false);
  });
});

describe('#843 valuePerPriceUnitPerLot', () => {
  it('converts tick value + tick size into money per 1.0 price move per lot', () => {
    expect(valuePerPriceUnitPerLot(1.0, 0.00001)).toBeCloseTo(100_000, 6);
    expect(valuePerPriceUnitPerLot(1.0, 0.01)).toBeCloseTo(100, 6);
  });

  it('UNKNOWN when either half is missing or zero — callers must refuse, not assume 1', () => {
    expect(valuePerPriceUnitPerLot(null, 0.01)).toBeNull();
    expect(valuePerPriceUnitPerLot(1.0, null)).toBeNull();
    expect(valuePerPriceUnitPerLot(1.0, 0)).toBeNull();
  });
});
