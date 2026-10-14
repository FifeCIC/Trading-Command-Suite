/**
 * PnlStatisticsService — expectancy correctness tests.
 *
 * ⚠️ WHY EXPECTANCY, NOT WIN RATE, IS TESTED HARDEST
 * The single most dangerous error in this file would be computing a POSITIVE expectancy for a
 * losing system — it would tell the owner to keep building when they should stop. That happens
 * the moment `avgLoss` is treated as a positive magnitude. The sign cases below exist
 * specifically to make that error fail loudly.
 */
import { bucket, reliabilityFor, isAbTestRow } from './pnl-statistics.service';

/**
 * #1120 — the live/test population split.
 *
 * ⚠️ WHY THIS IS TESTED AT ALL. The split's whole job is to stop a whole-book figure being read as
 * the strategy's result. Measured 2026-10-14: A/B arms were 23 trades (7% of the count) and 80% of
 * the loss, while live bots ran at −£0.35/trade. **If `isAbTestRow` under-reports, the split says
 * "all live" and the contamination is invisible — with no error**, which is precisely the defect
 * the split exists to reveal. So the both-directions cases below are load-bearing.
 */
describe('isAbTestRow — which population is this trade in?', () => {
  it('detects by the REAL attribution (`abTestId`)', () => {
    expect(isAbTestRow({ abTestId: 'b50727ee-1', strategy: 'Gold Macro Position' })).toBe(true);
  });

  it('detects by the strategy prefix, which is what the records actually carry today', () => {
    expect(isAbTestRow({ abTestId: null, strategy: 'AB-A #929 measurable run - tradeThreshold 55' })).toBe(true);
    expect(isAbTestRow({ abTestId: null, strategy: 'AB-B 929 XAU M15 - group vs maxscore weighting' })).toBe(true);
  });

  it('does NOT swallow a live bot whose name merely contains those letters', () => {
    // The prefix is ANCHORED. 'Gold AB-Scalp' is a live bot; a substring test would misfile it and
    // silently move its P&L into the instrument bucket.
    expect(isAbTestRow({ abTestId: null, strategy: 'Gold AB-Scalp' })).toBe(false);
    expect(isAbTestRow({ abTestId: null, strategy: 'ABX Momentum' })).toBe(false);
    expect(isAbTestRow({ abTestId: null, strategy: 'Gold Macro Position' })).toBe(false);
  });

  it('treats a missing field as LIVE, never as A/B — the safe direction', () => {
    // ⚠️ Defaulting the other way would hide live trades inside the instrument bucket and make the
    // strategy look better than it is. Under-reporting the instrument is the conservative error.
    expect(isAbTestRow({})).toBe(false);
    expect(isAbTestRow({ abTestId: null, strategy: null })).toBe(false);
    expect(isAbTestRow({ abTestId: '', strategy: '' })).toBe(false);
    expect(isAbTestRow({ abTestId: undefined, strategy: undefined })).toBe(false);
  });

  it('the two populations partition the rows — nothing is counted twice or dropped', () => {
    const rows = [
      { abTestId: 't1', strategy: 'AB-A x' },
      { abTestId: null, strategy: 'Gold Macro Position' },
      { abTestId: null, strategy: 'AB-B y' },
      { abTestId: null, strategy: 'forex-session-v1' },
    ];
    const ab = rows.filter(isAbTestRow);
    const live = rows.filter((r) => !isAbTestRow(r));
    expect(ab.length + live.length).toBe(rows.length);
    expect(ab.every((r) => /^AB-/.test(r.strategy) || r.abTestId != null)).toBe(true);
  });
});

describe('bucket — the population split reports the same arithmetic as the whole book', () => {
  it('live + abTest buckets account for the whole book', () => {
    const all = [100, -50, 20, -300, 5, -10];
    const abRows = [20, -300];
    const liveRows = all.filter((p) => !abRows.includes(p));
    const live = bucket('LIVE BOTS', liveRows);
    const ab = bucket('A/B TEST', abRows);
    // The split must not lose or invent money — a mismatch here means a row was misfiled.
    expect(live.totalPnl + ab.totalPnl).toBeCloseTo(bucket('ALL', all).totalPnl, 6);
    expect(live.trades + ab.trades).toBe(6);
    // …and each row landed on exactly one side, so neither bucket is empty by accident.
    expect(ab.trades).toBe(2);
    expect(live.trades).toBe(4);
  });
});

