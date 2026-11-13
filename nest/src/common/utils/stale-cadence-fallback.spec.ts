/**
 * stale-cadence-fallback.spec.ts — GUARD for `pickScoringCadence()` (#1165/#1264).
 *
 * ── WHAT THIS PROVES ──
 * A protocol is scored on the FINEST cadence that has FRESH data. Every case below is taken from a
 * real measurement on 2026-11-13, so a regression fails with the number that caused it rather than
 * with an invented fixture.
 *
 * ⚠️ THE BASELINE CASE IS THE GER40 ONE. The old behaviour scored the base `1m` series 7.6 hours
 * after it had frozen; the constant composite that produced was **89** on all 108 snapshots in two
 * hours, against an entry threshold of 10 on six `auto` bots. Do not "simplify" this away.
 */
import { pickScoringCadence, isStaleForCadence } from './timeframe';

/** GER40's measured bar ages at 2026-11-13T20:09Z, as (cadence, hoursOld) pairs. */
const GER40: Array<[string, number]> = [
  ['1m', 7.6],
  ['15m', 7.8],
  ['1h', 8.3],
  ['1d', 23.3],
];

const NOW = new Date('2026-11-13T20:09:00Z').getTime();
const barAgedHours = (hours: number) => [{ timestamp: new Date(NOW - hours * 3_600_000).toISOString() }];
const setsFor = (rows: Array<[string, number]>) =>
  rows.map(([tf, hours]) => ({ tf, bars: barAgedHours(hours) }));

describe('pickScoringCadence', () => {
  it('GER40: a frozen 1m base falls back to 1h — the finest cadence that is actually fresh', () => {
    const pick = pickScoringCadence(setsFor(GER40), NOW);

    expect(pick.allStale).toBe(false);
    expect(pick.switched).toBe(true);
    expect(pick.requested).toBe('1m');
    // 15m is stale at 7.8h against a 4h tolerance, so 1h is the first fresh one (8.3h < 12h).
    expect(pick.chosen?.tf).toBe('1h');
  });

  it('the cadences it DOES reject are rejected for the right reason, not by accident', () => {
    // If either of these ever becomes fresh, the fallback in the test above is passing for the
    // wrong reason — this pins the tolerances the decision depends on.
    expect(isStaleForCadence(barAgedHours(7.6)[0].timestamp, '1m', NOW)).toBe(true);
    expect(isStaleForCadence(barAgedHours(7.8)[0].timestamp, '15m', NOW)).toBe(true);
    expect(isStaleForCadence(barAgedHours(8.3)[0].timestamp, '1h', NOW)).toBe(false);
  });

  it('a fresh base cadence is used as-is — no switch, no behaviour change for healthy symbols', () => {
    const pick = pickScoringCadence(setsFor([['1m', 0.1], ['15m', 0.0], ['1h', 0.7], ['1d', 11]]), NOW);

    expect(pick.chosen?.tf).toBe('1m');
    expect(pick.switched).toBe(false);
    expect(pick.allStale).toBe(false);
  });

  it('every cadence stale is reported as allStale with no cadence chosen — the refusal path', () => {
    // The 17 July cohort shape: 1h ending weeks ago, 1d too.
    const pick = pickScoringCadence(setsFor([['1m', 2_000], ['15m', 2_000], ['1h', 2_000], ['1d', 2_000]]), NOW);

    expect(pick.allStale).toBe(true);
    expect(pick.chosen).toBeNull();
    expect(pick.switched).toBe(false);
  });

  it('an EMPTY cadence array is "nothing to judge", never "dead"', () => {
    const pick = pickScoringCadence([], NOW);

    expect(pick.allStale).toBe(false);
    expect(pick.chosen).toBeNull();
    expect(pick.requested).toBeNull();
  });

  it('a cadence with no bars is skipped without being called stale', () => {
    const pick = pickScoringCadence(
      [{ tf: '1m', bars: [] }, { tf: '1h', bars: barAgedHours(0.2) }],
      NOW,
    );

    expect(pick.chosen?.tf).toBe('1h');
    expect(pick.switched).toBe(true);
    expect(pick.allStale).toBe(false);
  });

  it('a malformed timestamp does not pause scoring — unparseable is not old', () => {
    const pick = pickScoringCadence([{ tf: '1m', bars: [{ timestamp: 'not-a-date' }] }], NOW);

    expect(pick.allStale).toBe(false);
    expect(pick.chosen?.tf).toBe('1m');
  });

  it('the coarsest cadence is used only when everything finer is stale', () => {
    const pick = pickScoringCadence(
      setsFor([['1m', 30], ['15m', 30], ['1h', 30], ['1d', 30]]),
      NOW,
    );

    // 1d tolerance is 72h, so a 30h-old daily series is the last resort and is still chosen —
    // refusing here would drop the symbol from the ladder entirely (#827's measured harm).
    expect(pick.chosen?.tf).toBe('1d');
    expect(pick.switched).toBe(true);
    expect(pick.allStale).toBe(false);
  });
});
