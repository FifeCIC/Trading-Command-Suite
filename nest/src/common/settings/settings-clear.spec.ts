import { SettingsResolverService } from './settings-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * settings-clear.spec.ts — the SINGLE-KEY delete, and the three answers it must keep distinct.
 *
 * WHY IT EXISTS BESIDE clearFamily()
 * ---------------------------------
 * `clearFamily()` derives a prefix and assumes a `:` before the field (`protocol:<s>:<d>:f`). That is
 * correct for the `protocol` family and WRONG for every dot-style family, so
 * `clearFamily('backtestBaseline', 'vix-spike-v1')` deletes nothing and reports `deleted: 0` — which
 * reads as "there was nothing to clear". A silent no-op on a delete is the failure this repo keeps
 * re-finding: plausible output, no error.
 *
 * `clear(key)` takes the exact key, so it needs no separator knowledge. What it must NOT do is become
 * an unowned delete path, so the guards are asserted here:
 *
 *   · an undeclared key is REFUSED (the #849 ownership rule applies to deletes too);
 *   · a `secret` setting is REFUSED (there is no stored row — it lives in `.env`);
 *   · `deleted: 0` is reported with `previousSource: 'absent'`, so "cleared" and "was never set" stay
 *     distinguishable rather than both looking like success.
 */

function stubPrisma(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const prisma = {
    isAvailable: true,
    globalSetting: {
      findUnique({ where }: { where: { key: string } }) {
        const value = rows.get(where.key);
        return Promise.resolve(value === undefined ? null : { key: where.key, value });
      },
      deleteMany({ where }: { where: { key?: string } }) {
        if (where.key !== undefined) {
          const existed = rows.delete(where.key);
          return Promise.resolve({ count: existed ? 1 : 0 });
        }
        return Promise.resolve({ count: 0 });
      },
      upsert() {
        return Promise.resolve({});
      },
    },
  };
  return { prisma, rows };
}

const resolverWith = (initial: Record<string, string> = {}) => {
  const { prisma, rows } = stubPrisma(initial);
  return {
    resolver: new SettingsResolverService(prisma as unknown as PrismaService),
    rows,
  };
};

const BASELINE = 'backtest.baseline.vix-spike-v1.runId';

describe('SettingsResolverService.clear', () => {
  it('deletes exactly the named key and reports what it replaced', async () => {
    const { resolver, rows } = resolverWith({
      [BASELINE]: 'f05433fd-4bc2-4863-a23a-7932ad0e2e30',
      // A second member of the SAME family: a single-key clear must not touch it.
      'backtest.baseline.vix-spike-v1.acceptedAt': '2026-10-27T18:00:00.000Z',
      'backtest.baseline.btc-speed-v1.runId': '521cbe05-701e-4752-8efc-49ea226e21f7',
    });

    const result = await resolver.clear(BASELINE);

    expect(result).toEqual({
      key: BASELINE,
      deleted: 1,
      previousSource: 'db',
    });
    expect(rows.has(BASELINE)).toBe(false);
    // ⚠️ The neighbours survive. This is the assertion that would fail if `clear` were implemented by
    // delegating to `clearFamily` — which is the obvious "reuse" a later author would reach for.
    expect(rows.has('backtest.baseline.vix-spike-v1.acceptedAt')).toBe(true);
    expect(rows.has('backtest.baseline.btc-speed-v1.runId')).toBe(true);
  });

  it('reports absent rather than pretending a delete happened', async () => {
    const { resolver } = resolverWith({});
    const result = await resolver.clear(BASELINE);
    expect(result.deleted).toBe(0);
    expect(result.previousSource).toBe('absent');
  });

  it('clears a declared runtime setting so the declared default takes over again', async () => {
    const { resolver } = resolverWith({ 'risk.maxOpenPositions': '20' });
    expect((await resolver.resolve('risk.maxOpenPositions')).value).toBe(20);

    await resolver.clear('risk.maxOpenPositions');

    const after = await resolver.resolve('risk.maxOpenPositions');
    expect(after.value).toBe(5);
    expect(after.source).toBe('default');
  });

  it('REFUSES an undeclared key — a delete is a write and needs an owner', async () => {
    const { resolver, rows } = resolverWith({ earnings_import_last: '2026-10-01' });
    await expect(resolver.clear('earnings_import_last')).rejects.toThrow(
      /matches no family/,
    );
    // Refused means untouched, not "deleted 0 after a partial attempt".
    expect(rows.has('earnings_import_last')).toBe(true);
  });

  it('REFUSES a secret — there is no stored row to delete', async () => {
    const { resolver } = resolverWith({});
    await expect(resolver.clear('secret.mt5Password')).rejects.toThrow();
  });
});
