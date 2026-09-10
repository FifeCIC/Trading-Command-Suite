import { computeMarketStatus } from './market-status';
import { MarketBar } from './interfaces/directive.interface';

/**
 * market-status.spec.ts — tradability gate contracts (2026-09-10, #750).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `computeMarketStatus` decides whether a symbol's market is currently
 * producing data, and it is used as a tradability gate (automation loop,
 * protocol gating, liquidity-check). It failed OPEN for weeks: the MT5 bridge
 * stamped broker SERVER time as UTC (#750), so every bar arrived ~3h in the
 * FUTURE, `ageMs` went negative, and a negative number can never exceed the
 * staleness threshold. Closed markets read `open: true`.
 *
 * The regression guard is therefore the most important test here: a
 * future-dated feed must read CLOSED, never open.
 */

const MIN = 60_000;

/** Build `count` 5m bars ending at `lastBarAt` (oldest → newest). */
function bars(count: number, lastBarAt: Date, volume = 100): MarketBar[] {
  const out: MarketBar[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = new Date(lastBarAt.getTime() - i * 5 * MIN);
    out.push({ timestamp: t, open: 1, high: 1, low: 1, close: 1, volume });
  }
  return out;
}

const NOW = new Date('2026-09-10T09:15:00Z');

describe('computeMarketStatus', () => {
  it('reads open for a feed producing fresh bars', () => {
    const status = computeMarketStatus(bars(30, NOW), NOW);
    expect(status.open).toBe(true);
    expect(status.asOf).toBe(NOW.toISOString());
  });

  it('reads closed for a genuinely stale feed (positive age)', () => {
    // Last real bar 3h old on a 5m cadence — weekend / dead feed.
    const status = computeMarketStatus(bars(30, new Date(NOW.getTime() - 180 * MIN)), NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('old');
  });

  // ── The #750 regression guard ──────────────────────────────────────────────
  it('reads CLOSED when bars are stamped hours in the future (clock skew, #750)', () => {
    // Broker server time (+3h) tagged as UTC — the exact #750 shape.
    const status = computeMarketStatus(bars(30, new Date(NOW.getTime() + 180 * MIN)), NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('data clock skew');
    expect(status.reason).toContain('180m in the future');
  });

  it('reads CLOSED for a 1h future skew (winter/summer offset mix-up)', () => {
    const status = computeMarketStatus(bars(30, new Date(NOW.getTime() + 60 * MIN)), NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('data clock skew');
  });

  it('tolerates a few seconds of future skew from ordinary clock slop', () => {
    // A synthetic placeholder bar is stamped `now`; both sides are the same
    // machine clock, so small positive drift must NOT close the market.
    const status = computeMarketStatus(bars(30, new Date(NOW.getTime() + 30_000)), NOW);
    expect(status.open).toBe(true);
  });

  it('ignores the synthetic current-bar placeholder (volume <= 1) when measuring age', () => {
    // BarRefreshService upserts a placeholder stamped `now` with volume=1 even
    // when the market is shut. Real data ends 3h earlier → must read CLOSED.
    const real = bars(29, new Date(NOW.getTime() - 180 * MIN));
    const placeholder: MarketBar = {
      timestamp: new Date(NOW.getTime()),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    };
    const status = computeMarketStatus([...real, placeholder], NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('old');
  });

  it('reads closed when every bar in the window is a synthetic placeholder', () => {
    const status = computeMarketStatus(bars(10, NOW, 1), NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('all synthetic placeholders');
  });

  // ── The descending-order fail-open (found live, #750 AC-3) ─────────────────
  it('reads CLOSED for a stale feed even when bars arrive newest-first', () => {
    // POST /scoring/arena/compare loads bars `orderBy: { timestamp: 'desc' }`
    // and passed them straight in. Every interval was negative, so the median
    // cadence collapsed to 0 and the staleness test was skipped → the gate read
    // OPEN for any feed. Live symptom: BTCUSD, frozen 2026-07-18, reported
    // `open: true` with `asOf` = 2026-07-14T12:00:00Z (the array's LAST element).
    const descending = bars(30, new Date(NOW.getTime() - 54 * 24 * 60 * MIN)).reverse();
    const status = computeMarketStatus(descending, NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('old');
  });

  it('reads OPEN for a fresh feed even when bars arrive newest-first', () => {
    const status = computeMarketStatus(bars(30, NOW).reverse(), NOW);
    expect(status.open).toBe(true);
    expect(status.asOf).toBe(NOW.toISOString());
  });

  it('gives the same verdict regardless of bar order', () => {
    const ascending = bars(30, new Date(NOW.getTime() - 180 * MIN));
    const a = computeMarketStatus(ascending, NOW);
    const b = computeMarketStatus([...ascending].reverse(), NOW);
    expect(b).toEqual(a);
  });

  it('reads CLOSED when duplicate timestamps make the cadence unmeasurable', () => {
    // No positive interval → "stale" is undefined. Previously this skipped the
    // test and read OPEN; an unmeasurable feed must read CLOSED.
    const dupes = bars(10, NOW).map((b) => ({ ...b, timestamp: new Date(NOW.getTime()) }));
    const status = computeMarketStatus(dupes, NOW);
    expect(status.open).toBe(false);
    expect(status.reason).toContain('indeterminate bar cadence');
  });

  it('reads closed for insufficient data', () => {
    expect(computeMarketStatus([], NOW)).toEqual({
      open: false,
      asOf: null,
      reason: 'insufficient bars',
    });
    const one = bars(1, NOW);
    expect(computeMarketStatus(one, NOW).open).toBe(false);
  });

  it('accepts ISO string timestamps from serialized bridge payloads', () => {
    const serialized = bars(30, NOW).map((b) => ({ ...b, timestamp: b.timestamp.toISOString() as any }));
    const status = computeMarketStatus(serialized as MarketBar[], NOW);
    expect(status.open).toBe(true);
    expect(status.asOf).toBe(NOW.toISOString());
  });
});
