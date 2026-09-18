import {
  estimatePositionMargin,
  resolveProfitCurrency,
  conversionFor,
  conversionPairsNeeded,
  describeMargin,
} from './position-margin';

/**
 * position-margin — the arithmetic that decides whether a position is allowed (#865).
 *
 * This is a MONEY PATH: it gates every order. Two things make it testable that the previous
 * implementation was not:
 *
 *   1. The live account provides an ORACLE. `account.margin` is the sum of the margins of the
 *      positions it holds, so the formula can be checked against something real rather than
 *      against a second copy of my own assumption. The fixture below uses the values measured
 *      from the account on 2026-09-18.
 *   2. Every branch returns a named reason instead of a default, so a test can assert WHICH input
 *      was missing rather than only that something went wrong.
 *
 * The defect this replaces produced `Allocation 62.7% exceeds max per symbol 25%` for BOTH a gold
 * position and a yen cross, because the expression contained no price and no contract size. The
 * first test class below is the property that could never hold before: **different instruments
 * must produce different numbers.**
 */

/** Real values from MetaQuotes-Demo #2 on 2026-09-18. */
const LIVE = {
  accountCurrency: 'GBP',
  accountLeverage: 100,
  quotes: { GBPUSD: 1.33838, GBPJPY: 209.768 },
};

