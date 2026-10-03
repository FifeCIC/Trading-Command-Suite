/**
 * pnl-alert.spec.ts — the P&L breach rule.
 *
 * ⚠️ TWO DEFECTS ARE GUARDED HERE, both measured on the live book 2026-10-03:
 *
 *   1. **`return` on the first match.** The alert fired 883 times naming ONE symbol (R3NK) while
 *      eight other open positions could not be reported at all.
 *   2. **A percentage computed across currencies and units.** `|pnl / (avgPrice x quantity)|` was
 *      wrong by ~88,000x on FX, where `quantity` is LOTS not units, and by the account FX rate on
 *      stocks, where `pnl` is in account currency and the notional is in the instrument's.
 *
 * ⚠️ CANARY: restoring first-match behaviour fails the ⭐ case; restoring the
 * `pnl / (avgPrice * quantity)` formula fails the two FX/currency cases. Both verified with the
 * marker count checked BEFORE the failure was trusted.
 */
import { pnlBreaches, worstBreach, pnlAlertMessage } from './pnl-alert';

/** A row in the REAL shape: the move is derived from avgPrice/currentPrice, not from pnl. */
const row = (
  symbol: string,
  avgPrice: number,
  currentPrice: number | null,
  pnl: number | null = null,
  side: string | null = 'buy',
) => ({ symbol, side, avgPrice, currentPrice, pnl });

describe('pnlBreaches — every breach, worst first', () => {
  // ⭐ THE CANARY. One big loser must not silence the others.
  it('⭐ reports EVERY breach, not just the first', () => {
    const rows = [row('R3NK', 100, 60), row('AAPL', 100, 120), row('XAUUSD', 100, 85)];
    const b = pnlBreaches(rows, 10);
    expect(b.map((x) => x.symbol)).toEqual(['R3NK', 'AAPL', 'XAUUSD']);
  });

  it('orders WORST FIRST so a cap drops the least significant', () => {
    const b = pnlBreaches([row('SMALL', 100, 89), row('BIG', 100, 10), row('MID', 100, 70)], 10);
    expect(b.map((x) => x.symbol)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('a position inside the threshold is not a breach', () => {
    expect(pnlBreaches([row('AAPL', 100, 105)], 10)).toEqual([]);
  });

  it('the threshold is EXCLUSIVE — exactly at the limit is not a breach', () => {
    expect(pnlBreaches([row('AAPL', 100, 110)], 10)).toEqual([]);
    expect(pnlBreaches([row('AAPL', 100, 110.01)], 10)).toHaveLength(1);
  });

  it('LARGE PROFITS are breaches too — the original behaviour, preserved on purpose', () => {
    const b = pnlBreaches([row('NVDA', 100, 150)], 10);
    expect(b).toHaveLength(1);
    expect(b[0].movePct).toBeCloseTo(50, 6);
  });

  // ⚠️ CANARY — THE FX LOTS BUG. Measured: USDCHF 0.01 lots @ 0.82806 -> 0.82878 is a 0.09% move,
  // but `pnl / (avgPrice * quantity)` produced **7970.4%**. At any sane threshold the old formula
  // reported this as a breach forever; the move says it is quiet.
  it('⚠️ CANARY — a tiny FX move is NOT a breach (the old formula said 7970%)', () => {
    const usdchf = row('USDCHF', 0.82806, 0.82878, 0.66, 'buy');
    expect(pnlBreaches([usdchf], 5)).toEqual([]);
    // The real move, for the record.
    expect(pnlBreaches([usdchf], 0.05)[0].movePct).toBeCloseTo(0.087, 2);
  });

  // ⚠️ CANARY — THE CROSS-CURRENCY BUG. Measured: MSTR fell 49.9% while `pnl / notional` reported
  // 37.1% (the ratio is the account's FX rate). The threshold must see the MOVE.
  it('⚠️ CANARY — a stock move is judged in PRICE, not in pnl-over-notional', () => {
    const mstr = row('MSTR', 319.48461538, 160, -154.12, null);
    const b = pnlBreaches([mstr], 40);
    expect(b).toHaveLength(1);
    expect(b[0].movePct).toBeCloseTo(-49.92, 1); // NOT 37.1
  });

  describe('⚠️ rows that must be SKIPPED, not reported', () => {
    it('an unpriced position is not a breach', () => {
      expect(pnlBreaches([row('AAPL', 100, null)], 10)).toEqual([]);
    });

    it('⚠️ CANARY — a ZERO entry cannot fabricate an Infinity breach', () => {
      expect(pnlBreaches([row('AAPL', 0, 100)], 10)).toEqual([]);
      expect(pnlBreaches([row('AAPL', NaN, 100)], 10)).toEqual([]);
    });

    it('an empty book reports nothing rather than everything', () => {
      expect(pnlBreaches([], 10)).toEqual([]);
    });
  });

  it('a SHORT gains as price falls, and the sign follows', () => {
    const b = pnlBreaches([row('XAUUSD', 4000, 3600, 5, 'sell')], 5);
    expect(b[0].movePct).toBeCloseTo(10, 6); // entry 4000 -> 3600 is +10% for a short
  });
});

describe('pnlAlertMessage — names them all', () => {
  it('⭐ names every breach, and says how many were hidden past the cap', () => {
    // ⚠️ -10% is EXACTLY the threshold and is therefore EXCLUDED (exclusive comparison), so seven
    // constructed rows yield SIX breaches. The first version of this test asserted 7 and failed —
    // the test was wrong, not the rule.
    const rows = [90, 85, 80, 75, 70, 65, 60].map((px, i) => row(`S${i}`, 100, px));
    const m = pnlAlertMessage(pnlBreaches(rows, 10), 5);
    expect(m).toContain('6 position(s)');
    expect(m).toContain('S6');
    expect(m).toContain('(+1 more)');
  });

  it('shows the currency amount alongside the move, and marks a missing one', () => {
    const withPnl = pnlAlertMessage(pnlBreaches([row('NVDA', 100, 150, 12.5)], 10));
    expect(withPnl).toContain('+12.50');
    expect(withPnl).toContain('+50.00%');

    const withoutPnl = pnlAlertMessage(pnlBreaches([row('NVDA', 100, 150, null)], 10));
    expect(withoutPnl).toContain('n/a');
  });
});

describe('worstBreach — drives severity', () => {
  it('is the largest PERCENTAGE move', () => {
    const b = pnlBreaches([row('BIGMONEY', 10000, 9500), row('SMALLMONEY', 100, 70)], 4);
    expect(worstBreach(b)!.symbol).toBe('SMALLMONEY'); // -30% beats -5%
  });

  it('is null when nothing breached', () => {
    expect(worstBreach([])).toBeNull();
  });
});
