import { BadRequestException, ConflictException } from '@nestjs/common';
import { StrategyRegistryService } from './strategy-registry.service';

/**
 * StrategyRegistryService — the MATERIALISE step (#875). Spec pins the contract the issue's
 * acceptance criteria name explicitly:
 *
 *   • naming persists name + part IDs and returns a stable id;
 *   • RENAMING does not create a second strategy;
 *   • editing a part does not silently orphan the name — it shows as DRIFT with the changed fields;
 *   • successors of registered bots are NOT auto-minted a parallel identity (the same strategy
 *     drifted, not a new one).
 *
 * Harness note: only `prisma`, `derivation` and `logger` are touched — prototype borrowed, those
 * three stubbed (same pattern as the venue-standby / activation-gate specs).
 */
describe('StrategyRegistryService — naming, drift, auto-registration (#875)', () => {
  const treatment = () => ({
    minComposite: 8, baseSize: 0.01, slPct: 1, tpPct: 1, maxHoldHours: null, cooldownMinutes: 5,
    maxPyramidTiers: 1, timeframe: '5m', sessionWindow: null, mode: 'manual', maxPositions: 1,
    maxDailyLoss: null, useRaritySizing: true, maxSize: null,
  });

  const card = (over: any = {}) => ({
    strategyKey: 'abc123', name: null, pinned: false,
    protocolIds: ['p1'], protocolRoles: ['long'], botIds: ['b1'], botNames: ['Bot One'],
    symbols: ['XAUUSD'], scoringStrategyIds: [], brokers: ['mt5'], treatment: treatment(),
    botCount: 1, symbolCount: 1, active: true, duplicateBotNames: ['Bot One'], unreachableBotNames: [],
    ...over,
  });

  function make(rows: any[] = [], cards: any[] = [card()]) {
    const store = new Map<string, any>(rows.map((r) => [r.strategyKey, r]));
    const prisma = {
      strategyRegistry: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id) return [...store.values()].find((r) => r.id === where.id) ?? null;
          return store.get(where.strategyKey) ?? null;
        }),
        findMany: jest.fn(async () => [...store.values()]),
        create: jest.fn(async ({ data }: any) => {
          const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
          store.set(data.strategyKey, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = [...store.values()].find((r) => r.id === where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }),
        createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
          let count = 0;
          for (const d of data) {
            if (store.has(d.strategyKey) && skipDuplicates) continue;
            store.set(d.strategyKey, { ...d });
            count++;
          }
          return { count };
        }),
      },
    };
    const derivation = {
      deriveAll: jest.fn(async () => ({
        strategies: cards, totalStrategies: cards.length, totalBots: cards.length,
        duplicateGroups: 0, orphans: [], derivedAt: new Date().toISOString(), definition: '',
      })),
    };
    const svc = Object.create(StrategyRegistryService.prototype) as StrategyRegistryService;
    (svc as any).prisma = prisma;
    (svc as any).derivation = derivation;
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, prisma, store };
  }

  it('registers a derived strategy: stable id + name + the accepted parts snapshot', async () => {
    const { svc } = make();
    const res = await svc.register('abc123', { name: 'Gold Momentum' });
    expect(res.created).toBe(true);
    expect(res.id).toBeTruthy();
    expect(res.name).toBe('Gold Momentum');
    expect(res.source).toBe('owner');
    expect((res.parts as any).botIds).toEqual(['b1']);
    expect((res.parts as any).symbols).toEqual(['XAUUSD']);
    expect((res.parts as any).treatment.timeframe).toBe('5m');
  });

  it('is idempotent: re-registering returns the existing row without a second identity', async () => {
    const { svc, store } = make();
    await svc.register('abc123', { name: 'Gold Momentum' });
    const again = await svc.register('abc123');
    expect(again.created).toBe(false);
    expect(store.size).toBe(1);
  });

  it('a name supplied for an existing UNNAMED row fills it (naming an auto row)', async () => {
    const { svc } = make();
    await svc.register('abc123', { source: 'auto' });
    const named = await svc.register('abc123', { name: 'Adopted' });
    expect(named.name).toBe('Adopted');
    expect(named.created).toBe(false);
  });

  it('refuses a key that is not currently materialised', async () => {
    const { svc } = make();
    await expect(svc.register('ghost99')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renaming edits the same row — never a second strategy', async () => {
    const { svc, store } = make();
    const row = await svc.register('abc123', { name: 'First' });
    await svc.rename(row.id, 'Second');
    expect(store.size).toBe(1);
    expect((await svc.list()).strategies[0].name).toBe('Second');
  });

  it('an empty rename clears the label but keeps the row registered', async () => {
    const { svc } = make();
    const row = await svc.register('abc123', { name: 'First' });
    const cleared = await svc.rename(row.id, '   ');
    expect(cleared.name).toBeNull();
    expect((await svc.list()).total).toBe(1);
  });

  it('list reports STEADY when the derived key still matches the accepted key', async () => {
    const { svc } = make();
    await svc.register('abc123', { name: 'Gold Momentum' });
    const { strategies } = await svc.list();
    expect(strategies[0].status).toBe('steady');
    expect(strategies[0].changed).toEqual([]);
  });

  it('list reports DRIFTED with the changed fields when a part was edited (name is NOT orphaned)', async () => {
    const edited = card({ strategyKey: 'def456', treatment: { ...treatment(), slPct: 2, minComposite: 9 } });
    const { svc } = make([], [edited]);
    // Register against the ORIGINAL configuration's key, then the edit arrives.
    const store = new Map();
    const original = card();
    store.set(original.strategyKey, {
      id: 'row-1', strategyKey: original.strategyKey, name: 'Gold Momentum', source: 'owner',
      parts: { protocolIds: original.protocolIds, protocolRoles: original.protocolRoles, botIds: original.botIds, botNames: original.botNames, symbols: original.symbols, scoringStrategyIds: original.scoringStrategyIds, brokers: original.brokers, treatment: original.treatment },
      createdAt: new Date(), updatedAt: new Date(),
    });
    (svc as any).prisma.strategyRegistry.findMany = jest.fn(async () => [...store.values()]);
    (svc as any).prisma.strategyRegistry.update = jest.fn(async ({ where, data }: any) => {
      const row = [...store.values()].find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    });

    const { strategies } = await svc.list();
    expect(strategies[0].status).toBe('drifted');
    expect(strategies[0].name).toBe('Gold Momentum'); // the name survived the part edit
    const fields = strategies[0].changed.map((c) => c.field);
    expect(fields).toContain('slPct');
    expect(fields).toContain('minComposite');
    expect(strategies[0].current?.strategyKey).toBe('def456');
  });

  it('reaccept accepts the drifted configuration and reports what changed', async () => {
    const edited = card({ strategyKey: 'def456', treatment: { ...treatment(), slPct: 2 } });
    const store = new Map([['abc123', {
      id: 'row-1', strategyKey: 'abc123', name: 'Gold Momentum', source: 'owner',
      parts: { botIds: ['b1'], protocolIds: ['p1'], protocolRoles: ['long'], symbols: ['XAUUSD'], scoringStrategyIds: [], brokers: ['mt5'], treatment: treatment() },
      createdAt: new Date(), updatedAt: new Date(),
    }]]);
    const { svc } = make([], [edited]);
    (svc as any).prisma.strategyRegistry.findUnique = jest.fn(async ({ where }: any) =>
      where.id ? store.get([...store.keys()][0]) : store.get(where.strategyKey) ?? null);
    (svc as any).prisma.strategyRegistry.update = jest.fn(async ({ where, data }: any) => {
      const row = [...store.values()].find((r) => r.id === where.id);
      Object.assign(row, data);
      store.delete('abc123');
      store.set(data.strategyKey, row);
      return row;
    });

    const res = await svc.reaccept('row-1');
    expect(res.strategyKey).toBe('def456');
    expect(res.status).toBe('reaccepted');
    expect(res.changed.map((c: any) => c.field)).toContain('slPct');
  });

  it('reaccept REFUSES when the target key is already another row (merge is deliberate)', async () => {
    const edited = card({ strategyKey: 'def456', treatment: { ...treatment(), slPct: 2 } });
    const store = new Map([
      ['abc123', { id: 'row-1', strategyKey: 'abc123', name: 'Old', source: 'owner', parts: { botIds: ['b1'], treatment: treatment() }, createdAt: new Date(), updatedAt: new Date() }],
      ['def456', { id: 'row-2', strategyKey: 'def456', name: 'Taken', source: 'auto', parts: { botIds: ['b2'], treatment: treatment() }, createdAt: new Date(), updatedAt: new Date() }],
    ]);
    const { svc } = make([], [edited]);
    (svc as any).prisma.strategyRegistry.findUnique = jest.fn(async ({ where }: any) =>
      where.id ? [...store.values()].find((r) => r.id === where.id) ?? null : store.get(where.strategyKey) ?? null);

    await expect(svc.reaccept('row-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('syncAuto registers a NEW materialised combination (active, single bot, unregistered)', async () => {
    const { svc, store } = make([], [card()]);
    const res = await svc.syncAuto();
    expect(res.created).toBe(1);
    const row = store.get('abc123');
    expect(row.source).toBe('auto');
    expect(row.name).toBeNull();
  });

  it('syncAuto SKIPS successors of registered bots — drift, not a parallel identity', async () => {
    const successor = card({ strategyKey: 'def456' }); // same bot b1, edited config
    const registered = { id: 'row-1', strategyKey: 'abc123', name: null, source: 'auto', parts: { botIds: ['b1'] }, createdAt: new Date(), updatedAt: new Date() };
    const { svc, store } = make([registered], [successor]);
    const res = await svc.syncAuto();
    expect(res.created).toBe(0);
    expect(store.size).toBe(1);
  });

  it('syncAuto skips inactive bots and duplicate groups', async () => {
    const inactive = card({ strategyKey: 'inactive1', active: false, botIds: ['b9'] });
    const dup = card({ strategyKey: 'dup1', botCount: 2, botIds: ['b7', 'b8'], duplicateBotNames: ['A', 'B'] });
    const { svc } = make([], [inactive, dup]);
    const res = await svc.syncAuto();
    expect(res.created).toBe(0);
  });
});
