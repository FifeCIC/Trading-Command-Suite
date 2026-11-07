/**
 * exit-quality.spec.ts — the numbers must be in ONE unit before they are compared (#1149).
 *
 * ⚠️ THE TRAP THIS FILE EXISTS FOR. A `trade` row carries `peakProfitPct` (a PERCENT of entry) and
 * `pnl` (CURRENCY). The tempting implementation subtracts one from the other and prints a
 * "give-back" that is a mixture of percent and pounds — plausible-looking, meaningless, and exactly
 * the failure shape this repo keeps re-finding.
 *
 * Every case below therefore pins the UNIT, and the sign, in both directions.
 */
import { computeExitQuality, normaliseSide, realisedPct } from './exit-quality';

describe('normaliseSide', () => {
  it('understands both spellings the broker and the app use', () => {
    expect(normaliseSide('buy')).toBe('long');
    expect(normaliseSide('BUY')).toBe('long');
    expect(normaliseSide('long')).toBe('long');
    expect(normaliseSide('sell')).toBe('short');
    expect(normaliseSide('SHORT')).toBe('short');
  });

  it('refuses to guess', () => {
    expect(normaliseSide(null)).toBe('unknown');
    expect(normaliseSide('')).toBe('unknown');
    expect(normaliseSide('sideways')).toBe('unknown');
  });
});

describe('realisedPct — a percentage of the entry price, side-aware', () => {
  it('a long that rose 1% reads +1', () => {
    expect(realisedPct('long', 100, 101)).toBe(1);
  });

  it('a short that fell 1% reads +1, not -1', () => {
    expect(realisedPct('short', 100, 99)).toBe(1);
  });

  it('a short that rose 1% reads -1', () => {
    expect(realisedPct('short', 100, 101)).toBe(-1);
  });

  it('the two sides are exact negations', () => {
    for (const exit of [90, 99.5, 100.01, 150]) {
      expect(realisedPct('long', 100, exit)).toBe(-(realisedPct('short', 100, exit) as number));
    }
  });

  it('absent prices, a zero entry, or an unknown side are null — never 0', () => {
    expect(realisedPct('long', 100, null)).toBeNull();
    expect(realisedPct('long', null, 101)).toBeNull();
    expect(realisedPct('long', 0, 101)).toBeNull();
    expect(realisedPct('unknown', 100, 101)).toBeNull();
  });
});

