import { demarker, forceIndex, roc, rsi } from './indicators';

describe('indicator correctness fixtures', () => {
  it('treats a flat RSI series as neutral', () => {
    expect(rsi(Array(20).fill(100), 14)).toEqual(Array(6).fill(50));
  });

  it('retains directional RSI extremes for monotonic series', () => {
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 20 }, (_, i) => 20 - i), 14).at(-1)).toBe(0);
  });

  it('does not emit non-finite ROC values when the comparison close is zero', () => {
    const values = roc([0, 1, 2], 1);
    expect(values[0]).toBe(0);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('uses high-to-high DeMax and low-to-low DeMin changes', () => {
    expect(demarker([10, 11, 20], [9, 1, 19], 2)[0]).toBeCloseTo(5 / 9, 8);
  });

  it('returns the EMA-smoothed Force Index instead of aligned raw values', () => {
    const values = forceIndex([1, 2, 4, 3], [10, 10, 10, 10], 2);
    expect(values[0]).toBe(15);
    expect(values[1]).toBeCloseTo(-5 / 3, 8);
  });
});
