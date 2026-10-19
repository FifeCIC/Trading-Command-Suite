/**
 * Guard for the MT5 bar fallback (#1128).
 *
 * THE DEFECT: `loadBars` asks the bridge for its LATEST `limit` bars — the request has no date
 * parameters. For a historical window those bars fall outside the requested range, `inWindow` is
 * empty, and the old code returned that empty list anyway, discarding the stored rows it had
 * already read. A window holding 12 stored bars then reported "found 0 bars", which blames the
 * store for a bar count it never had.
 *
 * The rule is one line, which is exactly why it needs a guard: a future edit that "tidies" the
 * comparison back to `>=`, or that returns the fallback unconditionally, is invisible without one.
 */
import { preferFallbackBars } from './replay.service';

describe('preferFallbackBars — a fallback may never reduce the data (#1128)', () => {
  it('rejects an empty fallback when bars are already stored', () => {
    // The historical-window case: the bridge answered, but nothing landed inside the range.
    expect(preferFallbackBars(0, 12)).toBe(false);
  });

  it('rejects a fallback that is smaller than the store', () => {
    expect(preferFallbackBars(9, 12)).toBe(false);
  });

  it('rejects a fallback that merely equals the store — no information is added', () => {
    // `>=` here would replace a store the replay could already walk with a copy of itself.
    expect(preferFallbackBars(12, 12)).toBe(false);
  });

  it('accepts a fallback that adds bars', () => {
    expect(preferFallbackBars(13, 12)).toBe(true);
    expect(preferFallbackBars(200, 0)).toBe(true);
  });
});
