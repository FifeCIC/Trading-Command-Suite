/**
 * MonteCarloService — guards for two #review-2026-10-17 defects.
 *
 * ⚠️ NEITHER GUARD IS ABOUT A LIVE PATH: `MonteCarloService` is injected into RiskController's
 * constructor and never called (`grep 'this.monteCarlo'` returns nothing). These tests exist so
 * that IF it is wired up, the two wrong numbers are already caught.
 *
 * 1. Sharpe annualisation — the ratio was multiplied by `sqrt(tradeCount)` unconditionally,
 *    asserting "this sequence is one year of trades". The guard proves `tradesPerYear` is actually
 *    consumed, by comparing the same sequence under two different annualisation factors.
 *
 * 2. Profit factor — the win/loss totals were accumulated OUTSIDE the iteration loop, so the ratio
 *    converged on the input sequence's own profit factor and carried no simulation information.
 *
 *    ⚠️ HONEST LIMIT — THE PROFIT-FACTOR TESTS BELOW DO NOT CANARY THAT DEFECT. Measured: with
 *    resampling *with replacement*, the median of the per-run factors sits very close to the
 *    aggregate Σwins/Σlosses the old code reported, so no behavioural assertion separates the two
 *    implementations. These tests guard the PROPERTIES (finite, sentinel only when no run can
 *    lose, and directional response to loss size) but they would pass against the old code too.
 *    Only the Sharpe guard in this file is a true canary of a #review-2026-10-17 defect.
 */
import { MonteCarloService } from './monte-carlo.service';

const service = new MonteCarloService();

// A mixed 20-trade sequence: wins and losses both present, so per-run factors are finite.
const MIXED = [12, -8, 15, -10, 7, -5, 9, -3, 14, -6, 11, -9, 8, -4, 13, -7, 6, -5, 10, -8];

describe('MonteCarloService — Sharpe annualisation (#review-2026-10-17)', () => {
  it('scales by tradesPerYear, not by the length of the supplied sequence', () => {
    // 5,000 iterations so the sampled mean/std-dev are stable; the annualisation factor itself is
    // exact, so the ratio of two runs is sqrt(20) / sqrt(1) to within sampling noise.
    const notAnnualised = service.simulate({
      tradePnlSequence: MIXED,
      iterations: 5000,
      tradesPerYear: 1,
    });
    const bySequenceLength = service.simulate({
      tradePnlSequence: MIXED,
      iterations: 5000,
    });

    expect(notAnnualised.metrics.sharpeApproximation).not.toBe(0);
    expect(bySequenceLength.metrics.sharpeApproximation / notAnnualised.metrics.sharpeApproximation)
      .toBeCloseTo(Math.sqrt(MIXED.length), 0);
  });

  it('differs between two tradesPerYear values by exactly their sqrt ratio', () => {
    const oneYear = service.simulate({ tradePnlSequence: MIXED, iterations: 5000, tradesPerYear: 1 });
    const fourYears = service.simulate({ tradePnlSequence: MIXED, iterations: 5000, tradesPerYear: 4 });

    // sqrt(4) / sqrt(1) = 2
    expect(fourYears.metrics.sharpeApproximation / oneYear.metrics.sharpeApproximation)
      .toBeCloseTo(2, 0);
  });
});

describe('MonteCarloService — profit factor is a per-run statistic (#review-2026-10-17)', () => {
  it('is finite and positive for a mixed sequence', () => {
    const result = service.simulate({ tradePnlSequence: MIXED, iterations: 2000 });

    expect(Number.isFinite(result.metrics.profitFactor)).toBe(true);
    expect(result.metrics.profitFactor).toBeGreaterThan(0);
  });

  it('reports the no-loss sentinel only when no run can lose', () => {
    const allWins = service.simulate({
      tradePnlSequence: [1, 2, 3, 4, 5, 6],
      iterations: 500,
    });

    // Every sampled run is all-wins ⇒ every per-run factor hits the 999 cap ⇒ the median is 999.
    expect(allWins.metrics.profitFactor).toBe(999);
  });

  it('does not simply restate the input sequence ratio', () => {
    // The old aggregate form was exactly Σwins/Σlosses. Turning every loss into a smaller loss
    // must move the per-run median in the same direction — this asserts the value is derived from
    // the runs at all, rather than being a constant independent of them.
    const softLosses = service.simulate({
      tradePnlSequence: [10, -1, 10, -1, 10, -1, 10, -1],
      iterations: 2000,
    });
    const hardLosses = service.simulate({
      tradePnlSequence: [10, -9, 10, -9, 10, -9, 10, -9],
      iterations: 2000,
    });

    expect(softLosses.metrics.profitFactor).toBeGreaterThan(hardLosses.metrics.profitFactor);
  });
});
