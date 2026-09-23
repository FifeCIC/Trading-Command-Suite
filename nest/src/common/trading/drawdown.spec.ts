import { computeDrawdownDetail } from './drawdown';

/**
 * #954 — the BOUNDED-RATIO canary.
 *
 * ⚠️ THE DEFECT THESE TESTS PIN. #950 fixed the percentage's unit and its peak-start, but
 * `peak > 0` does not bound a ratio: a window that reaches a TINY positive cumulative (+£0.03)
 * and falls £0.47 reports **1566.7%**. Four ordinary shapes were measured on 2026-09-22: 1566.7,
 * 1680, 1800, 2050 — all above 100%, which means the denominator (peak P&L) is not a capital base.
 * A figure that absurd on a RISK surface trains the reader to ignore the warning, and the risk
 * circuit breaker can trip on it (which it did — measured live, 1611.5%).
 *
 * THE RULE (settled #954): `pctOfPeak` is stated ONLY when the arithmetic is possible —
 * `peak > 0` AND `currency <= peak`. Anything else is `null`, with the currency figure always
 * present. The canary fires without needing the cause to be understood: it rejects exactly the
 * arithmetic signature `currency > peak`.
 *
 * Canary directions (both observed 2026-09-23): with `&& best.currency <= best.peak` removed from
 * `drawdown.ts`, the first test FAILS; restored, the suite PASSES.
 */
describe('computeDrawdownDetail — bounded ratio (#954)', () => {
  const t = (pnl: number, day: number) => ({ pnl, closedAt: new Date(Date.UTC(2026, 8, day)) });

  it('⭐ CANARY — the four impossible shapes from #954 report NULL, never 1,600%+', () => {
    // #950's own reported shape: a 0.47 fall below a 0.03 peak.
    expect(computeDrawdownDetail([t(-0.47, 2), t(0.03, 1)]).pctOfPeak).toBeNull();
    // The GBPCAD shape measured live: 1.68 below a 0.10 peak.
    expect(computeDrawdownDetail([t(-1.68, 2), t(0.1, 1)]).pctOfPeak).toBeNull();
    // +0.05 then −0.90.
    expect(computeDrawdownDetail([t(-0.9, 2), t(0.05, 1)]).pctOfPeak).toBeNull();
    // +2, −1, −40.
    expect(computeDrawdownDetail([t(-40, 3), t(-1, 2), t(2, 1)]).pctOfPeak).toBeNull();
  });

  it('a sane portfolio keeps its bounded percentage — 150 below a 500 peak is 30%', () => {
    // cums: 400, 500, 350 → peak 500, worst fall 150.
    const dd = computeDrawdownDetail([t(-150, 3), t(100, 2), t(400, 1)]);
    expect(dd.peak).toBe(500);
    expect(dd.currency).toBe(150);
    expect(dd.pctOfPeak).toBe(30);
  });

  it('the boundary is INCLUSIVE at 100% — a fall equal to the peak is stated, not hidden', () => {
    // +50 then −50: cums 50, 0 → currency 50 == peak 50 → exactly 100%.
    const dd = computeDrawdownDetail([t(-50, 2), t(50, 1)]);
    expect(dd.currency).toBe(50);
    expect(dd.peak).toBe(50);
    expect(dd.pctOfPeak).toBe(100);
  });

  it('a non-positive peak never divides — the #950 half of the rule, kept', () => {
    // A window that never rose above zero (cums −5, −35) has no denominator at all.
    expect(computeDrawdownDetail([t(-30, 2), t(-5, 1)]).pctOfPeak).toBeNull();
    // A window that falls to zero from a +5 peak (cums +5, 0) is exactly 100% — stated, not hidden.
    expect(computeDrawdownDetail([t(-5, 2), t(5, 1)]).pctOfPeak).toBe(100);
  });

  it('the currency figure is ALWAYS stated — only the percentage is conditional', () => {
    const dd = computeDrawdownDetail([t(-0.9, 2), t(0.05, 1)]);
    expect(dd.currency).toBe(0.9);  // cums 0.05, −0.85 → fall 0.90, always true
    expect(dd.pctOfPeak).toBeNull();
  });
});
