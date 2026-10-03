/**
 * protocol-health.coverage.spec.ts — proves the boot-time coverage formatter (#970) in BOTH
 * directions, and that "cannot judge" is never rendered as a finding.
 *
 * ⚠️ The direction that matters most is the NEGATIVE one. A formatter that always returns a string
 * would make every boot log a warning, and the obvious repair for a noisy warning is to stop
 * reading it — an ignored warning is worse than none.
 */
import { formatCoverageWarning, CoveragePayload } from './protocol-health.service';

const base = (over: Partial<CoveragePayload> = {}): CoveragePayload => ({
  bots: 39,
  covered: 38,
  failures: [],
  cannotJudge: [],
  ...over,
});

describe('formatCoverageWarning', () => {
  it('names the bot when a protocol never declares its own symbol (the #970 instance)', () => {
    const out = formatCoverageWarning(base({
      failures: [{ bot: 'US SPY Speed', symbol: 'US500', protocol: 'spy-speed-v1', set: ['SPY'] }],
      covered: 37,
    }));
    expect(out).toContain('1 bot(s)');
    expect(out).toContain('US SPY Speed');
    expect(out).toContain('US500');
    expect(out).toContain('spy-speed-v1');
    expect(out).toContain('SPY');
  });

  // ── the inverse: nothing to report must produce NOTHING ────────────────────────────────────────
  it('returns null when there are no failures', () => {
    expect(formatCoverageWarning(base())).toBeNull();
  });

  it('returns null when the payload is missing — the caller reports that separately', () => {
    expect(formatCoverageWarning(null)).toBeNull();
    expect(formatCoverageWarning(undefined)).toBeNull();
  });

  it('returns null when failures is not an array rather than inventing a finding', () => {
    expect(formatCoverageWarning(base({ failures: undefined as any }))).toBeNull();
    expect(formatCoverageWarning(base({ failures: 'nope' as any }))).toBeNull();
  });

  // ── "cannot judge" is NOT a finding ───────────────────────────────────────────────────────────
  it('returns null when bots merely COULD NOT BE JUDGED', () => {
    const out = formatCoverageWarning(base({
      covered: 38,
      cannotJudge: [{ bot: 'London EURUSD Macro', symbol: 'EURUSD', protocol: 'eurusd-macro-v1' }],
    }));
    expect(out).toBeNull();
  });

  it('never renders a missing symbol set as the literal "undefined"', () => {
    const out = formatCoverageWarning(base({
      failures: [{ bot: 'X', symbol: 'QQQ', protocol: 'p', set: undefined as any }],
    }));
    expect(out).not.toContain('undefined');
    expect(out).toContain('[]');
  });

  // ── bounds: a warning must stay one line even when the set explodes ────────────────────────────
  it('caps the named bots at five and reports the remainder', () => {
    const failures = Array.from({ length: 8 }, (_, i) => ({
      bot: `B${i}`, symbol: `S${i}`, protocol: 'p', set: ['OTHER'],
    }));
    const out = formatCoverageWarning(base({ failures }));
    expect(out).toContain('8 bot(s)');
    expect(out).toContain('B4');
    expect(out).not.toContain('B5');
    expect(out).toContain('(+3 more)');
  });

  it('does not append a remainder when five or fewer are named', () => {
    const failures = Array.from({ length: 5 }, (_, i) => ({
      bot: `B${i}`, symbol: `S${i}`, protocol: 'p', set: ['OTHER'],
    }));
    expect(formatCoverageWarning(base({ failures }))).not.toContain('more)');
  });
});
