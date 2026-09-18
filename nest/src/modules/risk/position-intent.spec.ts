import {
  resolveIntent,
  overrideKey,
  isGapExposed,
  needsDecision,
  parseIntent,
  describeIntent,
  summariseExposure,
  PROVIDER_DEFAULT_INTENT,
  GAP_EXPOSED_INTENTS,
  type PositionIntent,
} from './position-intent';

/**
 * position-intent — the axis that decides WHICH risk rules apply to a position.
 *
 * ⚠️ THE FIRST TEST BELOW IS THE REGRESSION GUARD, and it is written against the real ledger.
 *
 * On Friday 2026-09-18 the `weekend-gap-risk` alert reported:
 *
 *     "26 position(s) open going into weekend. Consider flattening or tightening stops."
 *
 * The 26 were 5 MT5 CFD positions (opened within 30 hours) and 21 Trading212 equity holdings
 * (oldest opened 25 July, aggregate −996, held deliberately). "Consider flattening" applied to a
 * long-term holding is not a mild misfire — it is the opposite of correct, and because it repeats
 * every Friday it trains the owner to ignore the alert entirely.
 *
 * A one-word "fix" would be to add `long-term` to the gap-exposed list, which restores the defect
 * while looking green. `GAP_EXPOSED_INTENTS` therefore has its own test asserting it does NOT
 * contain `long-term`, so that mistake fails the build rather than shipping.
 */

/** The measured ledger, 2026-09-18. */
const LEDGER = [
  { symbol: 'EURCAD', provider: 'mt5' },
  { symbol: 'EURCHF', provider: 'mt5' },
  { symbol: 'EURGBP', provider: 'mt5' },
  { symbol: 'EURUSD', provider: 'mt5' },
  { symbol: 'GBPJPY', provider: 'mt5' },
  // 21 Trading212 holdings — abbreviated to 5 here; the default is per-provider, not per-symbol,
  // so the count below is driven by the provider split, which is what the defect was about.
  { symbol: 'MSTR', provider: 'trading212' },
  { symbol: 'RBLX', provider: 'trading212' },
  { symbol: 'PTGEF', provider: 'trading212' },
  { symbol: 'XIACY', provider: 'trading212' },
  { symbol: 'ACIC', provider: 'trading212' },
];

