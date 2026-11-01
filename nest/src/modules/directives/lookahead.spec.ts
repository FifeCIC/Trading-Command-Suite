import { checkFidelity, lookaheadResult, timeframeToMs } from './lookahead';

describe('timeframeToMs', () => {
  it('maps the timeframes the app actually scores', () => {
    expect(timeframeToMs('1m')).toBe(60_000);
    expect(timeframeToMs('5m')).toBe(300_000);
    expect(timeframeToMs('15m')).toBe(900_000);
    expect(timeframeToMs('1h')).toBe(3_600_000);
    expect(timeframeToMs('4h')).toBe(14_400_000);
    expect(timeframeToMs('1d')).toBe(86_400_000);
  });

  it('falls back to one day for anything unrecognised, rather than zero', () => {
    // ⚠️ A zero fallback would make every live bar look like lookahead. One day is the coarsest bar
    // the app scores, so it errs toward ALLOWING data rather than refusing a valid live reading.
    expect(timeframeToMs('weird')).toBe(86_400_000);
    expect(timeframeToMs(undefined)).toBe(86_400_000);
  });
});

describe('checkFidelity — the lookahead test', () => {
  const bar = new Date('2026-10-01T14:00:00Z');

  it('LIVE: data fetched during the bar is OK (the arrival allowance)', () => {
    // 1h bar opens 14:00, value fetched 14:30 — normal for live scoring.
    expect(checkFidelity(new Date('2026-10-01T14:30:00Z'), bar, '1h')).toBe('ok');
  });

  it('LIVE: data fetched exactly at the end of the bar is still OK (inclusive boundary)', () => {
    expect(checkFidelity(new Date('2026-10-01T15:00:00Z'), bar, '1h')).toBe('ok');
  });

  it('LOOKAHEAD: data observed one millisecond after the bar closes', () => {
    expect(checkFidelity(new Date('2026-10-01T15:00:00.001Z'), bar, '1h')).toBe('lookahead');
  });

  it('LOOKAHEAD: today\'s snapshot used on a bar from three days ago', () => {
    expect(checkFidelity(new Date('2026-10-04T09:00:00Z'), bar, '1h')).toBe('lookahead');
  });

  it('the SAME pair of timestamps flips verdict with the timeframe — the bar duration is the allowance', () => {
    const observed = new Date('2026-10-01T19:00:00Z'); // 5h after the bar opened
    expect(checkFidelity(observed, bar, '1h')).toBe('lookahead');
    expect(checkFidelity(observed, bar, '1d')).toBe('ok');
  });

  it('UNKNOWN when either timestamp is missing — never OK', () => {
    // "I cannot prove this was available" must not be recorded as "it was available".
    expect(checkFidelity(null, bar, '1h')).toBe('unknown');
    expect(checkFidelity(new Date(), undefined, '1h')).toBe('unknown');
    expect(checkFidelity(undefined, undefined, '1h')).toBe('unknown');
  });

  it('accepts epoch millis as well as Dates', () => {
    expect(checkFidelity(bar.getTime() - 1000, bar.getTime(), '1h')).toBe('ok');
  });
});

describe('lookaheadResult — the shape of "cannot judge"', () => {
  const r = lookaheadResult(
    'the Fear & Greed index',
    new Date('2026-10-04T09:00:00Z'),
    new Date('2026-10-01T14:00:00Z'),
    'The provider is fetched live and cached, so no historical value exists.',
  );

  it('scores nothing and claims no direction', () => {
    expect(r.score).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.signalClass).toBe('neutral');
  });

  it('is flagged unmeasured so risk gating ignores it', () => {
    expect(r.unmeasured).toBe(true);
  });

  it('says UNMEASURED in capitals, names both timestamps and the word lookahead', () => {
    expect(r.reason).toMatch(/UNMEASURED/);
    expect(r.reason).toContain('2026-10-04 09:00');
    expect(r.reason).toContain('2026-10-01 14:00');
    expect(r.reason.toLowerCase()).toContain('lookahead');
  });

  it('still produces a readable reason when a timestamp is missing', () => {
    const vague = lookaheadResult('the snapshot', null, undefined, 'No date predicate.');
    expect(vague.reason).toContain('unknown time');
    expect(vague.unmeasured).toBe(true);
  });
});
