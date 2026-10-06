/**
 * shadow-supertrend.spec.ts — the SHADOW computation must be trustworthy before anyone reads it (#1077).
 * ================================================================================================
 * WHY. The shadow exists so one question can be answered from a real window instead of argued from
 * source: *"would a working SuperTrend have cleared the guardian's `>= 55` consensus?"* If the
 * shadow itself is wrong, that question gets a confident wrong answer — which is worse than the
 * incumbent defect, because the shadow is presented as the reference.
 *
 * ⚠️ WHAT THESE TESTS ARE NOT. They do not show that replacing the incumbent would help, or that it
 * would change any decision. That is UNMEASURED until the shadow has run across a real window.
 * These pin only that the shadow computes a trend, the same way each time, and says `null` when it
 * cannot judge.
 *
 * ⚠️ CANARY DIRECTIONS (run before trusting this file — each must make a named test FAIL):
 *   1. Delete the LOWER-band ratchet (`finalLower = basicLower > finalLower || prevClose <
 *      finalLower ? basicLower : finalLower;` → `finalLower = basicLower;`) →
 *      `the ratcheted band holds after a pullback that the current bar's own band would absorb`
 *      FAILS.
 *      ⚠️ **Measured 2026-10-06: breaking the UPPER band ratchet instead does NOT fail anything.**
 *      My first canary mutation was mis-targeted for exactly that reason — the trend FLIP depends
 *      on the opposite band from the one being seeded. Recorded so the next reader does not
 *      "confirm" the ratchet with a mutation that cannot reach it.
 *   2. Return `'bullish'` instead of `null` for short input → `too few bars is
 *      UNDETERMINED, never a call` FAILS.   ✅ **OBSERVED 2026-10-06: 1 failed, naming that test.**
 *   3. ~~Change the seed from `close >= hl2 ? 'up' : 'down'` to always `'down'` → the uptrend test
 *      FAILS.~~  🛑 **THIS CANARY DOES NOT WORK — MEASURED, NOT ASSUMED: it left `6 passed`.**
 *      The seed is not pinned by any test here because the **ratchet absorbs it**: seeded `'down'`
 *      on a rising series, `finalUpper` ratchets down until `close > finalUpper` and the trend
 *      flips to `'up'` anyway. The uptrend assertion therefore cannot tell a correct seed from a
 *      wrong one.
 *      ⚠️ **Stated rather than papered over: the seed line is UNGUARDED.** Pinning it needs a series
 *      where the seed decides and no band break ever occurs — not written.
 *
 * ⚠️ **TWO OF MY OWN CANARY CLAIMS WERE WRONG AND RUNNING THEM IS WHAT CAUGHT IT** (items 1 and 3).
 * Both read as correct from the source and neither survived execution. That is exactly the repo's
 * rule — *"a guard that has never been observed to fail is a decoration"* — a canary direction
 * written from the source is a CLAIM, and it needs the same treatment as any other claim.
 *
 * ⚠️ **A TEST THAT PASSED FOR THE WRONG REASON WAS REMOVED FROM THIS FILE.** The original
 * `a dip that does not close through the lower band does not flip the trend` used a pullback whose
 * closes still ROSE (slower), so it never exercised the ratchet — it passed with the ratchet
 * deleted. It is replaced by one constructed to sit **above the current bar's own band but below
 * the ratcheted one**, which is the only place the two implementations disagree.
 */
import { shadowSuperTrend } from './shadow-supertrend';

/** `n` bars drifting by `step` per bar; `range` controls the bar's own high-low. */
function series(n: number, step: number, range = 2, start = 100) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.now() - (n - i) * 300_000).toISOString(),
    high: start + i * step + range / 2,
    low: start + i * step - range / 2,
    close: start + i * step + step / 2,
  }));
}

describe('shadowSuperTrend — the #1077 comparison copy', () => {
  it('too few bars is UNDETERMINED, never a call', () => {
    // "cannot judge" must be a THIRD state: an absent reading must never render as a direction.
    expect(shadowSuperTrend([])).toBeNull();
    expect(shadowSuperTrend(series(5, 1))).toBeNull();
    expect(shadowSuperTrend(series(10, 1))).toBeNull();
  });

  it('a rising series reads bullish', () => {
    expect(shadowSuperTrend(series(40, 1))).toBe('bullish');
  });

  it('a falling series reads bearish', () => {
    expect(shadowSuperTrend(series(40, -1))).toBe('bearish');
  });

  /**
   * ⚠️ THE TEST THAT JUSTIFIES THE WHOLE FILE, and it is deliberately NOT a "pullback doesn't flip"
   * test — that shape passes for the wrong reason (measured: the first version used a pullback
   * whose closes still rose, and it passed with the ratchet deleted).
   *
   * What the ratchet actually does is keep the band TIGHT: it may never move away from price. So the
   * only place the two implementations disagree is a bar that closes **below the band carried from
   * the prior trend** while sitting **above the band that bar's own high/low/ATR would produce**.
   * That is the bar below, and deleting the lower-band ratchet must make this fail.
   */
  it('the ratcheted band holds after a pullback that the current bar\'s own band would absorb', () => {
    const bars = series(30, 1, 2, 100); // rises 100 → 129.5, range 2, so ATR ≈ 2
    const last = bars[bars.length - 1];
    expect(shadowSuperTrend(bars)).toBe('bullish');

    // One wide bar DOWN. Its own `hl2 − 3×ATR` is far below 119 because the range widened, so an
    // un-ratcheted band would swallow this move and stay bullish.
    bars.push({ timestamp: last.timestamp, high: 128, low: 118, close: 119 });

    expect(shadowSuperTrend(bars)).toBe('bearish');
  });

  it('is deterministic — the same input twice gives the same answer', () => {
    const bars = series(40, 0.7);
    expect(shadowSuperTrend(bars)).toBe(shadowSuperTrend(bars));
  });

  it('tolerates bars whose highs and lows are flat (zero range) without throwing', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.now() - (30 - i) * 300_000).toISOString(),
      high: 100,
      low: 100,
      close: 100,
    }));
    expect(() => shadowSuperTrend(flat)).not.toThrow();
    expect(['bullish', 'bearish', null]).toContain(shadowSuperTrend(flat));
  });
});
