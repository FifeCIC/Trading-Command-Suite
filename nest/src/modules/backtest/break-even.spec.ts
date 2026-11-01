/**
 * break-even.spec.ts — canary for the break-even win rate.
 *
 * ⚠️ THE TEST THAT MATTERS MOST IS THE FIRST ONE, and it is a REGRESSION test: the previous
 * implementation reported 88.0% where the truth is 74.9%, because it added a cost to bracket
 * distances that already contained it. That mistake was invisible in the shipped tests — they all
 * asserted the formula rather than the answer — and was only found by computing the same number a
 * second way and comparing.
 *
 * So every case here is written from the ANSWER backwards: an avg win, an avg loss, and the win rate
 * that must follow by one division. If a future edit reintroduces a cost term, these fail.
 */
import { breakEvenFromOutcomes, medianBracket } from './break-even';

const outcomes = (wins: number[], losses: number[]) => ({
  pnlPcts: [...wins, ...losses.map((l) => -Math.abs(l))],
});

describe('breakEvenFromOutcomes', () => {
  /**
   * THE REGRESSION. Measured on run `1bbf1860`: 1,588 trades, avg win +0.97%, avg loss 2.90%,
   * achieved 42.3%. The old geometric implementation said 88.0%; the answer is 74.9%.
   */
  it('reports 74.9% for avg win 0.97 / avg loss 2.90 — NOT the 88.0% the geometric version gave', () => {
    const r = breakEvenFromOutcomes(outcomes([0.97], [2.9]), 42.3);
    expect(r.avgWinPct).toBeCloseTo(0.97, 2);
    expect(r.avgLossPct).toBeCloseTo(2.9, 2);
    expect(r.requiredWinRatePct).toBe(74.9);
    expect(r.gapPp).toBe(-32.6);
    expect(r.profitable).toBe(false);
    // The arithmetic a reader can do by hand: 2.90 / (0.97 + 2.90) = 74.9%.
    expect(r.requiredWinRatePct).toBeCloseTo((2.9 / (0.97 + 2.9)) * 100, 1);
  });

  it('reports 48.8% for avg win 2.99 / avg loss 2.85 — a near-1:1 payoff needs about half', () => {
    const r = breakEvenFromOutcomes(outcomes([2.99], [2.85]), 22.9);
    expect(r.requiredWinRatePct).toBe(48.8);
    expect(r.gapPp).toBe(-25.9);
    expect(r.profitable).toBe(false);
  });

  it('reports a run that CLEARS the bar as profitable (the other direction)', () => {
    const r = breakEvenFromOutcomes(outcomes([2.99], [2.85]), 55);
    expect(r.gapPp).toBe(6.2);
    expect(r.profitable).toBe(true);
  });

  it('treats a gap of exactly zero as NOT profitable — break-even before variance', () => {
    // A 1:1 payoff needs exactly 50%.
    const r = breakEvenFromOutcomes(outcomes([2], [2]), 50);
    expect(r.requiredWinRatePct).toBe(50);
    expect(r.gapPp).toBe(0);
    expect(r.profitable).toBe(false);
  });

  it('averages over the real population, not over two representative numbers', () => {
    // wins +1 and +3 (avg 2); losses 1 and 5 (avg 3) → 3 / (2+3) = 60%.
    const r = breakEvenFromOutcomes(outcomes([1, 3], [1, 5]), 60);
    expect(r.avgWinPct).toBe(2);
    expect(r.avgLossPct).toBe(3);
    expect(r.requiredWinRatePct).toBe(60);
    expect(r.wins).toBe(2);
    expect(r.losses).toBe(2);
  });

  it('REFUSES a run with no wins instead of inventing a requirement', () => {
    const r = breakEvenFromOutcomes(outcomes([], [1.01, 2.5]), 0);
    expect(r.requiredWinRatePct).toBeNull();
    expect(r.unavailable).toBe('no-wins');
    expect(r.avgWinPct).toBeNull();
    expect(r.avgLossPct).not.toBeNull();
    expect(r.profitable).toBeNull();
  });

  it('REFUSES a run with no losses — 100% is not the answer, it is the absence of a question', () => {
    const r = breakEvenFromOutcomes(outcomes([1, 2], []), 100);
    expect(r.requiredWinRatePct).toBeNull();
    expect(r.unavailable).toBe('no-losses');
    expect(r.avgLossPct).toBeNull();
  });

  it('REFUSES an empty run', () => {
    const r = breakEvenFromOutcomes({ pnlPcts: [] }, 0);
    expect(r.requiredWinRatePct).toBeNull();
    expect(r.unavailable).toBe('no-trades');
  });

  it('counts a break-even trade (pnlPct exactly 0) as a LOSS, not a win', () => {
    // `pnlPct > 0` defines a win; 0 made nothing, so it cannot be evidence of an edge.
    const r = breakEvenFromOutcomes({ pnlPcts: [2, 0, -2] }, 33.3);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(2);
    expect(r.avgLossPct).toBe(1);
  });

  it('reports the requirement even when the achieved rate is unknown', () => {
    const r = breakEvenFromOutcomes(outcomes([1], [3]), null);
    expect(r.requiredWinRatePct).toBe(75);
    expect(r.gapPp).toBeNull();
    expect(r.profitable).toBeNull();
  });

  it('ignores non-finite pnl values rather than poisoning every average with NaN', () => {
    const r = breakEvenFromOutcomes({ pnlPcts: [1, Number.NaN, -3, Number.POSITIVE_INFINITY] }, 50);
    expect(r.avgWinPct).toBe(1);
    expect(r.avgLossPct).toBe(3);
    expect(r.requiredWinRatePct).toBe(75);
  });

  it('needs no cost input at all — the same trades give the same answer whatever the spread', () => {
    // The point of the rewrite: cost is already inside `pnlPct`. This test exists so that nobody
    // "improves" the function by adding a cost parameter back.
    const r = breakEvenFromOutcomes(outcomes([1], [3]), 50);
    expect(Object.keys(r)).not.toContain('costPct');
    expect(r.requiredWinRatePct).toBe(75);
  });
});

describe('medianBracket', () => {
  it('reads the bracket from the trades, as percentages of entry', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: 97.5, takeProfit: 103.5 },
      { entryPrice: 200, stopLoss: 195, takeProfit: 207 },
    ]);
    expect(r.stopPct).toBeCloseTo(2.5, 2);
    expect(r.targetPct).toBeCloseTo(3.5, 2);
    expect(r.sample).toBe(2);
  });

  it('mirrors a SHORT bracket correctly — the stop is above, the target below', () => {
    const r = medianBracket([{ entryPrice: 100, stopLoss: 102.5, takeProfit: 96.5 }]);
    expect(r.stopPct).toBeCloseTo(2.5, 2);
    expect(r.targetPct).toBeCloseTo(3.5, 2);
  });

  it('drops trades with no recorded levels and reports the sample it used', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: null, takeProfit: null },
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
    ]);
    expect(r.sample).toBe(1);
    expect(r.stopPct).toBeCloseTo(2, 2);
  });

  it('returns NULL, not zero, when nothing was recorded', () => {
    expect(medianBracket([])).toEqual({ stopPct: null, targetPct: null, sample: 0 });
    expect(medianBracket(null)).toEqual({ stopPct: null, targetPct: null, sample: 0 });
  });

  it('uses the MEDIAN, so one widened stop cannot move the number a reader acts on', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
      { entryPrice: 100, stopLoss: 90, takeProfit: 104 },
    ]);
    expect(r.stopPct).toBeCloseTo(2, 2);
  });
});
