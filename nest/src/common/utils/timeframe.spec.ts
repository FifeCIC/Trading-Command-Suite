import { selectBaseTimeframe, DEFAULT_LIVE_TIMEFRAME } from './timeframe';

/**
 * timeframe.spec.ts — pins the cadence mapping (#751, 2026-09-10).
 *
 * WHY THIS TABLE IS WORTH PINNING
 * -------------------------------
 * `recommendedTimeframe` is free text in the protocol seed data, and this function is
 * the only thing that turns it into a cadence that exists in `marketbar`. The Arena and
 * the scoring path now depend on it, so a silent change here changes which bars get
 * scored for every protocol.
 *
 * The regex order is load-bearing: the FINEST cadence mentioned wins. Watch the
 * ordering cases below — `'1d (signal), 1h/15m'` resolves to `15m`, not `1h`, because
 * the `15m` rule is evaluated first. That is pre-existing behaviour, preserved verbatim
 * when the function moved here from signal-envelope.service.ts.
 */
describe('selectBaseTimeframe', () => {
  // Real values taken from nest/src/modules/scoring/protocols-seed-data.ts
  it.each([
    ['5s–30s', '1m'],
    ['30s', '1m'],
    ['1m–5m', '1m'],
    ['1m–15m', '1m'],
    ['5m', '5m'],
    ['5m–1h', '5m'],
    ['5m–15m', '5m'],
    ['15m', '15m'],
    ['15m–1h', '15m'],
    ['15m–1d', '15m'],
    ['1h', '1h'],
    ['1h–1d', '1h'],
    ['4h', '4h'],
    ['1d–4h', '4h'],
    ['1d', '1d'],
    ['1d–1w', '1d'],
    // ⚠️ Ordering case: 15m is tested before 1h, so the finest cadence wins.
    ['1d (signal), 1h/15m', '15m'],
    ['1d (signal), 1h (entry)', '1h'],
  ])('maps %j to %j', (recommended, expected) => {
    expect(selectBaseTimeframe(recommended)).toBe(expected);
  });

  it('falls back to 1d for missing or unrecognised guidance', () => {
    expect(selectBaseTimeframe(undefined)).toBe('1d');
    expect(selectBaseTimeframe(null)).toBe('1d');
    expect(selectBaseTimeframe('')).toBe('1d');
    expect(selectBaseTimeframe('monthly')).toBe('1d');
  });

  it('is case-insensitive', () => {
    expect(selectBaseTimeframe('5M')).toBe('5m');
    expect(selectBaseTimeframe('1H')).toBe('1h');
  });

  it('exposes the live default cadence separately from the unknown-protocol fallback', () => {
    // Deliberately different: '1d' is the "no guidance" answer, 5m is the app's live
    // base cadence (automation-loop scores on 5m) used when no protocol is in play.
    expect(DEFAULT_LIVE_TIMEFRAME).toBe('5m');
    expect(selectBaseTimeframe(undefined)).not.toBe(DEFAULT_LIVE_TIMEFRAME);
  });
});
