import { MetaStackVersioningService } from './metastack-versioning.service';
import { BOT_BAR_DEFAULT } from '../../common/utils/style-thresholds';

/**
 * #929 — the variant instrument: base + DECLARED change → a genuinely different version.
 *
 * ⚠️ THE DEFECT THESE TESTS GUARD. A/B has never run because no strategy had a second version,
 * and `createSnapshot` can only copy the CURRENT config (a v-next identical to its base — an
 * A/B between identical configs measures nothing). The failure mode to prevent is precisely the
 * silent no-op: a "variant" that does not differ, or a typo'd key that quietly does nothing.
 *
 * ⚠️ WHY THE FIXTURE IMPORTS BOT_BAR_DEFAULT. The 13 real July snapshots carry
 * `tradeThreshold` 50-60 — those were written on the PRE-2026-09-15-rescale scale, where the
 * bot bar was 60. Writing 55/40 into a fixture reproduces a bar that the current composite
 * scale (~0-35) can never clear (#839), so `validate-threshold-sources.cjs` fails the build.
 * The threshold here is a UNIT, not a value to copy from a stale row.
 */
describe('MetaStackVersioningService.cloneSnapshotWithChanges (#929)', () => {
  function make(baseRow: any) {
    const create = jest.fn(async ({ data }: any) => ({ id: 'snap-new', ...data }));
    const changeLog = jest.fn(async () => ({}));
    const svc = Object.create(MetaStackVersioningService.prototype) as MetaStackVersioningService;
    (svc as any).prisma = {
      metaStackSnapshot: {
        findFirst: jest.fn(async () => baseRow),
        findUnique: jest.fn(async () => baseRow),
        create,
      },
      metaStackChangeLog: { create: changeLog },
    };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, create, changeLog };
  }

  const base = () => ({
    id: 'snap-base',
    version: '1.0.0',
    snapshot: { name: 'US SPX500 Day', protocolId: 'spy-day-v1', tradeThreshold: BOT_BAR_DEFAULT, weightStrategy: 'group-weighted', slPct: 1 },
  });

  it('creates a bumped variant and names the changed keys in the change log', async () => {
    const { svc, create, changeLog } = make(base());
    const out = await svc.cloneSnapshotWithChanges('ss-1', { tradeThreshold: BOT_BAR_DEFAULT + 5 }, { note: 'threshold hypothesis', createdBy: 'test' });

    expect(out.version).toBe('1.0.1');
    expect(out.changedKeys).toEqual(['tradeThreshold']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: '1.0.1',
          snapshot: expect.objectContaining({ tradeThreshold: BOT_BAR_DEFAULT + 5, protocolId: 'spy-day-v1' }),
        }),
      }),
    );
    const log = changeLog.mock.calls[0][0].data;
    expect(log.summary).toContain('tradeThreshold');
    expect(log.details.note).toBe('threshold hypothesis');
  });

  it('REJECTS an unknown key — a typo must fail, not create a junk variant', async () => {
    const { svc, create } = make(base());
    await expect(svc.cloneSnapshotWithChanges('ss-1', { tradThreshold: BOT_BAR_DEFAULT + 5 })).rejects.toThrow(/Unknown snapshot key/);
    expect(create).not.toHaveBeenCalled();
  });

  it('REJECTS a change that does not alter the snapshot — a no-op is not a variant', async () => {
    const { svc, create } = make(base());
    await expect(svc.cloneSnapshotWithChanges('ss-1', { tradeThreshold: BOT_BAR_DEFAULT })).rejects.toThrow(/do not alter/);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws NotFound when there is no snapshot to base a variant on', async () => {
    const { svc } = make(null);
    await expect(svc.cloneSnapshotWithChanges('ss-missing', { tradeThreshold: BOT_BAR_DEFAULT + 5 })).rejects.toThrow(/No snapshot/);
  });
});
