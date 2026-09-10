import { computeMarketStatus } from './market-status';
import { MarketBar } from './interfaces/directive.interface';

/**
 * Timeframe-relative staleness window (2026-09-10).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `computeMarketStatus` derived its staleness window as `medianInterval * 3`
 * over WHATEVER bars the caller passed. Two consequences, both live:
 *
 *  1. MIXED ARRAYS. A protocol loading `1d` bars while the caller's array also
 *     held `1m`/`5m`/`15m` produced a meaningless median. `ftse-speed-v1` (a 1d
 *     protocol) was told "last real bar 4m old (market closed)" while its newest
 *     5m bar was 8 minutes old — entirely fresh.
 *
 *  2. MID-FORMATION BARS. A 15m bar is legitimately up to 15m old the moment
 *     after it opens, so a tight window flapped. Observed failing ages on live
 *     markets with fresh data: 4m, 17m and 18m.
 *
 * The failure was not cosmetic. `liquidity-check` converts a closed reading into
 * `score: 0`, which the risk engine turned into a HARD GATE — so fresh data
 * reading as closed zeroed the composite and blocked the trade, blaming "symbol
 * liquidity too low". Over 45 minutes `spy-day-v1` (11 ticks), `qqq-day-v1` (11)
 * and `spy-speed-v1` (7) were gated shut on EVERY tick.
 *
 * THE CONTRACT
 * ------------
 * The window must be relative to the cadence the data is ON, and must be wide
 * enough that a bar still in formation is never mistaken for a dead feed —
 * while a genuinely frozen feed (weekend, 7-week BTCUSD freeze, #750 +3h skew)
 * still reads CLOSED.
 */
