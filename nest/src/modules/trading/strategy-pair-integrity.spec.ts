import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';
import { PROTOCOL_SEED_DATA } from '../scoring/protocols-seed-data';

/**
 * A PAIRED BOT'S TWO LEGS MUST BE A REAL PAIR (#1185, shape B).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Shape B pairs a LONG protocol and a SHORT protocol under ONE bot. Three properties make such a pair
 * real rather than decorative, and each one was measured failing somewhere in this repo before it was
 * written down:
 *
 *   1. **Different protocols.** `strategy_signal_queue` is unique on
 *      `(strategyId, protocolId, symbol)` with no role in the key, so two subscriptions of the SAME
 *      protocol collapse to one row — the "pair" becomes a single leg and nobody notices
 *      (`signal-queue-paired-legs.spec.ts` asserts the queue half).
 *   2. **Opposite, explicit roles.** A leg with role `'both'` allows the same direction as the other
 *      leg, so both would act on one signal — a doubled position, not a pair. And a role left
 *      undeclared falls back to a NAME heuristic (`/-short|short-/`), which is a guess.
 *   3. **The role must match the protocol's own direction contract.** A `role: 'short'` pointing at
 *      a `LONG_ONLY` protocol can never fire, because `classifyDirectiveInclusion()` drops bullish
 *      directives from a SHORT_ONLY protocol and the reverse — the pair would be silently one-sided.
 *
 * ⚠️ THIS GUARDS THE SEED, NOT THE LIVE TABLE, and that is deliberate: `strategy_protocol` rows created
 * by hand are lost on reinstall (`database-seed-discipline`). A pair that exists only in the database
 * comes back as a single-leg bot — that only ever goes long — which is the failure this file exists to
 * make impossible.
 *
 * ⚠️ WHAT IT DOES NOT COVER: whether the two legs share ONE netting account. That is the actual
 * blocker for holding both at once (`resolveAbArmAccounts` refuses the same account on two A/B arms
 * for the same reason) and there is no field declaring a bot's account strategy yet — recorded as an
 * open acceptance item on #1185 rather than papered over with an invented field.
 */
describe('paired bots — a long leg and a short leg that is really a pair (#1185)', () => {
  const paired = DEFAULT_TRADING_STRATEGIES.filter(s => (s as any).legs?.length);
  const isShortOnly = (slug: string) => PROTOCOL_SEED_DATA[slug]?.directionMode === 'SHORT_ONLY';

  it('the seed actually contains paired bots — a guard over an empty set proves nothing', () => {
    // Canary in the other direction: if the pairs were ever dropped from the seed this file would
    // otherwise pass vacuously for ever.
    expect(paired.length).toBeGreaterThan(0);
    expect(paired.map(p => p.symbol).sort()).toEqual(['NVDA', 'USDJPY', 'XAGUSD']);
  });

  it('every leg is a DIFFERENT protocol from the bot’s primary one', () => {
    for (const bot of paired) {
      for (const leg of (bot as any).legs) {
        expect(`${bot.name}: leg ${leg.protocolId} vs primary ${bot.protocolId}`)
          .not.toBe(`${bot.name}: leg ${bot.protocolId} vs primary ${leg.protocolId}`);
        expect(leg.protocolId).not.toBe(bot.protocolId);
      }
    }
  });

  it('no bot lists the same leg twice — the queue key cannot hold two rows for one protocol', () => {
    for (const bot of paired) {
      const ids = ((bot as any).legs as Array<{ protocolId: string }>).map(l => l.protocolId);
      expect(new Set(ids).size).toBe(ids.length);
      // …and the primary protocol is not repeated as a leg either.
      expect(ids).not.toContain(bot.protocolId);
    }
  });

  it('every leg declares an EXPLICIT long/short role — never `both`, never absent', () => {
    for (const bot of paired) {
      for (const leg of (bot as any).legs) {
        expect(['long', 'short']).toContain(leg.role);
      }
    }
  });

  it('the pair has one long leg and one short leg (not two of a kind)', () => {
    for (const bot of paired) {
      const roles = ((bot as any).legs as Array<{ role: string }>).map(l => l.role);
      // The primary leg's role is derived the same way `seedDefaults()` derives it.
      const primaryRole = (bot as any).requireDirection === 'SELL' ? 'short'
        : /-short|short-/i.test(bot.protocolId) ? 'short' : 'long';
      const all = [primaryRole, ...roles].sort();
      expect(`${bot.name}: ${all.join('+')}`).toBe(`${bot.name}: long+short`);
    }
  });

  it("every short leg points at a SHORT_ONLY protocol and every long leg at a LONG_ONLY one", () => {
    for (const bot of paired) {
      for (const leg of (bot as any).legs) {
        const proto = PROTOCOL_SEED_DATA[leg.protocolId];
        expect(`${bot.name} leg ${leg.protocolId} exists`).toBe(
          proto ? `${bot.name} leg ${leg.protocolId} exists` : 'MISSING FROM SEED',
        );
        if (leg.role === 'short') expect(isShortOnly(leg.protocolId)).toBe(true);
        if (leg.role === 'long') expect(isShortOnly(leg.protocolId)).toBe(false);
      }
    }
  });

  it('a short leg is never a plain copy of its long counterpart — bullish directives are gone', () => {
    // The defect this pins, measured 2026-11-02: the first version of the derivation copied each
    // long protocol and flipped only `directionMode`, and `validate-protocol-directions.cjs` refused
    // the build with six "SHORT_ONLY contains <bullish directive>" conflicts.
    const BULLISH = [
      'earnings-momentum', 'earnings-proximity', 'ema-structure', 'falling-risk-pyramid',
      'momentum-continuation-combo', 'momentum-exhaustion', 'panic-exhaustion-absorption',
      'rsi-oversold', 'target-achieved', 'three-soldiers-pattern', 'volume-surge',
    ];
    for (const bot of paired) {
      for (const leg of (bot as any).legs) {
        if (leg.role !== 'short') continue;
        const proto = PROTOCOL_SEED_DATA[leg.protocolId];
        const ids = proto.groups.flatMap(g => g.directiveIds);
        for (const bullish of BULLISH) {
          expect(`${leg.protocolId} contains ${bullish}`).toBe(
            ids.includes(bullish) ? `${leg.protocolId} CONTAINS BULLISH ${bullish}` : `${leg.protocolId} contains ${bullish}`,
          );
        }
      }
    }
  });
});
