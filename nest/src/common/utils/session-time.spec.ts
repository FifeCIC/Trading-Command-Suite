import {
  zoneOffsetMs,
  zonedWallClockInstant,
  minutesInZone,
  minutesFromOpen,
} from './session-time';

/**
 * Regression tests for the wall-clock → instant conversion (epic #731, 2026-09-10).
 *
 * The old inline implementation
 *   `const d = new Date(onDay.toLocaleString('en-US', { timeZone: iana })); d.setHours(h, m)`
 * parsed the ZONE's wall clock in the MACHINE's timezone. Measured on a
 * Europe/London machine it put:
 *   - New York's 09:30 open at 08:30 UTC (5 hours early)
 *   - Tokyo's 09:00 open at 08:00 UTC (8 hours late)
 *   - London's 08:00 open correctly — by accident of the machine's zone
 * and `session-open-effect` consequently scored 6,308 times without ever
 * leaving its no-signal branch.
 *
 * These expectations are absolute UTC instants, so they hold on ANY machine.
 */
describe('session-time — zone-correct session instants', () => {
  const BST_DAY = new Date('2026-09-10T12:00:00Z');  // British Summer Time / EDT
  const GMT_DAY = new Date('2026-01-15T12:00:00Z');  // GMT / EST

  it('resolves the New York open to the correct UTC instant', () => {
    expect(zonedWallClockInstant('America/New_York', BST_DAY, '09:30').toISOString())
      .toBe('2026-09-10T13:30:00.000Z'); // EDT = UTC-4
    expect(zonedWallClockInstant('America/New_York', GMT_DAY, '09:30').toISOString())
      .toBe('2026-01-15T14:30:00.000Z'); // EST = UTC-5
  });

  it('resolves the Tokyo open to the correct UTC instant', () => {
    expect(zonedWallClockInstant('Asia/Tokyo', BST_DAY, '09:00').toISOString())
      .toBe('2026-09-10T00:00:00.000Z'); // JST = UTC+9
    expect(zonedWallClockInstant('Asia/Tokyo', GMT_DAY, '09:00').toISOString())
      .toBe('2026-01-15T00:00:00.000Z');
  });

  it('resolves the London open across both BST and GMT', () => {
    expect(zonedWallClockInstant('Europe/London', BST_DAY, '08:00').toISOString())
      .toBe('2026-09-10T07:00:00.000Z'); // BST = UTC+1
    expect(zonedWallClockInstant('Europe/London', GMT_DAY, '08:00').toISOString())
      .toBe('2026-01-15T08:00:00.000Z'); // GMT = UTC+0
  });

  it('picks the zone calendar day, not the machine day', () => {
    // 23:30 UTC on the 10th is already the 11th in Tokyo.
    const lateUtc = new Date('2026-09-10T23:30:00Z');
    expect(zonedWallClockInstant('Asia/Tokyo', lateUtc, '09:00').toISOString())
      .toBe('2026-09-11T00:00:00.000Z');
    // ...and still the 10th in New York.
    expect(zonedWallClockInstant('America/New_York', lateUtc, '09:30').toISOString())
      .toBe('2026-09-10T13:30:00.000Z');
  });

  it('reports the zone offset with the right sign', () => {
    expect(zoneOffsetMs('America/New_York', BST_DAY)).toBe(-4 * 3600_000);
    expect(zoneOffsetMs('Asia/Tokyo', BST_DAY)).toBe(9 * 3600_000);
    expect(zoneOffsetMs('Europe/London', BST_DAY)).toBe(3600_000);
    expect(zoneOffsetMs('Europe/London', GMT_DAY)).toBe(0);
  });

  it('measures distance to the open from wall clocks, so DST cannot skew it', () => {
    // Exactly at the New York open.
    const atOpen = new Date('2026-09-10T13:30:00Z');
    expect(minutesFromOpen(atOpen, 'America/New_York', '09:30')).toBe(0);
    // 25 minutes after, and 20 minutes before (both small and signed).
    expect(minutesFromOpen(new Date('2026-09-10T13:55:00Z'), 'America/New_York', '09:30')).toBe(25);
    expect(minutesFromOpen(new Date('2026-09-10T13:10:00Z'), 'America/New_York', '09:30')).toBe(-20);
    // Wrapping across midnight stays small for a session that opens just after it.
    expect(minutesFromOpen(new Date('2026-09-10T00:05:00Z'), 'Asia/Tokyo', '09:00')).toBe(5);
    expect(minutesInZone(new Date('2026-09-10T13:30:00Z'), 'America/New_York')).toBe(9 * 60 + 30);
  });
});