describe('position-margin — the formula that decides if a position is allowed (#865)', () => {
  describe('ORACLE — reproduce the account\'s own margin from its open positions', () => {
    /**
     * The measured fixture. These two positions and `account.margin = 95.98` were read from the
     * live account at the same moment.
     *
     * ⚠️ This is the test that makes the formula trustworthy. A unit test that only checked
     * `margin === volume × contract × price / leverage` would pass for any expression I happened to
     * write down — including the one that blocked 78 trades, which was also "a formula".
     */
    const EURGBP = { symbol: 'EURGBP', volume: 0.1, price: 0.85982, contractSize: 100_000, profitCurrency: 'GBP' };
    const GBPJPY = { symbol: 'GBPJPY', volume: 0.01, price: 210.637, contractSize: 100_000, profitCurrency: 'JPY' };
    const ACTUAL_ACCOUNT_MARGIN = 95.98;

    it('reproduces the live account margin to within 0.1%', () => {
      const a = estimatePositionMargin({ ...EURGBP, ...LIVE });
      const b = estimatePositionMargin({ ...GBPJPY, ...LIVE });
      expect(a.source).toBe('computed');
      expect(b.source).toBe('computed');

      const total = (a as any).margin + (b as any).margin;
      const deltaPct = Math.abs((total - ACTUAL_ACCOUNT_MARGIN) / ACTUAL_ACCOUNT_MARGIN) * 100;

      // 96.02 computed vs 95.98 actual. The residual is expected: this uses priceOpen while MT5
      // recalculates margin at CURRENT prices. 0.1% is a tight bound on that explanation — if the
      // formula itself were wrong it would be out by tens of percent, as the old one was (11x).
      expect(deltaPct).toBeLessThan(0.1);
      expect(total).toBeCloseTo(96.02, 1);
    });

    it('computes each leg to the measured value', () => {
      expect((estimatePositionMargin({ ...EURGBP, ...LIVE }) as any).margin).toBeCloseTo(85.98, 1);
      expect((estimatePositionMargin({ ...GBPJPY, ...LIVE }) as any).margin).toBeCloseTo(10.04, 1);
    });
  });

  describe('THE PROPERTY THE OLD CODE COULD NOT SATISFY — instruments must differ', () => {
    /**
     * The defect in one assertion. Before the fix, `(size × 100_000) / leverage` had no price and
     * no contract size, so at equal size the estimate for gold and for a yen cross were IDENTICAL
     * — observed in the log as `62.7%` and `62.6%` on the same day.
     */
    it('produces different estimates for different instruments at the same size', () => {
      const gold = estimatePositionMargin({
        symbol: 'XAUUSD', volume: 0.1, price: 4346.06, contractSize: 100, profitCurrency: 'USD', ...LIVE,
      });
      const yen = estimatePositionMargin({
        symbol: 'NZDJPY', volume: 0.1, price: 89.343, contractSize: 100_000, profitCurrency: 'JPY', ...LIVE,
      });
      expect(gold.source).toBe('computed');
      expect(yen.source).toBe('computed');

      // Gold 0.1 lot (10 oz @ 4346) needs ~£325 of margin; NZDJPY 0.1 lot ~£47. The old code said
      // £1,160 for both.
      const goldMargin = (gold as any).margin;
      const yenMargin = (yen as any).margin;
      expect(goldMargin).toBeGreaterThan(yenMargin);
      expect(goldMargin / yenMargin).toBeGreaterThan(3);
    });

    it('is not inflated by margin utilisation — the old `balance / margin` divisor', () => {
      // The old code divided by balance/margin, which read 8.62 against a 1:100 account and
      // inflated every estimate ~11x. At 0.1 lot NZDJPY the truth is ~£47; the old code said
      // £1,160. Assert the order of magnitude so a regression to that shape fails loudly.
      const yen = estimatePositionMargin({
        symbol: 'NZDJPY', volume: 0.1, price: 89.343, contractSize: 100_000, profitCurrency: 'JPY', ...LIVE,
      });
      expect((yen as any).margin).toBeLessThan(100);
      expect((yen as any).margin).toBeGreaterThan(20);
    });
  });

  describe('profit-currency resolution — documented convention, never a guess', () => {
    it('prefers the value an open position reported', () => {
      expect(resolveProfitCurrency('US500', 'USD')).toBe('USD'); // index name carries no currency
      expect(resolveProfitCurrency('EURGBP', 'GBP')).toBe('GBP');
    });

    it('derives the quote currency for FX pairs and metals', () => {
      expect(resolveProfitCurrency('EURGBP')).toBe('GBP');
      expect(resolveProfitCurrency('GBPJPY')).toBe('JPY');
      expect(resolveProfitCurrency('NZDJPY')).toBe('JPY');
      expect(resolveProfitCurrency('XAUUSD')).toBe('USD'); // gold is a 6-letter XXXYYY symbol
      expect(resolveProfitCurrency('eurusd')).toBe('USD'); // case-insensitive
    });

    it('returns null for index CFDs rather than assuming a currency', () => {
      // ⚠️ THIS IS THE HONEST ANSWER, not a gap. `US500` settles in a currency the symbol name
      // does not state. Returning null makes the estimate unavailable and the caller refuses —
      // which is correct, because assuming GBP would silently mis-size every index position.
      // The permanent fix is one line in the bridge (`currencyProfit` on /symbol/X/info).
      for (const s of ['US500', 'GER40', 'UK100', 'FRA40']) {
        expect(resolveProfitCurrency(s)).toBeNull();
      }
    });

    it('rejects a junk value offered as a currency', () => {
      expect(resolveProfitCurrency('EURGBP', 'NOTACCY')).toBe('GBP'); // falls through to the rule
      expect(resolveProfitCurrency('EURGBP', '')).toBe('GBP');
    });
  });

  describe('conversion — both quoted directions, because brokers quote one', () => {
    it('uses a direct pair when the broker quotes it', () => {
      expect(conversionFor('USD', 'GBP', { USDGBP: 0.747 })).toEqual({ rate: 0.747, source: 'USDGBP' });
    });

    it('inverts when only the opposite direction is quoted — the live case', () => {
      // This broker quotes GBPUSD and GBPJPY; USDGBP and JPYGBP both 404. A one-sided lookup would
      // fail for EVERY usd- and jpy-denominated instrument on a GBP account.
      expect(conversionFor('USD', 'GBP', { GBPUSD: 1.33838 })!.source).toBe('1/GBPUSD');
      expect(conversionFor('USD', 'GBP', { GBPUSD: 1.33838 })!.rate).toBeCloseTo(1 / 1.33838, 10);
      expect(conversionFor('JPY', 'GBP', { GBPJPY: 209.768 })!.rate).toBeCloseTo(1 / 209.768, 10);
    });

    it('needs no rate when the instrument already settles in the account currency', () => {
      expect(conversionFor('GBP', 'GBP', {})).toEqual({ rate: 1, source: 'same-currency' });
    });

    it('returns null rather than 1 when no rate exists', () => {
      // A silent `?? 1` here would treat a JPY notional as GBP — off by ~200x.
      expect(conversionFor('JPY', 'GBP', {})).toBeNull();
      expect(conversionFor('JPY', 'GBP', { GBPJPY: 0 })).toBeNull(); // a zero rate is not a rate
    });

    it('names the pairs to fetch, both directions', () => {
      expect(conversionPairsNeeded('JPY', 'GBP')).toEqual(['JPYGBP', 'GBPJPY']);
      expect(conversionPairsNeeded('GBP', 'GBP')).toEqual([]);
    });
  });

  describe('fails CLOSED — every missing input is named, none is defaulted', () => {
    const BASE = {
      symbol: 'NZDJPY', volume: 0.1, price: 89.343, contractSize: 100_000,
      accountLeverage: 100, accountCurrency: 'GBP', profitCurrency: 'JPY',
      quotes: { GBPJPY: 209.768 },
    };

    it('computes when everything is present', () => {
      expect(estimatePositionMargin(BASE).source).toBe('computed');
    });

    // ⚠️ Each case asserts the REASON names the missing input. "Risk check failed" would send the
    // next reader through five gates instead of at the one value that is absent.
    const cases: [string, object, RegExp][] = [
      ['no price', { price: 0 }, /price/],
      ['no contract size', { contractSize: 0 }, /contractSize/],
      ['no account leverage', { accountLeverage: 0 }, /leverage/],
      ['no account currency', { accountCurrency: '' }, /account currency/],
      ['zero volume', { volume: 0 }, /volume/],
    ];
    for (const [name, override, expected] of cases) {
      it(`refuses when ${name}`, () => {
        const r = estimatePositionMargin({ ...BASE, ...override } as any);
        expect(r.source).toBe('unavailable');
        expect((r as any).reason).toMatch(expected);
      });
    }

    it('refuses an unknown profit currency instead of assuming the account currency', () => {
      const r = estimatePositionMargin({ ...BASE, symbol: 'US500', profitCurrency: undefined });
      expect(r.source).toBe('unavailable');
      expect((r as any).reason).toMatch(/profit currency unknown/);
      expect((r as any).reason).toMatch(/would be a guess/);
    });

    it('refuses when the conversion rate is missing, and names the pairs it tried', () => {
      const r = estimatePositionMargin({ ...BASE, quotes: {} });
      expect(r.source).toBe('unavailable');
      expect((r as any).reason).toMatch(/no JPY->GBP rate/);
      expect((r as any).reason).toMatch(/JPYGBP/);
      expect((r as any).reason).toMatch(/GBPJPY/);
    });

    it('never returns NaN or a negative margin', () => {
      for (const bad of [NaN, -1, Infinity]) {
        const r = estimatePositionMargin({ ...BASE, price: bad } as any);
        expect(r.source).toBe('unavailable');
      }
    });
  });

  describe('describeMargin — the block reason must show its arithmetic', () => {
    it('renders the numbers behind the estimate, not just the result', () => {
      const e = estimatePositionMargin({
        symbol: 'XAUUSD', volume: 0.1, price: 4346.06, contractSize: 100,
        accountLeverage: 100, accountCurrency: 'GBP', profitCurrency: 'USD',
        quotes: { GBPUSD: 1.33838 },
      });
      const text = describeMargin(e, 'GBP');
      // Every input a reader needs to re-derive it by hand.
      expect(text).toContain('contract 100');
      expect(text).toContain('4346.06');
      expect(text).toContain('USD');
      expect(text).toContain('1/GBPUSD');
      expect(text).toContain('÷ 100');
    });

    it('says why when unavailable', () => {
      const e = estimatePositionMargin({
        symbol: 'US500', volume: 0.1, price: 5000, contractSize: 1,
        accountLeverage: 100, accountCurrency: 'GBP',
      });
      expect(describeMargin(e, 'GBP')).toMatch(/^unavailable \(profit currency unknown/);
    });
  });
});
