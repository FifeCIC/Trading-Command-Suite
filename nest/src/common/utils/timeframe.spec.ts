import { selectBaseTimeframe, DEFAULT_LIVE_TIMEFRAME, alignBarTimestamp, isBarAligned, barLengthMs, cadenceStaleMs, isStaleForCadence, everyCadenceStale } from './timeframe';

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

/**
 * Cadence staleness — the shared owner for "is this series still current?" (#827 / #838).
 *
 * TWO consumers depend on these numbers agreeing, which is why the table is here rather than
 * duplicated: `bar-refresh.service.ts` decides whether to WRITE a bar set, and
 * `signal-envelope.service.ts` decides whether to SCORE a symbol at all. If they disagreed, ingest
 * would accept what scoring rejects (or worse, the reverse).
 */
describe('cadenceStaleMs — how old the newest bar may be', () => {
  const NOW = Date.parse('2026-09-16T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('is NOT the bar length — conflating the two is the trap this guards', () => {
    // "how long is a bar" and "how long may the newest bar be before I stop trusting it" are
    // different questions. For 1m they differ by 60x. If someone ever "simplifies" the staleness
    // check onto barLengthMs(), this fails immediately rather than shipping a feed that either
    // rejects every live symbol (tolerance = one bar) or accepts months-old data.
    expect(cadenceStaleMs('1m')).toBe(3_600_000);
    expect(barLengthMs('1m')).toBe(60_000);
    expect(cadenceStaleMs('1m')).not.toBe(barLengthMs('1m'));

    // ...and it is not merely a constant multiple either — the RATIO changes by cadence.
    expect(cadenceStaleMs('1d') / barLengthMs('1d')).toBe(3);   // 72h / 24h
    expect(cadenceStaleMs('1m') / barLengthMs('1m')).toBe(60);  // 1h / 1m
  });

  it('allows the real weekend gap for mt5 dailies — Fri 21:00 -> Mon 21:00 is exactly 72h', () => {
    // The tightest legitimate case for 1d. `isStaleForCadence` uses `>` so the boundary is
    // inclusive; if this starts failing, a quiet Monday has begun rejecting Friday's daily bar.
    expect(isStaleForCadence(ago(72 * 3_600_000), '1d', NOW)).toBe(false);
    expect(isStaleForCadence(ago(72 * 3_600_000 + 1), '1d', NOW)).toBe(true);
  });

  it('every cadence tolerates at least several of its own bars', () => {
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
      const bars = cadenceStaleMs(tf) / barLengthMs(tf);
      expect(bars).toBeGreaterThanOrEqual(3);
    }
  });

  it('does NOT reject a session break on coarser cadences — the #838 measurement, as a test', () => {
    // Measured live: 18 rejected pairs were ALL 1m, 1.9-4.6h old, on symbols ALIVE on 5-6 other
    // timeframes (SPY, QQQ, AMZN, UK100). A 2h-old stamp is stale for 1m (1h) but fresh for
    // everything else, so a nightly break costs only the tightest cadence. This pins that the
    // check is per (symbol, timeframe) and never suppresses a symbol wholesale.
    const twoHoursOld = ago(2 * 3_600_000);
    expect(isStaleForCadence(twoHoursOld, '1m', NOW)).toBe(true);
    for (const tf of ['5m', '15m', '1h', '4h', '1d']) {
      expect(isStaleForCadence(twoHoursOld, tf, NOW)).toBe(false);
    }
  });

  it('treats a malformed timestamp as NOT stale — a different fault must stay distinguishable', () => {
    // Returning `true` here would let an unparseable timestamp masquerade as "old data" and be
    // silently skipped. `isBarFutureStamped` draws the same line for the same reason.
    expect(isStaleForCadence('nonsense', '1h', NOW)).toBe(false);
    expect(isStaleForCadence(undefined, '1h', NOW)).toBe(false);
  });

  it('falls back to daily for an unrecognised cadence', () => {
    expect(cadenceStaleMs('1w')).toBe(24 * 3_600_000);
    expect(isStaleForCadence(ago(25 * 3_600_000), '1w', NOW)).toBe(true);
  });

  it('reproduces the live #827 defect — the 17 July cohort is stale on EVERY cadence', () => {
    // Ten US equities (TSLA, COIN, PLTR, SOFI, RKLB, RIOT, MARA, ASTS, HOOD, NVDA…) shared one
    // exact stale timestamp and were scored for eight weeks. Under the old envelope check only
    // EMPTY was rejected, so all ten produced predictions dated 17 July — which then sorted to the
    // FRONT of the maturation queue (`orderBy: predictedAt ASC`) ahead of every real row.
    const jul17 = '2026-07-17T21:00:00.000Z';
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
      expect(isStaleForCadence(jul17, tf, NOW)).toBe(true);
    }
  });
});

