import {
  classifySignal,
  isBuySignal,
  isSellSignal,
  signalToDirection,
  signalToSide,
  directionToSide,
  resolveEffectiveRole,
  directionAllowed,
} from './signal-direction';

/**
 * The SINGLE AUTHORITY on what a signal class means, and which way a bot may trade.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FILE GUARDS (measured live 2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Direction was decided with a PREFIX test:
 *
 *     env.signal.startsWith('SELL') ? 'SHORT' : 'LONG'
 *
 * `'STRONG_SELL'.startsWith('SELL')` is **false** — the token begins with `STRONG`. So every
 * STRONG_SELL, the highest-conviction bearish signal in the system, was routed as **LONG/BUY**.
 *
 * Observed live, not theorised: the ladder reported VIX at `STRONG_SELL` (composite 230,
 * `preTradeReady: true`, no blockers) while `strategy_signal_queue` held
 * `direction=LONG, signal=BUY` for the bot literally named "VIX Spike Short (demo proof #772)".
 * The execution path reads direction off the QUEUE, so that pending row would have placed a BUY on
 * a sell signal.
 *
 * The same predicate broke the ladder's own counters: `STRONG_SELL` matched neither
 * `startsWith('SELL')` nor `startsWith('BUY')`, so it was counted as neither. And it put the
 * ladder's "best protocol per symbol PER DIRECTION" dedupe key in the wrong bucket, so a strong
 * sell could displace a genuine long envelope.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS ARE SHAPED THIS WAY
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `STRONG_SELL` is asserted explicitly and table-driven, because the failure was a *prefix*
 * collision — a test that only ever tried `'SELL'` and `'BUY'` could never have caught it. Each
 * `STRONG_*` variant is tested for direction, side AND classification, so a partial regression
 * (fixing direction but not the counts) still fails.
 *
 * The permission tests assert the PRECEDENCE too: subscription role beats bot-level
 * `requireDirection`, and "not configured" means BOTH directions rather than silently "long only".
 */
