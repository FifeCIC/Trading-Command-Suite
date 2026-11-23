/**
 * bar-provider.spec.ts — one run, one publisher.
 *
 * ⚠️ THE DEFECT IS INVISIBLE WITHOUT A TEST AT THIS LEVEL. Mixing two publishers does not throw and
 * does not look wrong: it produces a plausible move between two price scales (WTI was ~25× apart,
 * #1282). So the cases below pin the CHOICE, including the two ways it could still go silent — falling
 * back when a pin matches nothing, and picking non-deterministically when two publishers tie.
 */
import { chooseBarProvider } from './bar-provider';

describe('chooseBarProvider', () => {
  it('uses the only publisher, with nothing to report', () => {
    expect(chooseBarProvider({ mt5: 449 })).toEqual({
      provider: 'mt5', available: ['mt5'], ambiguous: false, refused: null, note: null,
    });
  });

  it('▶ CANARY — two publishers, unpinned: reads ONE and names the collision', () => {
    const c = chooseBarProvider({ mt5: 449, yahoo: 12 });
    expect(c.provider).toBe('mt5');
    expect(c.ambiguous).toBe(true);
    expect(c.note).toMatch(/AMBIGUOUS PUBLISHER/);
    expect(c.note).toContain('mt5');
    expect(c.note).toContain('yahoo');
    // The whole point: the note says they were not blended.
    expect(c.note).toMatch(/NOT mixed in/);
  });

  it('picks deterministically on a tie, so two identical runs cannot disagree', () => {
    expect(chooseBarProvider({ mt5: 10, yahoo: 10 }).provider).toBe('mt5');
    expect(chooseBarProvider({ mt5: 10, yahoo: 10 }).provider).toBe('mt5');
    // …and the loser of a tie is still named.
    expect(chooseBarProvider({ mt5: 10, yahoo: 10 }).ambiguous).toBe(true);
  });

  it('honours an explicit pin and says which publishers it excluded', () => {
    const c = chooseBarProvider({ mt5: 449, yahoo: 12 }, 'yahoo');
    expect(c.provider).toBe('yahoo');
    expect(c.ambiguous).toBe(false);
    expect(c.note).toContain('mt5');
    expect(c.note).toMatch(/excluded/);
  });

  it('a pin with the only publisher reports nothing — no noise on the normal path', () => {
    expect(chooseBarProvider({ mt5: 449 }, 'mt5').note).toBeNull();
  });

  it('▶ CANARY — a pin that matches nothing is REFUSED, not silently resolved', () => {
    // Falling back here would be the silent pick this module exists to prevent: the caller asked for
    // a publisher, and "whatever is there" is a different answer wearing the same result.
    const c = chooseBarProvider({ mt5: 449, yahoo: 12 }, 'binance');
    expect(c.provider).toBeNull();
    expect(c.refused).toMatch(/barProvider 'binance' has no bars/);
    expect(c.refused).toContain('mt5');
  });

  it('an empty window picks nothing and says so rather than naming a publisher', () => {
    const c = chooseBarProvider({});
    expect(c.provider).toBeNull();
    expect(c.ambiguous).toBe(false);
    expect(c.refused).toBeNull();
    expect(c.note).toMatch(/no bars/);
  });

  it('ignores zero-count providers — a publisher with no rows is not a candidate', () => {
    const c = chooseBarProvider({ mt5: 449, yahoo: 0 });
    expect(c.provider).toBe('mt5');
    expect(c.ambiguous).toBe(false);
    expect(c.available).toEqual(['mt5']);
  });

  it('treats a blank pin as no pin', () => {
    expect(chooseBarProvider({ mt5: 449, yahoo: 12 }, '  ').provider).toBe('mt5');
    expect(chooseBarProvider({ mt5: 449, yahoo: 12 }, '  ').ambiguous).toBe(true);
  });
});
