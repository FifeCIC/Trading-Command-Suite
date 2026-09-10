import { parseMaxHoldHours } from './position-time-stop.service';

/**
 * Why these tests matter (#773)
 * ============================
 * `maxHoldDuration` was declared on the strategy interface with a default of `'30d'` but
 * was NEVER READ — so no time-based exit existed at all. 11 auto bots shared 5 broker-wide
 * position slots, nothing freed them, and the app executed 2 trades in 24h while scoring
 * composites of 81 and 82 that it then refused to act on.
 *
 * The parser is the safety-critical part of the fix, because its failure modes are both
 * silent and expensive:
 *
 *   - Parsing `'unlimited'` (or garbage) as 0 would close EVERY position immediately.
 *   - Parsing it as a huge number is safe (nothing closes) but useless.
 *   - Mis-parsing a unit (`'30d'` vs `'30h'`) closes positions 24x too early.
 *
 * So the rule these tests pin is: **"no limit" is `null`, never a number**, and an
 * unrecognised value is also `null`. A caller that mishandles `null` cannot cause a close,
 * which is the correct direction to fail.
 */
describe('parseMaxHoldHours — #773 position time-stop', () => {
  describe('explicit no-limit values must never become a number', () => {
    it('returns null for unlimited/none/off', () => {
      expect(parseMaxHoldHours('unlimited')).toBeNull();
      expect(parseMaxHoldHours('UNLIMITED')).toBeNull();
      expect(parseMaxHoldHours('none')).toBeNull();
      expect(parseMaxHoldHours('off')).toBeNull();
    });

    it('returns null for null/undefined/empty', () => {
      expect(parseMaxHoldHours(null)).toBeNull();
      expect(parseMaxHoldHours(undefined)).toBeNull();
      expect(parseMaxHoldHours('')).toBeNull();
      expect(parseMaxHoldHours('   ')).toBeNull();
    });

    it('returns null for unparseable input rather than 0', () => {
      // The dangerous failure: `0` would close every position on the next tick.
      expect(parseMaxHoldHours('soon')).toBeNull();
      expect(parseMaxHoldHours('abc')).toBeNull();
      expect(parseMaxHoldHours('d')).toBeNull();
      expect(parseMaxHoldHours('30dd')).toBeNull();
      expect(parseMaxHoldHours('--5h')).toBeNull();
    });

    it('returns null for zero and negative values', () => {
      expect(parseMaxHoldHours('0')).toBeNull();
      expect(parseMaxHoldHours('0h')).toBeNull();
      expect(parseMaxHoldHours('-5')).toBeNull();
    });
  });

  describe('documented strategy formats', () => {
    it('parses days', () => {
      expect(parseMaxHoldHours('7d')).toBe(7 * 24);
      expect(parseMaxHoldHours('30d')).toBe(30 * 24);
      expect(parseMaxHoldHours('1d')).toBe(24);
    });

    it('parses hours, because a scalp protocol needs sub-day limits', () => {
      expect(parseMaxHoldHours('48h')).toBe(48);
      expect(parseMaxHoldHours('4h')).toBe(4);
    });

    it('parses minutes for the short end', () => {
      expect(parseMaxHoldHours('30m')).toBeCloseTo(0.5, 10);
      expect(parseMaxHoldHours('90m')).toBeCloseTo(1.5, 10);
    });

    it('parses weeks', () => {
      expect(parseMaxHoldHours('1w')).toBe(24 * 7);
    });

    it('treats a bare number as hours (the safe, non-zero default)', () => {
      expect(parseMaxHoldHours('12')).toBe(12);
      expect(parseMaxHoldHours(12)).toBe(12);
    });
  });

  describe('the unit must not be confused — a wrong unit closes 24x too early', () => {
    it('distinguishes 30d from 30h', () => {
      expect(parseMaxHoldHours('30d')).toBe(720);
      expect(parseMaxHoldHours('30h')).toBe(30);
      expect(parseMaxHoldHours('30d')).not.toBe(parseMaxHoldHours('30h'));
    });

    it('is case-insensitive so config casing cannot change behaviour', () => {
      expect(parseMaxHoldHours('30D')).toBe(720);
      expect(parseMaxHoldHours('2H')).toBe(2);
    });

    it('tolerates surrounding and internal whitespace', () => {
      expect(parseMaxHoldHours('  30d  ')).toBe(720);
      expect(parseMaxHoldHours('30 d')).toBe(720);
    });
  });

  describe('accepts numeric input from JSON config', () => {
    it('handles a number as hours', () => {
      expect(parseMaxHoldHours(6)).toBe(6);
      expect(parseMaxHoldHours(0.5)).toBe(0.5);
    });

    it('treats numeric 0 as no limit, not as close-everything', () => {
      expect(parseMaxHoldHours(0)).toBeNull();
    });
  });
});