describe('computeMarketStatus — timeframe-relative staleness window', () => {
  const MIN = 60_000;

  /** Build `count` bars on `cadenceMin`, oldest → newest, ending at `lastBarAt`. */
  function series(count: number, lastBarAt: Date, cadenceMin: number, volume = 100): MarketBar[] {
    const out: MarketBar[] = [];
    for (let i = count - 1; i >= 0; i--) {
      out.push({
        timestamp: new Date(lastBarAt.getTime() - i * cadenceMin * MIN),
        open: 1, high: 1, low: 1, close: 1, volume,
      });
    }
    return out;
  }

  const NOW = new Date('2026-09-10T09:15:00Z');

  // ── The live failure: fresh data misread as closed ─────────────────────────
  it('reads OPEN when a bar is still forming mid-cadence (the 4m/17m/18m cases)', () => {
    // A 5m feed whose newest real bar is 4 minutes old — normal, not stale.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 4 * MIN), 5), NOW, '5m').open,
    ).toBe(true);

    // A 15m feed whose newest bar is 17 minutes old — the bar is in formation.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 17 * MIN), 15), NOW, '15m').open,
    ).toBe(true);

    // 18 minutes, same 15m cadence.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 18 * MIN), 15), NOW, '15m').open,
    ).toBe(true);
  });

  // ── Bars are stamped at bar-OPEN (the 2026-09-10 evening regression) ────────
  //
  // ⚠️ THE WINDOW MUST BE `2 × cadence + grace`, NOT `cadence + grace`.
  //
  // A 1h bar stamped 19:00 COVERS 19:00–20:00, so at 20:38 it is 98 minutes old
  // and is STILL THE CURRENT BAR. Measured live on a Thursday evening with XAUUSD
  // actively trading (its 5m bar was 3 minutes old) the whole gold family read
  // CLOSED, and because a `frozen` card sorts below a live one in the Ladder, the
  // HIGHEST-scoring card (`xau-speed-1h`, composite 185) never reached the top.
  //
  // The first rework used `cadence + 15m` (75m for 1h) and passed every test in
  // this file, because every case was a 5m feed. These cases exist so the window
  // cannot be tightened again without a failure.
  it('reads OPEN for an open-stamped 1h bar that is still the current bar', () => {
    // 98 minutes old on a 60m cadence — the exact live failing case.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 98 * MIN), 60), NOW, '1h').open,
    ).toBe(true);

    // And the worst legitimate case: just under one full extra cadence.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 119 * MIN), 60), NOW, '1h').open,
    ).toBe(true);
  });

  it('reads OPEN for an open-stamped 15m bar just past its own window', () => {
    // A 15m bar stamped 19:45 covers 19:45–20:00. Read at 20:38 it is 53 minutes
    // old — that is THREE 15m bars behind, so CLOSED is correct here.
    //
    // ⚠️ This assertion was originally written the other way and was wrong: it
    // conflated "one bar late" (tolerable, because the next bar may not have been
    // ingested yet) with "three bars late" (a genuinely stalled feed). The window
    // is `2 × cadence + 15m` = 45m, so 53m is correctly stale.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 53 * MIN), 15), NOW, '15m').open,
    ).toBe(false);

    // The tolerable case: one bar late (30m on a 15m cadence).
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 30 * MIN), 15), NOW, '15m').open,
    ).toBe(true);
  });

  it('reads OPEN at the boundary for every cadence (open-stamped tolerance)', () => {
    // Sweep: at `2 × cadence` exactly, every cadence must still read open.
    for (const [tf, cadenceMin] of [
      ['1m', 1], ['5m', 5], ['15m', 15], ['30m', 30], ['1h', 60], ['4h', 240],
    ] as const) {
      const status = computeMarketStatus(
        series(30, new Date(NOW.getTime() - cadenceMin * 2 * MIN), cadenceMin), NOW, tf,
      );
      expect(status.open).toBe(true);
    }
  });

  it('still reads CLOSED well beyond two cadences (fail-closed preserved)', () => {
    // 3h on a 1h cadence = 180m vs a 135m window → genuinely stale.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 180 * MIN), 60), NOW, '1h').open,
    ).toBe(false);
  });

  it('reads OPEN on a 1d protocol even though its daily bar is ~17h old', () => {
    // `ftse-speed-v1` runs on 1d bars. A daily bar opened at 21:00 UTC the
    // previous evening is mid-formation, not stale — the case that flapped.
    const lastDaily = new Date('2026-09-09T21:00:00Z');
    expect(computeMarketStatus(series(30, lastDaily, 1440), NOW, '1d').open).toBe(true);
  });

  it('is NOT fooled by a mixed-timeframe array', () => {
    // The caller passes 1d bars but the array also contains recent 1m bars.
    // Preferring the DECLARED cadence makes the answer independent of the mix.
    const daily = series(30, new Date('2026-09-09T21:00:00Z'), 1440);
    const intraday = series(5, new Date(NOW.getTime() - 5 * MIN), 1);
    const mixed = [...intraday, ...daily];

    expect(computeMarketStatus(mixed, NOW, '1d').open).toBe(true);
  });

  // ── Fail-closed must survive ───────────────────────────────────────────────
  it('still reads CLOSED for a genuinely stale feed on any cadence', () => {
    // 3h old on a 5m cadence — a dead feed (window 25m).
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 180 * MIN), 5), NOW, '5m').open,
    ).toBe(false);

    // ⚠️ On a 1d cadence the window is now `2 × 1440 + 15 = 2895m`, because bars
    // are stamped at bar-OPEN and a daily bar must be allowed to be a full window
    // old while still being the current one. So "2 days" is INSIDE the window —
    // 3 days is the first age that is genuinely stale. (This assertion previously
    // said 2 days and was written against the tighter `cadence + grace` window.)
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 2 * 1440 * MIN), 1440), NOW, '1d')
        .open,
    ).toBe(true);

    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 3 * 1440 * MIN), 1440), NOW, '1d')
        .open,
    ).toBe(false);
  });

  it('still reads CLOSED for a bar stamped hours in the future (clock skew, #750)', () => {
    const status = computeMarketStatus(
      series(30, new Date(NOW.getTime() + 180 * MIN), 5), NOW, '5m',
    );
    expect(status.open).toBe(false);
    expect(status.reason).toContain('clock skew');
  });

  it('still reads CLOSED when every bar is a synthetic placeholder', () => {
    // BarRefreshService upserts a `now`-stamped bar with volume 1 even when the
    // market is shut; it must not be able to fake freshness.
    const status = computeMarketStatus(series(30, NOW, 5, 1), NOW, '5m');
    expect(status.open).toBe(false);
    expect(status.reason).toContain('synthetic');
  });

  it('still reads CLOSED when the cadence is unverifiable and none was declared', () => {
    // No declared timeframe + duplicate timestamps = no measurable cadence.
    const dupes: MarketBar[] = Array.from({ length: 5 }, () => ({
      timestamp: NOW, open: 1, high: 1, low: 1, close: 1, volume: 100,
    }));
    const status = computeMarketStatus(dupes, NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('indeterminate bar cadence');
  });

  it('accepts a declared cadence even when intervals cannot be measured', () => {
    // With the timeframe declared, the window does not depend on measuring
    // intervals, so duplicate stamps are no longer a reason to veto.
    const dupes: MarketBar[] = Array.from({ length: 5 }, () => ({
      timestamp: NOW, open: 1, high: 1, low: 1, close: 1, volume: 100,
    }));
    expect(computeMarketStatus(dupes, NOW, '5m').open).toBe(true);
  });

  it('keeps a 20-minute floor so a short cadence cannot flap', () => {
    // A 1m feed idle for 12 minutes: longer than 3x the cadence, but far inside
    // the floor — the market produced data recently enough to be live.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 12 * MIN), 1), NOW, '1m').open,
    ).toBe(true);

    // 25 minutes on a 1m feed exceeds the floor and is genuinely stale.
    expect(
      computeMarketStatus(series(30, new Date(NOW.getTime() - 25 * MIN), 1), NOW, '1m').open,
    ).toBe(false);
  });

  it('never declares a live feed closed merely because one bar has not formed', () => {
    // Sweep every cadence at an age equal to exactly one cadence: always live.
    for (const [tf, cadenceMin] of [
      ['1m', 1], ['5m', 5], ['15m', 15], ['1h', 60], ['4h', 240], ['1d', 1440],
    ] as const) {
      const status = computeMarketStatus(
        series(30, new Date(NOW.getTime() - cadenceMin * MIN), cadenceMin), NOW, tf,
      );
      expect(status.open).toBe(true);
    }
  });
});