/**
 * Is the SYMBOL dead? (#827)
 *
 * ⚠️ THESE TESTS EXIST BECAUSE THE OBVIOUS IMPLEMENTATION WAS SHIPPED-BY-ACCIDENT-AND-CAUGHT.
 *
 * Checking only the BASE cadence skipped 11 symbols that were all ALIVE — SPY, QQQ, US500, USTEC,
 * XAUUSD, XAGUSD, UK100, GER40, FRA40, CHINA50, VIX — because a `1m` feed goes quiet whenever the
 * market is closed or the session is thin. The values below are the LIVE MEASUREMENTS from that
 * check, not invented ones, which is what makes them a real regression guard rather than a
 * restatement of the implementation.
 */
describe('everyCadenceStale — per-symbol, not per-base-cadence', () => {
  const NOW = Date.parse('2026-09-16T07:43:00.000Z');
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

  it('⚠️ SPY at 04:43 ET is ALIVE — a stale 1m must not remove it from the ladder', () => {
    // Measured: SPY 1m=12h, 5m=0.1h, 15m=12h, 1h=4.7h, 1d=35h.
    // The 1m feed is 12h quiet because the US market is CLOSED; the symbol is trading on 5m.
    // A base-cadence-only check returns TRUE here and silently drops SPY.
    expect(everyCadenceStale([
      { timeframe: '1m', newest: at(12) },    // stale (tol 1h)
      { timeframe: '1d', newest: at(35) },    // FRESH (tol 72h)
      { timeframe: '1h', newest: at(4.7) },   // fresh (tol 12h)
      { timeframe: '15m', newest: at(12) },   // stale (tol 4h)
    ], NOW)).toBe(false);
  });

  it('⚠️ XAUUSD is ALIVE while its 1m is quiet — the tightest real case measured', () => {
    // Measured: XAUUSD 1m=8.6h, 5m=0.0h, 15m=0.0h, 1h=0.7h, 1d=11h. Gold is trading NOW.
    expect(everyCadenceStale([
      { timeframe: '1m', newest: at(8.6) },   // stale
      { timeframe: '15m', newest: at(0.0) },  // forming
      { timeframe: '1h', newest: at(0.7) },
      { timeframe: '1d', newest: at(11) },
    ], NOW)).toBe(false);
  });

  it('the 17 July cohort IS dead — every cadence stale, so it is still caught', () => {
    // HOOD: 1h ended 31 July, 1d ended 21 July. Nothing is alive.
    expect(everyCadenceStale([
      { timeframe: '1d', newest: '2026-07-21T21:00:00.000Z' },
      { timeframe: '1h', newest: '2026-07-31T21:00:00.000Z' },
      { timeframe: '15m', newest: '2026-07-31T21:00:00.000Z' },
      { timeframe: '1m', newest: '2026-07-31T21:00:00.000Z' },
    ], NOW)).toBe(true);
  });

  it('one fresh cadence anywhere is enough to keep scoring', () => {
    expect(everyCadenceStale([
      { timeframe: '1m', newest: at(500) },
      { timeframe: '1d', newest: at(1) },   // the only fresh one
    ], NOW)).toBe(false);
  });

  it('an EMPTY set is NOT dead — "nothing to judge" differs from "judged and all stale"', () => {
    // The caller handles an empty marketBars array separately. Returning true here would skip a
    // symbol because of a loading fault, which is the opposite of the intent.
    expect(everyCadenceStale([], NOW)).toBe(false);
  });

  it('a single stale cadence IS dead — a symbol with only one usable series', () => {
    expect(everyCadenceStale([{ timeframe: '1h', newest: at(100) }], NOW)).toBe(true);
    expect(everyCadenceStale([{ timeframe: '1h', newest: at(1) }], NOW)).toBe(false);
  });
});