describe('signal-direction — one authority for signal class → direction (#714)', () => {
  describe('classification is by WHOLE TOKEN, never prefix', () => {
    it.each([
      ['BUY', 'buy'],
      ['STRONG_BUY', 'buy'],
      ['SELL', 'sell'],
      ['STRONG_SELL', 'sell'],
      ['HOLD', 'hold'],
      ['LONG', 'buy'],
      ['SHORT', 'sell'],
      ['NEUTRAL', 'hold'],
    ])('classifies %s as %s', (signal, expected) => {
      expect(classifySignal(signal)).toBe(expected);
    });

    it('handles case, whitespace and non-strings without guessing', () => {
      expect(classifySignal('strong_sell')).toBe('sell');
      expect(classifySignal('  Strong_Sell  ')).toBe('sell');
      expect(classifySignal('strong_buy')).toBe('buy');
      expect(classifySignal(null)).toBe('hold');
      expect(classifySignal(undefined)).toBe('hold');
      expect(classifySignal('')).toBe('hold');
    });

    it('reports an unrecognised class as UNKNOWN rather than defaulting it', () => {
      // ⚠️ The whole bug was a silent default. A new signal class must not become a BUY.
      expect(classifySignal('WEAK_SELL')).toBe('unknown');
      expect(classifySignal('MAYBE')).toBe('unknown');
      expect(signalToDirection('WEAK_SELL')).toBeNull();
      expect(signalToSide('WEAK_SELL')).toBeNull();
    });
  });

  describe('THE REGRESSION GUARD — STRONG_SELL must not be routed as a LONG', () => {
    it.each([
      ['BUY', 'LONG', 'BUY'],
      ['STRONG_BUY', 'LONG', 'BUY'],
      ['SELL', 'SHORT', 'SELL'],
      // ⚠️ THE LINE THAT WAS WRONG. `'STRONG_SELL'.startsWith('SELL') === false` produced LONG/BUY.
      ['STRONG_SELL', 'SHORT', 'SELL'],
    ])('%s -> direction %s, side %s', (signal, direction, side) => {
      expect(signalToDirection(signal)).toBe(direction);
      expect(signalToSide(signal)).toBe(side);
    });

    it('does not collapse STRONG_SELL into LONG the way a prefix test does', () => {
      // State the broken predicate explicitly, so the reader can see what was replaced and why
      // this test cannot pass by accident.
      expect('STRONG_SELL'.startsWith('SELL')).toBe(false);
      expect('STRONG_BUY'.startsWith('BUY')).toBe(false);
      // …and the authority disagrees with it, correctly:
      expect(isSellSignal('STRONG_SELL')).toBe(true);
      expect(isBuySignal('STRONG_BUY')).toBe(true);
    });

    it('counts STRONG_* in the ladder tallies (the counters were broken too)', () => {
      const signals = ['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL', 'HOLD'];
      expect(signals.filter(isBuySignal)).toEqual(['BUY', 'STRONG_BUY']);
      expect(signals.filter(isSellSignal)).toEqual(['SELL', 'STRONG_SELL']);
      // The old predicates counted STRONG_* as NEITHER, so the ladder under-reported both sides.
      expect(signals.filter(s => s.startsWith('BUY')).length).toBe(1);   // 2 expected
      expect(signals.filter(s => s.startsWith('SELL')).length).toBe(1);  // 2 expected
    });

    it('returns null for hold rather than defaulting to a side', () => {
      expect(signalToDirection('HOLD')).toBeNull();
      expect(signalToSide('HOLD')).toBeNull();
    });
  });

  describe('direction -> side never silently defaults to BUY', () => {
    it.each([
      ['LONG', 'BUY'],
      ['long', 'BUY'],
      ['buy', 'BUY'],
      ['SHORT', 'SELL'],
      ['short', 'SELL'],
      ['sell', 'SELL'],
    ])('%s -> %s', (direction, side) => {
      expect(directionToSide(direction)).toBe(side);
    });

    it('returns null for an unreadable direction instead of BUY', () => {
      // ⚠️ The execution path wrote `direction === 'SHORT' ? 'SELL' : 'BUY'`, so anything
      // unrecognised — including the LONG produced by the prefix bug — became a BUY.
      // `'SELL'.toUpperCase() === 'SHORT'` was false, so a real SHORT could misroute too.
      expect(directionToSide(undefined)).toBeNull();
      expect(directionToSide(null)).toBeNull();
      expect(directionToSide('')).toBeNull();
      expect(directionToSide('SIDEWAYS')).toBeNull();
      expect(directionToSide('HOLD')).toBeNull();
    });
  });

  describe('direction permission — subscription role wins, bot field is the fallback', () => {
    it('uses the subscription role when it says something', () => {
      expect(resolveEffectiveRole('short', 'BUY')).toBe('short'); // role wins
      expect(resolveEffectiveRole('long', 'SELL')).toBe('long');
      expect(resolveEffectiveRole('both', 'SELL')).toBe('both');
    });

    it('falls back to the bot-level requireDirection only when role is silent', () => {
      expect(resolveEffectiveRole(null, 'SELL')).toBe('short');
      expect(resolveEffectiveRole(undefined, 'BUY')).toBe('long');
      expect(resolveEffectiveRole('', 'SELL')).toBe('short');
      // The real row: vix-short-v1 subscription role='short', bot requireDirection='SELL'.
      expect(resolveEffectiveRole('short', 'SELL')).toBe('short');
      // The real row: 24 forex/xau subscriptions role='long', requireDirection null.
      expect(resolveEffectiveRole('long', null)).toBe('long');
    });

    it('treats an unreadable role and no bot field as UNCONSTRAINED, not long-only', () => {
      // `null` must mean "both ways". Reading it as long-only would silently delete every short
      // capability a bot has, which is the failure mode being fixed here.
      expect(resolveEffectiveRole(null, null)).toBeNull();
      expect(resolveEffectiveRole('nonsense', null)).toBeNull();
      expect(directionAllowed(null, 'LONG')).toBe(true);
      expect(directionAllowed(null, 'SHORT')).toBe(true);
      expect(directionAllowed('both', 'SHORT')).toBe(true);
    });

    it('permits only the matching direction for a constrained role', () => {
      expect(directionAllowed('short', 'SHORT')).toBe(true);
      expect(directionAllowed('short', 'LONG')).toBe(false);
      expect(directionAllowed('long', 'LONG')).toBe(true);
      expect(directionAllowed('long', 'SHORT')).toBe(false);
    });

    it('refuses an unclassifiable direction under a constrained role (fails closed)', () => {
      expect(directionAllowed('short', undefined)).toBe(false);
      expect(directionAllowed('long', 'SIDEWAYS')).toBe(false);
      expect(directionAllowed('short', 'HOLD')).toBe(false);
    });

    it('the VIX bot is permitted to sell and forbidden to buy', () => {
      // End-to-end on the measured row: role='short', requireDirection='SELL'.
      const role = resolveEffectiveRole('short', 'SELL');
      expect(directionAllowed(role, 'SHORT')).toBe(true);
      expect(directionAllowed(role, 'LONG')).toBe(false);
      // …and this is what the routing gate now does with a STRONG_SELL from vix-short-v1:
      expect(directionAllowed(role, signalToDirection('STRONG_SELL')!)).toBe(true);
    });
  });
});
