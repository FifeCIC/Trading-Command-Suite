import { nextPeakEquity } from './peak-equity';

/**
 * #848 — a drawdown peak must never be SEEDED FROM A FABRICATED ACCOUNT VALUE.
 *
 * ⚠️ THE LIVE DEFECT THESE TESTS PIN (measured 2026-09-16). `account?.equity ?? account?.balance
 * ?? 10_000` seeded this peak during a bridge outage. The fabricated $10,000 became a permanent
 * high-water mark; the real ~$1,389 account then read as "Drawdown 86.1% exceeds limit" and every
 * trade was blocked — and the block APPEARED the moment the bridge RECOVERED, because the
 * recovery is when the real (small) number started being compared against the invented peak.
 *
 * The arithmetic matched to one decimal: (10_000 − 1,389.37) / 10_000 = 86.11%.
 */
describe('nextPeakEquity (#848)', () => {
  it('⭐ CANARY — an UNREADABLE account never creates a peak (the old code returned 10,000 here)', () => {
    expect(nextPeakEquity(null, null)).toBeNull();
    expect(nextPeakEquity(null, Number('nope'))).toBeNull(); // NaN from a failed parse
  });

  it('an unreadable account never moves an existing peak — neither up nor down', () => {
    expect(nextPeakEquity(1500, null)).toBe(1500);
    expect(nextPeakEquity(1500, Number.NaN)).toBe(1500);
  });

  it('the FIRST real value sets the peak — never a fallback', () => {
    expect(nextPeakEquity(null, 1389.37)).toBe(1389.37);
  });

  it('the peak is monotonic — a lower later reading does not lower it', () => {
    expect(nextPeakEquity(1389.37, 1200)).toBe(1389.37);
    expect(nextPeakEquity(1389.37, 1500)).toBe(1500);
  });

  it('a zero balance is a REAL reading, not an absence — it may set the peak of a wiped account', () => {
    expect(nextPeakEquity(null, 0)).toBe(0);
  });
});
