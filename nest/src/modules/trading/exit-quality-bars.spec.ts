/**
 * exit-quality-bars.spec.ts — the bar-derived measurement must be cheap to read and honest about
 * whether it exists yet (#1149 follow-up).
 *
 * ⚠️ THE MEASUREMENT THAT SHAPED THIS FILE. The range join over `marketbar` (1.61M rows) costs
 * **14,326–34,490 ms** depending on the timeframe filter. Serving it from a request would hold a
 * connection for half a minute and time out, so it is computed once in the background and read from
 * memory. The states `ready` / `computing` / `error` are what stop an empty bar column from reading
 * as "no position moved".
 */
import { __resetBarMaxStateForTest, BAR_MAX_TTL_MS, barMaxState, isBarMaxFresh } from './exit-quality-bars';

describe('exit-quality bar cache', () => {
  beforeEach(() => __resetBarMaxStateForTest());

  it('starts with no computation and nothing fresh', () => {
    expect(barMaxState().computedAt).toBeNull();
    expect(isBarMaxFresh()).toBe(false);
  });

  it('is NOT fresh on the strength of a previous attempt that failed', () => {
    // A failed run must never be mistaken for a completed one.
    const s = barMaxState();
    s.error = 'join blew up';
    s.computedAt = null;
    expect(isBarMaxFresh()).toBe(false);
    expect(s.error).toBe('join blew up');
  });

  it('is fresh only within the TTL', () => {
    const s = barMaxState();
    const now = Date.now();
    s.computedAt = now - (BAR_MAX_TTL_MS - 1000);
    expect(isBarMaxFresh(now)).toBe(true);

    s.computedAt = now - (BAR_MAX_TTL_MS + 1000);
    expect(isBarMaxFresh(now)).toBe(false);
  });

  // ⚠️ The boundary is a decision, not an accident: at exactly the TTL the data is considered stale,
  // because a cache that is exactly as old as its lifetime has no margin left.
  it('treats exactly-at-TTL as stale', () => {
    const s = barMaxState();
    const now = Date.now();
    s.computedAt = now - BAR_MAX_TTL_MS;
    expect(isBarMaxFresh(now)).toBe(false);
  });

  it('exposes the map it was given, keyed by trade id', () => {
    const s = barMaxState();
    s.map = new Map([['trade-1', 2.5]]);
    expect(barMaxState().map.get('trade-1')).toBe(2.5);
    expect(barMaxState().map.get('missing')).toBeUndefined();
  });
});
