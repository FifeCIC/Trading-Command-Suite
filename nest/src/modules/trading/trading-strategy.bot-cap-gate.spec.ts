import { TradingStrategyService } from './trading-strategy.service';

/**
 * TradingStrategyService — the active-bot ceiling gate (#1193).
 *
 * ⚠️ WHAT THIS PINS, and why each half is separately canaried. The gate has four behaviours that
 * are easy to write as one and wrong as one:
 *
 *   1. **It refuses an increase at the ceiling** — the feature.
 *   2. **It never refuses a DECREASE.** The request that stops a bot must always succeed, at any
 *      level, or a limit intended to protect a new operator becomes a trap that keeps their bots
 *      running.
 *   3. **It is fail-open on cannot-judge.** `status: 'unavailable'` allows the activation. The
 *      repo's own lesson from #905: the defect being fixed is a false GREEN, and the fix must not
 *      become a false RED.
 *   4. **It is instant when switched off.** `progression.botCapEnabled=false` allows.
 *
 * A one-directional test cannot tell a working cap from a cap that never runs, so every refusal is
 * paired with an adjacent allow.
 *
 * Harness note: this borrows the prototype and stubs `prisma`, `protocolHealth`, `abPair` and
 * `progression` — the same pattern as `trading-strategy.activation-gate.spec.ts`. `protocolHealth`
 * returns `null` (no measurement) so #905's ceiling gate stays out of the way and each failure here
 * can only be the cap.
 */
describe('TradingStrategyService — active-bot cap (#1193)', () => {
  function makeService(opts: {
    strategy?: any;
    view?: any;
    enforcement?: { enabled: boolean; source: string };
  }) {
    const svc = Object.create(
      TradingStrategyService.prototype,
    ) as TradingStrategyService;
    const update = jest.fn(async ({ where, data }: any) => ({
      id: where.id,
      ...data,
    }));
    (svc as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    (svc as any).prisma = {
      tradingStrategy: {
        findUnique: jest.fn(async () => opts.strategy ?? null),
        update,
      },
      abPair: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
    };
    (svc as any).protocolHealth = {
      measureProtocolCeiling: jest.fn(async () => null),
    };
    (svc as any).progression = {
      isEnforcementEnabled: jest.fn(
        async () => opts.enforcement ?? { enabled: true, source: 'db' },
      ),
      getView: jest.fn(
        async () =>
          opts.view ?? {
            status: 'ok',
            activeBots: 1,
            botCap: 1,
            level: { level: 1, name: 'First install' },
            xp: 0,
            nextLevel: { level: 2, xpRequired: 75, activeBotCap: 2 },
            levels: [],
          },
      ),
    };
    return { svc, update };
  }

  const inactiveBot = {
    id: 'bot-1',
    name: 'EURUSD Swing',
    active: false,
    protocolId: 'xau-speed-1h',
    minComposite: 9,
  };

  it('REFUSES to activate a bot when the level is already at its ceiling', async () => {
    const { svc, update } = makeService({ strategy: inactiveBot });
    await expect(svc.update('bot-1', { active: true })).rejects.toMatchObject({
      code: 'TCS-TRADE-025',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('carries the level, the cap and the way out in the notice params', async () => {
    const { svc } = makeService({ strategy: inactiveBot });
    await expect(svc.update('bot-1', { active: true })).rejects.toMatchObject({
      params: expect.objectContaining({
        level: 1,
        cap: 1,
        active: 1,
        nextLevel: 2,
        nextXp: 75,
        nextCap: '2',
      }),
    });
  });

  it('ALLOWS the activation one slot below the ceiling', async () => {
    const { svc, update } = makeService({
      strategy: inactiveBot,
      view: {
        status: 'ok',
        activeBots: 0,
        botCap: 1,
        level: { level: 1 },
        xp: 0,
        nextLevel: { level: 2, xpRequired: 75, activeBotCap: 2 },
        levels: [],
      },
    });
    await svc.update('bot-1', { active: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'bot-1' },
      data: { active: true },
    });
  });

  it('⚠️ NEVER refuses a DEACTIVATION — the way out is always open, even at the ceiling', async () => {
    const { svc, update } = makeService({
      strategy: { ...inactiveBot, active: true },
      view: {
        status: 'ok',
        activeBots: 9,
        botCap: 1,
        level: { level: 1 },
        xp: 0,
        nextLevel: null,
        levels: [],
      },
    });
    await svc.update('bot-1', { active: false });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'bot-1' },
      data: { active: false },
    });
  });

  it('allows a re-save of an ALREADY-ACTIVE bot while over the ceiling (editing is not an increase)', async () => {
    const { svc, update } = makeService({
      strategy: { ...inactiveBot, active: true },
      view: {
        status: 'ok',
        activeBots: 9,
        botCap: 1,
        level: { level: 1 },
        xp: 0,
        nextLevel: null,
        levels: [],
      },
    });
    await svc.update('bot-1', { slPct: 1.5 });
    expect(update).toHaveBeenCalled();
  });

  it('ALLOWS everything when the ceiling is switched off in Settings', async () => {
    const { svc, update } = makeService({
      strategy: inactiveBot,
      enforcement: { enabled: false, source: 'db' },
    });
    await svc.update('bot-1', { active: true });
    expect(update).toHaveBeenCalled();
  });

  it('⚠️ FAIL-OPEN when the level cannot be computed — a guardrail must not become a lock', async () => {
    const { svc, update } = makeService({
      strategy: inactiveBot,
      view: { status: 'unavailable', reason: 'trade table missing' },
    });
    await svc.update('bot-1', { active: true });
    expect(update).toHaveBeenCalled();
  });

  it('FAIL-OPEN when reading the level throws', async () => {
    const { svc, update } = makeService({ strategy: inactiveBot });
    (svc as any).progression.getView = jest.fn(async () => {
      throw new Error('connection reset');
    });
    await svc.update('bot-1', { active: true });
    expect(update).toHaveBeenCalled();
  });

  it('an install already ABOVE its ceiling still refuses an increase (grandfathering is not amnesty)', async () => {
    const { svc, update } = makeService({
      strategy: inactiveBot,
      view: {
        status: 'ok',
        activeBots: 12,
        botCap: 3,
        level: { level: 3 },
        xp: 300,
        nextLevel: { level: 4, xpRequired: 600, activeBotCap: 5 },
        levels: [],
      },
    });
    await expect(svc.update('bot-1', { active: true })).rejects.toMatchObject({
      code: 'TCS-TRADE-025',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
