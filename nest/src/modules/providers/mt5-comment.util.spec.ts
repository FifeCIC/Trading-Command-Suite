import { sanitizeMt5Comment, extractStrategyFromComment } from './mt5-comment.util';

/**
 * extractStrategyFromComment — the ONE strategy-name parser (#884).
 *
 * ⚠️ THE REGRESSION THESE TESTS GUARD. There were two inline parses with different results:
 *   legacy branch:   "TCS Gold Swing 1H | 119%"  → "TCS Gold Swing 1H"   (prefix attached)
 *   primary branch:  "TCS Gold Swing 1H 119"     → "Gold Swing 1H 119"   (score attached)
 * The result is the GROUPING KEY on the Strategy Comparison page — one strategy rendered as
 * two rows, and the close path dropped it entirely (2 of 155 closes tagged, both phantoms).
 */
describe('extractStrategyFromComment — canonical parser (#884)', () => {
  it('parses the current format and strips the trailing score', () => {
    expect(extractStrategyFromComment('TCS Gold Swing 1H 119')).toBe('Gold Swing 1H');
  });

  it('parses the legacy pipe format to the SAME shape as the current one', () => {
    expect(extractStrategyFromComment('TCS Gold Swing 1H | 119%')).toBe('Gold Swing 1H');
    // The one-line expression of the defect: both eras must produce the identical key.
    expect(extractStrategyFromComment('TCS Gold Swing 1H | 119%')).toBe(
      extractStrategyFromComment('TCS Gold Swing 1H 119'),
    );
  });

  it('keeps a name with no score attached, minus the pipeline prefix', () => {
    expect(extractStrategyFromComment('TCS Agent Test')).toBe('Agent Test');
  });

  it('keeps names that contain digits but do not END in a bare score', () => {
    // "US30" must survive: the score strip only matches digits at the end, and "US30" ends in
    // the alphanumeric tail "30" preceded by a letter — not a standalone score token.
    expect(extractStrategyFromComment('TCS US30 Breakout')).toBe('US30 Breakout');
    expect(extractStrategyFromComment('US30 Breakout')).toBe('US30 Breakout');
  });

  it('returns undefined for empty and score-only comments — untagged stays untagged', () => {
    expect(extractStrategyFromComment('')).toBeUndefined();
    expect(extractStrategyFromComment(null)).toBeUndefined();
    expect(extractStrategyFromComment(undefined)).toBeUndefined();
    expect(extractStrategyFromComment('TCS 119')).toBeUndefined();
    expect(extractStrategyFromComment('TCS 119%')).toBeUndefined();
  });

  it('passes a foreign comment through (minus nothing it should not touch)', () => {
    expect(extractStrategyFromComment('manual note')).toBe('manual note');
  });

  it('does not regress the sanitizer contract: | and % are still stripped on the write side', () => {
    // Sanity anchor — the parser handles legacy comments, the sanitizer prevents new ones.
    expect(sanitizeMt5Comment('TCS Gold Swing 1H | 119%')).not.toContain('|');
    expect(sanitizeMt5Comment('TCS Gold Swing 1H | 119%')).not.toContain('%');
  });
});
