/**
 * max-hold.spec.ts — the bot's own time stop (#1136).
 *
 * ⚠️ WHY THIS EXISTS. `maxHoldHours` is set on 42 of 64 active bots and the backtester ignored it
 * entirely, so a run held trades past the point the live bot would have closed them. This pins the
 * comparison in both directions plus the boundary, because the boundary is the decision: `>=` closes a
 * trade whose bar is exactly at the limit, `>` would hold it one bar longer.
 *
 * CANARY: changing `>=` to `>` in `max-hold.ts` makes the "exactly at the limit" case fail. Deleting
 * the `limit <= 0` guard makes the "0 means no limit" case fail. Both were observed.
 */
import { maxHoldExpired } from './max-hold';

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);
const hours = (h: number) => T0 + h * 3_600_000;

describe('maxHoldExpired — the bot time stop', () => {
  it('does NOT expire before the limit', () => {
    expect(maxHoldExpired(T0, hours(4) - 1, 4)).toBe(false);
  });

  it('EXPIRES exactly at the limit — the boundary is inclusive', () => {
    // Live closes when the held duration has REACHED the limit. `>` here would hold one bar longer
    // and silently shift every time-stopped trade in the population.
    expect(maxHoldExpired(T0, hours(4), 4)).toBe(true);
  });

  it('expires after the limit', () => {
    expect(maxHoldExpired(T0, hours(12), 4)).toBe(true);
  });

  it('no limit: null, undefined, 0 and negative all mean NEVER', () => {
    expect(maxHoldExpired(T0, hours(1000), null)).toBe(false);
    expect(maxHoldExpired(T0, hours(1000), undefined)).toBe(false);
    // ⚠️ A missing setting must not become a zero-length hold. If 0 expired, every trade would close
    // on the bar after entry and the run would look like a catastrophic strategy, not a mis-read field.
    expect(maxHoldExpired(T0, hours(1), 0)).toBe(false);
    expect(maxHoldExpired(T0, hours(1), -5)).toBe(false);
  });

  it('no limit: a non-finite value is no limit, never zero', () => {
    expect(maxHoldExpired(T0, hours(1), Number.NaN)).toBe(false);
    expect(maxHoldExpired(T0, hours(1), Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('a bar BEFORE the entry cannot have expired', () => {
    // Guards a reversed or mis-joined bar series rather than reporting a hold that never happened.
    expect(maxHoldExpired(T0, hours(-1), 4)).toBe(false);
  });

  it('fractional hours are honoured (1.5h)', () => {
    expect(maxHoldExpired(T0, hours(1.4), 1.5)).toBe(false);
    expect(maxHoldExpired(T0, hours(1.5), 1.5)).toBe(true);
  });

  it('unreadable timestamps do not expire', () => {
    expect(maxHoldExpired(Number.NaN, hours(5), 4)).toBe(false);
    expect(maxHoldExpired(T0, Number.NaN, 4)).toBe(false);
  });

  it('the real configured values all behave (4h, 12h, 24h, 72h, 120h)', () => {
    // The distinct values actually set on active bots, measured 2026-11-16.
    for (const h of [4, 12, 24, 72, 120]) {
      expect(maxHoldExpired(T0, hours(h) - 1, h)).toBe(false);
      expect(maxHoldExpired(T0, hours(h), h)).toBe(true);
    }
  });
});
