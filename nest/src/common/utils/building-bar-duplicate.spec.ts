/**
 * building-bar-duplicate.spec.ts — the rule that stops a forming bar being stored as a session (#1049).
 *
 * ⚠️ The failure this guards is SILENT: a duplicate Friday `1d` bar reads as a perfectly ordinary
 * trading day, and a backtest over a daily series will trade it. 166 of them exist.
 */
import { dropFormingDuplicate, isSameOhlcv, OhlcvBar } from './building-bar-duplicate';

const bar = (timestamp: string, o: number, h: number, l: number, c: number, v: number): OhlcvBar =>
  ({ timestamp, open: o, high: h, low: l, close: c, volume: v });

// The real measured pair: EURUSD 1d, 2026-09-11 (Friday) repeating 2026-09-10 (Thursday).
const THU = bar('2026-09-10T21:00:00.000Z', 1.16114, 1.165, 1.158, 1.15983, 195012);
const FRI_DUPLICATE = bar('2026-09-11T21:00:00.000Z', 1.16114, 1.165, 1.158, 1.15983, 195012);

describe('isSameOhlcv', () => {
  it('is true for the measured Friday/Thursday pair', () => {
    expect(isSameOhlcv(FRI_DUPLICATE, THU)).toBe(true);
  });

  it('is false when ANY of the five fields differs — a quiet session has its own volume', () => {
    expect(isSameOhlcv({ ...FRI_DUPLICATE, close: 1.1599 }, THU)).toBe(false);
    expect(isSameOhlcv({ ...FRI_DUPLICATE, volume: 195013 }, THU)).toBe(false);
    expect(isSameOhlcv({ ...FRI_DUPLICATE, high: 1.1651 }, THU)).toBe(false);
  });

  it('treats a missing volume as 0 rather than blowing up', () => {
    expect(isSameOhlcv({ ...FRI_DUPLICATE, volume: null }, { ...THU, volume: 0 })).toBe(true);
  });
});

describe('dropFormingDuplicate', () => {
  it('drops the newest bar when it repeats its predecessor — the #1049 shape', () => {
    const r = dropFormingDuplicate([THU, FRI_DUPLICATE]);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0].timestamp).toBe(THU.timestamp);
    // The dropped bar is RETURNED, so the caller can log it rather than a bar vanishing.
    expect(r.dropped?.timestamp).toBe(FRI_DUPLICATE.timestamp);
  });

  it('keeps a genuinely different newest bar — the market was open', () => {
    const fri = bar('2026-09-11T21:00:00.000Z', 1.1599, 1.162, 1.1571, 1.1601, 201334);
    const r = dropFormingDuplicate([THU, fri]);
    expect(r.bars).toHaveLength(2);
    expect(r.dropped).toBeNull();
  });

  it('ONLY ever drops the newest — a historical duplicate is left alone', () => {
    // ⚠️ Load-bearing. Restricting to the newest means this rule can never delete a settled row;
    // the historical 205 are a decision for the owner, not something a refresh should silently undo.
    const dup = bar('2026-09-05T21:00:00.000Z', 1.16114, 1.165, 1.158, 1.15983, 195012);
    const r = dropFormingDuplicate([THU, dup, bar('2026-09-30T21:00:00.000Z', 1.13, 1.14, 1.12, 1.135, 9)]);
    expect(r.bars).toHaveLength(3);
    expect(r.dropped).toBeNull();
  });

  it('does NOTHING when the two bars share a timestamp — that is a different fault', () => {
    const same = { ...THU, open: 9, high: 9, low: 9, close: 9, volume: 9 };
    const r = dropFormingDuplicate([THU, same]);
    expect(r.bars).toHaveLength(2);
    expect(r.dropped).toBeNull();
  });

  it('is a no-op for 0 or 1 bars, and for a non-array', () => {
    expect(dropFormingDuplicate([]).dropped).toBeNull();
    expect(dropFormingDuplicate([THU]).bars).toHaveLength(1);
    expect(dropFormingDuplicate(null as any).bars).toEqual([]);
  });

  it('leaves the input array untouched — the caller may still need the raw fetch', () => {
    const input = [THU, FRI_DUPLICATE];
    dropFormingDuplicate(input);
    expect(input).toHaveLength(2);
  });
});
