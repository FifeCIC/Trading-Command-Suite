import { evaluateMtfReadiness, MTF_REQUIRING_DIRECTIVES } from './signal-envelope.service';

/**
 * #735 — a protocol containing a multi-timeframe directive must NOT report READY when the
 * 1d/1h/15m bundle was incomplete. The rule existed inline in the envelope builder and was
 * pinned by nothing; a regression would silently resume reporting "trade ready" for scores
 * computed from partial series — the failure shape this repo keeps re-finding (plausible
 * number, no error).
 *
 * The thresholds are pinned AT THE BOUNDARY in both directions: `1d ≥ 2`, `1h ≥ 10`, `15m ≥ 10`.
 */
describe('#735 — MTF readiness on an incomplete bundle', () => {
  it('flags a short 1h series and names the actual counts', () => {
    const r = evaluateMtfReadiness(new Set(MTF_REQUIRING_DIRECTIVES), 30, 3, 30);
    expect(r.code).toBe('INCOMPLETE_MTF');
    expect(r.blocker).toContain('1h=3');
    expect(r.blocker).toContain('Incomplete timeframe bundle');
  });

  it('flags a short 1d series even when 1h/15m are ample', () => {
    expect(evaluateMtfReadiness(new Set(MTF_REQUIRING_DIRECTIVES), 1, 40, 40).code).toBe('INCOMPLETE_MTF');
  });

  it('flags a short 15m series even when the others are ample', () => {
    expect(evaluateMtfReadiness(new Set(MTF_REQUIRING_DIRECTIVES), 5, 40, 9).code).toBe('INCOMPLETE_MTF');
  });

  it('passes at the EXACT thresholds (2/10/10) — boundary pinned, inclusive', () => {
    expect(evaluateMtfReadiness(new Set(MTF_REQUIRING_DIRECTIVES), 2, 10, 10).blocker).toBeNull();
  });

  it('one bar below any threshold still fails — the boundary is not off-by-one', () => {
    expect(evaluateMtfReadiness(new Set(MTF_REQUIRING_DIRECTIVES), 2, 9, 10).code).toBe('INCOMPLETE_MTF');
  });

  it('a protocol WITHOUT an MTF directive is not gated (control — the rule must not over-fire)', () => {
    expect(evaluateMtfReadiness(new Set(['rsi-oversold', 'macd-cross']), 0, 0, 0).blocker).toBeNull();
  });

  it('accepts a plain id array as well as a Set', () => {
    expect(evaluateMtfReadiness(['mtf-confluence-weighted'], 1, 1, 1).code).toBe('INCOMPLETE_MTF');
  });
});
