import { FirstRunSeedService } from './first-run-seed.service';
// #1258 — the source fleet, so the #1193 cap tests can compare a seeded flag against the flag it
// was given rather than against `false`. See the note in "an uncapped level keeps every shipped…".
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';

/**
 * first-run-seed.service.spec.ts — the install path must seed ONCE, and never on a live install.
 *
 * ── WHY THIS EXISTS ──
 *
 * Measured 2026-11-02: an empty database was built, the schema loaded (121 tables) and the API
 * booted against it. Result: **0 protocols, 0 bots, 0 directive groups.** The seeders existed but
 * only ever ran from an API call, so the app booted healthy and offered the user nothing — the
 * packaged strategies were inert.
 *
 * Two properties matter and they pull in opposite directions, which is why both are pinned here:
 *   1. A fresh database IS seeded (otherwise the package ships empty).
 *   2. A populated database is NOT touched (the seeders are convergent — #833 — so firing them on
 *      a live install would rewrite every declared field and revert deliberate local changes; it
 *      once flipped five bots to `semi-auto` and nulled four gold time-stops).
 *
 * ⚠️ These are behavioural, not mock-shaped: the fakes record the ORDER of calls, because a bot
 * created before its protocol would point at a slug that does not exist yet.
 */
function makeService(opts: {
  protocolCount: number;
  botCount: number;
  protocolCountAfterSeed?: number;
  isAvailable?: boolean;
}) {
  const calls: string[] = [];
  const prisma: any = {
    isAvailable: opts.isAvailable !== false,
    protocol: {
      count: jest.fn(async () => {
        calls.push('protocol.count');
        // After seeding, the count must read as non-empty — the bot step re-checks it.
        const seededIdx = calls.indexOf('protocolDb.seedProtocolsToDatabase');
        if (seededIdx >= 0) return opts.protocolCountAfterSeed ?? opts.protocolCount;
        return opts.protocolCount;
      }),
    },
    tradingStrategy: {
      count: jest.fn(async () => {
        calls.push('tradingStrategy.count');
        return opts.botCount;
      }),
    },
  };
  const protocolDb: any = {
    seedProtocolsToDatabase: jest.fn(async () => {
      calls.push('protocolDb.seedProtocolsToDatabase');
      return { seeded: 3, groups: 9, entries: 31 };
    }),
  };
  const tradingStrategy: any = {
    seedDefaults: jest.fn(async () => {
      calls.push('tradingStrategy.seedDefaults');
      return { created: 3, updated: 0, unchanged: 0, failed: 0, changes: [] };
    }),
  };
  // #1193 — the first-run seeder caps how many shipped bots start ACTIVE. Stubbed as UNLIMITED so
  // these tests keep describing the seeding order and idempotence they were written for; the cap
  // itself is covered by `progression-levels.spec.ts` and the bot-cap gate spec.
  const progression: any = {
    activeBotsForFreshInstall: jest.fn(async () => ({ limit: null, judged: true })),
  };
  const svc = new FirstRunSeedService(prisma, protocolDb, tradingStrategy, progression);
  return { svc, calls, protocolDb, tradingStrategy, prisma, progression };
}

