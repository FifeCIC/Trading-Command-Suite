/**
 * pnl-alert.spec.ts — the P&L breach rule.
 *
 * ⚠️ THE CASE THAT MATTERS IS NOT "does it detect a breach" — it is **"does it report the SECOND
 * one"**. The defect was `return` on the first match, which fired 872 times in two hours naming one
 * symbol (R3NK) while eight other open positions were invisible.
 *
 * ⚠️ CANARY: restoring `return out[0]`-style first-match behaviour fails
 * '⭐ reports EVERY breach, not just the first'. Verified against the real tree, marker count
 * checked BEFORE the failure was trusted.
 */
import { pnlBreaches, worstBreach, pnlAlertMessage } from './pnl-alert';

const row = (symbol: string, pnl: number | null, avgPrice = 100, quantity = 1) => ({
  symbol,
  pnl,
  avgPrice,
  quantity,
});

describe('pnlBreaches — every breach, worst first', () => {
  // ⭐ THE CANARY. One big loser must not silence the others.
  it('⭐ reports EVERY breach, not just the first', () => {
    const rows = [row('R3NK', -40), row('AAPL', 20), row('XAUUSD', -15)];
    const b = pnlBreaches(rows, 10);
    expect(b.map((x) => x.symbol)).toEqual(['R3NK', 'AAPL', 'XAUUSD']);
    // 40%, 20%, 15% — all past a 10% threshold, and all present.
    expect(b).toHaveLength(3);
  });

  it('orders WORST FIRST so a cap drops the least significant', () => {
    const b = pnlBreaches([row('SMALL', -11), row('BIG', -90), row('MID', -30)], 10);
    expect(b.map((x) => x.symbol)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('a position inside the threshold is not a breach', () => {
    expect(pnlBreaches([row('AAPL', 5)], 10)).toEqual([]);
  });

  it('the threshold is EXCLUSIVE — exactly at the limit is not a breach', () => {
    expect(pnlBreaches([row('AAPL', 10)], 10)).toEqual([]);
    expect(pnlBreaches([row('AAPL', 10.01)], 10)).toHaveLength(1);
  });

  it('LARGE PROFITS are breaches too — the original behaviour, preserved on purpose', () => {
    const b = pnlBreaches([row('NVDA', 50)], 10);
    expect(b).toHaveLength(1);
    expect(b[0].pnl).toBe(50);
  });

  describe('⚠️ rows that must be SKIPPED, not reported', () => {
    it('an unpriced position is not a breach', () => {
      expect(pnlBreaches([row('AAPL', null)], 10)).toEqual([]);
    });

    it('⚠️ CANARY — a ZERO notional cannot fabricate an Infinity breach', () => {
      // avgPrice/quantity of 0 makes the percentage Infinity, which is > any threshold.
      expect(pnlBreaches([row('AAPL', -5, 0, 1)], 10)).toEqual([]);
      expect(pnlBreaches([row('AAPL', -5, 100, 0)], 10)).toEqual([]);
    });

    it('a NaN pnl is not a breach', () => {
      expect(pnlBreaches([row('AAPL', NaN)], 10)).toEqual([]);
    });

    it('an empty book reports nothing rather than everything', () => {
      expect(pnlBreaches([], 10)).toEqual([]);
    });
  });
});

describe('pnlAlertMessage — names them all', () => {
  it('⭐ names every breach, and says how many were hidden past the cap', () => {
    const b = pnlBreaches(
      [row('A', -80), row('B', -70), row('C', -60), row('D', -50), row('E', -40), row('F', -30), row('G', -20)],
      10,
    );
    const m = pnlAlertMessage(b, 5);
    expect(m).toContain('7 position(s)');
    expect(m).toContain('A');
    expect(m).toContain('E');
    expect(m).toContain('(+2 more)');
    // The two smallest are the ones dropped by the cap.
    expect(m).not.toContain('G ');
  });

  it('signs a profit positively so the direction is readable without the number', () => {
    const m = pnlAlertMessage(pnlBreaches([row('NVDA', 50)], 10));
    expect(m).toContain('+50.00');
  });

  it('a loss carries its own minus sign and no plus', () => {
    const m = pnlAlertMessage(pnlBreaches([row('R3NK', -41.77)], 10));
    expect(m).toContain('-41.77');
    expect(m).not.toContain('+-');
  });
});

describe('worstBreach — drives severity', () => {
  it('is the largest percentage, not the largest currency amount', () => {
    // -20 on a 100 notional is 20%; -500 on a 10000 notional is 5%.
    const b = pnlBreaches([row('BIGMONEY', -500, 10000, 1), row('SMALLMONEY', -20, 100, 1)], 4);
    expect(worstBreach(b)!.symbol).toBe('SMALLMONEY');
  });

  it('is null when nothing breached', () => {
    expect(worstBreach([])).toBeNull();
  });
});
