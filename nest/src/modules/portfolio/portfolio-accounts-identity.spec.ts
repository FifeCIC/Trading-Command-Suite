/**
 * portfolio-accounts-identity.spec.ts — an account id must identify ONE account (#1205).
 *
 * MEASURED 2026-11-19, `GET /api/portfolio/accounts` on the running API: six MT5 rows for three
 * logins. The same login is configured on BOTH bridges, and the id was `mt5:<login>`, so
 * `mt5:10011309743`, `mt5:62149650` and `mt5:52918025` each appeared twice — once per bridge, with
 * different `connected` values and different equities.
 *
 * Three consequences, none of which raised anything:
 *   1. duplicate React keys in Screen Options (`key={acc.id}`) — rows can duplicate or vanish;
 *   2. one toggle flipped the same login on BOTH bridges (the row is `accounts.<id>`);
 *   3. therefore one toggle changed the total for both bridges at once.
 *
 * ⚠️ The id is a PERSISTED KEY (`accounts.<id>`), which is why the fix reads the pre-rename key as a
 * fallback instead of migrating. One legacy row controlled both bridges, so copying it to each
 * per-bridge key would be a guess about the project's intent — right today, wrong the moment the two
 * diverge. The fallback needs no guess, and the first write to the new key supersedes it.
 */
import { PortfolioAccountsService } from './portfolio-accounts.service';

type Store = Map<string, string>;

function makeService(bridgeAccounts: any[], store: Store = new Map()) {
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
    position: { findMany: async () => [] },
  };
  const isaService = { getDashboard: async () => null };
  const mt5Connection = { getAccounts: async () => bridgeAccounts };
  const capitalAdapter = { getAccount: async () => null };
  const service = new PortfolioAccountsService(
    prisma as any,
    isaService as any,
    mt5Connection as any,
    capitalAdapter as any,
  );
  return { service, store };
}

const mt5Ids = (overview: any) =>
  overview.categories
    .flatMap((c: any) => c.accounts.map((a: any) => a.id))
    .filter((id: string) => id.startsWith('mt5:'));

/** The measured shape: three logins, each configured on both bridges. */
const SAME_LOGIN_ON_TWO_BRIDGES = [
  { number: 10011309743, login: '10011309743', server: 'MetaQuotes-Demo', brokerId: 2, connected: true, equity: 410.54 },
  { number: 10011309743, login: '10011309743', server: 'MetaQuotes-Demo', brokerId: 3, connected: false },
  { number: 62149650, login: '62149650', server: 'PepperstoneUK-Demo', brokerId: 2, connected: false },
  { number: 62149650, login: '62149650', server: 'PepperstoneUK-Demo', brokerId: 3, connected: true, equity: 973.35 },
  { number: 52918025, login: '52918025', server: 'ICMarketsSC-Demo', brokerId: 2, connected: false },
  { number: 52918025, login: '52918025', server: 'ICMarketsSC-Demo', brokerId: 3, connected: false },
];

describe('PortfolioAccountsService — account identity (#1205)', () => {
  it('gives every MT5 row a UNIQUE id when one login sits on two bridges', async () => {
    const { service } = makeService(SAME_LOGIN_ON_TWO_BRIDGES);
    const ids = mt5Ids(await service.getOverview());

    expect(ids).toHaveLength(6);                       // six rows still reported…
    expect(new Set(ids).size).toBe(6);                 // …but six DISTINCT ids
    expect(ids).toContain('mt5:2:10011309743');
    expect(ids).toContain('mt5:3:10011309743');
  });

  it('CANARY: two accounts on the SAME bridge stay distinct, and the bridge is in both ids', async () => {
    const { service } = makeService([
      { number: 111, login: '111', server: 'A', brokerId: 2, connected: true },
      { number: 222, login: '222', server: 'A', brokerId: 2, connected: true },
    ]);
    const ids = mt5Ids(await service.getOverview());
    expect(ids).toEqual(['mt5:2:111', 'mt5:2:222']);
  });

  it('applies a PRE-RENAME toggle to the per-bridge key, so nothing silently goes inert', async () => {
    const store: Store = new Map();
    // The requirement excluded this login before the rename. One legacy row, no bridge in it.
    store.set('accounts.mt5:10011309743', JSON.stringify({ enabled: false, removed: true }));

    const { service } = makeService(SAME_LOGIN_ON_TWO_BRIDGES, store);
    const overview = await service.getOverview();
    // ⚠️ A `removed` account is not in `categories` — it is in `overview.removed`. Searching only
    // the categories made this test report "0 rows", which is a fact about the archive lifecycle
    // rather than about the key rename.
    const rows = [...overview.categories.flatMap((c: any) => c.accounts), ...(overview.removed ?? [])]
      .filter((a: any) => a.id === 'mt5:2:10011309743' || a.id === 'mt5:3:10011309743');

    // The legacy row controlled BOTH bridges, so both must still read as excluded.
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.enabled).toBe(false);
      expect(r.removed).toBe(true);
    }
  });

  it('lets a NEW per-bridge write supersede the legacy key', async () => {
    const store: Store = new Map();
    store.set('accounts.mt5:10011309743', JSON.stringify({ enabled: false }));

    const { service } = makeService(SAME_LOGIN_ON_TWO_BRIDGES, store);
    await service.setEnabled('mt5:3:10011309743', true);

    const overview = await service.getOverview();
    const all = overview.categories.flatMap((c: any) => c.accounts);
    // The bridge that was toggled on reads ON…
    expect(all.find((a: any) => a.id === 'mt5:3:10011309743').enabled).toBe(true);
    // …while the other bridge keeps the legacy answer. That is the whole point of the id change:
    // the two can now disagree, which they could not before.
    expect(all.find((a: any) => a.id === 'mt5:2:10011309743').enabled).toBe(false);
  });

  it('a row with NO brokerId keeps the legacy id rather than inventing a unique-looking one', async () => {
    const { service } = makeService([
      { number: 999, login: '999', server: 'X', connected: true },   // no brokerId
    ]);
    expect(mt5Ids(await service.getOverview())).toEqual(['mt5:999']);
  });
});
