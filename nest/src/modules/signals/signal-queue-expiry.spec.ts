import { SignalQueueService } from './signal-queue.service';
import {
  SIGNAL_MAX_AGE_DEFAULT_MINUTES,
  getMaxSignalAgeMinutes,
  signalAgeMinutes,
} from '../../common/utils/signal-freshness';

/**
 * #882 — the expiry sweep and the shared freshness rule.
 *
 * ⚠️ THE REGRESSION THESE TESTS GUARD. The void pass only sees pairs scored THIS run, so an
 * entry whose pair stops being scored is never voided — on 2026-09-21 one executed 120 hours
 * after insertion. The sweep is the fix; these tests hold its three load-bearing pieces:
 *   1. staleness keys on `updatedAt` (last CONFIRMATION), never `createdAt` (first insert);
 *   2. expiry ARCHIVES (`status='expired'`) and never deletes;
 *   3. the log tells 'expired — no longer observed' apart from 'Queue void', because
 *      conflating the two causes is how the defect stayed invisible.
 */
describe('signal-freshness — the one bound (#882)', () => {
  const ORIG = process.env.SIGNAL_MAX_AGE_MINUTES;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.SIGNAL_MAX_AGE_MINUTES;
    else process.env.SIGNAL_MAX_AGE_MINUTES = ORIG;
  });

  it('defaults to 360 minutes when unset', () => {
    delete process.env.SIGNAL_MAX_AGE_MINUTES;
    expect(getMaxSignalAgeMinutes()).toBe(SIGNAL_MAX_AGE_DEFAULT_MINUTES);
    expect(SIGNAL_MAX_AGE_DEFAULT_MINUTES).toBe(360);
  });

  it('reads a valid env override and rejects a broken one (never NaN)', () => {
    process.env.SIGNAL_MAX_AGE_MINUTES = '90';
    expect(getMaxSignalAgeMinutes()).toBe(90);
    process.env.SIGNAL_MAX_AGE_MINUTES = 'abc';
    expect(getMaxSignalAgeMinutes()).toBe(SIGNAL_MAX_AGE_DEFAULT_MINUTES);
    process.env.SIGNAL_MAX_AGE_MINUTES = '-5';
    expect(getMaxSignalAgeMinutes()).toBe(SIGNAL_MAX_AGE_DEFAULT_MINUTES);
  });

  it('signalAgeMinutes measures from now, and an undateable value is Infinity (fail-closed)', () => {
    const now = Date.now();
    expect(signalAgeMinutes(new Date(now - 10 * 60000), now)).toBe(10);
    expect(signalAgeMinutes(new Date(now + 60000), now)).toBe(0); // future → clamp, never negative
    expect(signalAgeMinutes(null, now)).toBe(Number.POSITIVE_INFINITY);
    expect(signalAgeMinutes('not-a-date', now)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('SignalQueueService.syncQueues — expiry sweep (#882)', () => {
  function make(execImpl?: (sql: string, args: any[]) => any) {
    const svc = new SignalQueueService({ isAvailable: true } as any);
    const exec = jest.fn(async (sql: string, ...args: any[]) => (execImpl ? execImpl(sql, args) : 0));
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM strategy_signal_queue') && sql.includes('TIMESTAMPDIFF')) {
        return [{ id: 'q-stale', symbol: 'USDJPY', protocolId: 'forex-session-v1', ageMin: 444 }];
      }
      return []; // subs query
    });
    (svc as any).prisma = { isAvailable: true, $executeRawUnsafe: exec, $queryRawUnsafe: query };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, exec, query };
  }

  it('archives stale pending entries and names the cause in the log', async () => {
    const { svc, exec } = make();
    // A pair was scored and did not signal (void runs too), and one entry is stale.
    await svc.syncQueues([], new Set(['forex-session-v1|EURUSD']));
    const logs = ((svc as any).logger.log as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Queue expire:') && l.includes('USDJPY 444m'))).toBe(true);
    const expireUpd = exec.mock.calls.find((c) => String(c[0]).includes("SET status = 'expired'") && String(c[0]).includes('TIMESTAMPDIFF') === false && String(c[0]).includes('updatedAt <'));
    expect(expireUpd).toBeTruthy();
    expect(expireUpd![1]).toBe(360); // the shared bound travels as a parameter, not a literal
  });

  it('the staleness UPDATE keys on updatedAt, never createdAt', async () => {
    const { svc, exec } = make();
    await svc.syncQueues([], new Set(['forex-session-v1|EURUSD']));
    const sql = exec.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).toContain('updatedAt < UTC_TIMESTAMP()');
    expect(sql).not.toContain('createdAt <');
  });

  it('expires unconsumable entries (no active bot+subscription) in the same pass, count logged', async () => {
    const { svc, exec } = make((sql) => (sql.includes('NOT EXISTS') ? 2 : 0));
    await svc.syncQueues([], new Set(['forex-session-v1|EURUSD']));
    const logs = ((svc as any).logger.log as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('no active bot subscription'))).toBe(true);
    expect(exec.mock.calls.some((c) => String(c[0]).includes('NOT EXISTS') && String(c[0]).includes("SET status = 'expired'"))).toBe(true);
  });

  it("void and expire read as different events in the log (#882 acceptance)", async () => {
    const { svc } = make();
    await svc.syncQueues([], new Set(['forex-session-v1|EURUSD']));
    const logs = ((svc as any).logger.log as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Queue void:'))).toBe(true);
    expect(logs.some((l) => l.startsWith('Queue expire:'))).toBe(true);
    const voidMsg = logs.find((l) => l.startsWith('Queue void:'))!;
    const expireMsg = logs.find((l) => l.startsWith('Queue expire:'))!;
    expect(voidMsg).not.toBe(expireMsg);
    expect(expireMsg).toContain('no longer observed');
  });
});
