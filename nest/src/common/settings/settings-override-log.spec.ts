import { SettingsResolverService } from './settings-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * settings-override-log.spec.ts — the append-only history of per-protocol overrides (#1144).
 *
 * WHY THIS EXISTS
 * ---------------
 * A per-protocol override lives in ONE mutable settings row (`protocol:<slug>:<dir>:maxScore`) written
 * with `upsert`. Overwriting it destroyed the previous value, so after the second change nobody could
 * answer "which configuration produced this run?". Measured evidence that it matters: run `5b906133`
 * holds BOTH 1395 and 1575 capacity, because an override landed while it was scoring — the run is
 * evidence of the gap and could not be explained from stored data.
 *
 * What is asserted here:
 *
 *   · the previous value is captured BEFORE the overwrite, so `oldValue` is real and `null` means
 *     ABSENT (a first override or a reset), never "it was 0";
 *   · `configVersion` is monotonic PER PROTOCOL — the join key `BacktestRun.configVersion` points at;
 *   · a non-protocol setting is NOT logged (the log is about overrides, not every setting);
 *   · a failing audit insert does NOT stop the override — the write already happened, and discarding a
 *     deliberate change because bookkeeping failed trades an action for a record of it.
 */

function stubPrisma(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const changes: Array<Record<string, any>> = [];
  const prisma = {
    isAvailable: true,
    globalSetting: {
      findUnique({ where }: { where: { key: string } }) {
        const value = rows.get(where.key);
        return Promise.resolve(value === undefined ? null : { key: where.key, value });
      },
      findMany({ where }: any) {
        const prefix: string = where?.key?.startsWith ?? '';
        return Promise.resolve(
          [...rows.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([key, value]) => ({ key, value })),
        );
      },
      upsert({ where, create }: any) {
        rows.set(where.key, create.value);
        return Promise.resolve({});
      },
      deleteMany({ where }: any) {
        if (where.key?.startsWith) {
          const prefix: string = where.key.startsWith;
          const doomed = [...rows.keys()].filter((k) => k.startsWith(prefix));
          doomed.forEach((k) => rows.delete(k));
          return Promise.resolve({ count: doomed.length });
        }
        const existed = rows.delete(where.key);
        return Promise.resolve({ count: existed ? 1 : 0 });
      },
    },
    protocolDirectiveChange: {
      aggregate({ where }: any) {
        const forSlug = changes.filter((c) => c.protocolSlug === where.protocolSlug);
        const max = forSlug.reduce((m, c) => Math.max(m, c.configVersion), 0);
        return Promise.resolve({ _max: { configVersion: forSlug.length ? max : null } });
      },
      create({ data }: any) {
        changes.push(data);
        return Promise.resolve(data);
      },
    },
  };
  return { prisma, rows, changes };
}

const resolverWith = (initial: Record<string, string> = {}) => {
  const stub = stubPrisma(initial);
  return {
    resolver: new SettingsResolverService(stub.prisma as unknown as PrismaService),
    ...stub,
  };
};

const KEY = 'protocol:btc-speed-v1:crypto-fear-greed:maxScore';

describe('per-protocol override history (#1144)', () => {
  it('records the FIRST override with oldValue null (absent, not zero) and version 1', async () => {
    const { resolver, changes } = resolverWith();
    await resolver.set(KEY, '240');

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      protocolSlug: 'btc-speed-v1',
      directiveId: 'crypto-fear-greed',
      field: 'maxScore',
      oldValue: null,
      newValue: '240',
      configVersion: 1,
    });
  });

  it('captures the value it REPLACES, and bumps the version', async () => {
    const { resolver, changes } = resolverWith({ [KEY]: '240' });
    await resolver.set(KEY, '300');

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: '240', newValue: '300', configVersion: 1 });
  });

  it('keeps one monotonic sequence PER PROTOCOL, so two protocols do not share a version', async () => {
    const { resolver, changes } = resolverWith();
    await resolver.set(KEY, '240');
    await resolver.set('protocol:eth-speed-v1:crypto-fear-greed:maxScore', '120');
    await resolver.set(KEY, '300');

    expect(changes.map((c) => [c.protocolSlug, c.configVersion])).toEqual([
      ['btc-speed-v1', 1],
      ['eth-speed-v1', 1],
      ['btc-speed-v1', 2],
    ]);
  });

  it('records a RESET as newValue null, keeping the value it removed', async () => {
    const { resolver, changes } = resolverWith({ [KEY]: '240' });
    await resolver.clear(KEY);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: '240', newValue: null, configVersion: 1 });
  });

  it('records a bulk family reset field by field, because "deleted 2 rows" cannot say what changed', async () => {
    const other = 'protocol:btc-speed-v1:crypto-fear-greed:minScore';
    const { resolver, changes } = resolverWith({ [KEY]: '240', [other]: '5' });
    await resolver.clearFamily('protocol', 'btc-speed-v1:crypto-fear-greed');

    expect(changes.map((c) => c.field).sort()).toEqual(['maxScore', 'minScore']);
    expect(changes.every((c) => c.newValue === null)).toBe(true);
  });

  it('does NOT log a setting that is not a per-protocol override', async () => {
    const { resolver, changes } = resolverWith();
    await resolver.set('backtest.baseline.btc-speed-v1.runId', 'abc123');
    expect(changes).toHaveLength(0);
  });

  it('still completes the WRITE when the audit insert fails', async () => {
    const { resolver, rows, prisma } = resolverWith();
    (prisma as any).protocolDirectiveChange.create = () => Promise.reject(new Error('audit table is gone'));

    await expect(resolver.set(KEY, '240')).resolves.toBeDefined();
    expect(rows.get(KEY)).toBe('240');
  });
});
