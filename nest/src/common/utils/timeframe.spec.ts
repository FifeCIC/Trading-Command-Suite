import { selectBaseTimeframe, DEFAULT_LIVE_TIMEFRAME, alignBarTimestamp, isBarAligned } from './timeframe';

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

/**
 * Bar alignment (#783) — floors a timestamp to its cadence's bar-OPEN boundary.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `importBars()` used to store timestamps verbatim and dedupe solely on the exact
 * (symbolId, timeframe, timestamp) key. A re-import that stamped a bar 30 minutes
 * differently therefore wrote a SECOND row for the same period, because `13:30` and
 * `13:00` are genuinely different timestamps — `P2002` never fired.
 *
 * Measured live: ~27,376 phantom bars of 266,890 (~10%) on `1h`/`4h`/`1d`, and a fake
 * 30-minute median interval on those series, which corrupted `computeMarketStatus()`'s
 * `effectiveCadenceMs`. For mt5 `1d`, 1,227 of 1,256 half-hour-shifted rows were
 * byte-identical duplicates of the real bar.
 *
 * The regression this guards is exact: aligning must make the offset duplicate collapse
 * onto the real bar so the unique key rejects it.
 */
describe('alignBarTimestamp', () => {
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  describe('intraday cadences floor to their open boundary', () => {
    it.each([
      // [timeframe, input, expected]
      ['1m', '2026-09-10T13:30:45.123Z', '2026-09-10T13:30:00.000Z'],
      ['5m', '2026-09-10T13:33:00.000Z', '2026-09-10T13:30:00.000Z'],
      ['15m', '2026-09-10T13:45:00.000Z', '2026-09-10T13:45:00.000Z'],
      ['15m', '2026-09-10T13:59:59.000Z', '2026-09-10T13:45:00.000Z'],
      ['30m', '2026-09-10T13:45:00.000Z', '2026-09-10T13:30:00.000Z'],
      ['1h', '2026-09-10T13:30:00.000Z', '2026-09-10T13:00:00.000Z'],
      ['1h', '2026-09-10T13:00:00.000Z', '2026-09-10T13:00:00.000Z'],
      ['4h', '2026-09-10T17:30:00.000Z', '2026-09-10T16:00:00.000Z'],
      ['4h', '2026-09-10T16:00:00.000Z', '2026-09-10T16:00:00.000Z'],
    ])('floors %s %s -> %s', (tf, input, expected) => {
      expect(iso(alignBarTimestamp(input, tf, 'mt5'))).toBe(expected);
    });

    it('never rounds UP — a bar must not move into the next period', () => {
      // 13:59:59.999 is still the 13:00 hourly bar. Rounding would move it to 14:00
      // and silently rewrite history, so flooring is the only correct direction.
      expect(iso(alignBarTimestamp('2026-09-10T13:59:59.999Z', '1h', 'mt5')))
        .toBe('2026-09-10T13:00:00.000Z');
    });

    it('is idempotent — an already-aligned bar is unchanged', () => {
      const once = alignBarTimestamp('2026-09-10T13:00:00.000Z', '1h', 'mt5');
      const twice = alignBarTimestamp(once, '1h', 'mt5');
      expect(twice?.getTime()).toBe(once?.getTime());
    });
  });

  describe('the #783 regression — an offset duplicate collapses onto the real bar', () => {
    it('maps 1h 13:30 onto the real 13:00 bar so the unique key rejects it', () => {
      // These were the two live rows for AMZN 2026-08-24 hour 13: identical OHLCV,
      // 16 days apart in import time, one stamped 13:00 and one 13:30.
      const real = alignBarTimestamp('2026-08-24T13:00:00.000Z', '1h', 'mt5');
      const phantom = alignBarTimestamp('2026-08-24T13:30:00.000Z', '1h', 'mt5');
      expect(phantom?.getTime()).toBe(real?.getTime());
    });

    it('maps the mt5 1d 21:30 phantom onto the real 21:00 bar', () => {
      const real = alignBarTimestamp('2026-09-09T21:00:00.000Z', '1d', 'mt5');
      const phantom = alignBarTimestamp('2026-09-09T21:30:00.000Z', '1d', 'mt5');
      expect(iso(real)).toBe('2026-09-09T21:00:00.000Z');
      expect(phantom?.getTime()).toBe(real?.getTime());
    });
  });

  describe('1d honours the PROVIDER boundary, not a hardcoded UTC hour', () => {
    // A blanket "floor 1d to 21:00" would shift every binance bar by three hours.
    it('uses 21:00 UTC for mt5 (CME/COMEX/FX close)', () => {
      expect(iso(alignBarTimestamp('2026-09-09T21:30:00.000Z', '1d', 'mt5')))
        .toBe('2026-09-09T21:00:00.000Z');
    });

    it('uses 00:00 UTC for binance (crypto close)', () => {
      expect(iso(alignBarTimestamp('2026-09-09T23:59:00.000Z', '1d', 'binance')))
        .toBe('2026-09-09T00:00:00.000Z');
    });

    it('uses 07:00 UTC for yahoo', () => {
      expect(iso(alignBarTimestamp('2026-09-09T07:00:00.000Z', '1d', 'yahoo')))
        .toBe('2026-09-09T07:00:00.000Z');
    });

    it('falls back to the mt5 boundary for an unknown provider', () => {
      expect(iso(alignBarTimestamp('2026-09-09T21:30:00.000Z', '1d', 'some-new-feed')))
        .toBe('2026-09-09T21:00:00.000Z');
    });

    it('pulls a bar stamped BEFORE its boundary back to the prior session', () => {
      // An mt5 daily bar at 20:00 UTC is the close of the previous session, not the
      // start of a new one. Without this it would create a second row per session.
      expect(iso(alignBarTimestamp('2026-09-09T20:00:00.000Z', '1d', 'mt5')))
        .toBe('2026-09-08T21:00:00.000Z');
    });

    it('leaves a correctly-stamped daily bar untouched', () => {
      expect(iso(alignBarTimestamp('2026-09-09T21:00:00.000Z', '1d', 'mt5')))
        .toBe('2026-09-09T21:00:00.000Z');
    });
  });

  describe('1w floors to Monday 00:00 UTC', () => {
    it.each([
      ['2026-09-10T13:00:00.000Z', '2026-09-07T00:00:00.000Z'], // Thursday -> Monday
      ['2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'], // Monday unchanged
      ['2026-09-06T23:00:00.000Z', '2026-08-31T00:00:00.000Z'], // Sunday -> prior Monday
    ])('floors %s -> %s', (input, expected) => {
      expect(iso(alignBarTimestamp(input, '1w', 'mt5'))).toBe(expected);
    });
  });

  describe('malformed input is rejected, never coerced', () => {
    it('returns null for an unparseable timestamp', () => {
      // Coercing bad input to now() or epoch 0 would write a bar that looks real.
      expect(alignBarTimestamp('not-a-date', '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp(undefined, '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp(null, '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp('', '1h', 'mt5')).toBeNull();
    });

    it('returns null for whitespace-only strings', () => {
      expect(alignBarTimestamp('   ', '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp('\t\n', '1h', 'mt5')).toBeNull();
    });

    it('rejects null-ish and non-scalar values that would coerce to epoch 0', () => {
      // ⚠️ THE TRAP: `new Date(null).getTime()` === 0, NOT NaN. A naive
      // `Number.isNaN` check therefore lets these through and they become
      // **1970-01-01** — a bar dated 1970 that looks like real data. `false` and
      // `[]` coerce to 0 the same way. This test exists because the first version
      // of `alignBarTimestamp` had exactly this hole.
      expect(alignBarTimestamp(false, '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp([], '1h', 'mt5')).toBeNull();
      expect(alignBarTimestamp({}, '1h', 'mt5')).toBeNull();
    });

    it('does allow a genuine epoch-0 number, because that is a real instant', () => {
      // 0 is a legitimate (if ancient) timestamp when passed as a NUMBER. The
      // guard rejects null/undefined/false, not the number zero.
      expect(alignBarTimestamp(0, '1h', 'mt5')).not.toBeNull();
    });
  });

  describe('accepts every timestamp shape the import endpoint can receive', () => {
    it('handles Date, ISO string and epoch ms identically', () => {
      const expected = Date.UTC(2026, 8, 10, 13, 0, 0);
      expect(alignBarTimestamp(new Date('2026-09-10T13:30:00.000Z'), '1h', 'mt5')?.getTime())
        .toBe(expected);
      expect(alignBarTimestamp('2026-09-10T13:30:00.000Z', '1h', 'mt5')?.getTime())
        .toBe(expected);
      expect(alignBarTimestamp(expected + 30 * 60_000, '1h', 'mt5')?.getTime())
        .toBe(expected);
    });
  });
});

describe('isBarAligned', () => {
  it('is true only for exact boundaries', () => {
    expect(isBarAligned('2026-09-10T13:00:00.000Z', '1h', 'mt5')).toBe(true);
    expect(isBarAligned('2026-09-10T13:30:00.000Z', '1h', 'mt5')).toBe(false);
    expect(isBarAligned('2026-09-09T21:00:00.000Z', '1d', 'mt5')).toBe(true);
    expect(isBarAligned('2026-09-09T21:30:00.000Z', '1d', 'mt5')).toBe(false);
    expect(isBarAligned('nonsense', '1h', 'mt5')).toBe(false);
  });

  it('detects the live phantom pattern — every 21:30 mt5 daily bar is misaligned', () => {
    // The whole 1,256-row 21:30 cohort from #783 fails this check by construction.
    expect(isBarAligned('2026-09-08T21:30:00.000Z', '1d', 'mt5')).toBe(false);
    expect(isBarAligned('2026-09-07T21:30:00.000Z', '1d', 'mt5')).toBe(false);
    expect(isBarAligned('2026-09-06T21:30:00.000Z', '1d', 'mt5')).toBe(false);
  });
});
