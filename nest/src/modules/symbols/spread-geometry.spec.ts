import { spreadGeometry } from './spread-geometry';

/**
 * canary: revert `eatsShareOfOnePctMove` to `spreadPct / 100` (the first cut) and the VIX case fails.
 * Values below are the ones MEASURED from broker 3 on 2026-10-29 — not invented.
 */
describe('spreadGeometry', () => {
  it('VIX — 0.9297% spread on an 18-point index is 17 ticks and eats 93% of a 1% move', () => {
    const g = spreadGeometry({ spreadPct: 0.9297, spreadAbs: 0.17, digits: 2 });
    expect(g.tickSize).toBe(0.01);
    expect(g.ticks).toBe(17);
    expect(g.eatsShareOfOnePctMove).toBe(0.9297);
  });

  it('US500 — 0.0052% is 4 ticks and eats about half a percent of a 1% move', () => {
    const g = spreadGeometry({ spreadPct: 0.0052, spreadAbs: 0.4, digits: 1 });
    expect(g.tickSize).toBe(0.1);
    expect(g.ticks).toBe(4);
    expect(g.eatsShareOfOnePctMove).toBeCloseTo(0.0052, 4);
  });

  it('an unmeasured spread yields nulls, never a zero that reads as free', () => {
    const g = spreadGeometry({ spreadPct: null, spreadAbs: null, digits: 2 });
    expect(g.ticks).toBeNull();
    expect(g.eatsShareOfOnePctMove).toBeNull();
  });

  it('spreadAbs present but digits unknown cannot produce a tick count', () => {
    const g = spreadGeometry({ spreadPct: 0.05, spreadAbs: 0.17, digits: null });
    expect(g.tickSize).toBeNull();
    expect(g.ticks).toBeNull();
    expect(g.eatsShareOfOnePctMove).toBeCloseTo(0.05, 4);
  });
});
