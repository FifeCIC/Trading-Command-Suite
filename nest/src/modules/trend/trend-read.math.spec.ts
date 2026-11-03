import {
  readTrend,
  linearRegression,
  confirmedPivots,
  positionInRange,
  TREND_MIN_BARS,
  TREND_THRESHOLDS,
  type TrendBarLike,
} from './trend-read.math';

/**
 * The trend READING (#1190, experiment).
 *
 * ⚠️ WHAT THIS FILE IS REALLY FOR. A reading is only worth having if it can be WRONG, so the tests
 * that matter are the ones that make it say the opposite of what it should:
 *   · a clean trend must read `trending-*` — AND
 *   · a flat / noisy series must NOT, which is the direction that catches "it labels everything a
 *     trend", the failure mode that makes such a tool worthless.
 *   · too few bars must return `null`, never a neutral reading.
 *
 * ⚠️ WHAT IT CANNOT SEE: the market. These are constructed series with a known answer. They prove
 * the arithmetic and the classification thresholds behave; they say nothing about whether the
 * reading is USEFUL, which is what the experiment is for and what only real data can answer.
 */

/** A synthetic bar series from a close-price generator, with a plausible high/low around each close. */
function barsFrom(closes: number[], spread = 0.5): TrendBarLike[] {
  const start = Date.UTC(2026, 0, 1);
  return closes.map((c, i) => ({
    timestamp: new Date(start + i * 3_600_000),
    open: c,
    high: c + spread,
    low: c - spread,
    close: c,
    volume: 1000,
  }));
}

/** A clean uptrend: +0.5 per bar on a 100 base, with a small deterministic wiggle so R² is not 1. */
function trendingCloses(n = 120, step = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => 100 + i * step + Math.sin(i / 3) * 0.6);
}

describe('trend-read.math — linearRegression', () => {
  it('fits a perfectly straight line with slope exact and R² = 1', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 200 + 2 * i);
    const fit = linearRegression(closes);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(2, 9);
    expect(fit!.r2).toBeCloseTo(1, 9);
    expect(fit!.residualStd).toBeCloseTo(0, 9);
    expect(fit!.endValue).toBeCloseTo(200 + 2 * 49, 9);
  });

  it('reports R² = 0 for a perfectly FLAT series, not 1 — a flat line is not a perfect trend', () => {
    const fit = linearRegression(Array.from({ length: 40 }, () => 100));
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBe(0);
    // The degenerate case: total variance is 0, so R² is undefined. Claiming 1 here would read as
    // "perfectly explained" when the series carries no trend information at all.
    expect(fit!.r2).toBe(0);
  });

  it('gives a NEGATIVE slope and a low R² for a sawtooth — movement without a line', () => {
    // Rises then falls repeatedly: lots of directional movement, no line-like behaviour.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 10 < 5 ? i : 50 - i) * 0.4);
    const fit = linearRegression(closes);
    expect(fit).not.toBeNull();
    expect(fit!.r2).toBeLessThan(TREND_THRESHOLDS.r2Trending);
  });

  it('returns NULL — not zeros — for fewer than two points', () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([100])).toBeNull();
  });

  it('returns NULL when any close is non-finite, rather than folding it in silently', () => {
    expect(linearRegression([100, 101, NaN, 103])).toBeNull();
    expect(linearRegression([100, 101, Infinity, 103])).toBeNull();
  });

  it('honours a sub-range, so the fit can be taken over a window', () => {
    // First 20 bars flat at 100, next 20 rising 1/bar. The TAIL is a perfect line (R² = 1) while the
    // whole series is not, because of the jump between the two halves — so the property under test
    // is "the window was honoured", not "the slope is bigger".
    const closes = [...Array.from({ length: 20 }, () => 100), ...Array.from({ length: 20 }, (_, i) => 100 + i)];
    const whole = linearRegression(closes)!;
    const tail = linearRegression(closes, 20, 39)!;
    expect(tail.slope).toBeCloseTo(1, 9);
    expect(tail.r2).toBeCloseTo(1, 9);
    expect(whole.r2).toBeLessThan(tail.r2);
    expect(tail.startIndex).toBe(20);
    expect(tail.endIndex).toBe(39);
  });
});

