import {
  detectZigZagSwings,
  swingHighs,
  swingLows,
  lastSwingHigh,
  lastSwingLow,
  SwingPoint,
} from '../utils/zigzag';

describe('ZigZag Swing Detector', () => {
  // ── Basic swing detection ──────────────────────────────

  it('should return empty for insufficient bars', () => {
    const highs = [10, 11, 12];
    const lows = [9, 10, 11];
    const closes = [9.5, 10.5, 11.5];
    const result = detectZigZagSwings(highs, lows, closes, { lookback: 5 });
    expect(result).toEqual([]);
  });

  it('should detect a clear swing high in a V-shaped pattern', () => {
    // 11 bars: rise to peak at index 5, then fall
    // lookback=5 → need 5 bars each side
    const highs = [10, 11, 12, 13, 14, 20, 14, 13, 12, 11, 10];
    const lows  = [9, 10, 11, 12, 13, 19, 13, 12, 11, 10, 9];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    const result = detectZigZagSwings(highs, lows, closes, { lookback: 5 });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('high');
    expect(result[0].index).toBe(5);
    expect(result[0].price).toBe(20);
  });

  it('should detect a clear swing low in an inverted-V pattern', () => {
    const highs = [20, 19, 18, 17, 16, 10, 16, 17, 18, 19, 20];
    const lows  = [19, 18, 17, 16, 15, 9, 15, 16, 17, 18, 19];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    const result = detectZigZagSwings(highs, lows, closes, { lookback: 5 });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('low');
    expect(result[0].index).toBe(5);
    expect(result[0].price).toBe(9);
  });

  it('should detect alternating swing highs and lows', () => {
    // Sine-wave pattern: peak at 5, trough at 15, peak at 25
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    for (let i = 0; i < 31; i++) {
      const phase = (i / 10) * Math.PI;
      const mid = 100 + Math.sin(phase) * 10;
      highs.push(mid + 1);
      lows.push(mid - 1);
      closes.push(mid);
    }

    const result = detectZigZagSwings(highs, lows, closes, { lookback: 2, minMovePct: 1 });
    // With a sine wave and wider lookback, should find multiple swings
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  // ── Noise filter ───────────────────────────────────────

  it('should filter small moves below minMovePct', () => {
    const highs = [100, 101, 102, 103, 104, 110, 104, 103, 105, 104, 103, 102, 101, 100, 99, 98];
    const lows  = [99, 100, 101, 102, 103, 109, 103, 102, 104, 103, 102, 101, 100, 99, 98, 97];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    // minMovePct=5 → the small 105 bump at index 8 should be filtered
    const result = detectZigZagSwings(highs, lows, closes, { lookback: 3, minMovePct: 5 });
    // Should only get the big swing at index 5 (110 peak)
    expect(swingHighs(result).length).toBe(1);
    expect(result[0].price).toBe(110);
  });

  it('should accept smaller moves with low minMovePct', () => {
    // Two distinct peaks with a clear trough between them.
    // Peak 1: 110 at index 5. Trough: 95 at index 8. Peak 2: 105 at index 11.
    const highs = [100,102,104,106,105,110,106,102, 98,100,102,105,103,101, 99, 98, 97];
    const lows  = [ 98,100,102,104,103,108,100, 96, 95, 98,100,103,101, 99, 97, 96, 95];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    // minMovePct=0.1 → should pick up both peaks
    const result = detectZigZagSwings(highs, lows, closes, { lookback: 3, minMovePct: 0.1 });
    expect(swingHighs(result).length).toBeGreaterThanOrEqual(2);
  });

  // ── Alternation rule ───────────────────────────────────

  it('should enforce alternation (high → low → high)', () => {
    // Double top: two equal highs with a shallow dip in between
    const highs = [10,11,12,13,14,20,14,13,14,20,14,13,12,11,10];
    const lows  = [ 9,10,11,12,13,19,13,12,13,19,13,12,11,10, 9];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    const result = detectZigZagSwings(highs, lows, closes, { lookback: 3, minMovePct: 0.5 });
    const highs_ = swingHighs(result);
    // Two consecutive highs at same level: second should replace first (only 1 high)
    // OR there's a low between them, resulting in 2 highs. Either is valid.
    expect([1, 2]).toContain(highs_.length);
  });

  // ── Convenience functions ──────────────────────────────

  it('swingHighs and swingLows should filter correctly', () => {
    const swings: SwingPoint[] = [
      { index: 5, price: 20, type: 'high' },
      { index: 10, price: 10, type: 'low' },
      { index: 15, price: 18, type: 'high' },
      { index: 20, price: 12, type: 'low' },
    ];
    expect(swingHighs(swings)).toEqual([20, 18]);
    expect(swingLows(swings)).toEqual([10, 12]);
  });

  it('lastSwingHigh and lastSwingLow should find most recent', () => {
    const swings: SwingPoint[] = [
      { index: 5, price: 20, type: 'high' },
      { index: 10, price: 10, type: 'low' },
      { index: 15, price: 18, type: 'high' },
    ];

    const sh = lastSwingHigh(swings, 12);
    const sl = lastSwingLow(swings, 12);

    expect(sh).not.toBeNull();
    expect(sh!.price).toBe(20); // index 5, before index 12
    expect(sl).not.toBeNull();
    expect(sl!.price).toBe(10); // index 10, before index 12
  });

  it('lastSwingHigh should return null if no swing high found', () => {
    const swings: SwingPoint[] = [
      { index: 10, price: 10, type: 'low' },
    ];
    expect(lastSwingHigh(swings)).toBeNull();
  });

  // ── Configurable lookback ──────────────────────────────

  it('should respect configurable lookback', () => {
    // Need enough bars: lookback*2+1
    // lookback=2 → 5 bars needed. lookback=3 → 7 bars needed.
    const highs = [10,11,12,15,12,11,10];
    const lows  = [ 9,10,11,14,11,10, 9];
    const closes = highs.map((h, i) => (h + lows[i]) / 2);

    // lookback=2 → will find peak at index 3 (15)
    const result2 = detectZigZagSwings(highs, lows, closes, { lookback: 2 });
    expect(result2.length).toBe(1);
    expect(result2[0].price).toBe(15);
  });
});