describe('position-intent — what a position is FOR decides which risk applies', () => {
  describe('⭐ REGRESSION — the 2026-09-18 weekend-gap miscount', () => {
    it('separates CFD trades from long-term holdings instead of counting one number', () => {
      const { exposed, held, needingDecision } = summariseExposure(LEDGER);

      expect(exposed.map((p) => p.symbol).sort()).toEqual(['EURCAD', 'EURCHF', 'EURGBP', 'EURUSD', 'GBPJPY']);
      expect(held.map((p) => p.symbol).sort()).toEqual(['ACIC', 'MSTR', 'PTGEF', 'RBLX', 'XIACY']);
      expect(needingDecision).toHaveLength(0);

      // The headline number the old alert reported (26, i.e. every row) is now the WRONG answer.
      // The alert must be able to say "5 gap-exposed, 21 held" and never "26 to flatten".
      expect(exposed.length).not.toBe(LEDGER.length);
      expect(exposed.length).toBe(5);
    });

    it('does NOT treat a long-term holding as gap-exposed', () => {
      // ⚠️ The one-word "fix" that would look correct and restore the defect.
      expect(GAP_EXPOSED_INTENTS).not.toContain('long-term');
      expect(isGapExposed('long-term')).toBe(false);
      expect(isGapExposed('intraday')).toBe(true);
      expect(isGapExposed('swing')).toBe(true);
    });

    it('a losing long-term holding is HELD, not flagged — the loss is the thesis, not the risk', () => {
      // Measured aggregate for the 21 was −996 and accepted by the owner. Intent, not sign, is the
      // input: the same loss on an intraday position would be exactly what the alert is for.
      const losing = [{ symbol: 'MSTR', provider: 'trading212' }];
      expect(summariseExposure(losing).held).toHaveLength(1);
      expect(summariseExposure(losing).exposed).toHaveLength(0);
    });
  });

  describe('inference is labelled, and the owner can overrule it', () => {
    it('defaults a stock-brokerage position to held and a CFD position to intraday', () => {
      expect(resolveIntent({ symbol: 'MSTR', provider: 'trading212' }))
        .toEqual({ intent: 'long-term', source: 'provider-default' });
      expect(resolveIntent({ symbol: 'EURUSD', provider: 'mt5' }))
        .toEqual({ intent: 'intraday', source: 'provider-default' });
    });

    it('an explicit override beats the provider default, and says so', () => {
      // A leveraged NVDA held on the brokerage is the owner's own example of a case the default
      // gets wrong. The override is how that is recorded once instead of re-litigated per alert.
      const overrides = new Map<string, PositionIntent>([
        [overrideKey('trading212', '3NVD'), 'intraday'],
      ]);
      expect(resolveIntent({ symbol: '3NVD', provider: 'trading212' }, overrides))
        .toEqual({ intent: 'intraday', source: 'override' });
      // ...and does not leak to a sibling symbol.
      expect(resolveIntent({ symbol: 'MSTR', provider: 'trading212' }, overrides).source)
        .toBe('provider-default');
    });

    it('normalises case and whitespace so writer and reader cannot drift apart', () => {
      const overrides = new Map<string, PositionIntent>([
        [overrideKey('Trading212', 'mstr'), 'swing'],
      ]);
      // The key is built one way; it must be found when the data arrives cased differently.
      expect(overrideKey('trading212', 'MSTR')).toBe(overrideKey('Trading212', 'mstr'));
      expect(resolveIntent({ symbol: 'mstr', provider: 'TRADING212' }, overrides).intent).toBe('swing');
    });
  });

  describe('⚠️ an unknown position is a QUESTION, not an answer', () => {
    it('marks an unrecognised provider as unclassified and asks', () => {
      const r = resolveIntent({ symbol: 'AAPL', provider: 'some-new-broker' });
      expect(r.intent).toBe('unclassified');
      expect(r.source).toBe('unknown');
      expect(needsDecision(r.intent)).toBe(true);
    });

    it('reports an unclassified position as needing a decision — NOT as gap risk', () => {
      // Both silent defaults are wrong here: assuming exposure would nag about every position on a
      // provider we have not characterised, and assuming safety would hide a real weekend risk.
      const { exposed, held, needingDecision } = summariseExposure([
        { symbol: 'AAPL', provider: 'some-new-broker' },
      ]);
      expect(exposed).toHaveLength(0);
      expect(held).toHaveLength(0);
      expect(needingDecision).toEqual([{ symbol: 'AAPL', provider: 'some-new-broker' }]);
    });

    it('an override answers the question, and the position then lands in a real bucket', () => {
      const overrides = new Map<string, PositionIntent>([
        [overrideKey('some-new-broker', 'AAPL'), 'long-term'],
      ]);
      const { held, needingDecision } = summariseExposure(
        [{ symbol: 'AAPL', provider: 'some-new-broker' }], overrides,
      );
      expect(needingDecision).toHaveLength(0);
      expect(held).toHaveLength(1);
    });
  });

  describe('parsing and labelling — one vocabulary, so surfaces cannot disagree', () => {
    it('accepts valid intents case-insensitively and rejects everything else', () => {
      expect(parseIntent('LONG-TERM')).toBe('long-term');
      expect(parseIntent(' intraday ')).toBe('intraday');
      expect(parseIntent('hold-forever')).toBeNull();
      expect(parseIntent('')).toBeNull();
      expect(parseIntent(null)).toBeNull();
      expect(parseIntent(undefined)).toBeNull();
    });

    it('labels every intent, including the unclassified one', () => {
      for (const i of ['long-term', 'swing', 'intraday', 'unclassified'] as PositionIntent[]) {
        expect(describeIntent(i)).toBeTruthy();
      }
      expect(describeIntent('unclassified')).toMatch(/needs a decision/i);
    });

    it('declares a default for every provider we actually hold positions with', () => {
      // Guards the class, not the instance: a new provider added without a default would silently
      // send every one of its positions to `unclassified`, i.e. a wall of questions.
      expect(Object.keys(PROVIDER_DEFAULT_INTENT).sort()).toEqual(['mt5', 'trading212']);
    });
  });
});
