import { AbTestService } from './ab-test.service';

/**
 * #929 — the honesty bar and the capacity policy.
 *
 * ⚠️ WHY THESE EXIST. An A/B "result" that names a winner on three trades is noise wearing a
 * result's clothes — the exact class of plausible-number-no-error this repo keeps paying for.
 * And capacity (1 test × 4 symbols) was the binding constraint that kept evidence from ever
 * accumulating; it is widened here WITH the honesty bar so speed cannot become false confidence.
 */
describe('AbTestService — verdict honesty + capacity (#929)', () => {
  function make(trades: any[], running: any[] = []) {
    const svc = Object.create(AbTestService.prototype) as AbTestService;
    (svc as any).prisma = {
      trade: { findMany: jest.fn(async () => trades) },
      metaStackSnapshot: {
        findMany: jest.fn(async () => [{ id: 'c' }, { id: 'v' }]),
        // #929 — `start()` now resolves the trade authority from the snapshot's scoring strategy,
        // so the harness must answer that lookup. The 'auto' bot below is what makes a test
        // startable at all; without it `start()` refuses, which is the point of the fix.
        findUnique: jest.fn(async (args: any) => ({ id: args.where.id, scoringStrategyId: 'ss-1' })),
      },
      tradingStrategy: {
        findMany: jest.fn(async () => [{ id: 'b1', name: 'Harness Bot', mode: 'auto', active: 1 }]),
      },
      abTest: {
        findMany: jest.fn(async () => running),
        findFirst: jest.fn(async () => running[0] ?? null),
        findUnique: jest.fn(async (args: any) => ({ id: args.where.id, name: 't', status: 'draft', controlStackId: 'c', variantStackId: 'v', symbols: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 'x', ...data })),
      },
    };
    (svc as any).adapterFactory = { create: jest.fn(() => ({})) };
    (svc as any).tradeRecorder = {};
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { svc };
  }

  // ⚠️ #929 — the side is `abTestSide`, NOT the `AB-A`/`AB-B` tag inside `brokerComment`.
  // The comment is mutable (the stranded-trade reaper overwrites it), so a reaped trade used to
  // lose its side and disappear from the verdict in silence. The comment is still set here on
  // purpose: it proves the split ignores it.
  const t = (side: 'AB-A' | 'AB-B', pnl: number) => ({
    status: 'closed',
    pnl,
    abTestSide: side === 'AB-A' ? 'A' : 'B',
    brokerComment: `TCS ${side} test`,
    openedAt: new Date(),
  });

  it('attributes a REAPED row whose brokerComment was overwritten (#929)', async () => {
    // Measured 2026-09-23: 14 of 14 A/B rows had their comment rewritten by the reaper, and the
    // old comment-parsing split attributed 0 to each side — `0 vs 0` for a test full of trades.
    const reaped = [
      { status: 'closed', pnl: 12, abTestSide: 'A', brokerComment: 'Reconciled: no broker counterpart (stranded row)' },
      { status: 'closed', pnl: -3, abTestSide: 'B', brokerComment: 'Reconciled: no broker counterpart (stranded row)' },
    ];
    const { svc } = make(reaped as any);
    const res = await (svc as any).computeResults({ id: 'ab1', name: 'x', symbols: ['EURUSD'] });

    expect(res.control.closedTrades).toBe(1);
    expect(res.variant.closedTrades).toBe(1);
    expect(res.unattributed).toBe(0);
  });

  it('REPORTS rows it cannot attribute instead of presenting "0 vs 0" (#929)', async () => {
    const orphan = [
      { status: 'closed', pnl: 5, abTestSide: null, brokerComment: 'Reconciled: no broker counterpart (stranded row)' },
    ];
    const { svc } = make(orphan as any);
    const res = await (svc as any).computeResults({ id: 'ab1', name: 'x', symbols: ['EURUSD'] });

    // "no trades yet" and "trades we cannot attribute" must not render the same.
    expect(res.unattributed).toBe(1);
    expect(res.verdict.unattributed).toBe(1);
    expect(res.verdict.note).toContain('do NOT read this as "no trades yet"');
  });

  it('REFUSES a verdict below 30 closed trades per side — and says the counts', async () => {
    const trades = [t('AB-A', 5), t('AB-A', -2), t('AB-B', 1)];
    const { svc } = make(trades);
    const res = await (svc as any).computeResults({ id: 'ab1', name: 'x', symbols: ['EURUSD'] });

    expect(res.verdict.verdict).toBe('insufficient-data');
    expect(res.verdict.n).toEqual({ control: 2, variant: 1 });
    expect(res.verdict.note).toContain('need ≥30 per side');
    expect(res.verdict.pValue).toBeUndefined(); // no statistical theatre on a tiny sample
  });

  it('names the leader WITH its method when the sample clears the bar (30v30, 67%v33%)', async () => {
    const trades = [
      ...Array.from({ length: 20 }, () => t('AB-A', 1)),
      ...Array.from({ length: 10 }, () => t('AB-A', -1)),
      ...Array.from({ length: 10 }, () => t('AB-B', 1)),
      ...Array.from({ length: 20 }, () => t('AB-B', -1)),
    ];
    const { svc } = make(trades);
    const res = await (svc as any).computeResults({ id: 'ab1', name: 'x', symbols: ['EURUSD'] });

    expect(res.verdict.verdict).toBe('control-leads');
    expect(res.verdict.method).toContain('two-proportion z-test');
    expect(res.verdict.pValue).toBeLessThan(0.05);
    expect(res.verdict.n).toEqual({ control: 30, variant: 30 });
  });

  it('identical records read as NO significant difference — not a coin-flip verdict', async () => {
    const trades = [
      ...Array.from({ length: 15 }, () => t('AB-A', 1)),
      ...Array.from({ length: 15 }, () => t('AB-A', -1)),
      ...Array.from({ length: 15 }, () => t('AB-B', 1)),
      ...Array.from({ length: 15 }, () => t('AB-B', -1)),
    ];
    const { svc } = make(trades);
    const res = await (svc as any).computeResults({ id: 'ab1', name: 'x', symbols: ['EURUSD'] });
    expect(res.verdict.verdict).toBe('no-significant-difference');
  });

  it('capacity: a third test is refused while AB_MAX_ACTIVE (default 2) are running', async () => {
    const running = [{ id: 'r1', name: 'one' }, { id: 'r2', name: 'two' }];
    const { svc } = make([], running);
    await expect(svc.start('new-test')).rejects.toThrow(/capacity reached \(2\/2/);
  });

  it('capacity: a second test IS allowed (the old max-1 rule is gone)', async () => {
    const running = [{ id: 'r1', name: 'one' }];
    const { svc } = make([], running);
    const started = await svc.start('new-test');
    expect(started.status).toBe('running');
  });
});
