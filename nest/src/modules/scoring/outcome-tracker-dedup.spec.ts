import { OutcomeTrackerService } from './outcome-tracker.service';

/**
 * OutcomeTrackerService — dedup by IDENTITY, not by elapsed time (#825).
 *
 * ⚠️ THE DEFECTS THESE TESTS GUARD (all measured on the live system, 2026-09-15 → 2026-09-21):
 *   1. the dedup key omitted `strategyId`, so a directive firing under protocol A suppressed the
 *      SAME directive under protocol B for five minutes — one protocol's observation cancelled
 *      another's;
 *   2. the 5-minute window against a ~2-minute cadence dropped ~3 of every 4 passes even after
 *      (1) was fixed — `directiveoutcome` was a sparse SAMPLE, silently;
 *   3. drops were logged at DEBUG and the counters were merged, so a 75% silent drop looked
 *      exactly like a quiet market.
 *
 * The rule now: record what was observed; the identity determines duplication.
 *   identity = strategyId :: directiveId :: symbol :: predictedAt
 */
describe('OutcomeTrackerService — identity dedup (#825)', () => {
  function make() {
    const createMany = jest.fn(async ({ data }: any) => ({ count: data.length }));
    const svc = new OutcomeTrackerService({
      isAvailable: true,
      directiveOutcome: { createMany },
    } as any);
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { svc, createMany };
  }

  const item = (over: any = {}) => ({
    directiveId: 'rsi-oversold', symbol: 'BTC', strategyId: 'btc-speed-v1',
    timeframe: '15m', score: 42, signalClass: 'bullish', confidence: 0.4,
    predictedAt: new Date('2026-09-22T10:00:00Z'), priceAtPredict: 100, ...over,
  });

  it('records an observation once; a replay of the SAME identity is skipped and COUNTED, not silent', async () => {
    const { svc, createMany } = make();
    const first = await svc.recordOutcomes([item()]);
    const second = await svc.recordOutcomes([item()]); // same pass replayed
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(createMany).toHaveBeenCalledTimes(1); // the replay never reached the DB

    const stats = svc.getRecordingStats();
    expect(stats.duplicateIdentitySkipped).toBe(1);
    expect(stats.recorded).toBe(1);

    // The visible record: the per-pass log names both numbers (the old line said nothing at a
    // level anyone reads — that is how a 75% drop went unseen).
    const logs = ((svc as any).logger.log as jest.Mock).mock.calls.map((c) => String(c[0])).join(' ');
    expect(logs).toContain('duplicate identity skipped');
  });

  it('the SAME directive+symbol under TWO protocols records BOTH (cross-protocol suppression is gone)', async () => {
    const { svc } = make();
    const a = await svc.recordOutcomes([item({ strategyId: 'forex-session-v1' })]);
    const b = await svc.recordOutcomes([item({ strategyId: 'gold-macro-v1' })]);
    expect(a).toBe(1);
    expect(b).toBe(1); // one protocol's observation must not cancel another's
  });

  it('a NEW pass is a NEW observation — there is no time-window suppression any more', async () => {
    const { svc } = make();
    await svc.recordOutcomes([item()]);
    const next = await svc.recordOutcomes([item({ predictedAt: new Date('2026-09-22T10:02:00Z') })]);
    expect(next).toBe(1); // 2 minutes apart: previously dropped by the 5-minute window
  });

  it('zero-score drops are counted SEPARATELY from identity drops', async () => {
    const { svc, createMany } = make();
    const n = await svc.recordOutcomes([item({ score: 0 })]);
    expect(n).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    const s = svc.getRecordingStats();
    expect(s.zeroScoreSkipped).toBe(1);
    expect(s.duplicateIdentitySkipped).toBe(0);
  });

  it('getRecordingStats exposes the rate the audit script thresholds on', () => {
    const { svc } = make();
    (svc as any).identityDropped = 30;
    (svc as any).recordedTotal.n = 70;
    const s = svc.getRecordingStats();
    expect(s.identityDropRatePct).toBe(30); // 30 / (70 + 30)
    expect(s.note).toContain('IDENTITY');
  });
});
