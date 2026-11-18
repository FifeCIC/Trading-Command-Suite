import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PortfolioAccountsService } from './portfolio-accounts.service';

/**
 * portfolio-accounts-removal.spec.ts — the archive/restore lifecycle on the account store.
 *
 * Why this file exists: `portfolio-accounts.service.ts` carried a comment claiming its two credential
 * readers "are asserted by the spec beside this file", and there was no spec. A comment that names a
 * guard which does not exist is worse than no comment — it reads as coverage. This covers the removal
 * behaviour specifically, because that is the part a wrong answer is invisible in: a removed account
 * that still counts towards the total looks exactly like a normal portfolio.
 */

type Store = Map<string, string>;

function makeService(store: Store = new Map()) {
  const prisma = {
    isAvailable: true,
    globalSetting: {
      findUnique: async ({ where }: any) =>
        store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null,
      upsert: async ({ where, create, update }: any) => {
        store.set(where.key, create?.value ?? update?.value);
        return { key: where.key, value: store.get(where.key) };
      },
    },
    position: {
      findMany: async () => [],
    },
  };

  const isaService = { getDashboard: async () => null };
  // No bridges: `collectAccounts()` then falls back to a single `mt5:bridge` row, which is exactly
  // the MT5 case the archive must REFUSE rather than hide.
  const mt5Connection = { getAccounts: async () => [] };
  const capitalAdapter = { getAccount: async () => null };

  const service = new PortfolioAccountsService(
    prisma as any,
    isaService as any,
    mt5Connection as any,
    capitalAdapter as any,
  );
  return { service, store };
}

const allIds = (overview: any) =>
  overview.categories.flatMap((c: any) => c.accounts.map((a: any) => a.id));

describe('PortfolioAccountsService — removal lifecycle', () => {
  it('archives an account: gone from the categories, present in `removed`', async () => {
    const { service } = makeService();

    const before = await service.getOverview();
    expect(allIds(before)).toContain('t212:cfd');
    expect(before.removed).toEqual([]);

    await service.setRemoved('t212:cfd', true);

    const after = await service.getOverview();
    expect(allIds(after)).not.toContain('t212:cfd');
    expect(after.removed.map((a: any) => a.id)).toEqual(['t212:cfd']);
    expect(after.removed[0].removed).toBe(true);
  });

  it('restores an account back into its category', async () => {
    const { service } = makeService();
    await service.setRemoved('t212:cfd', true);
    await service.setRemoved('t212:cfd', false);

    const after = await service.getOverview();
    expect(allIds(after)).toContain('t212:cfd');
    expect(after.removed).toEqual([]);
  });

  it('a removed account cannot contribute to a category total', async () => {
    // The total is computed from `cat.accounts`, so the assertion that matters is that the account is
    // not IN that list. `value` is null while disconnected, which would mask a total bug.
    const { service } = makeService();
    await service.setRemoved('t212:live', true);

    const overview = await service.getOverview();
    const live = overview.categories.find((c: any) => c.id === 'live')!;
    expect(live.accounts.map((a: any) => a.id)).not.toContain('t212:live');
    expect(live.total).toBe(0);
  });

  it('a later enable/disable toggle does NOT erase the removal', async () => {
    // Regression guard for the read-modify-write: `writeEnabled()` used to serialise `{ enabled }`
    // wholesale, so toggling a removed account silently un-removed it.
    const { service, store } = makeService();
    await service.setRemoved('t212:cfd', true);
    await service.setEnabled('t212:cfd', false);

    expect(JSON.parse(store.get('accounts.t212:cfd')!)).toEqual({ removed: true, enabled: false });

    const overview = await service.getOverview();
    expect(overview.removed.map((a: any) => a.id)).toEqual(['t212:cfd']);
  });

  it('rejects an unknown account with 404', async () => {
    const { service } = makeService();
    await expect(service.setRemoved('t212:nope', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a CATEGORY with 400 — removal is per account', async () => {
    const { service } = makeService();
    await expect(service.setRemoved('cat:live', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an MT5 account with 400 — it is removed at the bridge, not archived here', async () => {
    // Archiving a live MT5 connection would hide it while the terminal kept trading it.
    const { service } = makeService();
    const overview = await service.getOverview();
    const mt5 = overview.categories.flatMap((c: any) => c.accounts).find((a: any) => a.kind === 'mt5');
    expect(mt5).toBeDefined();

    await expect(service.setRemoved(mt5.id, true)).rejects.toBeInstanceOf(BadRequestException);
  });
});