describe('FirstRunSeedService — seed once, never twice', () => {
  it('SEEDS an empty database: protocols first, then bots', async () => {
    const { svc, calls, protocolDb, tradingStrategy } = makeService({
      protocolCount: 0,
      botCount: 0,
      protocolCountAfterSeed: 3,
    });

    const result = await svc.seedIfEmpty();

    expect(result).toEqual({ protocolsSeeded: 3, botsCreated: 3, skippedBecause: null });
    expect(protocolDb.seedProtocolsToDatabase).toHaveBeenCalledTimes(1);
    expect(tradingStrategy.seedDefaults).toHaveBeenCalledTimes(1);
    // ⚠️ ORDER. A bot references a protocol by slug; seeding bots first would create three bots
    // pointing at protocols that do not exist yet — active, listed, and unable to trade.
    expect(calls.indexOf('protocolDb.seedProtocolsToDatabase')).toBeLessThan(
      calls.indexOf('tradingStrategy.seedDefaults'),
    );
  });

  it('DOES NOTHING on a populated database — the convergent seeder must not fire', async () => {
    const { svc, protocolDb, tradingStrategy } = makeService({ protocolCount: 50, botCount: 40 });

    const result = await svc.seedIfEmpty();

    expect(result).toEqual({ protocolsSeeded: null, botsCreated: null, skippedBecause: null });
    expect(protocolDb.seedProtocolsToDatabase).not.toHaveBeenCalled();
    expect(tradingStrategy.seedDefaults).not.toHaveBeenCalled();
  });

  it('seeds bots on an install that has protocols but no bots', async () => {
    const { svc, protocolDb, tradingStrategy } = makeService({ protocolCount: 50, botCount: 0 });

    const result = await svc.seedIfEmpty();

    expect(result).toEqual({ protocolsSeeded: null, botsCreated: 3, skippedBecause: null });
    expect(protocolDb.seedProtocolsToDatabase).not.toHaveBeenCalled();
    expect(tradingStrategy.seedDefaults).toHaveBeenCalledTimes(1);
  });

  it('REFUSES to create bots when no protocol exists — a bot with no protocol is silent', async () => {
    // The protocol seeder failed to produce anything (a real possibility: it is wrapped in a
    // per-protocol try/catch). Creating bots anyway is the failure this catches.
    const { svc, tradingStrategy } = makeService({
      protocolCount: 0,
      botCount: 0,
      protocolCountAfterSeed: 0,
    });

    const result = await svc.seedIfEmpty();

    expect(result.protocolsSeeded).toBe(3); // the seeder reported success…
    expect(result.botsCreated).toBeNull();  // …but nothing exists, so bots were refused
    expect(tradingStrategy.seedDefaults).not.toHaveBeenCalled();
  });

  it('reports "cannot judge" rather than seeding when the database is unavailable', async () => {
    const { svc, protocolDb, tradingStrategy } = makeService({
      protocolCount: 0,
      botCount: 0,
      isAvailable: false,
    });

    const result = await svc.seedIfEmpty();

    // An unreachable database is NOT an empty one. Seeding here would be a guess.
    expect(result).toEqual({ protocolsSeeded: null, botsCreated: null, skippedBecause: 'database unavailable' });
    expect(protocolDb.seedProtocolsToDatabase).not.toHaveBeenCalled();
    expect(tradingStrategy.seedDefaults).not.toHaveBeenCalled();
  });

  describe('#1193 — how many shipped bots start ACTIVE', () => {
    /** What the seeder actually handed to `seedDefaults()`. */
    const seeded = (tradingStrategy: any) => tradingStrategy.seedDefaults.mock.calls[0][0] as any[];

    it('⚠️ a fresh install starts with ONE active bot, not the whole shipped set', async () => {
      const { svc, tradingStrategy, progression } = makeService({
        protocolCount: 0,
        botCount: 0,
        protocolCountAfterSeed: 3,
      });
      progression.activeBotsForFreshInstall = jest.fn(async () => ({ limit: 1, judged: true }));

      await svc.seedIfEmpty();

      const bots = seeded(tradingStrategy);
      expect(bots.length).toBeGreaterThan(1);
      expect(bots[0].active).not.toBe(false); // the first keeps its seeded flag
      expect(bots.slice(1).every((b) => b.active === false)).toBe(true);
    });

    it('an uncapped level keeps every shipped active flag', async () => {
      const { svc, tradingStrategy } = makeService({ protocolCount: 0, botCount: 0, protocolCountAfterSeed: 3 });

      await svc.seedIfEmpty();

      /**
       * ⚠️ COMPARED AGAINST THE SOURCE, NOT AGAINST `false` (#1258, 2026-11-13).
       *
       * This asserted `some(b => b.active === false) === false`, which was equivalent to "the cap
       * changed nothing" only while EVERY shipped bot was active. Once the seed carried the real
       * fleet, several bots are legitimately INACTIVE in `DEFAULT_TRADING_STRATEGIES` — so the old
       * form failed while the seeder was behaving perfectly, and the tempting repair would have been
       * to "fix" the seeder.
       *
       * The claim worth testing is the one the cap can break: for an uncapped level, every seeded
       * `active` flag equals the flag it was given.
       */
      const bots = seeded(tradingStrategy);
      expect(bots.every((b, i) => b.active === DEFAULT_TRADING_STRATEGIES[i].active)).toBe(true);
    });

    it('⚠️ FAIL-OPEN: an unreadable level keeps the shipped flags rather than shipping a one-bot install', async () => {
      const { svc, tradingStrategy, progression } = makeService({
        protocolCount: 0,
        botCount: 0,
        protocolCountAfterSeed: 3,
      });
      progression.activeBotsForFreshInstall = jest.fn(async () => ({ limit: null, judged: false }));

      await svc.seedIfEmpty();

      // Same comparison as above, and for the same reason: a fail-open level must not CHANGE a flag.
      const bots = seeded(tradingStrategy);
      expect(bots.every((b, i) => b.active === DEFAULT_TRADING_STRATEGIES[i].active)).toBe(true);
    });

    it('a CAPPED level flips only bots the source had ACTIVE — an already-inactive bot is untouched (#1258)', async () => {
      // ⚠️ THREE properties, because one is not enough to catch a cap that rewrites everything:
      //   1. inside the limit, every flag is the SOURCE flag (the cap must not touch these);
      //   2. beyond the limit, an ACTIVE bot is turned OFF (the cap doing its job);
      //   3. an already-OFF bot stays off (the cap is a no-op, not a rewriter).
      // ⚠️ Measured 2026-11-13: a mutation that set EVERY seeded bot `active: false` passed all
      // 9 tests in this file before this version — the two uncapped tests return early and never
      // reach the cap, and asserting "already-off bots are still off" is satisfied by a cap that
      // turns everything off. Property 1 is the only one that sees it.
      const { svc, tradingStrategy, progression } = makeService({
        protocolCount: 0, botCount: 0, protocolCountAfterSeed: 3,
      });
      const LIMIT = 3;
      progression.activeBotsForFreshInstall = jest.fn(async () => ({ limit: LIMIT, judged: true }));

      await svc.seedIfEmpty();

      const bots = seeded(tradingStrategy);
      // 1 — inside the limit, nothing changed.
      for (let i = 0; i < LIMIT; i++) expect(bots[i].active).toBe(DEFAULT_TRADING_STRATEGIES[i].active);
      // 2 — beyond the limit, a bot the source had ACTIVE is off.
      const activeBeyond = DEFAULT_TRADING_STRATEGIES
        .map((s, i) => ({ s, i }))
        .filter(({ s, i }) => i >= LIMIT && s.active !== false);
      expect(activeBeyond.length).toBeGreaterThan(0); // the case exists, or this proves nothing
      for (const { i } of activeBeyond) expect(bots[i].active).toBe(false);
      // 3 — an already-off bot stays off.
      for (const { i } of DEFAULT_TRADING_STRATEGIES.map((s, i) => ({ s, i })).filter(({ s }) => s.active === false)) {
        expect(bots[i].active).toBe(false);
      }
    });
  });
});