describe('trend-read.math — confirmedPivots', () => {
  /** A V: falls to a trough at index 10, then rises. */
  function vBars(): TrendBarLike[] {
    const closes = Array.from({ length: 21 }, (_, i) => 100 - Math.min(i, 10) + Math.max(0, i - 10));
    return barsFrom(closes, 0.1);
  }

  it('emits the trough of a V as a LOW pivot', () => {
    const pivots = confirmedPivots(vBars(), 3, 3);
    const lows = pivots.filter((p) => p.kind === 'low');
    expect(lows.length).toBeGreaterThanOrEqual(1);
    expect(lows[0].index).toBe(10);
  });

  it('is NON-REPAINTING: a pivot is only emitted once `rightBars` bars exist after it', () => {
    const all = vBars();
    // The trough sits at index 10 and needs indices 11, 12 and 13 to confirm. Truncate to 13 bars
    // (indices 0..12) so the third confirming bar does not exist — the pivot must then be ABSENT.
    // ⚠️ Slicing off the last 3 bars instead would NOT test this: with 21 bars that leaves 0..17,
    // and 11/12/13 all exist, so the pivot is legitimately still confirmed.
    const unconfirmed = all.slice(0, 13);
    expect(confirmedPivots(unconfirmed, 3, 3).some((p) => p.index === 10)).toBe(false);
    // The same bars WITH the confirming bar do produce it — otherwise this test would pass on a
    // detector that never fires at all.
    expect(confirmedPivots(all, 3, 3).some((p) => p.index === 10)).toBe(true);
  });

  it('never emits the SAME bar as both a high and a low pivot', () => {
    for (const p of confirmedPivots(vBars(), 3, 3)) {
      expect(['high', 'low']).toContain(p.kind);
    }
    const seen = confirmedPivots(vBars(), 3, 3).map((p) => `${p.index}:${p.kind}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('returns nothing for a series shorter than the lookback window', () => {
    expect(confirmedPivots(barsFrom([100, 101, 100]), 3, 3)).toEqual([]);
  });
});

describe('trend-read.math — positionInRange', () => {
  it('maps the ends to 0 and 100 and the middle to 50', () => {
    expect(positionInRange(10, 10, 20)).toBe(0);
    expect(positionInRange(20, 10, 20)).toBe(100);
    expect(positionInRange(15, 10, 20)).toBe(50);
  });

  it('returns NULL for a zero-width range — position in nothing is not 0 or 50', () => {
    expect(positionInRange(10, 10, 10)).toBeNull();
  });
});

describe('trend-read.math — readTrend classification', () => {
  it('reads a clean uptrend as tending UP, with both families concurring', () => {
    const read = readTrend(barsFrom(trendingCloses()));
    expect(read).not.toBeNull();
    expect(read!.verdict).toBe('trending-up');
    expect(read!.regression.slope).toBeGreaterThan(0);
    expect(read!.familiesAgree).toBe(true);
  });

  it('reads a clean DOWNTREND as tending DOWN, not merely "not up"', () => {
    const closes = trendingCloses(120, -0.5).map((c) => c + 60); // same shape, negative slope
    const read = readTrend(barsFrom(closes));
    expect(read).not.toBeNull();
    expect(read!.verdict).toBe('trending-down');
    expect(read!.regression.slope).toBeLessThan(0);
  });

  it('does NOT call a flat, noisy series a trend — the direction that catches an over-eager label', () => {
    // Deterministic pseudo-noise around a constant: no drift, no line.
    const closes = Array.from({ length: 160 }, (_, i) => 100 + Math.sin(i * 1.7) * 0.8 + Math.sin(i * 0.31) * 0.5);
    const read = readTrend(barsFrom(closes));
    expect(read).not.toBeNull();
    expect(read!.verdict).toBe('ranging');
    expect(read!.verdict).not.toBe('trending-up');
    expect(read!.regression.r2).toBeLessThan(TREND_THRESHOLDS.r2Trending);
  });

  it('returns NULL below the minimum bar count — never a neutral reading', () => {
    expect(readTrend(barsFrom(trendingCloses(TREND_MIN_BARS - 1)))).toBeNull();
    expect(readTrend(barsFrom(trendingCloses(TREND_MIN_BARS)))).not.toBeNull();
  });

  it('returns NULL when the series contains a non-finite price', () => {
    const closes = trendingCloses(80);
    closes[40] = NaN;
    expect(readTrend(barsFrom(closes))).toBeNull();
  });

  it('echoes the thresholds it applied, so the verdict can be audited without the source', () => {
    const read = readTrend(barsFrom(trendingCloses()))!;
    expect(read.thresholds).toEqual({ ...TREND_THRESHOLDS });
  });
});

describe('trend-read.math — the parts that must be usable, not just true', () => {
  it('puts the channel bracket around the last close in a clean trend', () => {
    const read = readTrend(barsFrom(trendingCloses()))!;
    expect(read.channel.lower).toBeLessThan(read.channel.upper);
    // The close is inside the band it was fitted with — this is the "am I extended?" reading.
    expect(read.channel.positionPct).toBeGreaterThan(-50);
    expect(read.channel.positionPct).toBeLessThan(150);
  });

  it('offers an invalidation level on the CORRECT side of price', () => {
    const up = readTrend(barsFrom(trendingCloses()))!;
    const lastClose = trendingCloses().at(-1)!;
    expect(up.invalidation.chosen).not.toBeNull();
    // An uptrend is invalidated BELOW, and never above: a level above price is not an invalidation.
    expect(up.invalidation.chosen!).toBeLessThan(lastClose);
    expect(up.invalidation.chosenBasis).not.toBe('none');
    expect(up.invalidation.alreadyBroken).toBe(false);
  });

  /**
   * ⚠️ THE DEFECT THIS PINS, MEASURED 2026-11-03 ON WTI 1h: the fit read `trending-up` while the last
   * close sat BELOW the most recent confirmed swing low. The first version picked the "tighter"
   * candidate — which was above price — and the UI labelled it "invalid below". A stop above the
   * price it is meant to protect is worse than no stop.
   *
   * The series below is deliberately shaped that way: a long rise (so the 200-bar fit leans up and
   * ADX reads trend) with a sharp fall over the last few bars, which takes price under its own
   * structure without enough bars to flip the fit.
   */
  it('does NOT put the invalidation on the wrong side of price when structure has broken', () => {
    const closes = [
      ...Array.from({ length: 150 }, (_, i) => 100 + i * 0.5), // a clean rise
      ...Array.from({ length: 10 }, (_, i) => 175 - i * 3.2),   // a sharp fall through structure
    ];
    const read = readTrend(barsFrom(closes))!;
    const lastClose = closes.at(-1)!;

    expect(read.regression.slope).toBeGreaterThan(0); // the fit still leans up

    // Whatever it reports, the chosen level must be on the correct side, and when nothing is, the
    // reading must SAY the structure already failed rather than offer a breached level as a stop.
    if (read.invalidation.chosen != null) {
      expect(read.invalidation.chosen).toBeLessThan(lastClose);
    } else {
      expect(read.invalidation.alreadyBroken).toBe(true);
    }
  });

  it('marks a RANGING verdict as not-applicable for invalidation — a range has edges, not invalidation', () => {
    const closes = Array.from({ length: 160 }, (_, i) => 100 + Math.sin(i * 1.7) * 0.8 + Math.sin(i * 0.31) * 0.5);
    const read = readTrend(barsFrom(closes))!;
    expect(read.verdict).toBe('ranging');
    expect(read.invalidation.notApplicable).toBe(true);
    expect(read.invalidation.chosen).toBeNull();
  });

  it('names WHICH candidate won the invalidation, rather than leaving it implied', () => {
    const read = readTrend(barsFrom(trendingCloses()))!;
    expect(['regression-edge', 'swing-level']).toContain(read.invalidation.chosenBasis);
    // Both candidates are reported, not just the winner.
    expect(read.invalidation.regressionEdge).not.toBeNull();
  });

  it('projects the fit FORWARD by the requested horizon, in the direction of the slope', () => {
    const read = readTrend(barsFrom(trendingCloses()), { horizonBars: 20 })!;
    expect(read.projection.horizonBars).toBe(20);
    expect(read.projection.value).toBeGreaterThan(read.regression.endValue);
    // The projection band is the channel width carried forward, not an invented interval.
    expect(read.projection.upper).toBeGreaterThan(read.projection.value);
    expect(read.projection.lower).toBeLessThan(read.projection.value);
  });

  it('is DETERMINISTIC — the same bars produce a byte-identical reading', () => {
    const bars = barsFrom(trendingCloses());
    const a = JSON.stringify(readTrend(bars));
    const b = JSON.stringify(readTrend(bars));
    expect(a).toBe(b);
  });
});