describe('computeExitQuality', () => {
  const row = (over: Partial<Parameters<typeof computeExitQuality>[0][number]> = {}) => ({
    symbol: 'VIX',
    side: 'buy',
    entryPrice: 100,
    exitPrice: 101,
    peakProfitPct: 2,
    closeReason: 'broker:tp',
    strategy: 'vix-spike-v1-short',
    pnlInvalid: 0,
    ...over,
  });

  it('give-back is peak MINUS realised, both in percent', () => {
    // Peaked at +2.00%, closed at +1.00% → 1.00 given back.
    const r = computeExitQuality([row({ peakProfitPct: 2, exitPrice: 101 })]);
    expect(r.overall.nComparable).toBe(1);
    expect(r.overall.avgPeakPct).toBe(2);
    expect(r.overall.avgRealisedPct).toBe(1);
    expect(r.overall.avgGiveBackPct).toBe(1);
  });

  it('counts the owner question directly: peaked positive, closed at or below zero', () => {
    // ⚠️ MY FIRST VERSION OF THIS FIXTURE WAS WRONG, and it is worth keeping on the record: I wrote
    // `side: 'sell', exitPrice: 100.06` and called it "+0.06% still positive". For a SHORT a price
    // that RISES from 100 to 100.06 is a LOSS of 0.06%. The real VIX row carried `pnl = +0.06`,
    // which is CURRENCY — the same confusion this whole module exists to prevent. A short profits
    // when the price FALLS, so the profitable one is priced BELOW entry.
    const r = computeExitQuality([
      row({ peakProfitPct: 2.85, exitPrice: 99.94, side: 'sell' }), // short, +0.06% → still positive
      row({ peakProfitPct: 2.79, exitPrice: 100.03, side: 'sell' }), // short, -0.03% → lost
    ]);
    expect(r.overall.peakedThenLost).toBe(1);
  });

  it('flags a trade that captured under half of a positive peak', () => {
    // peak 4, realised 1 → captured 25%
    const r = computeExitQuality([row({ peakProfitPct: 4, exitPrice: 101 })]);
    expect(r.overall.capturedUnderHalf).toBe(1);
  });

  it('a trade that captured most of its peak is NOT flagged', () => {
    const r = computeExitQuality([row({ peakProfitPct: 2, exitPrice: 101.9 })]); // 1.9 of 2.0
    expect(r.overall.capturedUnderHalf).toBe(0);
  });

  // ⚠️ COVERAGE IS THE POINT. Most of the history has no peak, so an average over `n` would be a
  // fiction. The bucket must report both denominators.
  it('averages over the rows that HAVE the measurement, and reports both counts', () => {
    const r = computeExitQuality([
      row({ peakProfitPct: 2 }),
      row({ peakProfitPct: 4 }),
      row({ peakProfitPct: null }), // no peak — must not drag any average
      row({ peakProfitPct: null }),
    ]);
    expect(r.overall.n).toBe(4);
    expect(r.overall.nWithPeak).toBe(2);
    expect(r.overall.avgPeakPct).toBe(3); // (2+4)/2, not /4
    expect(r.overall.nComparable).toBe(2);
  });

  it('a row with no peak still contributes a realised percentage', () => {
    const r = computeExitQuality([row({ peakProfitPct: null, exitPrice: 102 })]);
    expect(r.overall.nWithPeak).toBe(0);
    expect(r.overall.nWithRealised).toBe(1);
    expect(r.overall.avgPeakPct).toBeNull();
    expect(r.overall.avgRealisedPct).toBe(2);
  });

  it('excludes pnlInvalid rows and says how many it excluded', () => {
    const r = computeExitQuality([row(), row({ pnlInvalid: 1, peakProfitPct: 99 })]);
    expect(r.overall.n).toBe(1);
    expect(r.exclusions.pnlInvalid).toBe(1);
    // A fabricated row must not be able to move the average.
    expect(r.overall.avgPeakPct).toBe(2);
  });

  it('counts rows it could not price, rather than silently dropping them', () => {
    const r = computeExitQuality([row({ exitPrice: null })]);
    expect(r.exclusions.noPrices).toBe(1);
    expect(r.overall.n).toBe(1);
    expect(r.overall.nWithRealised).toBe(0);
  });

  it('groups by close reason and strategy, naming unrecorded values', () => {
    const r = computeExitQuality([
      row({ closeReason: 'broker:tp' }),
      row({ closeReason: 'system:time-stop', peakProfitPct: 1 }),
      row({ closeReason: null, strategy: null }),
    ]);
    expect(r.byCloseReason.map((b) => b.closeReason)).toContain('(unrecorded)');
    expect(r.byStrategy.map((b) => b.strategy)).toContain('(unassigned)');
    const tp = r.byCloseReason.find((b) => b.closeReason === 'broker:tp');
    expect(tp?.n).toBe(1);
  });

  it('an empty input is an empty result, not a zero average', () => {
    const r = computeExitQuality([]);
    expect(r.overall.n).toBe(0);
    expect(r.overall.avgPeakPct).toBeNull();
    expect(r.overall.avgGiveBackPct).toBeNull();
  });

  /**
   * ⚠️ "REACHED" IS THE DISCRIMINATOR, AND ITS DENOMINATOR IS THE MEASURED ROWS ONLY (#1149 follow-up).
   *
   * Measured 2026-11-07: of 139 trades carrying a peak, only **15 (10.8%)** ever moved more than 0.5%
   * in their favour — and those 15 came from two strategies on two symbols, while the session bots
   * produced none across ~24 measured trades. That is why this count exists: the average give-back
   * was a distraction (mostly ±0.2% noise), and "did the position MOVE at all?" is the question with
   * an answer in it.
   */
  it('counts only peaks ABOVE the threshold, not at it', () => {
    const r = computeExitQuality(
      [row({ peakProfitPct: 0.5 }), row({ peakProfitPct: 0.51 }), row({ peakProfitPct: 2 })],
      0.5,
    );
    expect(r.overall.reached).toBe(2);
    expect(r.overall.reachedPct).toBe(66.7); // 2 of 3 measured
  });

  it('reachedPct divides by the MEASURED rows, never by n', () => {
    const r = computeExitQuality(
      [row({ peakProfitPct: 2 }), row({ peakProfitPct: null }), row({ peakProfitPct: null })],
      0.5,
    );
    expect(r.overall.n).toBe(3);
    expect(r.overall.nWithPeak).toBe(1);
    expect(r.overall.reachedPct).toBe(100); // 1 of 1 measured, NOT 33% of 3
  });

  // ⚠️ THE DISTINCTION THAT MATTERS. "None of them moved" and "we never measured" are different
  // statements, and a 0 here would let a reader conclude the first when the truth is the second.
  it('a bucket with NO measured peaks reports null, not 0%', () => {
    const r = computeExitQuality([row({ peakProfitPct: null })], 0.5);
    expect(r.overall.nWithPeak).toBe(0);
    expect(r.overall.reachedPct).toBeNull();
    expect(r.overall.reached).toBe(0);
  });

  it('the threshold is configurable, so a different bar can be measured', () => {
    const rows = [row({ peakProfitPct: 1 }), row({ peakProfitPct: 3 })];
    expect(computeExitQuality(rows, 0.5).overall.reached).toBe(2);
    expect(computeExitQuality(rows, 2).overall.reached).toBe(1);
    expect(computeExitQuality(rows, 5).overall.reached).toBe(0);
  });

  it('reports reached per strategy, which is where the separation actually is', () => {
    const r = computeExitQuality(
      [
        row({ strategy: 'mover', peakProfitPct: 2 }),
        row({ strategy: 'mover', peakProfitPct: 3 }),
        row({ strategy: 'drifter', peakProfitPct: 0.1 }),
        row({ strategy: 'drifter', peakProfitPct: 0.2 }),
      ],
      0.5,
    );
    const mover = r.byStrategy.find((b) => b.strategy === 'mover');
    const drifter = r.byStrategy.find((b) => b.strategy === 'drifter');
    expect(mover?.reachedPct).toBe(100);
    expect(drifter?.reachedPct).toBe(0);
  });

  /**
   * ⚠️ THE BAR-DERIVED MAXIMUM, AND WHY IT IS A SEPARATE COLUMN (#1149 follow-up).
   *
   * Measured 2026-11-07 against `marketbar` on 40 trades: **19 understated** the true maximum by
   * more than 0.1pp and **0 overstated** it. On VIX the stored peak read 1.04% where the bars showed
   * **8.52%**; on GER40 and GBPUSD the two agreed to 0.05pp. So `reached 0.5%` measured on the stored
   * peak means something different on each instrument, and the bar figure is the one that can be
   * compared across them.
   *
   * ⚠️ The two are NOT merged. A row with bars and no stored peak must not borrow the stored
   * figure's denominator, or the bias the column exists to expose is reintroduced.
   */
  it('reports the bar-derived maximum beside the stored peak, not in place of it', () => {
    const r = computeExitQuality([
      row({ peakProfitPct: 1.04, barMaxPct: 8.52 }),
      row({ peakProfitPct: 0.23, barMaxPct: 0.28 }),
    ]);
    expect(r.overall.avgPeakPct).toBe(0.635); // the RECORD
    expect(r.overall.avgBarMaxPct).toBe(4.4); // the MEASUREMENT
    expect(r.overall.nWithBarMax).toBe(2);
  });

  it('counts bar-reached separately, so the bias is visible in the counts', () => {
    const r = computeExitQuality(
      [
        row({ peakProfitPct: 0.1, barMaxPct: 5 }), // stored says "never moved", bars say otherwise
        row({ peakProfitPct: 0.2, barMaxPct: 0.2 }),
      ],
      0.5,
    );
    expect(r.overall.reached).toBe(0); // by the record
    expect(r.overall.reachedBars).toBe(1); // by the measurement
    expect(r.overall.reachedBarsPct).toBe(50);
  });

  it('a row with no bars is null on the bar side, never 0', () => {
    const r = computeExitQuality([row({ peakProfitPct: 2, barMaxPct: null })], 0.5);
    expect(r.overall.nWithBarMax).toBe(0);
    expect(r.overall.avgBarMaxPct).toBeNull();
    expect(r.overall.reachedBarsPct).toBeNull();
    // ...and the stored side is untouched by the absence of bars
    expect(r.overall.avgPeakPct).toBe(2);
  });

  it('the bar denominators are independent of the stored-peak denominators', () => {
    const r = computeExitQuality([
      row({ peakProfitPct: 1, barMaxPct: 2 }),
      row({ peakProfitPct: 1 }), // no bars
      row({ peakProfitPct: null, barMaxPct: 3 }), // bars, no stored peak
    ]);
    expect(r.overall.nWithPeak).toBe(2);
    expect(r.overall.nWithBarMax).toBe(2);
  });

  it('true give-back uses the bar maximum, and is larger than the stored one', () => {
    // stored peak 1.0, bars 5.0, realised +1.0% → stored give-back 0, true give-back 4.0
    const r = computeExitQuality([row({ peakProfitPct: 1, barMaxPct: 5, exitPrice: 101 })], 0.5);
    expect(r.overall.avgGiveBackPct).toBe(0);
    expect(r.overall.avgTrueGiveBackPct).toBe(4);
  });
});