describe('bucket — expectancy sign correctness', () => {
  it('computes positive expectancy for a genuinely profitable book', () => {
    // 6 wins of +100, 4 losses of -50  =>  0.6*100 + 0.4*(-50) = +40
    const r = bucket('x', [100, 100, 100, 100, 100, 100, -50, -50, -50, -50]);
    expect(r.expectancy).toBeCloseTo(40, 6);
    expect(r.winRate).toBeCloseTo(0.6, 6);
    expect(r.totalPnl).toBeCloseTo(400, 6);
  });

  it('computes NEGATIVE expectancy for a high-win-rate losing system', () => {
    // 70% win rate but small wins / big losses: 7 x +10, 3 x -100 => 7 - 30 = -23
    const r = bucket('x', [10, 10, 10, 10, 10, 10, 10, -100, -100, -100]);
    expect(r.winRate).toBeCloseTo(0.7, 6);
    expect(r.expectancy).toBeCloseTo(-23, 6);
    // The whole point: a 70% win rate must NOT read as success.
    expect(r.expectancy).toBeLessThan(0);
  });

  it('keeps avgLoss NEGATIVE (sign contract)', () => {
    const r = bucket('x', [10, -20, -30]);
    expect(r.avgLoss).toBeLessThan(0);
    expect(r.avgWin).toBeGreaterThan(0);
  });

  it('reports zero expectancy for a symmetric book', () => {
    const r = bucket('x', [50, -50]);
    expect(r.expectancy).toBeCloseTo(0, 6);
  });

  it('handles all-wins without dividing by zero', () => {
    const r = bucket('x', [10, 20, 30]);
    expect(Number.isFinite(r.expectancy)).toBe(true);
    expect(r.expectancy).toBeCloseTo(20, 6);
    expect(r.profitFactor).toBe(999); // finite sentinel, not Infinity
  });

  it('handles all-losses', () => {
    const r = bucket('x', [-10, -20]);
    expect(r.expectancy).toBeCloseTo(-15, 6);
    expect(r.profitFactor).toBe(0);
  });

  it('handles a single trade', () => {
    const r = bucket('x', [42]);
    expect(r.expectancy).toBeCloseTo(42, 6);
    expect(r.standardError).toBe(0);
  });

  it('never returns Infinity for profitFactor (JSON would turn it into null)', () => {
    const r = bucket('x', [5, 5]);
    expect(Number.isFinite(r.profitFactor)).toBe(true);
  });

  it('computes profitFactor as gross profit / gross loss', () => {
    const r = bucket('x', [100, 100, -50]);
    expect(r.profitFactor).toBeCloseTo(4, 6); // 200 / 50
  });
});

describe('reliabilityFor — refusing to over-claim', () => {
  it('is always noise below 20 trades regardless of how good the numbers look', () => {
    expect(reliabilityFor(5, 1000, 0.01)).toBe('noise');
    expect(reliabilityFor(19, 1000, 0.01)).toBe('noise');
  });

  it('is noise when the estimate sits inside its own error bars', () => {
    // |10| / 20 = 0.5  ->  t < 1
    expect(reliabilityFor(100, 10, 20)).toBe('noise');
  });

  it('reaches strong only with a large sample AND a clear signal', () => {
    expect(reliabilityFor(500, 10, 2)).toBe('strong');
  });

  it('caps at weak for a strong signal on a modest sample', () => {
    expect(reliabilityFor(30, 10, 0.1)).toBe('weak');
  });

  it('caps at moderate below 200 trades even with a clear signal', () => {
    expect(reliabilityFor(100, 10, 1)).toBe('moderate');
  });
});
